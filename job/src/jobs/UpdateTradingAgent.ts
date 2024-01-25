import { createLogger, ILogger } from "lib/core/log";
import { CcxtExchangeManager } from "lib/exchange/ccxt/CcxtExchangeManager";
import Exchange from "lib/exchange/Exchange";
import { IExchange } from "lib/exchange/IExchange";
import IOrder from "lib/exchange/IOrder";
import { OrderSide } from "lib/exchange/OrderSide";
import IModelExchange from "lib/models/IModelExchange";
import IModelTradingAgent from "lib/models/IModelTradingAgent";
import ModelExchange from "lib/models/ModelExchange";
import ModelTradingAgent from "lib/models/ModelTradingAgent";
import StrategyFactory from "lib/trading/StrategyFactory";
import Agenda = require("agenda");

export interface JobData {
    id: string;
    dryRun?: boolean;
}

export async function updateTradingAgent(data?: JobData) {
    // Retrieve the trading agent id from the data
    if (!data || !data.id) {
        throw new Error("Missing id.");
    }
    const id = data.id;

    // Note the time before
    const startTime = Date.now();

    // retrieve the trading agent
    const tradingAgentModel = await ModelTradingAgent.findById(id);
    if (!tradingAgentModel) {
        throw new Error(`Trading agent with id ${id} not found.`);
    }
    if (!tradingAgentModel.exchangeId) {
        // there is no exchange attached to this strategy, so we are done
        return;
    }

    // retrieve the exchange data
    const exchangeModel = await ModelExchange.findById(
        tradingAgentModel.exchangeId
    );
    if (!exchangeModel) {
        throw new Error(
            `Exchange with id ${tradingAgentModel.exchangeId} not found.`
        );
    }

    const log = createLogger({
        program: `tradingAgent/${id}`,
        application: exchangeModel.exchangeName,
        level: tradingAgentModel.strategyOptions.logLevel
    });

    // Update the trading agent
    await doUpdateTradingAgent(
        tradingAgentModel,
        exchangeModel,
        log,
        data.dryRun
    );
    const totalTime = Date.now() - startTime;
    log.notice(`Total time: ${Math.round(totalTime / 1000)} seconds.`);
}

async function doUpdateTradingAgent(
    tradingAgentModel: IModelTradingAgent,
    exchangeModel: IModelExchange,
    log: ILogger,
    dryRun: boolean = false
) {
    if (!dryRun && tradingAgentModel.paused) {
        // the trading agent is paused, so do nothing
        log.warning(
            `Trading agent with id ${tradingAgentModel.id} is paused. Stopping update.`
        );
        return;
    }

    // check whether the exchange is in lockdown mode
    if (exchangeModel.lockdown) {
        log.warning(`Exchange is in lockdown mode.`);
        return;
    }

    // determine what the active markets are
    const activeMarkets = Object.keys(
        tradingAgentModel.strategyState.marketState || {}
    );

    // retrieve the exchange
    const ccxtExchange = await CcxtExchangeManager.getExchange(exchangeModel);

    // check whether the markets should be loaded
    const ccxtExchangeMarkets = ccxtExchange.getMarkets();
    if (
        activeMarkets.filter(market => ccxtExchangeMarkets.indexOf(market) <= 0)
            .length > 0
    ) {
        log.notice(`Loading markets for exchange ${ccxtExchange.name}.`);
        await ccxtExchange.loadMarkets();
    }

    // create the exchange
    const exchange = new Exchange(exchangeModel, ccxtExchange, log);
    exchange.dryRun = dryRun;

    // sync orders and update the exchange for each marhet
    const orderSyncSuccess = await Promise.all(
        activeMarkets.map(async market => {
            return (
                (await exchange.syncOrders(market)) &&
                (await exchange.update(market))
            );
        })
    );
    if (!orderSyncSuccess.every(value => value === true)) {
        log.warning(`Unable to sync orders. Aborting update.`);
        return;
    }

    // retrieve the open buy and sell orders for this market
    const orderFilter = (order: IOrder) =>
        order.remaining / order.amount >= 0.1;

    // check if there are any markets with no double-sided orders
    const doubleSidedOrders = activeMarkets.map(
        market =>
            exchange.getOpenOrders(market, OrderSide.Buy, orderFilter).length >
                0 &&
            exchange.getOpenOrders(market, OrderSide.Sell, orderFilter).length >
                0
    );
    if (doubleSidedOrders.every(value => value === true)) {
        log.info(
            `All markets currently have double sided orders, so no update is needed.`
        );
        return;
    }

    // sync tickers and balance (we do not use 'before update' since balance and tickers do not have
    // to be updated in case there is a double-sided order)
    const tickerSyncSuccess = await Promise.all([
        exchange.syncTickers(activeMarkets),
        exchange.syncBalance()
    ]);
    if (!tickerSyncSuccess.every(value => value === true)) {
        log.warning(`Unable to sync tickers or balance. Aborting update.`);
        return;
    }

    // Check if we reached the max drawdown
    checkDrawdown(exchange, tradingAgentModel, log);

    // create and prepare the strategy
    log.notice(
        `Creating and preparing strategy [${tradingAgentModel.strategy}].`
    );
    const strategy = StrategyFactory.instance.create(
        tradingAgentModel.strategy,
        exchange,
        tradingAgentModel.strategyOptions,
        tradingAgentModel.strategyState,
        log
    );
    if (!(await strategy.beforeRun())) {
        log.warning(`Strategy preparation failed. Aborting update.`);
        return;
    }
    log.notice(`Strategy preparation successful.`);

    // run the strategy
    log.notice(`Running strategy [${tradingAgentModel.strategy}].`);
    await Promise.all(
        strategy.activeMarkets.map(market => strategy.runForMarket(market))
    );
    log.notice(`Finished running strategy [${tradingAgentModel.strategy}].`);

    if (!dryRun) {
        log.info(`Saving changes to the database.`);

        // save the updated exchange
        exchangeModel.balances = exchange.state.balances;
        exchangeModel.tickers = exchange.state.tickers;
        exchangeModel.trades = exchange.state.trades;
        exchangeModel.orderBooks = exchange.state.orderBooks;
        exchangeModel.openOrders = exchange.state.openOrders;
        exchangeModel.closedOrders = exchange.state.closedOrders;
        exchangeModel.cancelledOrders = exchange.state.cancelledOrders;
        await exchangeModel.save();
        log.info(`Update exchange state written to the database.`);

        // save the updated trading agent
        tradingAgentModel.strategyState = strategy.state;
        await tradingAgentModel.save();
        log.info(`Update trading agent state written to the database.`);
    }

    log.notice(`Finished running strategy.`);
}

function checkDrawdown(
    exchange: IExchange,
    tradingAgentModel: IModelTradingAgent,
    log: ILogger
) {
    const state = tradingAgentModel.strategyState;
    const activeMarkets = Object.keys(state.marketState || {});
    // Compute the total balance
    const totalBalance = exchange.getTotalBalanceFromMarkets(
        false,
        activeMarkets
    );
    if (totalBalance === null) {
        log.warning(
            `Unable to compute drawdown due to missing balance or ticker data.`
        );
        return;
    }

    // update the peak market amount
    tradingAgentModel.peakMarketAmount = Math.max(
        totalBalance,
        tradingAgentModel.peakMarketAmount || 0
    );

    // compute the current drawdown
    const drawDown =
        (tradingAgentModel.peakMarketAmount - totalBalance) /
        tradingAgentModel.peakMarketAmount;

    // post an event if needed
    if (drawDown > (tradingAgentModel.maxDrawdown || 0.2)) {
        tradingAgentModel.paused = true;
        const balance = exchange.getBalances();
        log.crit(
            `Reached maximum drawdown. Peak = ${tradingAgentModel.peakMarketAmount}, currentTotal = ${totalBalance}.`
        );
        exchange.post("max_drawdown_reached", {
            peak: tradingAgentModel.peakMarketAmount,
            currentTotal: totalBalance,
            balance
        });
    }
}
