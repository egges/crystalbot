import express                      = require("express");
import Router                       from "./Router";
import StrategyFactory              from "lib/trading/StrategyFactory";
import ExchangeBacktest             from "lib/exchange/ExchangeBacktest";
import { GeneticOptimizer }         from "lib/core/GeneticOptimizer";
import { MarketMakingGeneticModel } from "lib/trading/MarketMakingGeneticModel";
import DataManager                  from "lib/exchange/DataManager";

export default class RouterBacktest extends Router {

    constructor() {
        super();
        this.post("/", this.runBacktest);
        this.post("/from_db", this.runBacktestFromDb);
        this.post("/optimize", this.runOptimizer);
        this.post("/optimize_db", this.runOptimizerFromDb);
    }

    public async runBacktest(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.body.exchange || !request.body.files || !request.body.strategy || !request.body.strategy.type) {
            response.status(400).send({
                error: "Obligatory fields: exchange, files, strategy, strategy.type"
            });
            return;
        }

        // create a backtest exchange
        const backtest = new ExchangeBacktest(request.body.exchange);

        // Create a trading strategy
        const strategy = StrategyFactory.instance.create(request.body.strategy.type,
            backtest, request.body.strategy, { activeMarkets: Object.keys(request.body.files) });

        // initialize the backtest
        await backtest.prepareBacktest(request.body);

        // deposit currencies
        request.body.deposit = request.body.deposit || {
            [backtest.fiatCurrency]: 100
        }
        const currencies = Object.keys(request.body.deposit);
        for (const currency of currencies) {
            await backtest.deposit(currency, request.body.deposit[currency]);
        }

        // run the backtest
        try {
            await backtest.runBacktest(strategy);
        } catch (error) {
            console.log(error);
        }

        response.status(200).send({
            events: await backtest.getEvents()
        });
    }

    public async runBacktestFromDb(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.body.exchange
            || !request.body.exchange.exchangeName
            || !request.body.market
            || !request.body.timeframes
            || !request.body.strategy
            || !request.body.strategy.type) {
            response.status(400).send({
                error: "Obligatory fields: exchange, exchange.exchangeName, market, timeframes, strategy, strategy.type"
            });
            return;
        }

        // create a backtest exchange
        const backtest = new ExchangeBacktest(request.body.exchange);

        console.log("Retrieving data.");

        // retrieve the data from the database
        const options = Object.assign({
            exchangeName: request.body.exchange.exchangeName,
            period: "7d",
            candleHistory: 100,
            estimateMissingTickers: true
        }, request.body);
        const data = await DataManager.instance.createDataset(options);

        console.log("Preparing backtest.");

        // prepare the backtest exchange
        await backtest.prepareBacktest({
            data: {
                [request.body.market]: data
            }
        });

        // Create a trading strategy
        const strategy = StrategyFactory.instance.create(request.body.strategy.type,
            backtest, request.body.strategy, { activeMarkets: [request.body.market] });

        // deposit currencies
        request.body.deposit = request.body.deposit || {
            [backtest.fiatCurrency]: 100
        }
        const currencies = Object.keys(request.body.deposit);
        for (const currency of currencies) {
            await backtest.deposit(currency, request.body.deposit[currency]);
        }

        // run the backtest
        try {
            await backtest.runBacktest(strategy);
        } catch (error) {
            console.log(error);
        }

        console.log("Backtest finished.");

        response.status(200).send({
            events: await backtest.getEvents()
        });
    }


    public async runOptimizer(request: express.Request, response: express.Response, next: express.NextFunction) {
        response.status(200).send();

        // create a backtest exchange
        const backtest = new ExchangeBacktest();

         // prepare the backtest exchange
         await backtest.prepareBacktest(request.body);

        // create a genetic model
        const geneticModel = new MarketMakingGeneticModel({
            exchange: backtest,
            market: "KCS/ETH"
        });
        const geneticAlgo = new GeneticOptimizer(geneticModel);

        // create a population
        await geneticAlgo.createPopulation();

        // run the algorithm
        await geneticAlgo.run();
    }

    public async runOptimizerFromDb(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.body.exchangeName || !request.body.timeframes || !request.body.market) {
            response.status(400).send({
                error: "Required fields: exchangeName, timeframes, market"
            })
        }

        response.status(200).send();

        // create a backtest exchange
        const backtest = new ExchangeBacktest();

        console.log("Retrieving data from the database.");

        // retrieve the data from the database
        const options = Object.assign({
            exchangeName: request.body.exchangeName,
            timeframes: request.body.timeframes,
            market: request.body.market,
            period: "7d",
            candleHistory: 100,
            estimateMissingTickers: false
        }, request.body);
        const data = await DataManager.instance.createDataset(options);

        console.log("Preparing backtest.");

        // prepare the backtest exchange
        await backtest.prepareBacktest({
            data: {
                [request.body.market]: data
            }
        });

        // create a genetic model
        const geneticModel = new MarketMakingGeneticModel({
            exchange: backtest,
            market: request.body.market,
            fiatAmount: 10
        });
        const geneticAlgo = new GeneticOptimizer(geneticModel);

        // create a population
        await geneticAlgo.createPopulation();

        // run the algorithm
        await geneticAlgo.run();
    }
}
