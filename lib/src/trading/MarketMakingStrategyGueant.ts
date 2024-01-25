import { IExchange } from "../exchange/IExchange";
import IStrategy from "./IStrategy";
import { IStrategyOptions, IMarketSettings } from "./IStrategyOptions";
import { computeGBMParameters } from "./MarketModelGueant";
import { merge } from "lodash";
import Balance from "../exchange/Balance";
import Ticker from "../exchange/Ticker";
import IOrder from "../exchange/IOrder";
import { ILogger, createLogger, LogLevel } from "../core/log";
import { OrderSide } from "../exchange/OrderSide";
import { TechnicalIndicators } from "./TechnicalIndicators";
import MathHelper from "../core/MathHelper";
import { IMarketMakingOptions, runMarketMaker } from "./MarketMakerInventory";
import { IEntryStrategyOptions, runEntryStrategy } from "./EntryStrategy";
import { IExitStrategyOptions, runExitStrategy } from "./ExitStrategy";
import { tail } from "../core/ArrayUtils";
import colors = require("colors");
import { OrderType } from "../exchange/OrderType";
import { AgentState } from "./AgentState";
import { logReturns } from "./ProfitLoss";

interface MarketSettings
    extends IMarketSettings,
        IMarketMakingOptions,
        IEntryStrategyOptions,
        IExitStrategyOptions {}

export interface IMarketMakingStrategyOptions extends IStrategyOptions {
    fiatRatio: number;
    maximumRatio: number;
    minimumRatio: number;
    minimumTrend: number;
    maximumTrend: number;
    maximumPriceLevel: number;
    minimumNotionalValue: number;
    autoCancelAtFillPercentage: number;
    marketSettings: Record<string, Partial<MarketSettings>>;
}

export interface IMarketMakingStrategyState {
    marketState: Record<string, MarketState>;
}

interface MarketState {
    ratio?: number;
    entryPrice?: number;
    entryTimestamp?: number;
    agentState?: AgentState;
}

export default class MarketMakingStrategyGueant implements IStrategy {
    protected exchange: IExchange = null;
    private _options: Partial<IMarketMakingStrategyOptions> = null;
    private _state: IMarketMakingStrategyState = null;
    protected log: ILogger;

    // the values below are recomputed for each run
    private _totalBalance: number = null;

    constructor(
        exchange: IExchange,
        options: Partial<IMarketMakingStrategyOptions>,
        state: IMarketMakingStrategyState,
        log?: ILogger
    ) {
        this.exchange = exchange;
        // define default market settings for each market
        this._options = merge(
            {
                dryRun: false,
                markets: [],
                paused: false,
                fiatRatio: 0.2,
                minimumRatio: 0.05,
                maximumRatio: 0.15,
                minimumTrend: 0.1,
                maximumTrend: 0.5, // for anything higher than this trend value, we choose the maximum ratio
                maximumPriceLevel: 0.65, // we do not include markets higher than this price level in the active market list
                minimumNotionalValue: 0,
                autoCancelAtFillPercentage: 0.9,
                marketSettings: {},
                logLevel: LogLevel.Notice
            },
            options
        );
        this._state = merge(
            {
                activeMarkets: [],
                marketState: {}
            },
            state || {}
        );

        this.log =
            log ||
            createLogger({
                application: `marketmaker/${exchange.name}`,
                level: this._options.logLevel
            });
    }

    public get state(): any {
        return this._state;
    }

    public async beforeRun() {
        const log = this.log;

        // update the list of active markets
        await this.updateActiveMarkets();
        log.notice(
            colors.magenta(
                `Active markets: ${JSON.stringify(this.activeMarkets)} (${
                    this.activeMarkets.length
                }).`
            )
        );

        // compute the total balance
        this._totalBalance = this.exchange.getTotalBalanceFromMarkets(
            false,
            this.activeMarkets
        );
        if (this._totalBalance === null) {
            log.warning(`Unable to compute total balance.`);
            return false;
        }
        log.notice(`Total balance: ${this._totalBalance.toFixed(7)}.`);
        return true;
    }

    public async run() {
        const log = this.log;

        // run the strategy for each market
        await Promise.all(
            this.activeMarkets.map(market =>
                (async () => {
                    log.info(`Starting agent update for market ${market}.`);
                    try {
                        await this.runForMarket(market);
                    } catch (error) {
                        log.error(
                            `runForMarket(${market}): An error occurred: ${error}.`
                        );
                    }
                    log.info(`Completed agent update for market ${market}.`);
                })()
            )
        );
    }

    public async runForMarket(market: string) {
        const {
            minimumTrend,
            maximumTrend,
            maximumPriceLevel,
            autoCancelAtFillPercentage,
            fiatRatio
        } = this._options;
        const log = this.log;
        const state = this.getState(market);

        // we assume a simple case with equally divided ratios
        state.ratio =
            state.ratio || (1 - fiatRatio) / this.activeMarkets.length;

        // first make sure the exchange is updated for this market (if the state is not idle)
        if (state.agentState !== AgentState.Idle) {
            const success = await this.exchange.update(market);
            if (!success) {
                log.warning(
                    `Exchange update not successful. Ignoring update for market ${market}.`
                );
                return;
            }
        } else {
            log.info(`Exchange update not needed for idle market ${market}.`);
        }

        log.debug(`Check that GBM parameters exist for market ${market}.`);

        await this.checkGBMParametersExist(market);

        log.debug(`Retrieving settings for market ${market}.`);

        const settings = this.marketSettings(market);

        log.debug(`Retrieved settings: ${JSON.stringify(settings)}.`);

        // Retrieve the base balance
        const baseBalance = this.exchange.getBalance(market.split("/")[0]);

        // Retrieve the current ticker
        const ticker = this.exchange.getTicker(market);

        // Compute the minimum deal amount for this market
        const minDealAmount =
            settings.minDealAmount || this.exchange.getMinDealAmount(market);

        // retrieve the open buy and sell orders for this market
        const orderFilter = (order: IOrder) =>
            order.remaining / order.amount >= 0.1;

        // check whether this market should be removed from the active markets list
        log.debug(
            `Market ${market} - can trade: ${settings.canTrade}; trend (${
                settings.trend
            }) >= minimum trend (${minimumTrend}), price level (${
                settings.priceLevel
            }) < maximum (${maximumPriceLevel}).`
        );
        const inTradeableUptrend =
            settings.canTrade &&
            settings.trend >= minimumTrend &&
            settings.priceLevel < maximumPriceLevel;
        if (inTradeableUptrend) {
            log.debug(
                `Market ${market} is still in a confirmed uptrend, so not removing market from active list.`
            );
        }
        if (baseBalance.total >= minDealAmount) {
            log.debug(
                `Total balance (${baseBalance.total.toFixed(
                    7
                )}) > minDealAmount (${minDealAmount.toFixed(
                    7
                )}) for market ${market}, so not removing market from active list.`
            );
        }
        const openOrders = this.exchange.getOpenOrders(market);
        if (openOrders.length > 0) {
            log.debug(
                `There are orders for market ${market}, so not removing market from active list.`
            );
        }

        // retrieve the candles
        const [dayCandles, hourCandles] = await Promise.all([
            this.exchange.retrieveCandles(market, "1d", undefined, 30),
            this.exchange.retrieveCandles(market, "1h", undefined, 60)
        ]);
        if (!dayCandles || !hourCandles) {
            throw new Error(`Unable to retrieve candles for market ${market}.`);
        }

        // compute the current target balance for this market
        const targetBalance =
            state.ratio *
            this.exchange.convertToBase(
                this._totalBalance * (1 - this._options.fiatRatio),
                market
            );

        // run the strategy
        const strategyInput = Object.assign(
            {
                log,
                canTrade: settings.canTrade,
                currentTime: this.exchange.currentTime,
                market,
                trend: settings.trend,
                priceLevel: settings.priceLevel,
                ticker,
                buyOrders: this.exchange.getOpenOrders(
                    market,
                    OrderSide.Buy,
                    orderFilter
                ),
                sellOrders: this.exchange.getOpenOrders(
                    market,
                    OrderSide.Sell,
                    orderFilter
                ),
                targetBalance,
                balance: this.exchange.getBalance(market.split("/")[0]),
                quoteBalance: this.exchange.fiatBalance,
                minDealAmount,
                dayCandles,
                hourCandles,
                entryPrice: state.entryPrice,
                entryTimestamp: state.entryTimestamp,
                fetchBalance: () =>
                    this.exchange.getBalance(market.split("/")[0]),
                cancelAllOrders: async () => {
                    log.info(`Cancelling all orders for market ${market}.`);
                    return this.exchange.cancelAllOrders(market);
                },
                retrieveCandles: (timeframe: string, limit: number) =>
                    this.exchange.retrieveCandles(
                        market,
                        timeframe,
                        undefined,
                        limit
                    ),
                convertToBase: (amount: number, price?: number) =>
                    this.exchange.convertToBase(amount, price || market),
                convertToQuote: (amount: number, price?: number) =>
                    this.exchange.convertToQuote(amount, price || market),
                getLastClosedOrder: (side: OrderSide) =>
                    this.exchange.getLastClosedOrder(market, side),
                fetchTrades: async () => {
                    await this.exchange.syncTrades([market]);
                    return this.exchange.getTrades(market);
                },
                setEntryData: (data: { price: number; timestamp: number }) => {
                    state.entryPrice = data.price;
                    state.entryTimestamp = data.timestamp;
                },
                setAgentState: (agentState: AgentState) => {
                    state.agentState = agentState;
                }
            },
            this._options,
            this.marketSettings(market) || {}
        );

        // run the market maker
        await runMarketMaker(
            Object.assign({}, strategyInput, {
                sell: async (amount: number, price: number) => {
                    log.notice(
                        `Placing sell order in market ${market}, amount = ${amount.toFixed(
                            7
                        )}, price = ${price.toFixed(7)}.`
                    );
                    return this.exchange.createOrder({
                        market,
                        type: OrderType.Limit,
                        side: OrderSide.Sell,
                        amount,
                        price,
                        autoCancelAtFillPercentage
                    });
                },
                buy: async (amount: number, price: number) => {
                    log.notice(
                        `Placing buy order in market ${market}, amount = ${amount.toFixed(
                            7
                        )}, price = ${price.toFixed(7)}.`
                    );
                    return this.exchange.createOrder({
                        market,
                        type: OrderType.Limit,
                        side: OrderSide.Buy,
                        amount,
                        price,
                        autoCancelAtFillPercentage
                    });
                }
            })
        );
    }

    // Helper functions

    protected async currentTrend(market: string): Promise<number> {
        // retrieve the candles
        const candles = await this.exchange.retrieveCandles(
            market,
            "1d",
            undefined,
            30
        );
        if (!candles) {
            throw new Error(
                `Unable to compute current trend for market ${market}.`
            );
        }
        const vdx = TechnicalIndicators.vdx(candles);
        return tail(vdx);
    }

    protected async checkGBMParametersExist(market: string) {
        const log = this.log;

        if (
            !this._options.marketSettings ||
            !this._options.marketSettings[market]
        ) {
            throw new Error("Missing market settings in strategy options.");
        }
        const marketSettings = this._options.marketSettings[market];

        // if mu and sigma are there, do nothing
        if (marketSettings.mu && marketSettings.sigma) {
            return;
        }

        log.notice(`Computing market parameters for market ${market}.`);
        // compute the parameters of the Geometric Brownian motion model
        const gbm = await computeGBMParameters(this.exchange, market);

        log.notice(
            `Geometric brownian motion model parameters: ${JSON.stringify(
                gbm
            )}.`
        );

        marketSettings.mu = gbm.mu;
        marketSettings.sigma = gbm.sigma;
    }

    protected setState(market: string, state: MarketState) {
        this._state.marketState = this._state.marketState || {};
        this._state.marketState[market] = Object.assign(
            this._state.marketState[market] || {},
            state
        );
    }

    protected getState(market: string): MarketState {
        this._state.marketState = this._state.marketState || {};
        return this._state.marketState[market] || {};
    }

    protected initState(market: string) {
        this._state.marketState = this._state.marketState || {};
        this._state.marketState[market] = this._state.marketState[market] || {};
    }

    protected deleteState(market: string) {
        this._state.marketState = this._state.marketState || {};
        delete this._state.marketState[market];
    }

    protected marketSettings(market: string): Partial<MarketSettings> {
        const { marketSettings } = this._options;
        return marketSettings[market] || {};
    }

    public get activeMarkets(): string[] {
        return Object.keys(this._state.marketState || {});
    }

    private async updateActiveMarkets() {
        const log = this.log;
        const markets = Object.keys(this._options.marketSettings);
        const activeMarkets = this.activeMarkets;
        const { maximumTrend, minimumTrend, maximumPriceLevel } = this._options;
        // add the markets where entry is possible and are not yet part of the active markets array
        const promises = [];
        for (const market of markets) {
            promises.push(
                (async () => {
                    const settings = this._options.marketSettings[market];
                    if (
                        !settings.canTrade &&
                        activeMarkets.indexOf(market) < 0
                    ) {
                        return;
                    }

                    // if there is no trend or price level information, compute it now
                    if (!settings.trend || !settings.priceLevel) {
                        // retrieve the candles
                        const candles = await this.exchange.retrieveCandles(
                            market,
                            "1d",
                            undefined,
                            30
                        );
                        if (!candles) {
                            throw new Error(
                                `Unable to compute current trend for market ${market}.`
                            );
                        }
                        const vdx = TechnicalIndicators.vdx(candles);
                        const rsi = TechnicalIndicators.rsi(candles, 20);
                        settings.trend = tail(vdx);
                        settings.priceLevel = tail(rsi) / 100;
                        log.warning(
                            `Computed trend for market ${market}: ${
                                settings.trend
                            }. Price level = ${settings.priceLevel}.`
                        );
                    }

                    if (
                        settings.trend >= minimumTrend &&
                        settings.priceLevel < maximumPriceLevel
                    ) {
                        // we'd like to consider entering this market, so initialize the market state
                        this.initState(market);
                    }
                })()
            );
        }
        await Promise.all(promises);
    }
}
