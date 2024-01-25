import { Candle }               from "../Candle";
import IOrder                   from "../IOrder";
import { OrderType }            from "../OrderType";
import { OrderSide }            from "../OrderSide";
import { IBalance }             from "../Balance";
import IModelExchange           from "../../models/IModelExchange";
import { IOrderBook }           from "../IOrderBook";
import { ITrade }               from "../ITrade";

export interface ICcxtExchange {

    name: string;

    rateLimit: number;
    enableRateLimit: boolean;

    loadMarkets(): Promise<any>;

    getMarkets(fiatCurrency?: string): string[];
    market(symbol: string): any;

    getMinDealAmount(market: string): number;

    fetchBalance(): Promise<Record<string, IBalance>>;

    fetchOpenOrders(symbol?: string): Promise<IOrder[]>;

    fetchTickers(markets?: string[], fiatCurrency?: string): Promise<Record<string, number[]>>;

    fetchOrderBook(markets: string[], limit?: number): Promise<Record<string, IOrderBook>>;
    fetchTrades(markets: string[], since?: number, limit?: number): Promise<Record<string, ITrade[]>>;

    createOrder(symbol: string, type: OrderType, side: OrderSide, amount: number, price?: number, params?: any): Promise<string>;
    cancelOrder(order: IOrder): Promise<void>;
    
    deposit(currency: string, amount: string, address: string): Promise<void>;
    withdraw(currency: string, amount: number, address: string): Promise<void>;

    retrieveCandles(market: string, timeframe?: string, since?: number, limit?: number, cleanData?: boolean): Promise<Candle[]>;
}