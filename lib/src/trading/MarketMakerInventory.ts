import IOrder from "../exchange/IOrder";
import Balance from "../exchange/Balance";
import Ticker from "../exchange/Ticker";
import { Candle } from "../exchange/Candle";
import MathHelper from "../core/MathHelper";
import { OrderSide } from "../exchange/OrderSide";
import { TechnicalIndicators } from "./TechnicalIndicators";
import { tail } from "../core/ArrayUtils";
import { ILogger } from "../core/log";

export interface IMarketMakingInput extends Partial<IMarketMakingOptions> {
    log: ILogger;
    currentTime: number;
    market: string;
    ticker: Ticker;
    buyOrders: IOrder[];
    sellOrders: IOrder[];
    targetBalance: number;
    balance: Balance;
    quoteBalance: Balance;
    hourCandles: Candle[];
    cancelAllOrders: () => Promise<void>;
    sell: (amount: number, price: number) => Promise<string>;
    buy: (amount: number, price: number) => Promise<string>;
    getLastClosedOrder: (side: OrderSide) => IOrder;
    convertToBase: (amount: number, price?: number) => number;
}

// the properties below are optional settings, each with a default value
export interface IMarketMakingOptions {
    sigma: number;
    mu: number;
    inventorySteps: number;
    minDealAmount: number;
    minimumNotionalValue: number;
    riskAversionCorrection: number;
    spreadFixedTerm: number;
    spreadSigmaMultiplier: number;
    minNextQuoteDifference: number;
    dynamicAmountDropoff: number;
    emaPeriodSlow: number;
    tradingRangeSigmaMultiplier: number; // x times sigma is the allowed trading range around the price level
    tradeVolumeCap: number; // maximum allowed order size based on daily trade volume
    coolOffPeriod: string;
}

const defaultOptions: IMarketMakingOptions = {
    sigma: 0.05,
    mu: 0,
    spreadFixedTerm: 0.005,
    spreadSigmaMultiplier: 0.1,
    inventorySteps: 8,
    minDealAmount: 1,
    minimumNotionalValue: 0,
    riskAversionCorrection: 0.1,
    minNextQuoteDifference: 0.005,
    dynamicAmountDropoff: 20,
    emaPeriodSlow: 20,
    tradingRangeSigmaMultiplier: 1,
    tradeVolumeCap: 0.01,
    coolOffPeriod: "2h"
};

export async function runMarketMaker(input: IMarketMakingInput) {
    // set the default values
    const completeInput = Object.assign({}, defaultOptions, input);

    const {
        log,
        currentTime,
        market,
        balance,
        quoteBalance,
        minNextQuoteDifference,
        emaPeriodSlow,
        dynamicAmountDropoff,
        minimumNotionalValue,
        coolOffPeriod,
        buyOrders,
        sellOrders,
        ticker,
        getLastClosedOrder,
        cancelAllOrders,
        sell,
        buy,
        convertToBase
    } = completeInput;

    // compute the last slow ema value and the mid price
    const emaSlow = await ema(
        Object.assign({}, completeInput, {
            emaPeriod: emaPeriodSlow
        })
    );

    const midPrice = (ticker.bid + ticker.ask) / 2;

    // if there is a two-sided quote, do nothing
    if (buyOrders.length > 0 && sellOrders.length > 0) {
        log.info(
            `There already is a full quote for market ${market} ignoring further update for this market.`
        );
        return;
    }

    // compute the quote prices
    const quotePrices = await computeQuotePrices(completeInput);

    // compute the deal amount
    const dealAmount = computeDealAmount(completeInput);
    log.info(`Deal amount for market ${market}: ${dealAmount.toFixed(7)}.`);

    // compute the actual amounts, based on the current price level
    const priceLevel = midPrice / emaSlow - 1;
    log.info(
        `Current price level for market ${market} is ${priceLevel.toFixed(2)}.`
    );
    const dynamicDealAmountBuy =
        priceLevel > 0
            ? Math.exp(-priceLevel * dynamicAmountDropoff) * dealAmount
            : dealAmount;
    const dynamicDealAmountSell =
        priceLevel < 0
            ? Math.exp(priceLevel * dynamicAmountDropoff) * dealAmount
            : dealAmount;
    // note if the deal amount is less than the minimum deal amount, just use the minimum deal amount
    // so we can still do market making in this case
    let minDealAmountBuy = completeInput.minDealAmount;
    if (minimumNotionalValue > 0) {
        minDealAmountBuy = Math.max(
            minDealAmountBuy,
            minimumNotionalValue / quotePrices.bid
        );
        log.info(
            `Minimum notional value > 0: ${minimumNotionalValue}. Minimum deal amount for buying in market ${market} = ${minDealAmountBuy}.`
        );
    }
    let minDealAmountSell = completeInput.minDealAmount;
    if (minimumNotionalValue > 0) {
        minDealAmountSell = Math.max(
            minDealAmountSell,
            minimumNotionalValue / quotePrices.ask
        );
        log.info(
            `Minimum notional value > 0: ${minimumNotionalValue}. Minimum deal amount for selling in market ${market} = ${minDealAmountSell}.`
        );
    }
    const buyAmount = Math.min(
        Math.max(minDealAmountBuy, dynamicDealAmountBuy),
        convertToBase(quoteBalance.free, quotePrices.bid)
    );
    const sellAmount = Math.min(
        Math.max(minDealAmountSell, dynamicDealAmountSell),
        balance.free
    );

    log.notice(
        `Computed amounts for market ${market}: ${buyAmount.toFixed(
            7
        )} (buy) and ${sellAmount.toFixed(7)} (sell).`
    );

    // we can only buy if the buy amount is large enough and we are actually in the market
    const canBuy =
        buyAmount >= minDealAmountBuy && balance.total > minDealAmountBuy;

    // we can only sell if the sell amount is large enough
    const canSell = sellAmount >= minDealAmountSell;

    log.notice(
        `Nr of existing buy orders for market ${market}: ${
            buyOrders.length
        }. Nr of existing sell orders: ${sellOrders.length}.`
    );
    log.info(`Market ${market} canBuy = ${canBuy}, canSell = ${canSell}.`);

    // repost quotes if there is a mismatch
    let mismatch = false;
    if (
        (sellOrders.length > 0 && !canSell) ||
        (sellOrders.length === 0 && canSell)
    ) {
        mismatch = true;
    }
    if (
        (buyOrders.length > 0 && !canBuy) ||
        (buyOrders.length === 0 && canBuy)
    ) {
        mismatch = true;
    }

    if (!mismatch) {
        log.info(`No need to change quotes for market ${market}.`);
        return;
    }

    // cancel the remaining open orders
    await cancelAllOrders();

    const promises = [];

    // Place a sell order if possible
    if (canSell) {
        // put in the limit order
        promises.push(
            (async () => {
                const id = await sell(sellAmount, quotePrices.ask);
                log.info(`Sell order placed with id ${id}.`);
            })()
        );
    }
    // Place a buy order if possible
    if (canBuy) {
        // put in the limit order
        promises.push(
            (async () => {
                const id = await buy(buyAmount, quotePrices.bid);
                log.info(`Buy order placed with id ${id}.`);
            })()
        );
    }

    // Resolve the promises
    return Promise.all(promises);
}

async function computeQuotePrices(
    options: IMarketMakingInput
): Promise<{ bid: number; ask: number }> {
    const {
        log,
        market,
        sigma,
        spreadFixedTerm,
        spreadSigmaMultiplier,
        balance,
        targetBalance,
        riskAversionCorrection,
        ticker,
        getLastClosedOrder,
        coolOffPeriod,
        currentTime,
        minNextQuoteDifference
    } = options;

    // compute the offset from the target balance
    const balanceOffset = balance.total - targetBalance;
    const offset = (balance.total - targetBalance) / targetBalance;
    log.notice(
        `Optimal balance for market ${market} = ${targetBalance.toFixed(
            7
        )}. Balance offset = ${balanceOffset.toFixed(
            7
        )}. Inventory offset = ${offset.toFixed(2)}.`
    );

    // compute the midprice and optimal quote prices
    const midPrice = (ticker.bid + ticker.ask) / 2;
    log.notice(`Midprice for market ${market} = ${midPrice}.`);

    // first compute the initial spread
    const spread = spreadFixedTerm + spreadSigmaMultiplier * sigma;

    const quotePrices = {
        bid: midPrice - (midPrice * spread * (1 + offset)) / 2,
        ask: midPrice + (midPrice * spread * (1 - offset)) / 2
    };

    log.notice(
        `Optimal quote prices for market ${market}: ${quotePrices.bid.toFixed(
            7
        )} (bid) and ${quotePrices.ask.toFixed(
            7
        )} (ask). Midprice = ${midPrice.toFixed(7)}. Spread = ${(
            quotePrices.ask - quotePrices.bid
        ).toFixed(7)} (${(
            ((quotePrices.ask - quotePrices.bid) / midPrice) *
            100
        ).toFixed(2)}%).`
    );

    // apply risk aversion correction
    const inventoryBasedRiskAversionCorrection =
        Math.exp(Math.log(2) * Math.abs(offset)) *
        riskAversionCorrection *
        sigma;
    log.notice(
        `Risk aversion correction for market ${market} = ${inventoryBasedRiskAversionCorrection.toFixed(
            7
        )}.`
    );

    if (offset > 0) {
        // correct the bid price downward since inventory is high
        quotePrices.bid *= 1 - inventoryBasedRiskAversionCorrection;
    } else {
        // correct the ask price upward since inventory is low
        quotePrices.ask *= 1 + inventoryBasedRiskAversionCorrection;
    }
    log.notice(
        `Optimal quote prices for market ${market} after risk aversion correction: ${quotePrices.bid.toFixed(
            7
        )} (bid) and ${quotePrices.ask.toFixed(7)} (ask). Spread = ${(
            quotePrices.ask - quotePrices.bid
        ).toFixed(7)} (${(
            ((quotePrices.ask - quotePrices.bid) / midPrice) *
            100
        ).toFixed(2)}%).`
    );

    // widen the spread in case the new quote is buying higher than we just sold or vice versa
    const lastClosedBuyOrder = getLastClosedOrder(OrderSide.Buy);
    const lastClosedSellOrder = getLastClosedOrder(OrderSide.Sell);
    const lastBuyPrice = lastClosedBuyOrder ? lastClosedBuyOrder.price : 0;
    const lastBuyTime = lastClosedBuyOrder
        ? lastClosedBuyOrder.timestampClosed || 0
        : 0;
    if (lastBuyTime > 0) {
        log.info(
            `Last buy for market ${market}: price ${lastBuyPrice.toFixed(
                7
            )}, at ${new Date(lastBuyTime).toISOString()}.`
        );
    } else {
        log.info(`No last buy registered for market ${market}.`);
    }
    const lastSellPrice = lastClosedSellOrder
        ? lastClosedSellOrder.price
        : Infinity;
    const lastSellTime = lastClosedSellOrder
        ? lastClosedSellOrder.timestampClosed || 0
        : 0;
    if (lastSellTime > 0) {
        log.info(
            `Last sell for market ${market}: price ${lastSellPrice.toFixed(
                7
            )}, at ${new Date(lastSellTime).toISOString()}.`
        );
    } else {
        log.info(`No last sell registered for market ${market}.`);
    }
    const coolOffPeriodMs = MathHelper.periodToMs(coolOffPeriod);
    if (lastSellTime + coolOffPeriodMs > currentTime) {
        quotePrices.bid = Math.min(
            quotePrices.bid,
            lastSellPrice * (1 - minNextQuoteDifference)
        );
    }
    if (lastBuyTime + coolOffPeriodMs > currentTime) {
        quotePrices.ask = Math.max(
            quotePrices.ask,
            lastBuyPrice * (1 + minNextQuoteDifference)
        );
    }
    log.notice(
        `Optimal quote prices for market ${market} after last buy/sell correction: ${quotePrices.bid.toFixed(
            7
        )} (bid) and ${quotePrices.ask.toFixed(7)} (ask). Spread = ${(
            quotePrices.ask - quotePrices.bid
        ).toFixed(7)} (${(
            ((quotePrices.ask - quotePrices.bid) / midPrice) *
            100
        ).toFixed(2)}%).`
    );

    return quotePrices;
}

function withinTradingRange(
    options: IMarketMakingInput & {
        emaSlow: number;
    }
): boolean {
    const {
        log,
        market,
        sigma,
        ticker,
        emaSlow,
        tradingRangeSigmaMultiplier
    } = options;

    const maxPrice = emaSlow * (1 + sigma * tradingRangeSigmaMultiplier);
    const minPrice = emaSlow * (1 - sigma * tradingRangeSigmaMultiplier);
    const midPrice = (ticker.bid + ticker.ask) / 2;
    if (midPrice > maxPrice) {
        log.notice(
            `Mid price (${midPrice}) for market ${market} is above maximum allowed price level ${maxPrice.toFixed(
                7
            )}.`
        );
        return false;
    } else if (midPrice < minPrice) {
        log.notice(
            `Mid price (${midPrice}) for market ${market} is below minimum allowed price level ${minPrice.toFixed(
                7
            )}.`
        );
        return false;
    }
    return true;
}

async function ema(options: {
    market: string;
    emaPeriod: number;
    hourCandles: Candle[];
}): Promise<number> {
    const { market, emaPeriod, hourCandles } = options;

    // compute the ema
    const input = hourCandles.map(candle => candle.close);
    const ema = TechnicalIndicators.ema(input, emaPeriod);
    return tail(ema);
}

function computeDealAmount(options: IMarketMakingInput): number {
    const { ticker, targetBalance, inventorySteps, tradeVolumeCap } = options;
    // maximum allowed order size based on daily trade volume
    const maxVolumeCap = tradeVolumeCap * ticker.baseVolume;
    // compute the deal amount
    return Math.min(targetBalance / inventorySteps, maxVolumeCap);
}
