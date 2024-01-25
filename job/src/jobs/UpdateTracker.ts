import ModelTracker             from "lib/models/ModelTracker";
import Tracker                  from "lib/exchange/Tracker";
import { createLogger }         from "lib/core/log";

export interface JobData {
    id: string;
}

export async function updateTracker(data?: JobData) {

    // Retrieve the tracker id from the data
    if (!data || !data.id) {
        throw new Error("Missing id.");
    }
    const id = data.id;

    const log = createLogger({
        application: `UpdateTracker/${id}`
    });

    // Note the time before
    const startTime = Date.now();

    // Retrieve the tracker
    const trackerModel = await ModelTracker.findById(id);
    if (!trackerModel) {
        throw new Error(`Tracker with id ${id} not found.`)
    }

    // Don't do anything if the tracker is paused
    if (trackerModel.paused) {
        log.warning(`Ignoring update. Tracker has been paused.`);
        return;
    }

    // Create the tracker and retrieve the data
    log.notice(`Updating tracker.`);
    const tracker = new Tracker(trackerModel.id);
    await tracker.update();
    log.notice(`Finished updating tracker.`);
    const totalTime = Date.now() - startTime;
    log.notice(`Total time: ${Math.round(totalTime / 1000)} seconds.`);
}
