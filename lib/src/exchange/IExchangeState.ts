import IOrder from "./IOrder";
import { IOrderBook }       from "./IOrderBook";

import { IBalance } from "./Balance";
import { LogLevel } from "../core/log";
import { ITrade } from "./ITrade";

export interface IExchangeState {
    id?: any;
    exchangeName: string;
    simulation: boolean;
    reserves: Record<string, number>;
    minDealAmounts: Record<string, number>;
    fee: number;
    fiatCurrency: string;
    forceAutoCancel: boolean;
    lockdown: boolean;
    cancelledOrders: Record<string, IOrder>;
    closedOrders: Record<string, IOrder>;
    openOrders: Record<string, IOrder>;
    balances: Record<string, IBalance>;
    tickers: Record<string, number[]>;
    orderBooks: Record<string, IOrderBook>;
    trades: Record<string, ITrade[]>;
    balanceLastSync: number;
    ordersLastSync: number;
    tickersLastSync: number;
    maxSyncAge: number;
    logLevel: LogLevel;
    rateLimit: number;
}