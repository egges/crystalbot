import ModelExchange            from "lib/models/ModelExchange";
import { CcxtExchangeManager }  from "lib/exchange/ccxt/CcxtExchangeManager";
import Exchange                 from "lib/exchange/Exchange";
import { createLogger }         from "lib/core/log";
import Agenda                               = require("agenda");

export interface JobData {
    id: string;
}

export async function postExchangeStatus(data?: JobData) {
    // Retrieve the exchange id from the data
    if (!data || !data.id) {
        throw new Error("Missing id.");
    }
    const id = data.id;

    const log = createLogger({
        application: `PostExchangeStatus/${id}`
    });

    // retrieve the exchange
    const exchangeModel = await ModelExchange.findById(id);
    if (!exchangeModel) {
        throw new Error(`Exchange with id ${id} not found.`);
    }

    // Create the exchange
    const ccxtExchange = await CcxtExchangeManager.getExchange(exchangeModel);
    const exchange = new Exchange(exchangeModel, ccxtExchange);

    // Sync the ccxt exchange and store in the database
    log.notice(`Syncing exchange.`);
    const result = await ccxtExchange.syncBalance(exchangeModel, true);
    if (result) {
        log.notice(`Finished syncing exchange.`);
    } else {
        log.warning(`Exchange sync incomplete. Ignoring status post.`);
        return;
    }

    // Post the status event
    await exchange.post("status", {
        totalBalance: exchange.getTotalBalance(false, undefined, true),
        totalBalanceWithReserves: exchange.getTotalBalance(true, undefined, true),
        balances: exchange.getBalances(),
        openOrders: exchange.getOpenOrders()
    });
}
