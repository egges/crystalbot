import IStrategy                    from "./IStrategy";
import { IExchange }                from "../exchange/IExchange";
import { IStrategyOptions }         from "./IStrategyOptions";
import { ILogger } from "lib/core/log";

/**
 * Interface for behavior creator function, which is generated when a behavior is registered.
 *
 * @type StrategyCreator
 */
type StrategyCreator = (exchange: IExchange, options: IStrategyOptions, state: any, log?: ILogger) => IStrategy;

/**
 * Interface that a strategy class should adhere to.
 *
 * @interface IStrategyClass
 */
interface IStrategyClass {
    new(exchange: IExchange, options: IStrategyOptions, state: any, log?: ILogger);
}

/**
 * This component represents a factory for registering and creating strategies objects.
 */
export default class StrategyFactory {

    public static instance = new StrategyFactory();
    private constructor() {
    }

    /**
     * Dictionary of id mapping to strategy creator functions.
     *
     * @protected
     * @type {Record<string, StrategyCreator>}
     * @memberof StrategyFactory
     */
    protected _strategyCreators: Record<string, StrategyCreator> = {};

    public registerStrategies(strategies: Record<string, IStrategyClass>) {
        for (const strategyType of Object.keys(strategies)) {
            this.register(strategies[strategyType], strategyType);
        }
    }

    public register(strategyClass: IStrategyClass, type: string) {
        this._strategyCreators[type] = (exchange: IExchange, options: any, state: any, log?: ILogger) => {
            return new strategyClass(exchange, options, state, log);
        };
    }

    /**
     * Creates an instance of the strategy, provided a type and the constructor
     * parameters (exchange, strategy id, options).
     *
     * @param {string} type                   type of the strategy to create
     * @returns {F4BehaviorBase}
     *
     * @memberof StrategyFactory
     */
    public create(type: string, exchange: IExchange, options: IStrategyOptions, state: any, log?: ILogger): IStrategy {
        if (!this._strategyCreators[type]) {
            throw new Error(`Missing strategy creator for ${type}. Did you register the strategy in the factory?`);
        }
        return this._strategyCreators[type](exchange, options, state, log);
    }

    public async run(type: string, exchange: IExchange, options: IStrategyOptions, state: any): Promise<IStrategyOptions> {
        const strategy = this.create(type, exchange, options, state);
        await strategy.run();
        return strategy.state;
    }
}
