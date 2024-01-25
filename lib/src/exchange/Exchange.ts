import Balance                                  from "./Balance";
import Ticker                                   from "./Ticker";
import { IExchange, ICreateOrderOptions }       from "./IExchange";
import IOrder                                   from "./IOrder";
import { Candle }                               from "./Candle";
import { ICcxtExchange }                        from "./ccxt/ICcxtExchange";
import Types                                    from "../core/Types";
import MathHelper                               from "../core/MathHelper";
import { IExchangeState }                       from "./IExchangeState";
import ModelEvent                               from "../models/ModelEvent";
import IEvent                                   from "./IEvent";
import { OrderType }                            from "./OrderType";
import { OrderSide }                            from "./OrderSide";
import { merge, cloneDeep }                     from "lodash";
import { ILogger, createLogger, LogLevel }      from "../core/log";
import { IOrderBook }                           from "./IOrderBook";
import { ITrade }                               from "./ITrade";
import ArrayUtils                               from "../core/ArrayUtils";
import colors                                   = require("colors");


export default class Exchange implements IExchange {

    protected _exchange: ICcxtExchange = null;
    protected _state: IExchangeState = null;
    protected _slippage = 0.01;
    protected _dryRun: boolean = false;
    protected log: ILogger;

    public constructor(data: Partial<IExchangeState>, exchange?: ICcxtExchange, log?: ILogger) {
        this._state = merge({
            exchangeName: null,
            simulation: true,
            reserves: {},
            minDealAmounts: {},
            lockdown: false,
            cancelledOrders: {},
            closedOrders: {},
            openOrders: {},
            balances: {},
            tickers: {},
            orderBooks: {},
            trades: {},
            fee: 0.0001,
            fiatCurrency: "ETH",
            forceAutoCancel: false,
            balanceLastSync: 0,
            ordersLastSync: 0,
            tickersLastSync: 0,
            maxSyncAge: 0,
            logLevel: LogLevel.Notice,
            rateLimit: null
        }, data);
        this._exchange = exchange;
        if (this._exchange && data.rateLimit) {
            this._exchange.rateLimit = data.rateLimit;
        }
        this.log = log || createLogger({
            application: data.exchangeName,
            level: this._state.logLevel
        });
    }

    public get state(): IExchangeState {
        return this._state;
    }

    public async reset() {
        this._state.reserves = {};
        this._state.lockdown = false;
        this._state.closedOrders = {};
        this._state.openOrders = {};
        this._state.balances = {};
    }

    public get dryRun(): boolean { return this._dryRun; }
    public set dryRun(value: boolean) { this._dryRun = value; }

    public get name(): string {
        return this._state.exchangeName;
    }

    public get ccxtExchange(): ICcxtExchange {
        return this._exchange;
    }

    // local cache updating
    protected _deposit(currency: string, amount: number) {
        if (!this._state.balances[currency]) {
            this._state.balances[currency] = {
                free: 0,
                used: 0
            };
        }
        this._state.balances[currency].free += amount;
    }

    protected _withdraw(currency: string, amount: number) {
        if (!this._state.balances[currency]) {
            this._state.balances[currency] = {
                free: 0,
                used: 0
            };
        }
        this._state.balances[currency].free -= amount;
    }

    protected _withdrawFromUsed(currency: string, amount: number) {
        if (!this._state.balances[currency]) {
            this._state.balances[currency] = {
                free: 0,
                used: 0
            };
        }
        this._state.balances[currency].used -= amount;
    }

    protected _reserve(currency: string, amount: number) {
        if (!this._state.balances[currency]) {
            this._state.balances[currency] = {
                free: 0,
                used: 0
            };
        }
        // get the balance and the reserve
        const balance = this._state.balances[currency];
        const reserve = this._state.reserves[currency] || 0;
        amount = Math.min(amount, Math.max(balance.free - reserve, 0));
        balance.free -= amount;
        balance.used += amount;
    }

    protected _release(currency: string, amount: number) {
        if (!this._state.balances[currency]) {
            this._state.balances[currency] = {
                free: 0,
                used: 0
            };
        }
        amount = Math.min(amount, this._state.balances[currency].used);
        this._state.balances[currency].free += amount;
        this._state.balances[currency].used -= amount;
    }

    // orders

    private _generateOrderId(): string {
        const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
        let str = "";
        for (let i = 0; i < 16; i += 1) {
            str += chars[Math.floor(Math.random() * chars.length)];
        }
        return str;
    }

    public getMinDealAmount(market: string): number {
        if (this._state.minDealAmounts[market]) {
            return this._state.minDealAmounts[market];
        } else if (this._exchange) {
            return this._exchange.getMinDealAmount(market);
        } else {
            return 1;
        }
    }

    public async createOrder(options: ICreateOrderOptions): Promise<string> {
        const { market, autoCancel, type, side, amount } = options;
        // retrieve the ticker data for this market
        const ticker = this.getTicker(market);
        // set the defaults
        options = Object.assign({
            price: side === OrderSide.Buy ? ticker.bid : ticker.ask,
            sticky: false,
            autoCancelAtFillPercentage: 1,
            autoCancelAtPriceLevel: side === OrderSide.Buy ? Infinity : 0
        }, options);
        let { price, sticky, autoCancelAtPriceLevel, autoCancelAtFillPercentage } = options;
        if (this._state.lockdown) {
            throw new Error("Exchange is in lockdown mode.");
        }
        if (!autoCancel && this._state.forceAutoCancel) {
            throw new Error("Autocancel value is obligatory.");
        }

        // market orders cannot be sticky
        if (type === OrderType.Market && sticky) {
            this.log.warning("Ignoring sticky option since it is only available for limit orders.");
            sticky = false;
        }

        // convert autocancel value to ms if needed
        let autoCancelMs: number = autoCancel as number;
        if (autoCancel && Types.isString(autoCancel)) {
            autoCancelMs = MathHelper.periodToMs(autoCancel as string);
        }

        // In case of market orders, the price becomes the ticker price
        if (type === OrderType.Market) {
            price = side === OrderSide.Buy ? ticker.ask : ticker.bid;
        }

        // check that amount is correct
        if (!amount || amount <= 0) {
            throw new Error(`[${market}] Order amount should be positive (order request: ${JSON.stringify(options)}).`);
        }
        // check that price is correct
        if (!price || price <= 0) {
            throw new Error(`[${market}] Order should have a valid price (order request: ${JSON.stringify(options)}).`);
        }

        // retrieve the quote and base balances
        const quoteCurrency = market.split("/")[1];
        const baseCurrency = market.split("/")[0];
        const quoteBalance = this.getBalance(quoteCurrency);
        const baseBalance = this.getBalance(baseCurrency);

        // create the order object
        const order = {
            id: this._generateOrderId(),
            timestamp: this.currentTime,
            status: "open",
            market: market,
            type,
            side,
            price,
            amount,
            fee: amount * this._state.fee,
            filled: 0,
            remaining: amount,
            autoCancel: autoCancelMs,
            autoCancelAtFillPercentage,
            autoCancelAtPriceLevel,
            sticky
        };

        // create the event data object
        const eventData: any = {
            quoteBalanceBefore: quoteBalance.json,
            baseBalanceBefore: baseBalance.json
        };

        if (side === OrderSide.Buy) {
            // compute how much we can buy
            order.amount = Math.min(price * amount, quoteBalance.free) / price;
            if (type == OrderType.Limit) {
                // reserve the amount
                this._reserve(quoteCurrency, order.amount * price);
            } else {
                // subtract the quote amount from the balance
                this._withdraw(quoteCurrency, amount * price);
                // add the base amount to the balance
                const baseAmount = amount * (1 - this._state.fee) * (1 - this._slippage);
                eventData.quoteAmountSold = amount * price;
                eventData.baseAmountBought = baseAmount;
                this._deposit(baseCurrency, baseAmount);
            }
        } else {
            // compute how much we can sell
            order.amount = Math.min(baseBalance.free, amount);
            if (type == OrderType.Limit) {
                // reserve the amount
                this._reserve(baseCurrency, order.amount);
            } else {
                // subtract the base currency from the balance
                this._withdraw(baseCurrency, amount);
                // add the quote amount to the balance
                const quoteAmount = price * amount * (1 - this._state.fee) * (1 - this._slippage);
                this._deposit(quoteCurrency, quoteAmount);
            }
        }

        // if this is not a simulation, actually create the order on the exchange
        if (!this._state.simulation && this._exchange && !this._dryRun) {
            try {
                // convert to precision
                const id = await this._exchange.createOrder(market, type, side, amount, price);
                Object.assign(order, {
                    id
                });
            } catch (error) {
                this.log.error(error.toString());
                return;
            }
        }

        // save the order and return the order id
        if (type === OrderType.Market) {
            this._state.closedOrders[order.id] = order;
        } else {
            this._state.openOrders[order.id] = order;
        }

        // post the event
        this.post(`${type}_order_created`, Object.assign(eventData, {
            order: cloneDeep(order),
            quoteBalanceAfter: this.getBalance(quoteCurrency).json,
            baseBalanceAfter: this.getBalance(baseCurrency).json,
            autoCancel,
            autoCancelAtTime: autoCancel ? autoCancelMs + order.timestamp : undefined,
            ticker: this.getTicker(market)
        }));
        this.log.notice(`Created ${type} ${side} order: ${JSON.stringify(order)}.`);
        return order.id;
    }

    public async cancelOrder(order: IOrder): Promise<void> {
        if (this._state.lockdown) {
            throw new Error("Exchange is in lockdown mode.");
        }
        if (order.status !== "open") {
            throw new Error("Cannot cancel orders that are already closed.");
        }
        const quoteCurrency = order.market.split("/")[1];
        const baseCurrency = order.market.split("/")[0];
        const quoteBalance = this.getBalance(quoteCurrency);
        const baseBalance = this.getBalance(baseCurrency);

        // create the event data object
        const eventData = {
            orderId: order.id,
            order,
            quoteBalanceBefore: quoteBalance,
            baseBalanceBefore: baseBalance
        };

        if (!this._state.simulation && !this._dryRun) {
            try {
                await this._exchange.cancelOrder(order);
            } catch (error) {
                this.log.error(error.toString());
                return;
            }
        }

        if (order.side === "buy") {
            // compute how much of the quote currency was reserved
            const quotePrice = order.price * order.amount;

            // unreserve the amount
            this._release(quoteCurrency, quotePrice);
        } else {
            // unreserve the amount
            this._release(baseCurrency, order.amount);
        }

        // move the order to the cancelled order record
        this._state.cancelledOrders[order.id] = order;

        // if the order was partly filled, also add it to the closed order recorde
        if (order.filled > 0) {
            this._state.closedOrders[order.id] = order;
            this._state.closedOrders[order.id].timestampClosed = this.currentTime;
        }

        // delete the open order
        delete this._state.openOrders[order.id];

        // post the event
        Object.assign(eventData, {
            quoteBalanceAfter: this.getBalance(quoteCurrency),
            baseBalanceAfter: this.getBalance(baseCurrency)
        });
        this.post(order.type + "_order_cancelled", eventData);
        this.log.notice(`Cancelled order: ${JSON.stringify(order)}.`);
    }

    public async cancelAllOrders(market?: string, side?: OrderSide) {
        const openOrderIds = Object.keys(this._state.openOrders);
        return Promise.all(openOrderIds.map((orderId) => (async () => {
            const order = this._state.openOrders[orderId];
            // ignore orders that are not of the provided side
            if (side && order.side !== side) {
                return;
            }
            // ignore orders that are not of the provided market
            if (market && order.market !== market) {
                return;
            }
            return this.cancelOrder(order);
        })()));
    }

    public async cancelOrderById(id: string): Promise<void> {
        if (this._state.lockdown) {
            throw new Error("Exchange is in lockdown mode.");
        }
        // retrieve the order
        const order = this.getOrder(id);
        if (!order) {
            throw new Error(`Unknown order id: ${id}.`);
        }
        return this.cancelOrder(order);
    }

    public getOrder(id: string): IOrder {
        return this._state.openOrders[id] || this._state.closedOrders[id] || null;
    }

    public setOrderAutoCancel(id: string, autoCancel: string | number) {
        // retrieve the order
        const order = this._state.openOrders[id];
        if (!order) {
            throw new Error(`Unknown order id: ${id}.`);
        }
        const timeDiff = this.currentTime - order.timestamp;
        // convert autocancel value to ms if needed
        let autoCancelMs: number;
        if (Types.isString(autoCancel)) {
            autoCancelMs = MathHelper.periodToMs(autoCancel as string);
        } else {
            autoCancelMs = autoCancel as number;
        }
        order.autoCancel = autoCancelMs + timeDiff;
    }

    public getClosedOrders(market?: string, since?: number, limit?: number, filter?: (order: IOrder) => boolean): IOrder[] {
        const result = [];
        const orderIds = Object.keys(this._state.closedOrders);
        for (const orderId of orderIds) {
            const order = this._state.closedOrders[orderId];
            if (market && order.market !== market) {
                continue;
            }
            if (since && order.timestamp < since) {
                continue;
            }
            if (limit && result.length >= limit) {
                break;
            }
            if (filter && !filter(order)) {
                continue;
            }
            result.push(order);
        }
        return result;
    }

    public getOpenOrders(market?: string, side?: OrderSide, filter?: (order: IOrder) => boolean): IOrder[] {
        const result = [];
        const orderIds = Object.keys(this._state.openOrders);
        for (const orderId of orderIds) {
            const order = this._state.openOrders[orderId];
            if (market && order.market !== market) {
                continue;
            }
            if (side && order.side !== side) {
                continue;
            }
            if (filter && !filter(order)) {
                continue;
            }
            result.push(order);
        }
        return result;
    }

    public getLastClosedOrder(market: string, side?: OrderSide, filter?: (order: IOrder) => boolean): IOrder {
        let lastOrder: IOrder = null;
        const orderIds = Object.keys(this._state.closedOrders);
        for (const orderId of orderIds) {
            const order = this._state.closedOrders[orderId];
            // ignore orders not in this market or not on this side
            if (order.market !== market) {
                continue;
            }
            if (side && side !== order.side) {
                continue;
            }
            if (filter && !filter(order)) {
                continue;
            }
            // deal with the first order
            if (!lastOrder) {
                lastOrder = order;
                continue;
            }
            if (order.timestamp > lastOrder.timestamp) {
                lastOrder = order;
            }
        }
        return lastOrder;
    }

    // markets

    public get markets(): string[] {
        const currencies = Object.keys(this._state.balances);
        return currencies.map(currency => `${currency}/${this._state.fiatCurrency}`);
    }

    // current time

    public get currentTime(): number {
        return Date.now();
    }

    // order book
    public getOrderBook(market: string): IOrderBook {
        return this._state.orderBooks[market] || { bids: [], asks: [] };
    }
    

    // trades

    public getTrades(market: string): ITrade[] {
        return this._state.trades[market] || [];
    }


    // balance
    public get fiatBalance(): Balance {
        return this.getBalance(this.fiatCurrency);
    }
    
    public getBalances(currenciesOrMarkets?: string[]): Record<string, Balance> {
        const balances = {};
        currenciesOrMarkets = currenciesOrMarkets || Object.keys(this._state.balances);
        for (const currencyOrMarket of currenciesOrMarkets) {
            balances[currencyOrMarket] = this.getBalance(currencyOrMarket);
        }
        return balances;
    }

    public getBalance(currencyOrMarket: string): Balance {
        if (currencyOrMarket.indexOf("/") >= 0) {
            currencyOrMarket = currencyOrMarket.split("/")[0];
        }
        if (!this._state.balances[currencyOrMarket]) {
            this._state.balances[currencyOrMarket] = {
                free: 0,
                used: 0
            };
        }
        const balance = Object.assign({}, this._state.balances[currencyOrMarket]);
        balance.locked = Math.min(this._state.reserves[currencyOrMarket] || 0, balance.free);
        return new Balance(balance);
    }

    public get fiatCurrency(): string {
        return this._state.fiatCurrency;
    }

    public convertToQuote(amount: number, marketOrPrice: string | number): number {
        if (Types.isString(marketOrPrice)) {
            // retrieve the price from the latest ticker
            const ticker = this.getTicker(marketOrPrice as string);
            marketOrPrice = ticker.last;
        }
        return amount * (marketOrPrice as number);
    }

    public convertToBase(amount: number, marketOrPrice: string | number): number {
        if (Types.isString(marketOrPrice)) {
            // retrieve the price from the latest ticker
            const ticker = this.getTicker(marketOrPrice as string);
            if (!ticker) {
                throw new Error(`Ticker for market ${marketOrPrice} is not available.`);
            }
            marketOrPrice = ticker.last;
        }
        return amount / (marketOrPrice as number);
    }

    // reserves
    public setReserve(currency: string, amount: number) {
        this._state.reserves[currency] = amount;
    }

    protected getReserve(currency: string): number {
        return this._state.reserves[currency] || 0;
    }

    public clearReserve(currency: string) {
        delete this._state.reserves[currency];
    }

    // depositing and withdrawing
    public async deposit(currency: string, amount: number, address?: string): Promise<void> {
        if (this._state.lockdown) {
            throw new Error("Exchange is in lockdown mode.");
        }
        if (this._state.simulation) {
            const balance = this.getBalance(currency);

            // create the event data object
            const eventData: any = {
                currency,
                balanceBefore: balance.json
            };

            this._deposit(currency, amount);

            Object.assign(eventData, {
                balanceAfter: this.getBalance(currency).json
            });
            this.post("deposit", eventData);
        } else if (!this._dryRun) {
            return this._exchange.deposit(currency, amount.toString(), address);
        }
    }

    public async withdraw(currency: string, amount: number, address?: string): Promise<void> {
        if (this._state.lockdown) {
            throw new Error("Exchange is in lockdown mode.");
        }
        if (this._state.simulation) {
            const balance = this.getBalance(currency);

            // create the event data object
            const eventData: any = {
                currency,
                balanceBefore: balance.json
            };

            if (balance.free < amount) {
                throw new Error("Withdrawal amount higher than balance.");
            }
            this._withdraw(currency, amount);

            Object.assign(eventData, {
                balanceAfter: this.getBalance(currency).json
            });
            this.post("withdraw", eventData);
        } else if (!this._dryRun) {
            return this._exchange.withdraw(currency, amount, address);
        }
    }

    // updating

    public async beforeUpdate(markets?: string[]) {

        // sync tickers and balance
        const promiseResult = await Promise.all([
            this.syncTickers(markets),
            this.syncBalance()
        ]);
        return promiseResult.every((value) => value === true);
    }

    public async update(market?: string): Promise<boolean> {
        if (this._state.lockdown) {
            return;
        }

        // sync the orders
        const success = await this.syncOrders(market);
        if (!success) {
            return false;
        }

        // fulfill limit orders if needed
        if (this._state.simulation) {
            await this.fulfillLimitOrders(market);
        }

        // auto cancel orders
        await this.autoCancelOrders(market);

        // cancel and replace sticky orders if needed
        await this.updateStickyOrders(market);

        // finally, remove old orders that are no longer relevant
        this.purgeOrderList(market);

        return true;
    }

    protected async autoCancelOrders(market?: string) {
        const ticker = this.getTicker(market)
        const openOrders = this.getOpenOrders(market, undefined, (order: IOrder) => {
            if (order.autoCancel && order.timestamp + order.autoCancel < this.currentTime) {
                return true;
            } else if (order.filled >= order.autoCancelAtFillPercentage * order.amount) {
                return true;
            }
            if (order.side === OrderSide.Buy && ticker.ask > order.autoCancelAtPriceLevel) {
                return true;
            } else if (order.side === OrderSide.Sell && ticker.bid < order.autoCancelAtPriceLevel) {
                return true;
            }
            return false;
        });
        return Promise.all(openOrders.map((order) => this.cancelOrder(order)));
    }

    protected async updateStickyOrders(market?: string) {
        const openOrders = this.getOpenOrders(market, undefined, (order: IOrder) => 
            order.sticky
        );
        return Promise.all(openOrders.map((order) => this._updateStickyOrder(order)));
    }

    protected async fulfillLimitOrders(market?: string) {
        const openOrders = this.getOpenOrders(market, undefined, (order: IOrder) => 
            order.type === OrderType.Limit
        );
        return Promise.all(openOrders.map((order) => this._checkFullfillOrder(order)));
    }

    private async _checkFullfillOrder(order: IOrder) {
        // only deal with limit orders
        if (order.type !== OrderType.Limit) {
            return;
        }

        // a few useful variables
        const quoteCurrency = order.market.split("/")[1];
        const baseCurrency = order.market.split("/")[0];
        const quoteBalance = this.getBalance(quoteCurrency);
        const baseBalance = this.getBalance(baseCurrency);

        // retrieve the last smallest candle
        const latestCandle = await this.retrieveLatestCandle(order.market);
        if (!latestCandle || latestCandle.volume <= 0 || order.timestamp >= latestCandle.timestamp) {
            // nothing happened during this candle, or the order was placed during this candle,
            // so we are done
            return;
        }

        // create the event data object
        const eventData: any = {
            orderId: order.id,
            order,
            quoteBalanceBefore: quoteBalance.json,
            baseBalanceBefore: baseBalance.json
        };

        if (order.side === "buy" && latestCandle.low < order.price) {
            // buy
            this._withdrawFromUsed(quoteCurrency, order.amount * order.price);
            this._deposit(baseCurrency, order.amount * (1 - this._state.fee));
            order.status = "closed";
            order.filled = order.amount;
            order.remaining = 0;
            order.timestampClosed = this.currentTime;
            delete this._state.openOrders[order.id];
            this._state.closedOrders[order.id] = order;

            Object.assign(eventData, {
                quoteBalanceAfter: this.getBalance(quoteCurrency).json,
                baseBalanceAfter: this.getBalance(baseCurrency).json
            });
            this.post("limit_order_fulfilled", eventData);
        } else if (order.side === "sell" && latestCandle.high > order.price) {
            // sell
            this._withdrawFromUsed(baseCurrency, order.amount);
            this._deposit(quoteCurrency, order.amount * order.price * (1 - this._state.fee));
            order.status = "closed";
            order.filled = order.amount;
            order.remaining = 0;
            delete this._state.openOrders[order.id];
            this._state.closedOrders[order.id] = order;

            Object.assign(eventData, {
                quoteBalanceAfter: this.getBalance(quoteCurrency).json,
                baseBalanceAfter: this.getBalance(baseCurrency).json
            });
            this.post("limit_order_fulfilled", eventData);
        }
    }

    private async _updateStickyOrder(order: IOrder) {
        // if an order is not sticky, we don't need to do anything else
        if (!order.sticky) {
            return;
        }

        this.log.info(`Checking if sticky ${order.side} order ${order.id} (price: ${order.price}) should be updated.`);
        const ticker = this.getTicker(order.market);

        // sync and retrieve the order book for this market
        await this.syncOrderBook([order.market]);
        const orderBook = this.getOrderBook(order.market);

        this.log.info(`Current ticker for market ${order.market}: ${JSON.stringify(ticker.json)}.`);

        // compute the new price
        let newPrice = order.side === OrderSide.Buy ? ticker.bid : ticker.ask;
        if (order.side === OrderSide.Buy && orderBook.bids.length > 1) {
            // check if we are the only best buyer
            const bestBidPrice = orderBook.bids[0][0];
            const bestBidAmount = orderBook.bids[0][1];
            const secondBestBidPrice = orderBook.bids[1][0];
            if (order.remaining >= bestBidAmount && order.price === bestBidPrice) {
                newPrice = secondBestBidPrice;
            }
        } else if (order.side === OrderSide.Sell && orderBook.asks.length > 1) {
            // check if we are the only best seller
            const bestAskPrice = orderBook.asks[0][0];
            const bestAskAmount = orderBook.asks[0][1];
            const secondBestAskPrice = orderBook.asks[1][0];
            if (order.remaining >= bestAskAmount && order.price === bestAskPrice) {
                newPrice = secondBestAskPrice;
            }
        }

        if (order.price === newPrice) {
            // the price didn't change, so no need to update
            this.log.info(`Price did not change, so no need to cancel sticky order ${order.id} in market ${order.market}.`);
            return;
        }

        try {
            this.log.info(`Cancelling sticky order ${order.id} (price: ${order.price}).`);
            await this.cancelOrder(order);
            // remove the order from the cancelled orders array since this is a sticky order
            delete this._state.cancelledOrders[order.id];
            const newAutoCancel = order.autoCancel ? order.autoCancel - (this.currentTime - order.timestamp) : undefined;
            if ((!order.autoCancel || newAutoCancel > 0) && order.remaining >= this.getMinDealAmount(order.market)) {
                this.log.info(`Creating sticky order ${order.id} (new price: ${newPrice}, amount: ${order.remaining}).`);
                await this.createOrder({
                    market: order.market,
                    type: OrderType.Limit,
                    side: order.side,
                    amount: order.remaining,
                    price: newPrice,
                    autoCancel: newAutoCancel,
                    autoCancelAtFillPercentage: order.autoCancelAtFillPercentage,
                    sticky: true,
                });                        
            } else {
                if (order.autoCancel && newAutoCancel <= 0) {
                    this.log.info(`Not creating new sticky order since the new order would be immediately cancelled.`);
                } else if (order.filled >= order.autoCancelAtFillPercentage * order.amount) {
                    this.log.info(`Not creating new sticky order since the new order would be immediately cancelled due to being filled above the fill percentage.`);
                } else {
                    this.log.info(`Not creating new sticky order since the new order amount ${order.remaining} is less than the minimum deal amount ${this.getMinDealAmount(order.market)}.`);
                }
            }
        } catch (error) {
            this.log.error(error.toString());
        }
    }

    protected purgeOrderList(market?: string) {
        const purgeAge = 1000 * 60 * 60 * 24 * 7; // one week

        this.log.debug(`Starting order purge.`);

        // purge closed orders
        let closedOrderPurgeCount = 0;
        const closedOrderIds = Object.keys(this._state.closedOrders);
        for (const orderId of closedOrderIds) {
            // ignore orders not in the provided market
            if (market && this._state.closedOrders[orderId].market !== market) {
                continue;
            }
            if (this._state.closedOrders[orderId].timestamp + purgeAge < this.currentTime) {
                delete this._state.closedOrders[orderId];
                this.log.info(`Purging closed order with id ${orderId}.`);
                closedOrderPurgeCount += 1;
            }
        }
        if (closedOrderPurgeCount > 0) {
            this.log.notice(`Purged ${closedOrderPurgeCount} closed orders.`);
        }

        // purge cancelled orders
        let cancelledOrderPurgeCount = 0;
        const cancelledOrderIds = Object.keys(this._state.cancelledOrders);
        for (const orderId of cancelledOrderIds) {
            if (this._state.cancelledOrders[orderId].timestamp + purgeAge < this.currentTime) {
                delete this._state.cancelledOrders[orderId];
                this.log.info(`Purging cancelled order with id ${orderId}.`);
                cancelledOrderPurgeCount += 1;
            }
        }
        if (cancelledOrderPurgeCount > 0) {
            this.log.notice(`Purged ${cancelledOrderPurgeCount} cancelled orders.`);
        }

        this.log.debug(`Completed order purge.`);
    }

    // ****************************************************************
    // Syncing/updating balance, order, and ticker data
    // ****************************************************************

    public async lockdown() {
        this._state.lockdown = true;
    }

    public async resetLockdown() {
        this._state.lockdown = false;
    }

    public get isInLockdown(): boolean {
        return this._state.lockdown;
    }

    public getTotalBalanceFromMarkets(includeReserve = false, markets?: string[], includeFiatCurrency: boolean = true): number {
        // construct the list of currencies
        const currencies = [];
        for (const market of markets) {
            currencies.push(market.split("/")[0]);
        }
        if (includeFiatCurrency) {
            currencies.push(this.fiatCurrency);
        }
        return this.getTotalBalance(includeReserve, currencies);
    }

    public getTotalBalance(includeReserve = false, currencies?: string[], ignoreMissingMarkets: boolean = false): number {
        const markets = this.markets;

        const balances = this.getBalances(currencies);
        if (!balances) {
            return null;
        }
        const tickers = this.getTickers();
        if (!tickers) {
            return null;
        }

        let total = 0;
        currencies = currencies || Object.keys(balances);
        for (const currency of currencies) {
            // check if the market still exists
            const market = `${currency}/${this._state.fiatCurrency}`;
            const marketOpposite = `${this._state.fiatCurrency}/${currency}`;
            if (currency !== this._state.fiatCurrency && markets.indexOf(market) < 0 && markets.indexOf(marketOpposite) < 0) {
                continue;
            }
            if (!balances[currency]) {
                this.log.warning(`Unable to compute total balance due to missing balance for currency ${currency}.`);
                return null;
            }

            let totalBalance = balances[currency].total;
            if (includeReserve) {
                totalBalance += balances[currency].locked;
            }
            if (totalBalance <= 0) {
                continue;
            }
            if (currency === this._state.fiatCurrency) {
                total += totalBalance;
            } else {
                if (tickers[market]) {
                    const data = tickers[market];
                    total += data.bid * totalBalance;
                } else if (!ignoreMissingMarkets) {
                    this.log.warning(`Unable to compute total balance due to missing market ${market}.`);
                    return null;
                }
            }
        }
        return total;
    }

    public getTickers(markets?: string[]): Record<string, Ticker> {
        const tickers = {};
        markets = markets || Object.keys(this._state.tickers);
        for (const market of markets) {
            if (this._state.tickers[market]) {
                tickers[market] = new Ticker(this._state.tickers[market]);
            }
        }
        return tickers;
    }

    public getTicker(market: string): Ticker {
        const tickers = this.getTickers([market]);
        if (!tickers[market]) {
            throw new Error(`Unable to retrieve ticker for market ${market}`);
        }
        return tickers[market];
    }

    public async retrieveCandles(market: string, timeframe?: string, since?: number, limit?: number, cleanData: boolean = true): Promise<Candle[]> {
        return this._exchange.retrieveCandles(market, timeframe, since, limit, cleanData);
    }

    public async retrieveLatestCandle(market: string, timeframe?: string, cleanData?: boolean): Promise<Candle> {
        const latestCandle = await this.retrieveCandles(market, timeframe, undefined, 1, cleanData);
        if (!latestCandle) {
            return null;
        }
        return latestCandle.length > 0 ? latestCandle[0] : null;
    }

    // ****************************************************************
    // Managing events
    // ****************************************************************

    public async post(type: string, data?: any) {
        return;
    }

    public async clearEventList() {
        return;
    }

    public async getEvents() {
        return [];
    }

    // syncing

    public async syncTickers(markets?: string[]): Promise<boolean> {
        if (!this._exchange) {
            return true; // no syncing is needed since there is no exchange
        }
        try {
            this.log.notice(`Syncing tickers.`);
            const tickers = await this._exchange.fetchTickers(markets);
            // verify that all tickers have been retrieved
            for (const market of markets) {
                if (!tickers[market]) {
                    throw new Error(`Missing ticker for market ${market}.`);
                }
            }
            this._state.tickers = tickers;
            merge(this._state.tickers, tickers);
            this.log.notice(`Finished syncing tickers.`);
            return true;
        } catch (error) {
            this.log.error(error.toString());
            return false;
        }
    }

    public async syncBalance(): Promise<boolean> {
        if (!this._exchange || this._state.simulation) {
            return true; // no syncing is needed since there is no exchange
        }
        try {
            this.log.notice(`Syncing balance.`);
            const balances = await this._exchange.fetchBalance();
            merge(this._state.balances, balances);
            this.log.notice(`Finished syncing balance.`);
            return true;
        } catch (error) {
            this.log.error(error.toString());
            return false;
        }
    }

    public async syncOrders(market?: string): Promise<boolean> {
        if (!this._exchange || this._state.simulation) {
            return true; // no syncing is needed since there is no exchange
        }
        const { openOrders, closedOrders, cancelledOrders, forceAutoCancel } = this._state;
        try {
            this.log.notice(market ? `Syncing orders for market ${market}.` : `Syncing orders.`);
            // fetch the open orders
            const ccxtOrders = await this._exchange.fetchOpenOrders(market);
            const ccxtOrderIdMap = ArrayUtils.mapFromArray(ccxtOrders, "id");
            this.log.debug(`Ccxt order ids for market ${market}: ${Object.keys(ccxtOrderIdMap)}.`);
            // move all open orders in the document that are not in the open order list
            // to the closed order list and update the open orders if needed
            for (const orderId of Object.keys(openOrders)) {
                if (market && openOrders[orderId].market !== market) {
                    continue;
                }
                // update the open order information
                if (!ccxtOrderIdMap[orderId]) {
                    if (!cancelledOrders[orderId]) {
                        // we assume the order is fulfilled since it is not in the orders retrieved from the
                        // exchange, and not in the cancelled orders array
                        this.log.info(`Closing order ${JSON.stringify(openOrders[orderId])}.`);
                        closedOrders[orderId] = openOrders[orderId];
                        closedOrders[orderId].timestampClosed = this.currentTime;
                        delete openOrders[orderId];

                        // update the order status
                        const order = closedOrders[orderId];
                        Object.assign(order, {
                            status: "closed",
                            filled: order.amount,
                            remaining: 0
                        });

                        if (order.side === OrderSide.Buy) {
                            this.log.notice(colors.green(`Bought ${order.filled.toFixed(7)} in market ${order.market} for price ${order.price.toFixed(7)}.`));
                        } else {
                            this.log.notice(colors.red(`Sold ${order.filled.toFixed(7)} in market ${order.market} for price ${order.price.toFixed(7)}.`));
                        }

                        // post an event
                        const quoteCurrency = order.market.split("/")[1];
                        const baseCurrency = order.market.split("/")[0];
                        this.post("limit_order_fulfilled", {
                            order,
                            quoteBalanceAfter: this.getBalance(quoteCurrency), // balance should be synced before orders
                            baseBalanceAfter: this.getBalance(baseCurrency) // balance should be synced before orders
                        });
                    }
                } else {
                    this.log.debug(`Updating open order with id ${orderId}.`);
                    const order = openOrders[orderId];
                    const ccxtOrder = ccxtOrderIdMap[orderId];
                    // update the open order in the document
                    Object.assign(order, {
                        status: ccxtOrder.status,
                        filled: ccxtOrder.filled,
                        remaining: ccxtOrder.remaining,
                        fee: ccxtOrder.fee
                    });
                }
            }
            // create new open orders for orders that are not yet in the database
            for (const ccxtOrder of ccxtOrders) {
                if (openOrders[ccxtOrder.id]) {
                    continue;
                }
                if (closedOrders[ccxtOrder.id]) {
                    // we accidentally removed an order that shouldn't have been removed
                    // so put it back
                    this.log.warning(`Restoring cancelled order with id ${ccxtOrder.id}.`);
                    openOrders[ccxtOrder.id] = closedOrders[ccxtOrder.id];
                    delete closedOrders[ccxtOrder.id];
                    Object.assign(openOrders[ccxtOrder.id], {
                        status: ccxtOrder.status,
                        filled: ccxtOrder.filled,
                        remaining: ccxtOrder.remaining,
                        fee: ccxtOrder.fee
                    });
                } else if (forceAutoCancel) {
                    this.log.info(`Cancelling order with id ${ccxtOrder.id} due to forceAutoCancel setting.`);
                    // cancel the order since only orders with auto cancel value are allowed
                    if (!this._dryRun) {
                        await this.cancelOrder(ccxtOrder);
                    }
                } else {
                    this.log.info(`Creating new open order of ccxt order in market ${ccxtOrder.market}.`);
                    openOrders[ccxtOrder.id] = ccxtOrder;
                }
            }
            // Finally verify that all orders have autocancel and sticky settings
            let countOpenOrders = 0;
            for (const orderId of Object.keys(openOrders)) {
                if (market && openOrders[orderId].market !== market) {
                    continue;
                }
                const order = openOrders[orderId];
                if (order.sticky === undefined) {
                    this.log.warning(`Cancelling zombie order: ${JSON.stringify(order)}.`);
                    if (!this._dryRun) {
                        await this._exchange.cancelOrder(order);
                    }
                    delete openOrders[orderId];
                } else {
                    countOpenOrders += 1;
                }
            }
            if (ccxtOrders.length !== countOpenOrders) {
                this.log.error(`Order array lengths are different after sync.`);
                this.log.info(JSON.stringify(ccxtOrderIdMap));
                this.log.info(JSON.stringify(openOrders));
                return false;
            }
            if (market) {
                this.log.notice(`Finished syncing orders for market ${market} (${countOpenOrders} open orders).`);
            } else {
                this.log.notice(`Finished syncing orders (${countOpenOrders} open orders).`)
            }
            return true;
        } catch (error) {
            this.log.error(error.toString());
            return false;
        }
    }

    public async syncOrderBook(markets: string[]): Promise<boolean> {
        if (!this._exchange || this._state.simulation) {
            return true; // no syncing is needed since there is no exchange
        }
        this._state.orderBooks = this._state.orderBooks || {};
        try {
            this.log.notice(`Syncing order book for markets ${JSON.stringify(markets)}.`);
            Object.assign(this._state.orderBooks, await this._exchange.fetchOrderBook(markets, 50));
            this.log.notice(`Finished syncing order book for markets ${JSON.stringify(markets)}.`);
            return true;
        } catch (error) {
            this.log.error(error.toString());
            return false;
        }
    }

    public async syncTrades(markets: string[]): Promise<boolean> {
        if (!this._exchange) {
            return true; // no syncing is needed since there is no exchange
        }
        this._state.trades = this._state.trades || {};
        try {
            this.log.notice(`Syncing trades for markets ${JSON.stringify(markets)}.`);
            Object.assign(this._state.trades, await this._exchange.fetchTrades(markets, undefined, 50));
            this.log.notice(`Finished syncing trades for markets ${JSON.stringify(markets)}.`);
            return true;
        } catch (error) {
            this.log.error(error.toString());
            return false;
        }
    }
}
