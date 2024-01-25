import { createLogger } from "lib/core/log";
import { CcxtExchangeManager } from "lib/exchange/ccxt/CcxtExchangeManager";
import Exchange from "lib/exchange/Exchange";
import ModelExchange from "lib/models/ModelExchange";
import ModelTradingAgent from "lib/models/ModelTradingAgent";
import Agenda = require("agenda");
import moment = require("moment-timezone");

export interface JobData {
    id: string;
}

export async function getStats(data?: JobData) {
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
        program: `getStats/${id}`,
        application: exchangeModel.exchangeName,
        level: tradingAgentModel.strategyOptions.logLevel
    });

    let output = "";
    const writeOutput = (str: string) => {
        log.notice(str);
        if (output !== "") {
            output += "<br>";
        }
        output += str;
    };

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
        writeOutput(`Loading markets for exchange ${ccxtExchange.name}.`);
        await ccxtExchange.loadMarkets();
    }

    writeOutput(
        moment()
            .tz("Europe/Amsterdam")
            .format("LLLL")
    );

    // create the exchange
    const exchange = new Exchange(exchangeModel, ccxtExchange, log);

    // Sync the ccxt exchange and store the retrieved data in the database
    if (!(await exchange.beforeUpdate(activeMarkets))) {
        writeOutput(`Exchange preparation failed. Aborting update.`);
        return;
    }

    // compute the total balance
    const totalBalance = exchange.getTotalBalanceFromMarkets(
        false,
        activeMarkets
    );
    if (totalBalance === null) {
        writeOutput(`Unable to compute total balance.`);
        return false;
    }
    writeOutput(`Total balance: $${totalBalance.toFixed(2)}.`);

    const strategyOptions = tradingAgentModel.strategyOptions || {};
    const fiatRatio = strategyOptions["fiatRatio"] || 0.35;
    const ratio = (1 - fiatRatio) / activeMarkets.length;

    // compute the balances in each active market
    for (const market of activeMarkets) {
        // total balance reporting

        const baseAmount = exchange
            .convertToBase(totalBalance, market)
            .toFixed(7);
        const ticker = exchange.getTicker(market);
        writeOutput(
            `Total balance in market ${market}: ${baseAmount}. Midprice = ${ticker.average.toFixed(
                2
            )}.`
        );

        // get the balance
        const balance = exchange.getBalance(market);

        // compute the current target balance for this market
        const targetBalance =
            ratio * exchange.convertToBase(totalBalance, market);
        // compute the offset
        const offset = (balance.total - targetBalance) / targetBalance;

        writeOutput(
            `Current balance in market ${market}: ${balance.total.toFixed(
                7
            )}. Target balance = ${targetBalance.toFixed(
                7
            )}. Offset = ${offset.toFixed(2)}.`
        );
    }

    const totalTime = Date.now() - startTime;
    writeOutput(`Total time: ${Math.round(totalTime / 1000)} seconds.`);
    return output;
}
