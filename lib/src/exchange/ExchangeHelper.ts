import { IExchange }            from "./IExchange";
import ModelExchange            from "../models/ModelExchange";
import { CcxtExchangeManager }  from "./ccxt/CcxtExchangeManager";
import Exchange                 from "./Exchange";
import { Candle }               from "./Candle";

export async function createExchange(id: string): Promise<IExchange> {
    const exchangeModel = await ModelExchange.findById(id);
    if (!exchangeModel) {
        throw new Error(`Exchange with id ${id} not found.`);
    }

    const ccxtExchange = await CcxtExchangeManager.getExchange(exchangeModel);
    return new Exchange(exchangeModel, ccxtExchange);
}

export function cleanCandleData(candles: Candle[]) {
    let initialPrice = 0;
    // first find the initial price
    for (const candle of candles) {
        if (candle.close) {
            initialPrice = candle.close;
            break;
        }
    }
    for (let i = 0; i < candles.length; i += 1) {
        const candle = candles[i];
        if (!candle.open || !candle.high || !candle.low ||
            !candle.close) {
            // get the previous close price
            const lastClose = i > 0 ? candles[i - 1].close : initialPrice;
            candle.open = lastClose;
            candle.high = lastClose;
            candle.low = lastClose;
            candle.close = lastClose;
            candle.volume = 0;
        }
    }
}