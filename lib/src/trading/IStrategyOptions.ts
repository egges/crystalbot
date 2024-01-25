
import { LogLevel } from "../core/log";

export interface IMarketSettings {
    trend: number;
    priceLevel: number;
    canTrade: boolean;
}

export interface IStrategyOptions {
    logLevel: LogLevel;
    marketSettings: Record<string, Partial<IMarketSettings>>;
}
