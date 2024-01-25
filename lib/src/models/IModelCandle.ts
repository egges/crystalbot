import mongoose             = require("mongoose");
import { IOrderBook }       from "../exchange/IOrderBook";
import { ITrade }           from "../exchange/ITrade";

interface IModelCandle extends mongoose.Document {
    exchangeName: string;
    market: string;
    timeframe: string;
    timestamp: number;
    data: number[];
    tickerData: number[];
    orderBookData: IOrderBook;
    tradeData: ITrade[];
}

export default IModelCandle;
