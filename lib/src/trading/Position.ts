import { ITradingAgent }        from "./ITradingAgent";
import TrailingStopLoss         from "./TrailingStopLoss";
import { IStopLossOptions }     from "./TrailingStopLoss";
import MathHelper               from "../core/MathHelper";
import PositionStatus           from "./PositionStatus";
import { start } from "repl";

interface IPositionOptions {
    /** 
     * Indicates whether this is a pyramid position (thus needing less safeguards).
     * Default: false.
     */
    pyramid?: boolean;

    /** 
     * The minimum risk percentage - only useful for ATR stop loss where the risk
     * is computed automatically. When using a fixed stop loss percentage (set in the
     * stop loss options), make sure that percentage is higher than this value, otherwise
     * no positions will ever be created. Default: 0.02 (2%).
     */
    minRisk?: number;

    /**
     * Percentage of the total available amount one is willing to risk for this position.
     * Default: 0.01 (1%).
     */
    risk?: number;

    /** 
     * The risk/reward ratio that is the target of this position - ignored if the
     * fixedReward option is set. Default: 1.5
     */
    riskRewardRatio?: number;

    /**
     * When set this number overrides the risk/reward ratio. Use a percentage <0, 1].
     * Default: undefined.
     */
    fixedReward?: number;

    /**
     * How long to wait before the position is cancelled where there is no seller
     * (only used for limit buy orders). Default: 1h.
     */
    maxBuyWaitTime?: string;

    /**
     * Maximum time to wait before triggering a timeout that cancels the position
     * regardless of the price (default: 1d)
     */
    maxPositionTime?: string;

    /**
     * Whether limit orders should be used for this position. If set to false, market
     * orders will be used. Default: true.
     */
    useLimitBuyOrder?: boolean;

    /**
     * The number of sell orders to generate once the position is entered. Sell orders
     * are spread between the start take profit point and the end take profit point (computed
     * from the risk-reward ratio or the fixed reward). Default: 5.
     */
    nrSellOrders?: number;

    /**
     * Choose a value between 0 and 1 te determine how the sell orders should be spread
     * between start and end take profit. A value of 0 means a uniform spread. A value of
     * 1 means a strong skew toward the end take profit price. Default: 0.5.
     */
    skew?: number;

    /**
     * Determine how soon the position should start selling (value between 0-1). When set to
     * 0, the position will start selling as soon as the entry price is reached. A value of
     * 1 means selling only when the end take profit price has been reached.
     */
    startTakeProfit?: number;

    /**
     * Set the options used for the (trailing) stop loss.
     */
    stopLossOptions?: IStopLossOptions;
}

export default class Position {
    private _options: IPositionOptions = {
        pyramid: false,
        minRisk: 0.02,
        risk: 0.01,
        riskRewardRatio: 1.5,
        maxBuyWaitTime: "1h",
        maxPositionTime: "1d",
        useLimitBuyOrder: true,
        nrSellOrders: 5,
        skew: 0.5,
        startTakeProfit: 0.5
    }

    private _status = PositionStatus.Created;
    private _market: string;
    private _stopSellPrice: number;
    private _price: number;
    private _entryTimestamp: number;
    private _amount: number;

    // Pivot points
    private _pivot: number;
    private _r1: number;
    private _r2: number;
    private _s1: number;
    private _s2: number;

    // buy order
    private _buyOrderId: string = null;

    // sell orders
    private _sellOrders: string[] = [];

    private _tradingAgent: ITradingAgent;
    private _trailingStopLoss: TrailingStopLoss;

    private constructor() {
    }

    public get baseCurrency(): string {
        return this._market.split("/")[0];
    }

    public get quoteCurrency(): string {
        return this._market.split("/")[1];
    }

    public get status(): PositionStatus {
        return this._status;
    }

    public static async create(market: string, tradingAgent: ITradingAgent, options: IPositionOptions = {}): Promise<Position> {
        const position = new Position();
        position._market = market;
        position._tradingAgent = tradingAgent;
        Object.assign(position._options, options);

        // retrieve the latest market data
        const ticker = tradingAgent.exchange.tickers[market];

        // determine the price and create a trailing stop loss
        if (position._options.useLimitBuyOrder) {
            position._price = ticker.bid;
        } else {
            position._price = ticker.ask;
        }
        position._trailingStopLoss = new TrailingStopLoss(market, tradingAgent, position._options.stopLossOptions);

        // compute the risk reward ratio
        const risk = position._price - await position._trailingStopLoss.computeCurrentStopPrice();
        if (position._price === 0 ||
            (risk / position._price <= position._options.minRisk && !position._options.pyramid)) {
            // we do not want to enter a position with extremely low risk, since this will:
            // a) likely trigger the stop loss too early
            // b) result in a small reward that is further reduced by fees and slippage
            position._status = PositionStatus.Cancelled;
            return position;
        }

        // retrieve the available budget
        const totalAmount = await tradingAgent.exchange.getTotalBalance();

        // compute the base/quote amount to risk in this trade
        const quoteBalance = tradingAgent.getBalance(position.quoteCurrency);
        const size = Math.min(position._options.risk * totalAmount / risk * position._price, quoteBalance.free);
        position._amount = MathHelper.toFixed(size / position._price, 6);

        // buy the amount and store the timestamp
        position._entryTimestamp = ticker.timestamp;
        if (position._options.useLimitBuyOrder) {
            position._buyOrderId = await tradingAgent.exchange.createLimitBuyOrder(market, position._amount, position._price);
        } else {
            position._buyOrderId = await tradingAgent.exchange.createMarketBuyOrder(market, position._amount);
        }
        position._status = PositionStatus.Initialized;

        tradingAgent.exchange.post("position_created", {
            options: position._options,
            quoteBalance: quoteBalance,
            entryPrice: position._price,
            risk,
            quoteAmount: size,
            baseAmount: position._amount,
            buyOrderId: position._buyOrderId
        });

        return position;
    }

    public async update() {
        switch (this._status) {
            case PositionStatus.Initialized:
                await this.updateState_Initialized(); break;
            case PositionStatus.Entered:
                await this.updateState_Entered(); break;
            case PositionStatus.Setup:
                await this.updateState_Setup(); break;
        }
    }

    protected async updateState_Initialized() {
        // check if we need to change our status from BuyOrderPlaced to Entered
        const order = await this._tradingAgent.exchange.getOrder(this._buyOrderId);
        if (order && order.status !== "open") {
            // the order is no longer open, so update the status
            this._status = PositionStatus.Entered;
            return;
        }

        // check if we need to cancel the position
        const currentTime = this._tradingAgent.exchange.tickers[this._market].timestamp;
        if (this._entryTimestamp + MathHelper.periodToMs(this._options.maxBuyWaitTime) < currentTime) {
            // TO DO: check for partially filled limit buy order.
            await this._tradingAgent.exchange.cancelOrder(this._buyOrderId);
            this._status = PositionStatus.Cancelled;
        }
    }

    protected async updateState_Entered() {
        // retrieve the base balance
        let baseBalance = this._tradingAgent.getBalance(this.baseCurrency);
        if (baseBalance.free <= 0.00001) {
            return;
        }
        // update the trailing stop loss
        await this._trailingStopLoss.update();

        const risk = this._price - this._trailingStopLoss.stopPrice;
        const startTakeProfit = this._options.fixedReward ?
            this._price * (1 + this._options.fixedReward * this._options.startTakeProfit)
            : this._price + this._options.riskRewardRatio * risk * this._options.startTakeProfit;
        const endTakeProfit = this._options.fixedReward ?
            this._price * (1 + this._options.fixedReward)
            : this._price + this._options.riskRewardRatio * risk;
        const nrOrders = this._options.nrSellOrders;
        const free = baseBalance.free;

        for (let i = 0; i < nrOrders; i += 1) {
            const multiplier = 2 * this._options.skew / (nrOrders * (nrOrders - 1)) * i + (1 - this._options.skew) / nrOrders;
            let amount = free * multiplier;
            if (i === nrOrders - 1) { // to avoid rounding errors
                baseBalance = this._tradingAgent.getBalance(this.baseCurrency);
                amount = baseBalance.free;
            }
            const price = startTakeProfit + (i + 1) / nrOrders * (endTakeProfit - startTakeProfit);
            this._sellOrders.push(await this._tradingAgent.exchange.createLimitSellOrder(this._market,
                amount, price));
        }
        this._status = PositionStatus.Setup;
    }

    protected async updateState_Setup() {
        // update the trailing stop loss
        await this._trailingStopLoss.update();

        // check if there are any remaining limit orders that are open
        const openOrders = await this._tradingAgent.exchange.getOpenOrders(this._market);
        let limitOrdersOpen = false;
        for (const order of openOrders) {
            if (this._sellOrders.indexOf(order.id) >= 0) {
                limitOrdersOpen = true;
            }
        }
        if (!limitOrdersOpen) {
            this._status = PositionStatus.Completed;
        }

        // check if we should leave the position
        const ticker = this._tradingAgent.exchange.tickers[this._market];
        if ((ticker.bid <= this._trailingStopLoss.stopPrice) || this.priceRecoveryTimeout) {
            await this.leave();
        }
    }

    protected get priceRecoveryTimeout(): boolean {
        if (!this._options.maxPositionTime) {
            return false;
        }
        const ticker = this._tradingAgent.exchange.tickers[this._market];
        return ticker.bid < this._price 
            && ticker.timestamp > this._entryTimestamp + MathHelper.periodToMs(this._options.maxPositionTime);
    }

    protected async leave() {
        // cancel all open limit orders in this market
        const orders = await this._tradingAgent.exchange.getOpenOrders(this._market);
        for (const order of orders) {
            await this._tradingAgent.exchange.cancelOrder(order.id);
        }
        // retrieve the ticker
        const ticker = this._tradingAgent.exchange.tickers[this._market];

        const potentialWin = (this._trailingStopLoss.highestBidPrice - this._price) / this._price;
        const priceDiff = (ticker.bid - this._price) / this._price;

        // sell the remaining open balance
        const freeBalance = this._tradingAgent.getBalance(this.baseCurrency).free;
        if (freeBalance > 0.0001) {
            await this._tradingAgent.exchange.createMarketSellOrder(this._market, freeBalance);
        }
        this._status = PositionStatus.Left;

        this._tradingAgent.exchange.post("position_left", {
            currentStopPrice: this._trailingStopLoss.stopPrice,
            currentBid: ticker.bid,
            highestBid: this._trailingStopLoss.highestBidPrice,
            orderPrice: this._price,
            orders,
            potentialWin: Math.round(potentialWin * 10000) / 100 + "%",
            priceDifference: Math.round(priceDiff * 10000) / 100 + "%",
            win: priceDiff > 0
        });
    }

    public get zeroRisk(): boolean {
        return this._price < this._trailingStopLoss.stopPrice;
    }
}