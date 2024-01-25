import { IStrategyOptions } from "./IStrategyOptions";

export interface ITradingAgentState {
    strategy: string;
    strategyOptions: IStrategyOptions;
    strategyState: any;
    paused?: boolean;
    maxDrawdown?: number;
    minimumFiatPrice?: number;
    fiatCurrency?: string;
    minimumVolume?: number;
    minimumAverageVolume?: number;
    maxPercentageHoursNoVolume?: number;
    blacklist: string[];
    peakMarketAmount?: number;
    metadata?: any;
}
