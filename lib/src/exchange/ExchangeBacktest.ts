import Ticker               from "./Ticker";
import Exchange             from "./Exchange";
import { Candle }           from "./Candle";
import IStrategy            from "../trading/IStrategy";
import MathHelper           from "../core/MathHelper";
import FileReader           from "../core/FileReader";
import IEvent               from "./IEvent";
import { cleanCandleData }  from "./ExchangeHelper";

export default class ExchangeBacktest extends Exchange {

    private _tickerData: Record<string, Ticker[]> = {};
    private _candleData: Record<string, Candle[]> = {};
    private _backtestStartTime: number = -1;
    private _backtestEndTime: number = Infinity;
    private _currentBacktestTime: number = -1;
    private _currentPointer: number = -1;
    private _timeframes: string[];

    public constructor(data: object = {}) {
        super(data);
        this._state.simulation = true;
        this.post("exchange_created", data);
    }

    public get currentTime(): number {
        return this._currentBacktestTime;
    }

    public async prepareBacktest(settings: any) {
        let data = settings.data;
        if (settings.files) {
            data = await this.readDataFromFiles(settings.files);
        }
        if (!data) {
            throw new Error(`Cannot run backtest because no data was provided.`);
        }
        // store the ticker data and candles for each market
        const markets = Object.keys(data);
        for (const market of markets) {
            // store the ticker data
            this._tickerData[market] = [];
            for (const tickerArray of data[market].tickers) {
                if (tickerArray && tickerArray.length === 6) {
                    this._tickerData[market].push(new Ticker(tickerArray));
                }
            }
            const tickerData = this._tickerData[market];
            // update the backtest start and end times
            this._backtestStartTime = Math.max(tickerData[0].timestamp, this._backtestStartTime);
            this._backtestEndTime = Math.min(tickerData[tickerData.length - 1].timestamp, this._backtestEndTime);
            // retrieve the available timeframes and sort them by size
            this._timeframes = Object.keys(data[market].candles);
            this._timeframes.sort((a: string, b: string) => {
                return MathHelper.periodToMs(a) - MathHelper.periodToMs(b);
            });

            // store the candle data
            for (const timeframe of this._timeframes) {
                const candles = [];
                for (const candle of data[market].candles[timeframe]) {
                    candles.push(new Candle(candle));
                }
                cleanCandleData(candles);
                this._candleData[market + timeframe] = candles;
            }
        }
    }

    protected async readDataFromFiles(files: any) {
        const data = {};
        // read the market files
        const markets = Object.keys(files);
        for (const market of markets) {
            // load the market file
            data[market] = JSON.parse(await FileReader.read(`backtestdata/${files[market]}`));
        }
        return data;
    }

    public async runBacktest(strategy: IStrategy) {
        if (this._currentPointer >= 0) {
            throw new Error("Can only run a single backtest at a time.");
        }

        // compute how many data points there are in the backtest
        let dataPoints = Infinity;
        const markets = Object.keys(this._tickerData);
        for (const market of markets) {
            dataPoints = Math.min(dataPoints, this._tickerData[market].length);
        }

        // variable for storing the initial prices
        const initialPrices: { [market: string]: number } = {};

        this._currentPointer = 0;

        this.post("backtest_started", {
            startTime: this._backtestStartTime,
            endTime: this._backtestEndTime,
            durationSeconds: (this._backtestEndTime - this._backtestStartTime) / 1000,
            dataPointsNr: dataPoints,
            totalBalance: this.getTotalBalance(true)
        });

        for (; this._currentPointer < dataPoints; this._currentPointer += 1) {
            // update the exchange
            await this.beforeUpdate();
            await this.update();

            // store the initial prices for the buy and hold benchmark data
            if (this._currentPointer === 0) {
                for (const market of markets) {
                    initialPrices[market] = this.getTicker(market).ask;
                }
            }

            // run the strategy
            const result = await strategy.beforeRun();
            if (result) {
                await strategy.run();
            }
        }

        this._currentPointer = dataPoints - 1;
        const buyAndHoldBenchmarks: any = {};
        for (const market of markets) {
            const ticker = this.getTicker(market);
            const change = Math.round((ticker.bid - initialPrices[market]) / initialPrices[market] * 10000) / 100;
            buyAndHoldBenchmarks[market] = {
                initialPrice: initialPrices[market],
                finalPrice: ticker.bid,
                changePercentage: change
            };
        }

        this.post("backtest_finished", {
            openOrders: this.getOpenOrders(),
            totalBalance: this.getTotalBalance(true),
            balances: this.getBalances(),
            buyAndHoldBenchmarks
        });
    }

    public async retrieveLatestCandle(market: string, timeframe?: string, cleanData?: boolean): Promise<Candle> {
        timeframe = timeframe || this._timeframes[0];
        if (timeframe === this._timeframes[0]) {
            return this._candleData[market + timeframe][this._currentPointer];
        } else {
            return super.retrieveLatestCandle(market, timeframe, cleanData);
        }
    }

    public async retrieveCandles(market: string, timeframe: string = "", since?: number, limit: number = 1, cleanData: boolean = true): Promise<Candle[]> {
        timeframe = timeframe || this._timeframes[0];
        const timeframeMs = MathHelper.periodToMs(timeframe);
        if (!this._candleData[market + timeframe]) {
            throw new Error(`Missing candle data for market ${market} and timeframe ${timeframe}`)
        }
        const until = since ? since + limit * timeframeMs : this._currentBacktestTime;
        since = since || this._currentBacktestTime - limit * timeframeMs;
        const data = this._candleData[market + timeframe].filter((value) => {
            return value.timestamp >= since && value.timestamp < until;
        });
        if (timeframe !== this._timeframes[0]) {
            // construct the partial candle data for the last candle
            const lastCandle = data[data.length - 1];
            if (lastCandle) {
                // clear the candle data except the timestamp and the open price
                lastCandle.high = 0;
                lastCandle.low = Infinity;
                lastCandle.close = lastCandle.open;
                lastCandle.volume = 0;
                // get the candles starting at the last timestamp in the smallest timeframe
                const partialCandleData = this._candleData[market + this._timeframes[0]].filter((value) => {
                    return value.timestamp >= lastCandle.timestamp && value.timestamp <= this._currentBacktestTime;
                });
                // construct the new candle data
                for (const candle of partialCandleData) {
                    lastCandle.high = Math.max(lastCandle.high, candle.high); // high
                    lastCandle.low = Math.min(lastCandle.low, candle.low); // low
                    lastCandle.close = candle.close; // close 
                    lastCandle.volume += candle.volume; // volume
                }
            }
        }
        return data;
    }

    // Retrieving tickers

    public getTickers(markets?: string[]): Record<string, Ticker> {
        markets = markets || Object.keys(this._tickerData);
        const tickers = {};
        for (const market of markets) {
            if (this._tickerData[market]) {
                tickers[market] = this._tickerData[market][this._currentPointer];
            }
        }
        return tickers;
    }

    // *******************************************************
    // Updating the exchange
    // *******************************************************

    public async update() {
        await super.update();

        // update the current backtest time
        for (const market of Object.keys(this._tickerData)) {
            this._currentBacktestTime = this._tickerData[market][this._currentPointer].timestamp;
        }
    }

    public async reset() {
        this._events = [];
        this._currentPointer = -1;
        return super.reset();
    }

    // ****************************************************************
    // Managing events (backtest doesn't store events in the database)
    // ****************************************************************

    protected _events: IEvent[] = [];

    public async getEvents() {
        return this._events;
    }

    public async clearEventList() {
        this._events = [];
    }

    public async post(type: string, data?: any) {
        if (!this._events) {
            this._events = [];
        }
        this._events.push({
            exchangeId: null,
            timestamp: this.currentTime,
            type, data
        });
    }
}
