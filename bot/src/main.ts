// Database imports
import mongoose                     = require("mongoose");
import access                       from "./access";

// Express app imports
import ExpressApp                   from "server/ExpressApp";
import HttpRequest                  from "lib/core/HttpRequest";

// Routers
import RouterBacktest               from "server/RouterBacktest";
import RouterData                   from "server/RouterData";
import RouterExchange               from "server/RouterExchange";
import RouterTracker                from "server/RouterTracker";
import RouterTradingAgent           from "server/RouterTradingAgent";

// Strategies
import StrategyFactory              from "lib/trading/StrategyFactory";
import MarketMakingStrategyGenetic  from "lib/trading/MarketMakingStrategyGenetic";
import MarketMakingStrategyGueant   from "lib/trading/MarketMakingStrategyGueant";

// Used for testing
import ModelTracker                 from "lib/models/ModelTracker";
import Tracker                      from "lib/exchange/Tracker";

// Coinbase initialization
import Coinbase                     from "lib/exchange/CoinBase";
import CoinBase from "lib/exchange/CoinBase";


const environment = process.env.NODE_ENV || "development";

class Bootstrap {

    public static instance = new Bootstrap();

    protected expressApp = new ExpressApp();

    private constructor() {
        this.initialize();
    }

    protected async initialize() {

        console.log(`[${new Date().toUTCString()}] Starting CrystalBot server (${environment}).`);

        // initialize Mongoose
        console.info(`[${new Date().toUTCString()}] Connecting to the database.`);
        (mongoose as any).Promise = Promise;
        // Fix deprecation warnings
        mongoose.set("useNewUrlParser", true);
        mongoose.set("useFindAndModify", false);
        mongoose.set("useCreateIndex", true);
        await mongoose.connect(access.dbConnectionString);
        console.info(`[${new Date().toUTCString()}] Database connected.`);

        // Set the http request API key
        HttpRequest.instance.apiKey = access.apiKey;

        // Initialize the strategy factory
        this.initializeStrategyFactory();

        // initialize Express
        this.initializeExpress();

        // initialize CoinBase
        CoinBase.instance.initialize(access.coinbase);

        if (access.trackExchanges) {
            this.devUpdateTrackers();
        }
    }

    protected initializeExpress() {

        // add the routers to the app
        this.expressApp.addRoute("/backtest", new RouterBacktest());
        this.expressApp.addRoute("/data", new RouterData());
        this.expressApp.addRoute("/exchange", new RouterExchange());
        this.expressApp.addRoute("/tradingagent", new RouterTradingAgent());
        this.expressApp.addRoute("/tracker", new RouterTracker());

        // standard message to show that the service is live
        // (we can add some diagnostics here later if needed)
        this.expressApp.app.get("/", (request, response, next) => {
            response.send("CrystalBot is online.");
        });

        // health check for Kubernetes
        this.expressApp.app.get("/health", (request, response, next) => {
            response.status(200).send();
        });
    
        // listen on the port
        const port = parseInt(process.env.PORT, 10) || 5000;
        this.expressApp.listen(port);
        console.info(`[${new Date().toUTCString()}] CrystalBot service listening on port ${port}.`);
    }

    protected initializeStrategyFactory() {
        StrategyFactory.instance.register(MarketMakingStrategyGenetic, "MarketMakingStrategyGenetic");
        StrategyFactory.instance.register(MarketMakingStrategyGueant, "MarketMakingStrategyGueant")
    }

    protected async devUpdateTrackers() {
        const updateFunc = async () => {
            const beforeTime = Date.now();
            if (access.trackExchanges) {
                const trackers = await ModelTracker.find();
                for (const trackerModel of trackers) {
                    const tracker = new Tracker(trackerModel.id);
                    await tracker.update();
                }
            }
            const diffTime = Date.now() - beforeTime;
            const scheduleUpdate = Math.max(0, 120000 - diffTime);
            console.log(`[${new Date().toUTCString()}] dev_TrackerUpdate: Finished update - scheduling next in ${scheduleUpdate / 1000} seconds.`);
            setTimeout(updateFunc, scheduleUpdate);
        };
        return updateFunc();
    }
}
