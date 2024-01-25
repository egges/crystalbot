import mongoose                 = require("mongoose");
import IModelCandle             from "./IModelCandle";

const schema = new mongoose.Schema({
    exchangeName: {
        type: String,
        required: true
    },
    market: {
        type: String,
        required: true
    },
    timeframe: {
        type: String,
        required: true
    },
    timestamp:  {
        type: Number,
        required: true,
        index: true
    },
    data: {
        type: [Number],
        default: []
    },
    tickerData: {
        type: [mongoose.SchemaTypes.Mixed],
        default: []
    },
    orderBookData: {
        type: mongoose.SchemaTypes.Mixed,
        default: {}
    },
    tradeData: {
        type: [mongoose.SchemaTypes.Mixed],
        default: []
    }
}, { minimize: false, versionKey: false, timestamps: true });

const model = mongoose.model<IModelCandle>("candle", schema);
export default model;
