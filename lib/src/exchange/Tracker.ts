import ModelCandle                  from "../models/ModelCandle";
import ModelTracker                 from "../models/ModelTracker";
import ModelExchange                from "../models/ModelExchange";
import { CcxtExchangeManager }      from "./ccxt/CcxtExchangeManager";
import { ILogger, createLogger }       from "../core/log";
import { IOrderBook } from "./IOrderBook";
import { ICcxtExchange } from "./ccxt/ICcxtExchange";
import Ticker from "./Ticker";
import { ITrade } from "./ITrade";
import MathHelper from "../core/MathHelper";

export default class Tracker  {

    protected trackerModelId: string;
    protected log: ILogger;

    public constructor(id: string) {
        this.trackerModelId = id;
    }

    public async update() {
        // read the documents
        const doc = await ModelTracker.findById(this.trackerModelId);
        if (!doc) {
            throw new Error(`Tracker with id ${this.trackerModelId} not found.`);
        }

        const exchangeModel = await ModelExchange.findById(doc.exchangeId);
        if (!exchangeModel) {
            throw new Error(`Exchange with id ${doc.exchangeId} not found.`);
        }

        // create the logger
        this.log = createLogger({
            application: `tracker/${doc.id}`,
            level: doc.logLevel
        });

        const ccxtExchange = await CcxtExchangeManager.getExchange(exchangeModel);

        // load the markets
        this.log.info(`Loading markets for exchange ${ccxtExchange.name}.`);
        await ccxtExchange.loadMarkets();

        this.log.info(`Fetching tickers, orderbook and trade history.`);
        const [ tickers, orderBooks, trades ] = await Promise.all([
            ccxtExchange.fetchTickers(doc.markets),
            ccxtExchange.fetchOrderBook(doc.markets, 50),
            ccxtExchange.fetchTrades(doc.markets, 50)
        ])

        // determine the smallest timeframe
        let smallestTimeframe = doc.timeframes[0];
        for (const timeframe of doc.timeframes) {
            if (MathHelper.periodToMs(timeframe) < MathHelper.periodToMs(smallestTimeframe)) {
                smallestTimeframe = timeframe;
            }
        }

        // remove old data from the database
        await this.removeOldData(ccxtExchange.name, doc.historyDays);

        // array containing candles to create
        const candleCreateList = [];
        const candleUpdateList: { id: string, data: any }[] = [];

        const promises = [];

        this.log.info(`Retrieving candle data.`);

        // update the candles
        for (const market of doc.markets) {
            const ticker = tickers[market];
            const orderBook = orderBooks[market];
            const tradeData = trades[market];
            // update the candles
            await Promise.all(doc.timeframes.map((timeframe) => (async () => {
                if (timeframe === smallestTimeframe) {
                    return this._updateCandleData(ccxtExchange, market, timeframe,
                        candleCreateList, candleUpdateList,
                        orderBook, ticker, tradeData);
                } else {
                    return this._updateCandleData(ccxtExchange, market, timeframe,
                        candleCreateList, candleUpdateList);
                }
            })()));
        }
        await Promise.all(promises);

        // create and update the candles
        this.log.info(`Storing candle data.`);

        await ModelCandle.create(candleCreateList);
        for (const { id, data } of candleUpdateList) {
            await ModelCandle.findOneAndUpdate({ _id: id }, data);
        }
    }

    private async _updateCandleData(exchange: ICcxtExchange,
        market: string,
        timeframe: string,
        candleCreateList: any[],
        candleUpdateList: { id: string, data: any }[],
        orderBookData?: IOrderBook,
        tickerData?: number[],
        tradeData?: ITrade[]) {

        // find the timestamp of the last candle
        const lastCandle = await ModelCandle.findOne({
            exchangeName: exchange.name,
            timeframe: timeframe,
            market: market
        }).sort("-timestamp").exec();

        // retrieve the candles since the last time and update the database models
        const candles = await (async () => {
            if (lastCandle) {
                const since = lastCandle.timestamp - 1000;
                return await exchange.retrieveCandles(market, timeframe, since, undefined, false);
            } else {
                return await exchange.retrieveCandles(market, timeframe, undefined, 30, false);
            }
        })();
        if (!candles) {
            this.log.warning(`${this.trackerModelId}/${exchange.name}: Unable to retrieve candles for ${market}.`);
            return;
        }
        let updateCount = 0;
        let createCount = 0;
        for (const candle of candles) {
            const conditions = {
                exchangeName: exchange.name,
                timeframe: timeframe,
                market: market,
                timestamp: candle.timestamp
            };

            // retrieve the model
            const model = await ModelCandle.findOne(conditions);
            if (model) {
                // schedule update
                const data: any = {
                    data: candle.raw
                };
                if (candle === candles[candles.length - 1] || !model.tickerData) {
                    data.tickerData = tickerData;
                }
                if (candle === candles[candles.length - 1] || !model.orderBookData) {
                    data.orderBookData = orderBookData;
                }
                if (candle === candles[candles.length - 1] || !model.tradeData) {
                    data.tradeData = tradeData;
                }
                candleUpdateList.push({
                    id: model._id, data
                });
                updateCount += 1;
            } else {
                // schedule create
                candleCreateList.push({
                    exchangeName: exchange.name,
                    timeframe: timeframe,
                    market: market,
                    timestamp: candle.timestamp,
                    data: candle.raw,
                    tickerData,
                    orderBookData,
                    tradeData
                });
                createCount += 1;
            }
        }
        this.log.info(`${this.trackerModelId}/${exchange.name}: ${createCount} candles created and ${updateCount} candles updated for ${market} at timeframe ${timeframe}.`);
    }

    private async removeOldData(exchangeName: string, maxDays: number = 60) {
        // compute the time before which data should be removed
        const cutoffTime = Date.now() - maxDays * 24 * 60 * 60 * 1000;

        // remove old candles
        const countBefore = await ModelCandle.countDocuments({}).exec();
        await ModelCandle.deleteMany({
            exchangeName,
            timestamp: { $lt: cutoffTime }
        }).exec();
        const removed = countBefore - await ModelCandle.countDocuments({}).exec();
        if (removed > 0) {
            this.log.info(`${this.trackerModelId}/${exchangeName}: Removed ${removed} candles.`);
        }
    }
}
