export interface IMarketModelParameters {
    midPrice: number;
    inventory: number;
    desiredSpread: number;
}

export function computeQuote(parameters: IMarketModelParameters): { bid: number, ask: number } {
    return {
        bid: parameters.midPrice - parameters.midPrice * parameters.desiredSpread * (1 + parameters.inventory) / 2,
        ask: parameters.midPrice + parameters.midPrice * parameters.desiredSpread * (1 - parameters.inventory) / 2
    }
}