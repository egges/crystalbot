import Balance              from "./Balance";
import IOrder               from "./IOrder";
import IEvent               from "./IEvent";
import { Candle }           from "./Candle";
import Ticker               from "./Ticker";
import { ICcxtExchange }    from "./ccxt/ICcxtExchange";
import { IOrderBook }       from "./IOrderBook";
import { ITrade }           from "./ITrade";
import { OrderSide }        from "./OrderSide";
import { OrderType }        from "./OrderType";

export interface ICreateOrderOptions {
    market: string;
    type: OrderType;
    side: OrderSide;
    amount: number;
    price?: number; // default the best bid for a buy order and the best ask for a sell order
    autoCancel?: string | number; // default no auto cancelling
    autoCancelAtFillPercentage?: number; // between 0 and 1
    autoCancelAtPriceLevel?: number; // auto cancel when price reaches a certain level
    sticky?: boolean;
}

export interface IExchange {

    readonly name: string;
    readonly ccxtExchange: ICcxtExchange;
    dryRun: boolean;

    // orders
    getMinDealAmount(market: string): number;
    createOrder(options: ICreateOrderOptions): Promise<string>;
    cancelOrderById(id: string): Promise<void>;
    cancelOrder(order: IOrder): Promise<void>;
    cancelAllOrders(market?: string, side?: OrderSide);
    getOrder(id: string): IOrder;
    getClosedOrders(market?: string, since?: number, limit?: number, filter?: (order: IOrder) => boolean): IOrder[];
    getOpenOrders(market?: string, side?: OrderSide, filter?: (order: IOrder) => boolean): IOrder[];
    getLastClosedOrder(market: string, side?: OrderSide, filter?: (order: IOrder) => boolean): IOrder;

    setOrderAutoCancel(id: string, autoCancel: string | number);

    // market
    readonly markets: string[];

    // balance
    readonly fiatBalance: Balance;
    getBalances(currenciesOrMarkets?: string[]): Record<string, Balance>;
    getBalance(currencyOrMarket: string): Balance;
    // total balance in the fiat currency
    getTotalBalance(includeReserve?: boolean, currenciesOrMarkets?: string[], ignoreMissingMarkets?: boolean): number;
    getTotalBalanceFromMarkets(includeReserve?: boolean, markets?: string[], includeFiatCurrency?: boolean): number;
    readonly fiatCurrency: string;


    // helper functions
    convertToQuote(amount: number, marketOrPrice: string | number): number;
    convertToBase(amount: number, marketOrPrice: string | number): number;

    // depositing and withdrawing
    deposit(currency: string, amount: number, address?: string): Promise<void>;
    withdraw(currency: string, amount: number, address?: string): Promise<void>;

    // updating the exchange (auto cancel orders; replace sticky orders etc)
    beforeUpdate(markets?: string[]);
    update(market?: string);

    // get the current exchange time as a ms timestamp
    readonly currentTime: number;

    // get single or multiple tickers
    getTickers(markets?: string[]): Record<string, Ticker>;
    getTicker(market: string): Ticker;

    // candles
    retrieveCandles(market: string, timeframe?: string, since?: number, limit?: number, cleanData?: boolean): Promise<Candle[]>;
    retrieveLatestCandle(market: string, timeframe?: string, cleanData?: boolean): Promise<Candle>;

    // order book
    getOrderBook(market: string): IOrderBook;
    
    // recent trades
    getTrades(market: string): ITrade[];

    // lockdown mode
    lockdown();
    readonly isInLockdown: boolean;
    resetLockdown();

    // posting an event
    post(type: string, data?: any): Promise<void>;
    clearEventList(): Promise<void>;
    getEvents(): Promise<IEvent[]>;

    // syncing
    syncBalance(): Promise<boolean>;
    syncTickers(markets?: string[]): Promise<boolean>;
    syncOrders(market?: string): Promise<boolean>;
    syncOrderBook(markets: string[]): Promise<boolean>;
    syncTrades(markets: string[]): Promise<boolean>;
}
