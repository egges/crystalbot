import mongoose                 = require("mongoose");
import IModelTracker            from "./IModelTracker";
import { LogLevel }             from "../core/log";

const schema = new mongoose.Schema({
    exchangeId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    timeframes: {
        type: [String],
        default: []
    },
    markets: {
        type: [String],
        default: []
    },
    paused: {
        type: Boolean,
        default: false
    },
    logLevel: {
        type: String,
        default: LogLevel.Notice
    },
    lastTracked: Number,
    historyDays: Number,
    tags: {
        type: [String],
        default: []
    },
    metadata: {
        type: mongoose.SchemaTypes.Mixed,
        default: {}
    }
}, { minimize: false, versionKey: false, timestamps: true });

const model = mongoose.model<IModelTracker>("tracker", schema);
export default model;
