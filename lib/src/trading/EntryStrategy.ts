import IOrder                                   from "../exchange/IOrder";
import Balance                                  from "../exchange/Balance";
import Ticker                                   from "../exchange/Ticker";
import { Candle }                               from "../exchange/Candle";
import { ITrade }                               from "../exchange/ITrade";
import { OrderSide }                            from "../exchange/OrderSide";
import { TechnicalIndicators }                  from "./TechnicalIndicators";
import { tail }                                 from "../core/ArrayUtils";
import MathHelper                               from "../core/MathHelper";
import { ILogger }                              from "../core/log";
import { AgentState } from "./AgentState";
import { logReturns } from "./ProfitLoss";

export interface IEntryStrategyInput extends Partial<IEntryStrategyOptions> {
    log: ILogger;
    currentTime: number;
    market: string;
    ticker: Ticker;
    trend: number;
    priceLevel: number;
    buyOrders: IOrder[];
    balance: Balance;
    quoteBalance: Balance;
    targetBalance: number;
    entryPrice: number;
    dayCandles: Candle[];
    hourCandles: Candle[];
    canEnterMoreMarkets: boolean;
    cancelAllOrders: () => Promise<void>;
    buy: (amount: number) => Promise<string>;
    fetchTrades: () => Promise<ITrade[]>;
    convertToBase: (amount: number) => number;
    convertToQuote: (amount: number) => number;
    setEntryData: (data: { price: number, timestamp: number }) => void;
    setAgentState: (agentState: AgentState) => void;
}

export interface IEntryStrategyOptions {
    emaPeriodDaily: number,
    emaPeriodDailyRetracement: number,
    emaPeriodMid: number;
    emaPeriodFast: number;
    maPeriodVolume: number;
    minimumTrend: number;
    minimumReturns: number;
    minimumReturnsPeriod: number;
    maximumPriceLevel: number;
    atrRetracementMultiplier: number;
    minDealAmount: number;
    minimumNotionalValue: number;
    volumeBalancePeriod: string;
}

const defaultOptions: IEntryStrategyOptions = {
    emaPeriodDaily: 7,
    emaPeriodDailyRetracement: 3,
    emaPeriodMid: 7,
    emaPeriodFast: 3,
    maPeriodVolume: 20,
    minimumTrend: 0.1,
    minimumReturns: 0.01,
    minimumReturnsPeriod: 6,
    maximumPriceLevel: 0.6,
    atrRetracementMultiplier: 0,
    minDealAmount: 1,
    minimumNotionalValue: 0,
    volumeBalancePeriod: "1h"
};

export async function runEntryStrategy(input: IEntryStrategyInput): Promise<boolean> {

    // set the default values
    const completeInput = Object.assign({}, defaultOptions, input);

    const { log, currentTime, market, buyOrders, balance, quoteBalance, ticker, minDealAmount, targetBalance,
        cancelAllOrders, buy, convertToBase, convertToQuote, minimumNotionalValue,
        canEnterMoreMarkets, setEntryData, setAgentState } = completeInput;

    // determine whether there is a sticky buy order
    const stickyBuyOrder = buyOrders.filter((value) => value.sticky).length;

    // if we are currently trying to enter this market, simply check that we are still in an
    // acceptable price range
    if (stickyBuyOrder) {
        if (!await entryPossible(completeInput)) {
            log.notice(`Cancelling sticky buy order for market ${market} since entry is no longer possible.`);
            await cancelAllOrders();
            setAgentState(AgentState.Idle);
            return false;
        } else {
            log.info(`Sticky buy order in place for market ${market}. Ignoring further updates.`);
            setAgentState(AgentState.TryingToEnter);
            return true;
        }
    }

    if (balance.total >= minDealAmount) {
        // we are in the market, and there is no sticky buy order, so entry strategy is not needed
        return false;
    }

    // we are not currently in the market, check whether we should enter it now
    if (targetBalance > 0 && canEnterMoreMarkets && await entryPossible(completeInput)) {
        log.notice(`Trying to enter by placing sticky buy order for market ${market}.`);
        log.info(`Target base balance for market ${market}: ${targetBalance.toFixed(7)}.`);
        let amount = Math.max(0, targetBalance - balance.total);
        log.info(`Amount to buy for market ${market}: ${amount.toFixed(7)}.`);
        // check that we have enough quote balance to perform the operation
        const requiredQuoteAmount = convertToQuote(amount);
        if (requiredQuoteAmount > quoteBalance.free) {
            amount = convertToBase(quoteBalance.free);
            log.info(`Adapted amount to ${amount.toFixed(7)} due to quote balance restriction.`);
        }
        if (amount < Math.max(minDealAmount, minimumNotionalValue / ticker.bid)) {
            log.info(`Available amount for buying (${amount.toFixed(7)}) too low. Aborting entry.`);
            setAgentState(AgentState.Idle);
            return false;
        }

        // initialize the entry price and timestamp of the state
        setEntryData({
            price: null,
            timestamp: null
        });
        
        // cancel the remaining open orders
        await cancelAllOrders();
    
        // put in the limit order
        const id = await buy(amount);
        log.info(`Buy order placed with id ${id}.`);
        setAgentState(AgentState.TryingToEnter);
        return true;
    }

    // we cannot currently enter the market
    log.info(`Cannot enter market ${market} at the moment.`);
    setAgentState(AgentState.Idle);
    return false;
}

async function entryPossible(input: IEntryStrategyInput): Promise<boolean> {

    const { log, market, trend, priceLevel, hourCandles, dayCandles, maximumPriceLevel, ticker,
        emaPeriodDaily, emaPeriodDailyRetracement, emaPeriodMid, emaPeriodFast, minimumTrend, atrRetracementMultiplier,
        minimumReturns, minimumReturnsPeriod, maPeriodVolume } = input;

    if (trend < minimumTrend) {
        log.notice(`Market ${market} trend (${trend.toFixed(4)} < minimum (${minimumTrend}), so entry is not possible.`);
        return false;
    }
    if (priceLevel > maximumPriceLevel) {
        log.notice(`Market ${market} priceLevel (${priceLevel.toFixed(4)} > maximum (${maximumPriceLevel}), so entry is not possible.`);
        return false;
    }

    // compute the returns of the day candles and remove the last element
    const returns = logReturns(dayCandles);
    returns.pop();
    const returnsMa = tail(TechnicalIndicators.ma(returns, minimumReturnsPeriod));
    log.info(`Entry metrics (trend strength) for market ${market}: returns (${returnsMa.toFixed(4)} should be > minimum (${minimumReturns}).`);
    if (returnsMa < minimumReturns) {
        log.notice(`Market ${market} returns (${returnsMa.toFixed(4)} < minimum (${minimumReturns}), so entry is not possible.`);
        return false;
    }

    // verify that at least one third of the returns in the period are at or above the minimum returns
    const minimumReturnNr = Math.floor(minimumReturnsPeriod / 3);
    const positiveReturnCount = returns.slice(returns.length - minimumReturnsPeriod).filter((value) => value >= minimumReturns).length;
    log.info(`Entry metrics (positive return count) for market ${market}: ${positiveReturnCount} should be >= minimum (${minimumReturnNr}).`);
    if (positiveReturnCount < minimumReturnNr) {
        log.notice(`Market ${market} positive return count (${positiveReturnCount} < minimum (${minimumReturnNr}), so entry is not possible.`);
        return false;
    }
    
    // verify that there is enough volume supporting the trend
    const volumes = dayCandles.map((value) => value.volume);
    volumes.pop();
    const volumeMa = tail(TechnicalIndicators.ma(volumes, maPeriodVolume));
    log.info(`Entry metrics (trend-supporting volume) for market ${market}: ${tail(volumes).toFixed(4)} should be >= MA (${volumeMa.toFixed(4)}).`);
    if (tail(volumes) < volumeMa) {
        log.notice(`Market ${market} trend supporting volume (${tail(volumes).toFixed(4)} < MA (${volumeMa.toFixed(4)}), so entry is not possible.`);
        return false;
    }

    // make sure that we enter near the bottom of a retracement
    const dailyCloseValues = dayCandles.map((candle) => candle.close);
    const emaDaily = tail(TechnicalIndicators.ema(dailyCloseValues, emaPeriodDailyRetracement));
    const atr = tail(TechnicalIndicators.atr(dayCandles, emaPeriodDaily));
    const inRetracement = ticker.bid < (emaDaily - atr * atrRetracementMultiplier);
    log.info(`Entry metrics (retracement detection) for market ${market}: bidPrice (${ticker.bid.toFixed(7)}) < (emaDaily ${emaDaily.toFixed(7)} - atr (${atr.toFixed(7)}) * multiplier (${atrRetracementMultiplier}).`);
    if (!inRetracement) {
        log.notice(`Market ${market} not near retracement bottom, so entry is not possible.`);
        return false;
    }
    // compute the hourly ema's
    const closeValues = hourCandles.map((candle) => candle.close);
    const emaMid = TechnicalIndicators.ema(closeValues, emaPeriodMid);
    const emaFast = TechnicalIndicators.ema(closeValues, emaPeriodFast);
    const lastEmaMid = tail(emaMid);
    const lastEmaFast = tail(emaFast);

    const emaEntryPossible = lastEmaFast < lastEmaMid;
    log.notice(`Entry metrics (local setup) for market ${market}: emaFast (${lastEmaFast.toFixed(7)}) < emaMid (${lastEmaMid.toFixed(7)}).`);
    if (!emaEntryPossible) {
        log.notice(`Entry not possible in market ${market} due to local EMA setup.`);
        return false;
    }
    const volumeBalance = await computeVolumeBalance(input);
    log.notice(`Entry metrics (volume balance) for market ${market}: volume balance (${volumeBalance.toFixed(2)}) >= 0.`);
    return volumeBalance >= 0;
}

async function computeVolumeBalance(input: IEntryStrategyInput): Promise<number> {

    const { currentTime, fetchTrades, volumeBalancePeriod } = input;

    const cutoff = currentTime - MathHelper.periodToMs(volumeBalancePeriod);
    const trades = (await fetchTrades()).filter((trade) => trade.timestamp >= cutoff);
    // compute buy and sell volume for trades in the last period
    let buyVolume = 0;
    let sellVolume = 0;
    for (const trade of trades) {
        switch (trade.side) {
            case OrderSide.Buy:
                buyVolume += trade.amount; break;
            case OrderSide.Sell:
                sellVolume += trade.amount; break;
        }
    }
    // there is not enough data, so do not correct the price
    if (!buyVolume && !sellVolume) {
        return 0;
    }
    // compute the volume balance
    return (buyVolume - sellVolume) / (buyVolume + sellVolume);
}
