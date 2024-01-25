import { Candle }       from "../exchange/Candle";
import IOrder           from "../exchange/IOrder";
import MathHelper       from "../core/MathHelper";
import { OrderSide }    from "../exchange/OrderSide";

export interface ComputeReturnInput {
    dayCandles: Candle[];
    trades: IOrder[];
    currentBalance: number;
}

export function logReturns(candles: Candle[]): number[] {
    return candles.map((candle, index) => {
        if (index === 0) {
            return 0;
        } else {
            return Math.log(candle.close / candles[index - 1].close);
        }
    });
}