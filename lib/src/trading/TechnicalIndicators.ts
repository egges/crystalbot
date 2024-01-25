import { Candle } from "lib/exchange/Candle";

export class TechnicalIndicators {

    // moving average
    public static ma(input: number[], period: number): number[] {
        const movingAverages: number[] = [];

        // keep track of the running total
        let runningTotal = 0;       

        for (let i = 0; i < input.length; i += 1) {
            runningTotal += input[i];
            // if the first item in the running total is outside the period, remove it
            if (i - period >= 0) {
                runningTotal -= input[i - period];
            }
            // average is the running total divided by the number of items in the running total
            // (which is either the period, or i + 1 if there are less than period items)
            movingAverages.push(runningTotal / Math.min(i + 1, period));
        }
        return movingAverages;
    }

    // exponential moving average
    public static ema(input: number[], period: number): number[] {
        if (input.length === 0) {
            return [];
        }
        // smoothing factor
        const k = 2 / (period + 1);
        // first item is just the same as the first item in the input
        const emaArray = [input[0]];
        // for the rest of the items, they are computed with the previous one
        for (let i = 1; i < input.length; i += 1) {
          emaArray.push(input[i] * k + emaArray[i - 1] * (1 - k));
        }
        return emaArray;
    }

    // volume weighted ema
    public static volumeEma(input: number[], volumes: number[], period: number): number[] {
        const volInput = input.map((value, index) => value * volumes[index]);
        const num = this.ema(volInput, period);
        const den = this.ema(volumes, period);
        return num.map((value, index) => value / den[index]);
    }

    // average true range
    public static atr(candles: Candle[], period: number = 14) {
        // first compute the ATR values
        const atrValues = candles.map((candle, index) => {
            const highLow = candle.high - candle.low;
            if (index === 0) {
                return highLow;
            }
            const highPrevClose = Math.abs(candle.high - candles[index - 1].close);
            const lowPrevClose = Math.abs(candle.low - candles[index - 1].close);
            return Math.max(highLow, highPrevClose, lowPrevClose);
        });
        // return the exponential moving average over these values
        return this.ema(atrValues, period)
    }

    // relative strength index
    public static rsi(candles: Candle[], period: number = 14) {
        const ups = candles.map((candle, index) => {
            if (index === 0) {
                return 0;
            } else {
                return Math.max(0, candle.close - candles[index - 1].close);
            }
        });
        const downs = candles.map((candle, index) => {
            if (index === 0) {
                return 0;
            } else {
                return Math.max(0, candles[index - 1].close - candle.close);
            }
        });
        // compute the EMA values
        const upEma = this.ema(ups, period);
        const downEma = this.ema(downs, period);
        return upEma.map((upValue, index) => {
            const downValue = downEma[index];
            if (!downValue) {
                return 100;
            }
            const rs = upValue / downEma[index];
            return 100 - (100 / (1 + rs));
        });
    }

    // volume adjusted relative strength index
    public static vrsi(candles: Candle[], period: number = 14) {
        const volumes = candles.map((candle) => candle.volume);
        const ups = candles.map((candle, index) => {
            if (index === 0) {
                return 0;
            } else {
                return Math.max(0, candle.close - candles[index - 1].close);
            }
        });
        const downs = candles.map((candle, index) => {
            if (index === 0) {
                return 0;
            } else {
                return Math.max(0, candles[index - 1].close - candle.close);
            }
        });
        // compute the volume-adjusted EMA values
        const upEma = this.volumeEma(ups, volumes, period);
        const downEma = this.volumeEma(downs, volumes, period);
        return upEma.map((upValue, index) => {
            const downValue = downEma[index];
            if (!downValue) {
                return 50;
            }
            const rs = upValue / downEma[index];
            return 100 - (100 / 1 + rs);
        });
    }

    // directional movement indicator
    public static diPlus(candles: Candle[], period: number = 14): number[] {
        return this.ema(this.bullPoints(candles), period);
    }

    public static diMin(candles: Candle[], period: number = 14): number[] {
        return this.ema(this.bearPoints(candles), period);
    }

    public static adx(candles: Candle[], period: number = 14): number[] {
        const diPlus = this.diPlus(candles, period);
        const diMin = this.diMin(candles, period);
        return diPlus.map((plusValue, index) => {
            if (plusValue + diMin[index] === 0) {
                return 0;
            } else {
                return (plusValue - diMin[index]) / (plusValue + diMin[index]);
            }
        });
    }

    // volume-weighted directional movement indicator
    public static vdiPlus(candles: Candle[], period: number = 14): number[] {
        const volumes = candles.map((candle) => candle.volume);
        return this.volumeEma(this.bullPoints(candles), volumes, period);
    }

    public static vdiMin(candles: Candle[], period: number = 14): number[] {
        const volumes = candles.map((candle) => candle.volume);
        return this.volumeEma(this.bearPoints(candles), volumes, period);
    }

    public static vdx(candles: Candle[], period: number = 14): number[] {
        const vdiPlus = this.vdiPlus(candles, period);
        const vdiMin = this.vdiMin(candles, period);
        return vdiPlus.map((plusValue, index) => {
            if (plusValue + vdiMin[index] === 0) {
                return 0;
            } else {
                return (plusValue - vdiMin[index]) / (plusValue + vdiMin[index]);
            }
        });
    }

    // helper functions for directional movement indicator
    private static bullPoints(candles: Candle[]): number[] {
        const highDiff = candles.map((now, index) => {
            return index > 0 ? now.high - candles[index - 1].high : 0;
        });
        const lowDiff = candles.map((now, index) => {
            return index > 0 ? candles[index - 1].low - now.low : 0;
        });
        return highDiff.map((value, index) => value >= lowDiff[index] ? Math.max(highDiff[index] / candles[index].close, 0) : 0);
    }

    private static bearPoints(candles: Candle[]): number[] {
        const highDiff = candles.map((now, index) => {
            return index > 0 ? now.high - candles[index - 1].high : 0;
        });
        const lowDiff = candles.map((now, index) => {
            return index > 0 ? candles[index - 1].low - now.low : 0;
        });
        return lowDiff.map((value, index) => value > highDiff[index] ? Math.max(lowDiff[index] / candles[index].close, 0) : 0);
    }
}
