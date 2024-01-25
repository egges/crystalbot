import mongoose            = require("mongoose");

export interface IModelJob<T = any> extends mongoose.Document {
    name: string;
    data: T;
    lastModifiedBy: Date;
    nextRunAt: Date;
    priority: number;
    repeatInterval: string;
    repeatTimezone: string;
    lockedAt: Date;
    lastFinishedAt: Date;
    lastRunAt: Date;
}
