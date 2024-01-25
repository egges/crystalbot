import express = require("express");
import bodyParser = require("body-parser");
import { createLogger } from "lib/core/log";
import { createJobProcessor, createRepeatingJob } from "lib/job/AgendaUtils";
import MarketMakingStrategyGueant from "lib/trading/MarketMakingStrategyGueant";
// Strategies
import StrategyFactory from "lib/trading/StrategyFactory";
import access from "./access";
import { getStats } from "./jobs/GetStats";
// Jobs imports
import { updateTradingAgent } from "./jobs/UpdateTradingAgent";
import { JobType } from "./JobType";
import mongoose = require("mongoose");
import Agenda = require("agenda");

const app: express.Express = express();
const log = createLogger({});
let agenda: Agenda;

function initializeStrategyFactory() {
    StrategyFactory.instance.register(
        MarketMakingStrategyGueant,
        "MarketMakingStrategyGueant"
    );
}

async function initializeAgenda() {
    log.notice("Setting up job runner.");
    agenda = new Agenda({
        mongo: mongoose.connection.db,
        db: { collection: "jobs" }
    });
    agenda.processEvery("1 second");

    // Create a job processor for updating trading agents
    createJobProcessor(agenda, JobType.UpdateTradingAgent, updateTradingAgent);

    // Create a job for the OKEX trading agent
    await createRepeatingJob("1 second", JobType.UpdateTradingAgent, {
        id: "5d64f1fe1466b9bc113bfcec"
    });

    await agenda.start();

    // add listeners
    agenda.on("start", job => {
        log.notice(`Starting job ${job.attrs.name}.`);
    });
    agenda.on("success", job => {
        log.notice(`Completed job ${job.attrs.name}.`);
    });
    agenda.on("fail", (err, job) => {
        log.notice(`Job ${job.attrs.name} failed with error: ${err.message}.`);
    });

    log.notice("Job runner started.");

    // Graceful shutdown
    const gracefulShutdown = async () => {
        log.notice("Stopping job runner.");
        await agenda.stop();
        process.exit(0);
    };
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
}

const crystalbotGetStats = async (
    req: express.Request,
    res: express.Response
) => {
    try {
        // get the api key
        const { key } = req.query;
        if (key !== access.apiKey) {
            throw new Error(`Invalid key.`);
        }

        // get the id
        const { agentId } = req.params;

        // get the stats
        const result = await getStats({
            id: agentId
        });
        res.status(200).send(result);
    } catch (error) {
        console.log(error);
        res.status(200).send(error.message);
    }
};

const crystalbot = (dryRun?: boolean) => async (
    req: express.Request,
    res: express.Response
) => {
    try {
        // get the api key
        const { key } = req.query;
        if (key !== access.apiKey) {
            throw new Error(`Invalid key.`);
        }

        // get the agent id
        const { agentId } = req.params;

        // update the trading agent
        await updateTradingAgent({
            id: agentId,
            dryRun
        });
        res.status(200).send();
    } catch (error) {
        console.log(error);
        res.status(200).send(error.message);
    }
    res.status(200).send;
};

(async function bootstrap() {
    const environment = process.env.NODE_ENV || "development";

    log.notice(`Starting server (${environment}).`);

    // initialize Mongoose
    log.notice("Connecting to the database.");
    (mongoose as any).Promise = Promise;
    // Fix deprecation warnings
    mongoose.set("useNewUrlParser", true);
    mongoose.set("useFindAndModify", false);
    mongoose.set("useCreateIndex", true);
    await mongoose.connect(access.dbConnectionString);
    log.notice("Database connected.");

    // Initialize the strategy factory
    initializeStrategyFactory();

    // Initialize agenda
    await initializeAgenda();

    // parse body of requests as JSON
    app.use(bodyParser.json());

    // route definition
    app.get("/:agentId", crystalbotGetStats);
    app.post("/:agentId", crystalbot());
    app.post("/:agentId/dryrun", crystalbot(true));

    // start the server
    const port = Number(process.env.PORT) || 5700;
    app.listen(port, () => {
        console.log("Crystalbot server listening on port", port);
    });
})();
