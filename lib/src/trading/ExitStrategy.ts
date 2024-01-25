import IOrder                           from "../exchange/IOrder";
import Balance                          from "../exchange/Balance";
import Ticker                           from "../exchange/Ticker";
import { Candle }                       from "../exchange/Candle";
import { OrderSide }                    from "../exchange/OrderSide";
import MathHelper                       from "../core/MathHelper";
import { ILogger }                      from "../core/log";
import { TechnicalIndicators }          from "./TechnicalIndicators";
import { tail }                         from "../core/ArrayUtils";
import { logReturns }                   from "./ProfitLoss";
import { AgentState }                   from "./AgentState";

export interface IExitStrategyInput extends Partial<IExitStrategyOptions> {
    log: ILogger;
    currentTime: number;
    market: string;
    canTrade: boolean;
    ticker: Ticker;
    trend: number;
    entryPrice: number;
    entryTimestamp: number;
    sellOrders: IOrder[];
    dayCandles: Candle[];
    hourCandles: Candle[];
    balance: Balance;
    fetchBalance(): Balance;
    getLastClosedOrder: (side: OrderSide) => IOrder;
    cancelAllOrders: () => Promise<void>;
    sell: (amount: number) => Promise<string>;
    setEntryData: (data: { price: number, timestamp: number }) => void;
    setAgentState: (agentState: AgentState) => void;
}

export interface IExitStrategyOptions {
    minDealAmount: number;
    minimumNotionalValue: number;
    atrPeriod: number;
    volatilityMultiplier: number;
    maPeriodReturns: number;
    emaPeriodSlow: number;
    minNextQuoteDifference: number;
    takeProfitRSIThreshold: number;
    takeProfitATRMultiplier: number;
    returnBasedExitAfter: string;
    returnThreshold: number;
}

const defaultOptions: IExitStrategyOptions = {
    atrPeriod: 14,
    volatilityMultiplier: 1,
    minDealAmount: 1,
    minimumNotionalValue: 0,
    maPeriodReturns: 4,
    emaPeriodSlow: 20,
    minNextQuoteDifference: 0.005,
    takeProfitRSIThreshold: 80, // take profit if RSI reaches this threshold
    takeProfitATRMultiplier: 4, // take profit if we can make 4 x ATR in profits
    returnBasedExitAfter: "2d",
    returnThreshold: 0
}

// returns a boolean indicating whether an exit strategy is currently in place
export async function runExitStrategy(input: IExitStrategyInput): Promise<boolean> {

    // set the default values
    const completeInput = Object.assign({}, defaultOptions, input);

    const { log, currentTime, market, sellOrders, canTrade,
        minDealAmount, minimumNotionalValue, entryPrice, entryTimestamp, ticker,
        cancelAllOrders, fetchBalance, sell, setEntryData,
        getLastClosedOrder, setAgentState } = completeInput;

    // if we are not in the market (or the balance is too low to sell at the moment), so we do not need to continue any further
    if (fetchBalance().total <= Math.max(minDealAmount, minimumNotionalValue / ticker.ask)) {
        return true;
    }

    // initialize the entry price and timestamp if needed
    if (!entryPrice || !entryTimestamp) {
        // retrieve the last closed buy order
        const lastClosedBuyOrder = getLastClosedOrder(OrderSide.Buy);
        if (!lastClosedBuyOrder) {
            // there is no last closed buy order, so set the entry price to the current price and time
            completeInput.entryPrice = ticker.average;
            completeInput.entryTimestamp = currentTime;
            log.warning(`Could not retrieve entry price and time for market ${market}. Using current price ${ticker.average.toFixed(7)} and timestamp ${currentTime}`);
        } else {
            completeInput.entryPrice = lastClosedBuyOrder.price;
            completeInput.entryTimestamp = lastClosedBuyOrder.timestampClosed || currentTime;
            log.info(`Storing entry price ${lastClosedBuyOrder.price} and timestamp ${lastClosedBuyOrder.timestampClosed} for market ${market}.`);
        }
        setEntryData({
            price: completeInput.entryPrice,
            timestamp: completeInput.entryTimestamp
        });
    }

    // determine whether there is a sticky sell order
    const stickySellOrder = sellOrders.filter((value) => value.sticky).length;

    // determine whether an exit is needed
    const exitNeeded = await takeProfitExitPossible(completeInput)
        || await returnBasedExitPossible(completeInput);
    
    // if we are currently trying to exit this market, simply check that an exit is still needed
    if (stickySellOrder) {
        if (!exitNeeded && canTrade) {
            log.notice(`Cancelling sticky sell order for market ${market} since exit is no longer needed.`);
            await cancelAllOrders();
            setAgentState(AgentState.HasPosition);
            return false;
        } else {
            log.info(`Sticky sell order in place for market ${market}. Ignoring further updates.`);
            setAgentState(AgentState.TryingToLeave);
            return true;
        }
    }

    // if we are in the market, check whether we should exit the market
    if (exitNeeded) {
        // cancel the remaining open orders
        await cancelAllOrders();
    
        // place a sticky sell order for the remaining inventory
        const balance = fetchBalance();
        const id = await sell(balance.free);
        log.info(`Sell order placed with id ${id}.`);
        setAgentState(AgentState.TryingToLeave);
        return true;
    }

    // no actions were needed for exiting the market
    setAgentState(AgentState.HasPosition);
    return false;
}

async function stopPriceReached(input: IExitStrategyInput): Promise<boolean> {

    const { log, market, ticker } = input;
    const stopPrice = await computeStopPrice(input);
    if (ticker.ask < stopPrice) {
        log.notice(`Stop price level ${stopPrice.toFixed(7)} reached for market ${market}.`);
    }
    return ticker.ask < stopPrice;
}

async function computeStopPrice(input: IExitStrategyInput): Promise<number> {

    const { log, market, ticker, entryPrice, dayCandles,
        entryTimestamp, atrPeriod, volatilityMultiplier } = input;
    
    // compute the ATR array and multiply the values by the stop loss multiplier and subtract these from the candle close prices (ignoring the last (current) candle)
    const candles = dayCandles.slice(0, dayCandles.length - 1);
    const atr = TechnicalIndicators.atr(candles, atrPeriod);

    if (tail(candles).timestamp <= entryTimestamp) {
        const stopPrice = entryPrice - tail(atr) * volatilityMultiplier;
        log.info(`Computed fixed stop price for market ${market}: ${stopPrice.toFixed(7)}. Entry price = ${entryPrice.toFixed(7)}. Current ask price = ${ticker.ask.toFixed(7)}.`);
        return stopPrice;
    }
    const trailingStop = atr.map((atrValue, index) => candles[index].close - atrValue * volatilityMultiplier);

    // ensure that the trailing stop values go strictly up after we entered the market
    for (let i = 1; i <= trailingStop.length - 1; i += 1) {
        if (trailingStop[i] < trailingStop[i - 1] && candles[i].timestamp > entryTimestamp) {
            trailingStop[i] = trailingStop[i - 1];
        }
    }

    // return the last ATR value
    const stopPrice = tail(trailingStop)
    log.info(`Computed trailing stop price for market ${market}: ${stopPrice.toFixed(7)}. Entry price = ${entryPrice.toFixed(7)}. Current ask price = ${ticker.ask.toFixed(7)}.`);
    return stopPrice;
}

async function takeProfitExitPossible(input: IExitStrategyInput): Promise<boolean> {

    const { log, market, ticker, entryPrice, dayCandles,
        minNextQuoteDifference, takeProfitRSIThreshold, takeProfitATRMultiplier } = input;

    // compute the RSI
    const rsi = tail(TechnicalIndicators.rsi(dayCandles, 14));
    const takeProfitPossibleRSI = rsi >= takeProfitRSIThreshold && ticker.ask > entryPrice * (1 + minNextQuoteDifference);
    if (takeProfitPossibleRSI) {
        log.notice(`Take profit RSI exit possible for market ${market} (current RSI value = ${rsi}).`);
    }

    // compute the ATR
    const atr = tail(TechnicalIndicators.atr(dayCandles, 20));
    const exitPrice = entryPrice + takeProfitATRMultiplier * atr
    const takeProfitPossibleATR = ticker.ask >= exitPrice;
    if (takeProfitPossibleATR) {
        log.notice(`Take profit ATR exit possible for market ${market} (ATR = ${atr}, entryPrice = ${entryPrice.toFixed(7)}, take profit exit = ${exitPrice.toFixed(7)}).`);
    }
 
    return takeProfitPossibleRSI || takeProfitPossibleATR;
}

async function returnBasedExitPossible(input: IExitStrategyInput): Promise<boolean> {

    const { currentTime, log, market, ticker, hourCandles, entryTimestamp, returnThreshold,
        maPeriodReturns, dayCandles, emaPeriodSlow, returnBasedExitAfter } = input;

    // first check if a return-based exit should be computed
    if (entryTimestamp + MathHelper.periodToMs(returnBasedExitAfter) > currentTime) {
        log.info(`Return-based exit not yet possible for market ${market} since entry was too recent.`);
        return false;
    }
    
    // compute the MA of the log returns
    const returns = logReturns(dayCandles);
    const ma = TechnicalIndicators.ma(returns, maPeriodReturns);
    log.debug(`Daily log returns moving average for market ${market}: ${JSON.stringify(ma)}`);
    const lastReturnMa = tail(ma);

    if (lastReturnMa > returnThreshold) {
        log.info(`Current return MA value for market ${market}: ${lastReturnMa.toFixed(4)}. Exit not needed.`);
        return;
    }

    // we need to exit this market - check whether now is a good time
    const closeValues = hourCandles.map((candle) => candle.close);
    const emaSlow = TechnicalIndicators.ema(closeValues, emaPeriodSlow);
    const lastEmaSlow = tail(emaSlow);
    const exitPossible = ticker.average > lastEmaSlow;
    if (exitPossible) {
        log.notice(`Return-based exit possible for market ${market}: average ticker price (${ticker.average}) > emaSlow (${lastEmaSlow}) and MA return: ${lastReturnMa.toFixed(4)}.`);
    } else {
        log.notice(`Return-based exit needed for market ${market}, but waiting for the price to consolidate (MA return: ${lastReturnMa.toFixed(4)}).`); 
    }
    return exitPossible;
}
