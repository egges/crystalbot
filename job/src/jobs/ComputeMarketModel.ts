import ModelTradingAgent                    from "lib/models/ModelTradingAgent";
import ModelExchange                        from "lib/models/ModelExchange";
import { CcxtExchangeManager }              from "lib/exchange/ccxt/CcxtExchangeManager";
import { createLogger }                     from "lib/core/log";
import { computeGBMParameters,  computeMarketDynamicsParameters, computeSpread }
                                            from "lib/trading/MarketModelGueant";
import { IMarketMakingStrategyOptions }     from "lib/trading/MarketMakingStrategyGueant";
import Ticker                               from "lib/exchange/Ticker";

export interface JobData {
    id: string;
    markets?: string[];
    dryRun?: boolean;
}

export async function computeMarketModel(data?: JobData) {

    // retrieve the trading agent id from the data
    if (!data || !data.id) {
        throw new Error("Missing id.");
    }
    const id = data.id;

    // note the time before
    const startTime = Date.now();

    // retrieve the trading agent
    const tradingAgentModel = await ModelTradingAgent.findById(id);
    if (!tradingAgentModel) {
        throw new Error(`Trading agent with id ${id} not found.`);
    }
    // retrieve the exchange
    const exchangeModel = await ModelExchange.findById(tradingAgentModel.exchangeId);
    if (!exchangeModel) {
        throw new Error(`Exchange with id ${tradingAgentModel.exchangeId} not found.`);
    }

    const log = createLogger({
        application: `ComputeMarketModel/${id}/${exchangeModel.exchangeName}`,
        level: tradingAgentModel.strategyOptions.logLevel
    });

    // retrieve the exchange
    const exchange = await CcxtExchangeManager.getExchange(exchangeModel);
    // load the markets
    log.notice(`Loading markets for exchange ${exchange.name}.`);
    await exchange.loadMarkets();

    // determine for which markets we need to compute the models
    const markets = data.markets || tradingAgentModel.strategyState.activeMarkets;

    // get the tickers to compute the current price
    const tickers = await exchange.fetchTickers(markets);

    // update the market model for each market
    const promises = [];
    const strategyOptions = tradingAgentModel.strategyOptions as IMarketMakingStrategyOptions;
    for (const market of markets) {
        promises.push((async () => {
            if (!tickers[market]) {
                throw new Error(`Missing ticker for market ${market}.`);
            }
            if (!strategyOptions.marketSettings || !strategyOptions.marketSettings[market]) {
                throw new Error("Missing market settings in strategy options.");
            }
            const marketSettings = strategyOptions.marketSettings[market];

            log.notice(`Computing market parameters for market ${market}.`);

            // compute the parameters of the Geometric Brownian motion model
            const gbm = await computeGBMParameters(exchange, market);
            log.info(`Geometric brownian motion model parameters for ${market}: ${JSON.stringify(gbm)}.`);

            // compute the market dynamic parameters
            const dynamicsResult = await computeMarketDynamicsParameters(exchange, market);

            log.info(`Market dynamics parameters for ${market}: ${JSON.stringify(dynamicsResult)}.`);

            log.info(`Previous market settings for ${market}: ${JSON.stringify(marketSettings.modelSettings)}.`);
            marketSettings.modelSettings = Object.assign(
                marketSettings.modelSettings || { gamma: 0.01 },
                gbm, dynamicsResult
            );
            log.info(`New market settings for ${market}: ${JSON.stringify(marketSettings.modelSettings)}.`);

            const currentPrice = new Ticker(tickers[market]).last;

            const spread = computeSpread(Object.assign({}, marketSettings.modelSettings, {
                midPrice: 0,
                inventory: 0
            })) / currentPrice * 100;

            log.info(`Spread with inventory offset 0: ${spread}%.`);

            const spreadMin = computeSpread(Object.assign({}, marketSettings.modelSettings, {
                midPrice: 0,
                inventory: -strategyOptions.inventorySteps
            })) / currentPrice * 100;

            log.info(`Spread with inventory offset ${-strategyOptions.inventorySteps}: ${spreadMin}%.`);

            const spreadMax = computeSpread(Object.assign({}, marketSettings.modelSettings, {
                midPrice: 0,
                inventory: strategyOptions.inventorySteps
            })) / currentPrice * 100;

            log.info(`Spread with inventory offset ${strategyOptions.inventorySteps}: ${spreadMax}%.`);

            tradingAgentModel.markModified("strategyOptions");

            log.notice(`Finished computing market parameters for market ${market}.`);

        })());
    }
    await Promise.all(promises);

    if (!data.dryRun) {

        log.info(`Storing new model parameters.`);

        // finally, save to the database
        await tradingAgentModel.save();

        log.info(`Model parameters stored.`);
    }

    const totalTime = Date.now() - startTime;
    log.notice(`Total time: ${Math.round(totalTime / 1000)} seconds.`);
}
