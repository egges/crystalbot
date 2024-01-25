import express                      = require("express");
import RouterREST                   from "./RouterREST";
import ModelTracker                 from "lib/models/ModelTracker";
import Tracker                      from "lib/exchange/Tracker";

export default class RouterTracker extends RouterREST {

    constructor() {
        super(ModelTracker);
    }

    public createRoutes() {
        super.createRoutes();

        // update the tracker
        this.post("/:key/update", this.update);
    }

    public async update(request: express.Request, response: express.Response, next: express.NextFunction) {
        // retrieve the tracker
        const trackerModel = await ModelTracker.findById(request.params.key);
        if (!trackerModel) {
            response.status(400).send({
                error: `Tracker with id ${request.params.key} not found.`
            });
            return;
        }
        if (trackerModel.paused) {
            console.log(`[${new Date().toUTCString()}] ${trackerModel.id}: Ignoring update. Tracker has been paused.`);
            response.status(200).send();
            return;
        }
        try {
            console.log(`[${new Date().toUTCString()}] ${trackerModel.id}: Updating tracker.`);
            const tracker = new Tracker(trackerModel.id);
            await tracker.update();
            console.log(`[${new Date().toUTCString()}] ${trackerModel.id}: Finished updating tracker.`);
            response.status(200).send();
        } catch (error) {
            console.log(`[${new Date().toUTCString()}] ${trackerModel.id}: An error occurred while updating tracker.`);
            console.log(error);
            response.status(400).send({
                error: error
            });
        }
    }
}
