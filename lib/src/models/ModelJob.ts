import mongoose                 = require("mongoose");
import { IModelJob }            from "./IModelJob";

const schema = new mongoose.Schema({
    name: String,
    data: {
        type: mongoose.SchemaTypes.Mixed,
        default: {}
    },
    lastModifiedBy: {
        type: Date,
        default: null
    },
    nextRunAt: {
        type: Date,
        default: null
    },
    priority: Number,
    repeatInterval: String,
    repeatTimezone: String,
    lockedAt: {
        type: Date,
        default: null
    },
    lastFinishedAt: {
        type: Date,
        default: null
    },
    lastRunAt: {
        type: Date,
        default: null
    },
}, { minimize: false, versionKey: false, timestamps: false });

export const ModelJob = mongoose.model<IModelJob>("job", schema);
