import express              = require("express");
import Router               from "./Router";
import DataManager          from "lib/exchange/DataManager";

export default class RouterData extends Router {

    constructor() {
        super();
        this.get("/retrieve", this.retrieveData);
        this.post("/export", this.exportData);
        this.post("/clearHistory/:exchangeName", this.clearHistory);
    }

    public async retrieveData(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.query.exchangeName || !request.query.timeframes || !request.query.market
            || !request.query.period) {
            response.status(400).send({
                error: "Missing obligatory field(s): exchangeName, timeframes, market, or period."
            });
            return;
        }
        const data = await DataManager.instance.createDataset(request.query);
        response.status(200).send(data);
    }

    public async exportData(request: express.Request, response: express.Response, next: express.NextFunction) {

        if (!request.body.exchangeName || !request.body.timeframes || !request.body.market
            || !request.body.period) {
            response.status(400).send({
                error: "Missing obligatory field(s): exchangeName, timeframes, market, or period."
            });
            return;
        }
        await DataManager.instance.exportDataset(request.body);
        response.status(200).send();
    }

    public async clearHistory(request: express.Request, response: express.Response, next: express.NextFunction) {

        await DataManager.instance.clearHistory(request.params.exchangeName);
        response.status(200).send();
    }
}
