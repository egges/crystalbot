import { std, mean } from "mathjs";
import { Candle } from "../exchange/Candle";

export interface IComputeGBMParametersResult {
  sigma: number;
  mu: number;
}

export function computeModelParameters(
  hourCandles: Candle[]
): IComputeGBMParametersResult {
  // compute the log returns of the 1 hour candles
  const logReturns = hourCandles.map((candle, i) => {
    if (i === 0) {
      return 0;
    } else {
      return Math.log(candle.close / hourCandles[i - 1].close);
    }
  });

  // sigma is the std of the log returns, converted to day time delta by multiplying with sqrt(24)
  const sigma = std(logReturns, "unbiased") * Math.sqrt(24);
  // mu is the mean of the log returns (* 24 to convert to day time delta)
  // + 1/2 * sigma^2
  const mu = mean(logReturns) * 24 + 0.5 * sigma * sigma;

  return {
    sigma,
    mu
  };
}
