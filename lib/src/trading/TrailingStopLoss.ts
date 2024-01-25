import TradingAgent             from "./TradingAgent";
import * as tulind              from "tulind";

export interface IStopLossOptions {
    atrPeriod?: number;
    atrMultiplier?: number;
    fixedRisk?: number;
    trailing?: boolean;
}

export default class TrailingStopLoss {

    private _options: IStopLossOptions = {
        atrPeriod: 14,
        atrMultiplier: 3,
        fixedRisk: 0,
        trailing: true
    }

    private _tradingAgent: TradingAgent;
    private _market: string;

    private _maxBid = 0;
    private _stopPrice = 0;

    constructor(market: string, tradingAgent: TradingAgent, options: IStopLossOptions = {}) {
        this._market = market;
        this._tradingAgent = tradingAgent;
        Object.assign(this._options, options);
    }

    public get stopPrice(): number {
        return this._stopPrice;
    }

    public get highestBidPrice(): number {
        return this._maxBid;
    }

    public async computeCurrentStopPrice() {
        const exchange = this._tradingAgent.exchange;
        const candles = await exchange.retrieveCandles(this._market, "1h", undefined, this._options.atrPeriod * 3);
        const high = [];
        const low = [];
        const close = [];
        for (const candle of candles) {
            close.push(candle.close); // closing price
            high.push(candle.high); // high price
            low.push(candle.low); // high price
        }

        if (this._options.fixedRisk) {
            // the stop price is simply the last close price minus the risk
            return close[close.length - 1] * (1 - this._options.fixedRisk);
        } else {
            // the current stop price is the current candle's close - multiplier * ATR
            const atrResult = await this.performATR(high, low, close, this._options.atrPeriod);
            return close[close.length - 1] - this._options.atrMultiplier * atrResult[atrResult.length - 1];
        }
    }

    public async update() {
        const exchange = this._tradingAgent.exchange;

        // retrieve the latest bid price
        const latestBid = exchange.tickers[this._market].bid;

        // compute the new stop price
        if (this._options.trailing || this._stopPrice === 0) {
            const newStopPrice = await this.computeCurrentStopPrice();
            this._stopPrice = Math.max(this._stopPrice, newStopPrice);
        }
        
        // compute the highest bid price until now (best case scenario)
        this._maxBid = Math.max(this._maxBid, latestBid);
    }

    protected async performATR(high: number[], low: number[], close: number[],
        period: number): Promise<number[]> {
        return new Promise<number[]>((resolve, reject) => {
            tulind.indicators.atr.indicator([high, low, close], [period], function(err, results) {
                resolve(results[0]);
            });
        });
    }
}
