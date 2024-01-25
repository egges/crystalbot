import { isEqual }                      from "lodash";
import { ModelJob }                     from "../models/ModelJob";
import Agenda                           = require("agenda");

export async function createJobProcessor(agenda: Agenda, name: string, processor: (data?: any) => Promise<void> | void) {
    agenda.define(name, { lockLifetime: 36000000 }, async (job, done) => {
        try {
            await processor(job.attrs.data);
            done();
        } catch (error) {
            done(error);
        }
    });
}

export async function createRepeatingJob(repeatInterval: string, name: string, data?: any) {
    // first check if the job already exists
    const existingJobs = await ModelJob.find({
        name: { $eq: name }
    });
    for (const job of existingJobs) {
        if (!job.data && !data) {
            // we don't have to create this job
            // since it already exists
            return;
        } else if (isEqual(job.data || {}, data || {})) {
            // if the data is the same the job already exists
            return;
        }
    }
    return ModelJob.create({
        name,
        type: "normal",
        nextRunAt: new Date(),
        repeatInterval,
        data
    })

}