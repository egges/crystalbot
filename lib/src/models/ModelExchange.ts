import mongoose = require("mongoose");
import IModelExchange from "./IModelExchange";
import { LogLevel } from "../core/log";

const schema = new mongoose.Schema(
    {
        exchangeName: {
            type: String,
            required: true
        },
        apiKey: String,
        apiSecret: String,
        password: String,
        simulation: {
            type: Boolean,
            default: false
        },
        rateLimit: Number,
        reserves: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        minDealAmounts: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        fee: {
            type: Number,
            default: 0.0001
        },
        fiatCurrency: {
            type: String,
            default: "ETH"
        },
        forceAutoCancel: {
            type: Boolean,
            default: false
        },
        lockdown: Boolean,
        closedOrders: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        openOrders: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        cancelledOrders: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        balances: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        tickers: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        orderBooks: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        trades: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        },
        balanceLastSync: {
            type: Number,
            default: 0
        },
        ordersLastSync: {
            type: Number,
            default: 0
        },
        tickersLastSync: {
            type: Number,
            default: 0
        },
        maxSyncAge: {
            type: Number,
            default: 25000
        },
        logLevel: {
            type: String,
            default: LogLevel.Notice
        },
        verbose: Boolean,
        metadata: {
            type: mongoose.SchemaTypes.Mixed,
            default: {}
        }
    },
    { minimize: false, versionKey: false, timestamps: true, usePushEach: true }
);

const model = mongoose.model<IModelExchange>("exchange", schema);
export default model;
