import mongoose                 = require("mongoose");
import IEvent                   from "../exchange/IEvent";

const schema = new mongoose.Schema({
    exchangeId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    timestamp:  {
        type: Number,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    data: {
        type: mongoose.SchemaTypes.Mixed,
        default: {}
    }
}, { minimize: false, versionKey: false, timestamps: true });

const model = mongoose.model<IEvent & mongoose.Document>("event", schema);
export default model;
