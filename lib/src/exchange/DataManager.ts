import ModelCandle                  from "../models/ModelCandle";
import MathHelper                   from "../core/MathHelper";
import FileStorage                  from "../core/FileStorage";
import { CandleChannel }            from "./Candle";

export interface ExportDataOptions {
    exchangeName: string;
    timeframes: string[];
    market: string;
    period: string;
    endTimestamp?: number;
    candleHistory?: number;
    estimateMissingTickers?: boolean;
}

export default class DataManager {

    // Needed for Singleton behavior
    public static instance = new DataManager();
    private constructor() {
    }

    public async exportDataset(options: ExportDataOptions) {
        // create the dataset
        const data = await this.createDataset(options);

        // construct the filename
        const endTimestamp = options.endTimestamp || Date.now();
        const marketFile = options.market.split("/").join("-");
        const date = new Date(endTimestamp);
        const filename = `${options.exchangeName}/${marketFile}-${options.period}-${date.toDateString()}-${options.candleHistory || 0}.json`;

        // store the data in cloud storage
        return FileStorage.instance.uploadStringToFile(JSON.stringify(data), filename);
    }

    public async createDataset(options: ExportDataOptions) {
        // compute the start and time
        const endTimestamp = options.endTimestamp || Date.now();
        const startTimestamp = endTimestamp - MathHelper.periodToMs(options.period);

        const data = {
            tickers: [],
            candles: {}
        };

        // sort the timeframes from smallest to largest
        const timeframes = options.timeframes.sort((a: string, b: string) => {
            return MathHelper.periodToMs(a) - MathHelper.periodToMs(b);
        });
        // create the data set
        for (const timeframe of timeframes) {
            // construct the query filter
            const timeframeMs = MathHelper.periodToMs(timeframe);
            const queryFilter = {
                $gte: startTimestamp - timeframeMs * (options.candleHistory || 0),
                $lte: endTimestamp
            };
            // retrieve the candles from the database
            const candles = await ModelCandle.find({
                exchangeName: { $eq: options.exchangeName },
                market: { $eq: options.market},
                timestamp: queryFilter,
                timeframe: timeframe
            }).sort("timestamp").exec();
            data.candles[timeframe] = [];
            for (const candle of candles) {
                // add the candle data
                data.candles[timeframe].push(candle.data);
                // add the ticker data from the smallest timeframe
                if (timeframe === timeframes[0]) {
                    data.tickers.push(candle.tickerData || null);
                }
            }
            // clean the candle data
            this.cleanCandleData(data.candles[timeframe]);
        }

        if (options.estimateMissingTickers) {
            // first compute the spreads from the largest timeframe candles
            const largestTimeframe = timeframes[timeframes.length - 1];
            const spreads = this.computeSimulatedSpreads(data.candles[largestTimeframe]);
            // now add the simulated tickers to the data set
            const smallestTimeframe = timeframes[0];
            this.addSimulatedTickers(data.candles[largestTimeframe], data.candles[smallestTimeframe],
                smallestTimeframe, data.tickers, spreads);
        }

        return data;
    }

    // Candle data cleaning

    protected cleanCandleData(candles: number[][]) {
        let initialPrice = 0;
        // first find the initial price
        for (const candle of candles) {
            if (candle[CandleChannel.Close]) {
                initialPrice = candle[CandleChannel.Close];
                break;
            }
        }
        for (let i = 0; i < candles.length; i += 1) {
            const candle = candles[i];
            if (!candle[CandleChannel.Open] || !candle[CandleChannel.High] || !candle[CandleChannel.Low] ||
                !candle[CandleChannel.Close]) {
                // get the previous close price
                const lastClose = i > 0 ? candles[i - 1][CandleChannel.Close] : initialPrice;
                candle[CandleChannel.Open] = lastClose;
                candle[CandleChannel.High] = lastClose;
                candle[CandleChannel.Low] = lastClose;
                candle[CandleChannel.Close] = lastClose;
                candle[CandleChannel.Volume] = 0;
            }
        }
    }

    public async clearHistory(exchangeName: string) {
        return ModelCandle.deleteMany({
            exchangeName: { $eq: exchangeName }
        });
    }

    // *********************************************************************
    // Method for simulating bid and ask prices
    // See also: https://www3.nd.edu/~scorwin/documents/high-low_spreads.pdf
    // *********************************************************************

    protected getSimulatedSpread(timestamp: number, spreads: any[]): number {
        for (let i = 1; i < spreads.length; i += 1) {
            if (i === spreads.length - 1 || timestamp < spreads[i].timestamp) {
                return spreads[i - 1].spread;
            }
        }
        return 0.005;
    }

    protected getDayVolumeQuote(candles: number[][], timestamp: number): number {
        let day = 0;
        while (day < candles.length && timestamp < candles[day][CandleChannel.Timestamp]) {
            day += 1;
        }
        day = Math.min(day, candles.length - 1);
        return candles[day][CandleChannel.Volume];
    }

    protected computeSimulatedSpreads(dayCandles: number[][]) {
        const spreads = [];
        for (let i = 1; i < dayCandles.length; i += 1) {
            const candleDayOne = dayCandles[i - 1];
            const candleDayTwo = dayCandles[i];

            // compute beta
            const betaOne = Math.log( candleDayOne[CandleChannel.High] / candleDayOne[CandleChannel.Low] );
            const betaTwo = Math.log( candleDayTwo[CandleChannel.High] / candleDayTwo[CandleChannel.Low] );
            const beta = betaOne * betaOne + betaTwo * betaTwo;

            // compute gamma
            const observedHigh = Math.max(candleDayOne[CandleChannel.High], candleDayTwo[CandleChannel.High]);
            const observedLow = Math.min(candleDayOne[CandleChannel.Low], candleDayTwo[CandleChannel.Low]);
            const log = Math.log( observedHigh / observedLow );
            const gamma = log * log;

            // compute alpha
            const divider = 3 - 2 * Math.sqrt(2);
            const alpha = (Math.sqrt(2 * beta) - Math.sqrt(beta)) / divider - Math.sqrt(gamma / divider);
            const alphaExp = Math.exp(alpha);

            // compute the spread
            const spread = 2 * (alphaExp - 1) / (alphaExp + 1);
            if (spreads.length === 0) {
                spreads.push({
                    timestamp: candleDayOne[CandleChannel.Timestamp],
                    spread: Math.max(spread, 0.005) // assume a minimum spread of 0.5%
                });
            }
            spreads.push({
                timestamp: candleDayTwo[CandleChannel.Timestamp],
                spread: Math.max(spread, 0.005) // assume a minimum spread of 0.5%
            });
        }
        return spreads;
    }

    protected addSimulatedTickers(dayCandles: number[][], smallestCandles: number[][], smallestTimeframe: string, tickers: number[][], spreads: any[]) {
        // get the smallest timeframe
        const smallestTimeframeMs = MathHelper.periodToMs(smallestTimeframe);

        let prevBid = 0;
        let prevAsk = 0;
        for (let i = 0; i < tickers.length; i += 1) {
            if (tickers[i] && tickers[i].length === 6) {
                continue;
            }
            const candle = smallestCandles[i];
            const candleEndTimestamp = candle[CandleChannel.Timestamp] + smallestTimeframeMs;
            const spread = this.getSimulatedSpread(candleEndTimestamp, spreads) * candle[CandleChannel.Close];
            const highDist = Math.abs(candle[CandleChannel.High] - candle[CandleChannel.Close]);
            const lowDist = Math.abs(candle[CandleChannel.Close] - candle[CandleChannel.Low]);

            if (candle[CandleChannel.Open] !== candle[CandleChannel.Close] || prevBid === 0 || prevAsk === 0) {
                // we only compute bid and ask prices if there was movement in the market
                // (open price is not the same as close price), otherwise, we use the
                // previously determined bid and ask prices
                prevBid = highDist < lowDist ? candle[CandleChannel.Close] - spread : candle[CandleChannel.Close];
                prevAsk = highDist < lowDist ? candle[CandleChannel.Close] : candle[CandleChannel.Close] + spread;
            }
            const quoteVolume = this.getDayVolumeQuote(dayCandles, candleEndTimestamp);
            const baseVolume = quoteVolume / candle[CandleChannel.Close];
            tickers[i] = [
                candleEndTimestamp,
                prevBid,
                prevAsk,
                candle[CandleChannel.Close],
                baseVolume,
                quoteVolume
            ];
        }
    }
}
