interface IStrategy {
    beforeRun(): Promise<boolean>;
    run(): Promise<void>;
    runForMarket(market: string): Promise<void>;

    readonly state: any;
    readonly activeMarkets: string[];
}

export default IStrategy;
