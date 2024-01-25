import express                      = require("express");
import RouterREST                   from "./RouterREST";
import ModelExchange                from "lib/models/ModelExchange";
import { createExchange }           from "lib/exchange/ExchangeHelper";
import CoinBase                     from "lib/exchange/CoinBase";

export default class RouterExchange extends RouterREST {

    constructor() {
        super(ModelExchange);
    }

    public createRoutes() {
        super.createRoutes();


        // withdrawing and depositing
        this.post("/:key/withdraw", this.withdraw); // withdraw an amount from a balance
        this.post("/:key/deposit", this.deposit);   // deposit an amount to a balance

        // buying and selling
        this.post("/:key/buy", this.buy);   // buy a currency in a market
        this.post("/:key/sell", this.sell);   // sell a currency in a market

        // tickers
        this.get("/:key/tickers/:marketBase?/:marketQuote?", this.tickers);

        // trades
        this.get("/:key/trades/:marketBase/:marketQuote", this.trades);

        // balance
        this.get("/:key/balances", this.balances);
        this.get("/:key/balance/total/:currency?", this.totalBalance); // retrieve total balance in a specific currency
        this.get("/:key/balance/:currency", this.balance);

        // orders
        this.get("/:key/openOrders/:marketBase?/:marketQuote?", this.openOrders);
        this.get("/:key/closedOrders/:marketBase?/:marketQuote?", this.closedOrders);
        this.post("/:key/cancelOrder/:orderId", this.cancelOrder);   // cancel an order
    }

    // Withdrawing and depositing

    public async withdraw(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.body.currency || !request.body.amount) {
            response.status(400).send({
                error: "Required fields: currency, amount"
            });
            return;
        }
        request.body.address = request.body.address || "none";

        try {
            const exchange = await createExchange(request.params.key);
            await exchange.withdraw(request.body.currency, request.body.amount, request.body.address);
            response.status(200).send();
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    public async deposit(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.body.currency || !request.body.amount) {
            response.status(400).send({
                error: "Required fields: currency, amount"
            });
            return;
        }
        request.body.address = request.body.address || "none";

        try {
            const exchange = await createExchange(request.params.key);
            await exchange.deposit(request.body.currency, request.body.amount, request.body.address);
            response.status(200).send();
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    // Buying and selling

    public async buy(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.body.market || !request.body.amount || !request.body.type) {
            response.status(400).send({
                error: "Required fields: market, amount, type"
            });
            return;
        }
        if (request.body.type === "limit" && !request.body.price) {
            response.status(400).send({
                error: "Price field is required for limit orders."
            });
            return;
        }

        try {
            const exchange = await createExchange(request.params.key);
            const id = await exchange.createOrder(request.body.market, request.body.type, 
                "buy", request.body.amount, request.body.price, request.body.autoCancel);
            response.status(200).send(id);
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    public async sell(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.body.market || !request.body.amount || !request.body.type) {
            response.status(400).send({
                error: "Required fields: market, amount"
            });
            return;
        }
        if (request.body.type === "limit" && !request.body.price) {
            response.status(400).send({
                error: "Price field is required for limit orders."
            });
            return;
        }

        try {
            const exchange = await createExchange(request.params.key);
            const id = await exchange.createOrder(request.body.market, request.body.type,
                "sell", request.body.amount, request.body.price, request.body.autoCancel);
            response.status(200).send(id);
        } catch (error) {
            response.status(400).send({ error });
        }        
    }

    public async cancelOrder(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            await exchange.cancelOrder(request.params.orderId);
            response.status(200).send();
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    // Orders

    public async openOrders(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            const market = request.params.marketBase ? `${request.params.marketBase}/${request.params.marketQuote}` : undefined;
            const orders = exchange.getOpenOrders(market);
            response.status(200).send(orders);
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    public async tickers(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            const markets = request.params.marketBase ? [`${request.params.marketBase}/${request.params.marketQuote}`] : undefined;
            const tickers = exchange.getTickers(markets);
            if (markets) {
                const tickerJson =  tickers[markets[0]].json;
                response.status(200).send(tickerJson);
            } else {
                // convert to JSON
                const tickersJson = {};
                const tickerMarkets = Object.keys(tickers);
                for (const market of tickerMarkets) {
                    tickersJson[market] = tickers[market].json;
                }
                response.status(200).send(tickersJson);
            }
        } catch (error) {
            response.status(400).send({ error });
        }        
    }

    public async trades(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            const market = `${request.params.marketBase}/${request.params.marketQuote}`;
            const trades = await exchange.getTrades(market, request.body.since, request.body.limit);
            console.log("Nr of previous trades = " + trades.length);
            response.status(200).send(trades);
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    public async closedOrders(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            const market = request.params.marketBase ? `${request.params.marketBase}/${request.params.marketQuote}` : undefined;
            const orders = exchange.getClosedOrders(market, request.params.since, request.params.limit);
            response.status(200).send(orders);
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    // Retrieving balance

    public async balances(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            const balances = exchange.getBalances();
            const balancesJson = {};
            for (const currency of Object.keys(balances)) {
                balancesJson[currency] = balances[currency].json;
            }
            response.status(200).send(balancesJson);
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    public async balance(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            const balance = exchange.getBalance(request.params.currency);
            response.status(200).send(balance.json);
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    public async totalBalance(request: express.Request, response: express.Response, next: express.NextFunction) {
        try {
            const exchange = await createExchange(request.params.key);
            if (!request.params.currency) {
                const totalBalance = exchange.getTotalBalance(false, undefined, true);
                response.status(200).send(totalBalance.toString());
            } else if (request.params.currency === "EUR" || request.params.currency === "USD") {
                const fiatCurrency = exchange.fiatCurrency;
                const totalBalance = exchange.getTotalBalance();
                const totalBalanceInEurOrUsd = await CoinBase.instance.getSellPrice(`${fiatCurrency}/${request.params.currency}`, totalBalance);
                response.status(200).send(totalBalanceInEurOrUsd.toString());
            } else {
                response.status(400).send({
                    error: `Cannot retrieve balance in provided currency (${request.params.currency}).`
                });
                return;
            }
        } catch (error) {
            response.status(400).send({ error });
        }
    }

    public async postFindDocumentById(instance: object, request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        // remove the API key and secret for security
        delete instance["apiKey"];
        delete instance["apiSecret"];
        delete instance["password"];
        return true;
    }

    public async postFindDocuments(instances: object[], request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        for (const instance of instances) {
            // remove the API key and secret for security
            delete instance["apiKey"];
            delete instance["apiSecret"];
            delete instance["password"];
        }
        return true;
    }

    public async preUpdateDocument(request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        if (request.body.name) {
            response.status(400).send({
                error: `Changing an exchange name is not allowed.`
            });
            return false;
        }
        return true;
    }
}