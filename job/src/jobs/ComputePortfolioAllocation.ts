import mathjs                               from "mathjs";
import ModelTradingAgent                    from "lib/models/ModelTradingAgent";
import ModelExchange                        from "lib/models/ModelExchange";
import { CcxtExchangeManager }              from "lib/exchange/ccxt/CcxtExchangeManager";
import { createLogger, ILogger }            from "lib/core/log";
import { ICcxtExchange }                    from "lib/exchange/ccxt/ICcxtExchange";
import IModelTradingAgent                   from "lib/models/IModelTradingAgent";
import Ticker                               from "lib/exchange/Ticker";
import { computeModelParameters }           from "lib/trading/GeometricBrownianMotion";
import { TechnicalIndicators }              from "lib/trading/TechnicalIndicators";
import { tail }                             from "lib/core/ArrayUtils";

export interface JobData {
    id: string;
    dryRun?: boolean;
}

export async function computePortfolioAllocation(data?: JobData) {

    // retrieve the trading agent id from the data
    if (!data || !data.id) {
        throw new Error("Missing id.");
    }
    const id = data.id;

    // retrieve the trading agent
    const tradingAgentModel = await ModelTradingAgent.findById(id);
    if (!tradingAgentModel) {
        throw new Error(`Trading agent with id ${id} not found.`);
    }

    const log = createLogger({
        application: `ComputePortfolioAllocation/${id}`,
        level: tradingAgentModel.strategyOptions.logLevel
    });

    await doComputePortfolioAllocation(tradingAgentModel, log, data.dryRun);
}

export async function doComputePortfolioAllocation(tradingAgentModel: IModelTradingAgent, log: ILogger, dryRun?: boolean) {
    // note the time before
    const startTime = Date.now();

    // retrieve the exchange
    const exchangeModel = await ModelExchange.findById(tradingAgentModel.exchangeId);
    if (!exchangeModel) {
        throw new Error(`Exchange with id ${tradingAgentModel.exchangeId} not found.`);
    }
    const exchange = await CcxtExchangeManager.getExchange(exchangeModel);
    // load the markets
    log.notice(`Loading markets for exchange ${exchange.name}.`);
    await exchange.loadMarkets();

    const strategyOptions = tradingAgentModel.strategyOptions;

    if (!strategyOptions.marketSettings) {
        strategyOptions.marketSettings = {};
    }

    // get all markets for the fiat currency that the agent operates in
    // and filter out the markets on the blacklist
    const blacklist = tradingAgentModel.blacklist || [];
    const allMarkets = exchange.getMarkets(tradingAgentModel.fiatCurrency || "ETH")
        .filter((market) => (blacklist.indexOf(market) < 0));

    // retrieve the tickers for the 24h volume
    const tickers = await exchange.fetchTickers(allMarkets);

    // compute which markets to consider in the portfolio based on day volume, fiat price and
    // current price movement
    const tradeableMarkets: string[] = [];
    const promises = [];
    for (const market of allMarkets) {
        promises.push((async () => {
            strategyOptions.marketSettings[market] = strategyOptions.marketSettings[market] || {};
            const settings = strategyOptions.marketSettings[market];

            // by default, we cannot trade in the market
            Object.assign(settings, {
                canTrade: false
            })
            const ticker = new Ticker(tickers[market]);
            const dayVolume = tickers[market] ? ticker.quoteVolume : 0;

            // make sure that the volume and the fiat price is high enough
            if (dayVolume < (tradingAgentModel.minimumVolume || 70)) {
                log.info(`Market ${market} removed due to low day volume (${dayVolume}).`);
                return;
            }
            if (tradingAgentModel.minimumFiatPrice && ticker.last < tradingAgentModel.minimumFiatPrice) {
                log.info(`Market ${market} removed due to low fiat price (${ticker.last}).`);
                return;
            }

            // retrieve the 1h candles for 1 week
            const hourCandles = await exchange.retrieveCandles(market, "1h", undefined, 24 * 7);
            if (!hourCandles) {
                throw new Error(`Unable to retrieve 1h candles for market ${market}.`);
            }

            // make sure that there are not too many hours without trading
            const countHoursNoVolume = hourCandles.filter((candle) => candle.volume <= 0).length;
            const percentageNoVolume = countHoursNoVolume / hourCandles.length;
            if (percentageNoVolume > (tradingAgentModel.maxPercentageHoursNoVolume || 0.1)) {
                log.info(`Market ${market} removed due to too many hours with no volume (${(percentageNoVolume * 100).toFixed(2)}).`);
                return;
            }

            // compute the parameters of the Geometric Brownian motion model
            const gbm = await computeModelParameters(hourCandles);
            log.info(`Geometric brownian motion model parameters for ${market}: ${JSON.stringify(gbm)}.`);
            Object.assign(settings, gbm);

            // retrieve the last 30 1d candles
            const nrDayCandles = 30;
            const dayCandles = await exchange.retrieveCandles(market, "1d", undefined, nrDayCandles);
            if (!dayCandles) {
                throw new Error(`Unable to retrieve 1d candles for market ${market}.`);
            }

            // if there are not enough day candles, ignore this market
            if (dayCandles.length < nrDayCandles) {
                log.info(`Market ${market} removed due to not enough days trading (${dayCandles.length}) < ${nrDayCandles}.`);
                return;
            }
            // make sure the average volume is acceptable
            const quoteVolumes = dayCandles.map((candle) => candle.quoteVolumeEstimate);
            const emaVolume = TechnicalIndicators.ema(quoteVolumes, 5);
            if (tail(emaVolume) < (tradingAgentModel.minimumAverageVolume || 70)) {
                log.info(`Market ${market} removed due to too low average volume (${tail(emaVolume)}).`);
                return;

            }
            // compute the trend and the RSI value of the market
            const vdx = TechnicalIndicators.vdx(dayCandles);
            const rsi = TechnicalIndicators.rsi(dayCandles, 20);
            settings.trend = tail(vdx);
            settings.priceLevel = tail(rsi) / 100;
            log.info(`Computed trend for market ${market}: ${settings.trend}. Price level = ${settings.priceLevel}.`);
                
            // add the market to the tradeable market list
            settings.canTrade = true;
            tradeableMarkets.push(market);
        })());
    }
    await Promise.all(promises);

    log.info(`Trading is possible in markets ${JSON.stringify(tradeableMarkets)} (${tradeableMarkets.length} markets).`);
    tradingAgentModel.markModified("strategyOptions");

    const totalTime = Date.now() - startTime;
    log.notice(`Total time (portfolio allocation): ${Math.round(totalTime / 1000)} seconds.`);

    // finally, save to the database
    if (!dryRun) {
        log.info(`Storing portfolio allocation and market models.`);
        await tradingAgentModel.save();
        log.info(`Portfolio allocation stored.`);
    }
}
