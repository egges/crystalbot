import mongoose            = require("mongoose");
import { LogLevel }         from "../core/log";

interface IModelTracker extends mongoose.Document {
    exchangeId: mongoose.Types.ObjectId;
    timeframes: string[];
    paused: boolean;
    markets: string[];
    logLevel: LogLevel;
    lastTracked: number;
    historyDays: number;
    tags?: string[];
    metadata?: any;
}

export default IModelTracker;
