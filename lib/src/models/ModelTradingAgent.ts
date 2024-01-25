import mongoose                         = require("mongoose");
import IModelTradingAgent               from "./IModelTradingAgent";

const schema = new mongoose.Schema({
    exchangeId: mongoose.Schema.Types.ObjectId,
    strategy: String,
    paused: {
        type: Boolean,
        default: false
    },
    strategyOptions: {
        type: mongoose.SchemaTypes.Mixed,
        default: {}
    },
    strategyState: {
        type: mongoose.SchemaTypes.Mixed,
        default: {}
    },
    maxDrawdown: Number,
    peakMarketAmount: Number,
    minimumVolume: Number,
    minimumAverageVolume: Number,
    maxPercentageHoursNoVolume: Number,
    minimumFiatPrice: Number,
    blacklist: {
        type: [String],
        default: []
    },
    fiatCurrency: String,
    metadata: {
        type: mongoose.SchemaTypes.Mixed,
        default: {}
    }
}, { minimize: false, versionKey: false, timestamps: true });

export default mongoose.model<IModelTradingAgent>("tradingagent", schema);
