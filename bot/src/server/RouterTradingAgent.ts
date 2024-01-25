import express                      = require("express");
import RouterREST                   from "./RouterREST";
import ModelTradingAgent            from "lib/models/ModelTradingAgent";

export default class RouterTradingAgent extends RouterREST {

    constructor() {
        super(ModelTradingAgent);
    }
}
