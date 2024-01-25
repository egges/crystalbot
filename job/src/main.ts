import access from "./access";
import mongoose = require("mongoose");
import { createLogger, ILogger } from "lib/core/log";
import Agenda = require("agenda");
import { createRepeatingJob, createJobProcessor } from "lib/job/AgendaUtils";

// Strategies
import StrategyFactory from "lib/trading/StrategyFactory";
import MarketMakingStrategyGueant from "lib/trading/MarketMakingStrategyGueant";

// Jobs imports
import { JobType } from "./JobType";
import { updateTracker } from "./jobs/UpdateTracker";
import { updateTradingAgent } from "./jobs/UpdateTradingAgent";
import { postExchangeStatus } from "./jobs/PostExchangeStatus";
import { computeMarketModel } from "./jobs/ComputeMarketModel";
import { computePortfolioAllocation } from "./jobs/ComputePortfolioAllocation";

/**
 *  This contains the bootstrap for the job runner service.
 *
 * @class Bootstrap
 * @copyright 2018 CrystalBot
 */
export class Bootstrap {
    public static instance = new Bootstrap();
    private constructor() {
        this.initialize();
        //this.dbScript();
    }

    protected log: ILogger;
    protected agenda: Agenda = null;

    /**
     * Initialize the job runner.
     *
     * @memberOf Bootstrap
     */
    private async initialize() {
        const environment = process.env.NODE_ENV || "development";
        this.log = createLogger({});
        this.log.notice(`Starting server (${environment}).`);

        // initialize Mongoose
        this.log.notice("Connecting to the database.");
        (mongoose as any).Promise = Promise;
        // Fix deprecation warnings
        mongoose.set("useNewUrlParser", true);
        mongoose.set("useFindAndModify", false);
        mongoose.set("useCreateIndex", true);
        await mongoose.connect(access.dbConnectionString);
        this.log.notice("Database connected.");

        // Initialize the strategy factory
        this.initializeStrategyFactory();

        // Setting up the job runner
        this.log.notice("Setting up job runner.");
        this.agenda = new Agenda({
            mongo: mongoose.connection.db,
            db: { collection: "jobs" }
        });
        this.agenda.processEvery("5 seconds");
        this.initializeJobProcessors();
        await this.createJobs();
        //await this.agenda.start();

        // add listeners
        this.agenda.on("start", job => {
            this.log.notice(`Starting job ${job.attrs.name}.`);
        });
        this.agenda.on("success", job => {
            this.log.notice(`Completed job ${job.attrs.name}.`);
        });
        this.agenda.on("fail", (err, job) => {
            this.log.notice(
                `Job ${job.attrs.name} failed with error: ${err.message}.`
            );
        });

        this.log.notice("Job runner started.");

        // Graceful shutdown
        const gracefulShutdown = async () => {
            this.log.notice("Stopping job runner.");
            await this.agenda.stop();
            process.exit(0);
        };
        process.on("SIGTERM", gracefulShutdown);
        process.on("SIGINT", gracefulShutdown);
    }

    protected initializeStrategyFactory() {
        StrategyFactory.instance.register(
            MarketMakingStrategyGueant,
            "MarketMakingStrategyGueant"
        );
    }

    protected async initializeJobProcessors() {
        //createJobProcessor(this.agenda, JobType.UpdateTracker, updateTracker);
        createJobProcessor(
            this.agenda,
            JobType.UpdateTradingAgent,
            updateTradingAgent
        );
        // createJobProcessor(this.agenda, JobType.PostExchangeStatus, postExchangeStatus);
        // createJobProcessor(this.agenda, JobType.ComputeMarketModel, computeMarketModel);
        // createJobProcessor(this.agenda, JobType.ComputePortfolioAllocation, computePortfolioAllocation);
    }

    protected async createJobs() {
        // Coinbase pro trading agent update
        await createRepeatingJob("1 minute", JobType.UpdateTradingAgent, {
            id: "5d33269a2035cc027516b95a"
        });
    }
}
