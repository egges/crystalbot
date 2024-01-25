import mongoose            = require("mongoose");
import { IExchangeState }    from "../exchange/IExchangeState";

interface IModelExchange extends IExchangeState, mongoose.Document {
    apiKey?: string;
    apiSecret?: string;
    password?: string;
    metadata?: any;
}

export default IModelExchange;
