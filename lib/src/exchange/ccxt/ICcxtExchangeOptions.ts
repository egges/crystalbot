
import { LogLevel }       from "../../core/log";

export interface ICcxtExchangeOptions {
    id?: any;
    exchangeName: string;
    apiKey?: string;
    apiSecret?: string;
    password?: string;
    rateLimit?: number;
    verbose?: boolean;
    logLevel: LogLevel;
}