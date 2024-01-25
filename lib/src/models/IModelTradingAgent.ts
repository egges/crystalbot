import mongoose                 = require("mongoose");
import { ITradingAgentState }   from "../trading/ITradingAgentState";

interface IModelTradingAgent extends ITradingAgentState, mongoose.Document {
    exchangeId: mongoose.Types.ObjectId;
    metadata: any;
}

export default IModelTradingAgent;
