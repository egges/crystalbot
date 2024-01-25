import { std, mean } from "mathjs";
import { linearRegression } from "simple-statistics";
import { Candle } from "../exchange/Candle";
import MathHelper from "../core/MathHelper";

export interface ICandleReader {
  retrieveCandles(
    market: string,
    timeframe?: string,
    since?: number,
    limit?: number,
    cleanData?: boolean
  ): Promise<Candle[]>;
}

export interface IMarketModelSettings {
  sigma: number;
  mu: number;
  gamma: number;
  buy: IMarketDynamicParameters;
  sell: IMarketDynamicParameters;
}

export interface IMarketModelParameters extends IMarketModelSettings {
  midPrice: number;
  inventory: number;
  includeDrift?: boolean;
}

export interface IMarketDynamicParameters {
  A: number;
  k: number;
}

export function computeSpread(parameters: IMarketModelParameters): number {
  const { sigma, gamma, mu, buy, sell, inventory, includeDrift } = parameters;

  // sanity check
  if (!(sigma && gamma && buy && sell && buy.A && buy.k && sell.A && sell.k)) {
    return 0;
  }
  // compute the optimal price distances
  const bid = computeTerms(sigma, gamma, buy.k, buy.A);
  let bidMultiplier = (2 * inventory + 1) / 2;
  if (includeDrift) {
    bidMultiplier += -mu / (gamma * sigma * sigma);
  }
  const bidPriceDistance = bid.lnTerm + bidMultiplier * bid.sqrtTerm;

  const ask = computeTerms(sigma, gamma, sell.k, sell.A);
  let askMultiplier = -(2 * inventory - 1) / 2;
  if (includeDrift) {
    askMultiplier += mu / (gamma * sigma * sigma);
  }
  const askPriceDistance = ask.lnTerm + askMultiplier * ask.sqrtTerm;

  // return the spread
  return bidPriceDistance + askPriceDistance;
}

// Based on the paper "Dealing with the Inventory Risk: A solution to the market making problem", Gueant et al, 2012.
export function computeQuote(
  parameters: IMarketModelParameters
): { bid: number; ask: number } {
  const {
    sigma,
    mu,
    gamma,
    buy,
    sell,
    midPrice,
    inventory,
    includeDrift
  } = parameters;

  // sanity check
  if (!(sigma && gamma && buy && sell && buy.A && buy.k && sell.A && sell.k)) {
    return { bid: 0, ask: 0 };
  }
  // compute the optimal price distances
  const bid = computeTerms(sigma, gamma, buy.k, buy.A);
  let bidMultiplier = (2 * inventory + 1) / 2;
  if (includeDrift) {
    bidMultiplier += -mu / (gamma * sigma * sigma);
  }
  const bidPriceDistance = bid.lnTerm + bidMultiplier * bid.sqrtTerm;

  const ask = computeTerms(sigma, gamma, sell.k, sell.A);
  let askMultiplier = -(2 * inventory - 1) / 2;
  if (includeDrift) {
    askMultiplier += mu / (gamma * sigma * sigma);
  }
  const askPriceDistance = ask.lnTerm + askMultiplier * ask.sqrtTerm;

  // compute the final bid/ask quotes (with a safeguard to never cross the current mid price)
  return {
    bid: Math.min(midPrice, midPrice - bidPriceDistance),
    ask: Math.max(midPrice, midPrice + askPriceDistance)
  };
}

// Helper function for computing the log and square root term

function computeTerms(
  sigma: number,
  gamma: number,
  k: number,
  A: number
): { lnTerm: number; sqrtTerm: number } {
  // Square root term
  const sqrtTerm = Math.sqrt(
    Math.max(0, (sigma * sigma * gamma) / (2 * k * A)) *
      Math.pow(1 + gamma / k, 1 + k / gamma)
  );

  // Ln term
  const lnTerm = (1 / gamma) * Math.log(1 + gamma / k);

  // return the terms in an object
  return { lnTerm, sqrtTerm };
}

export interface IComputeGBMParametersResult {
  sigma: number;
  mu: number;
}

export async function computeGBMParameters(
  exchange: ICandleReader,
  market: string
): Promise<IComputeGBMParametersResult> {
  // retrieve the 1h candles for 1 week to compute the log returns
  const candles = await exchange.retrieveCandles(
    market,
    "1h",
    undefined,
    24 * 7
  );
  if (!candles) {
    throw new Error(`Unable to compute log returns for market ${market}.`);
  }
  const logReturns = [];
  for (let i = 1; i < candles.length; i += 1) {
    logReturns.push(Math.log(candles[i].close / candles[i - 1].close));
  }

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

// helper function for computing the market dynamics parameters

export interface IComputeMarketDynamicsParametersResult {
  buy: IMarketDynamicParameters;
  sell: IMarketDynamicParameters;
}

export async function computeMarketDynamicsParameters(
  exchange: ICandleReader,
  market: string
): Promise<IComputeMarketDynamicsParametersResult> {
  // we use 15m candles for this computation
  const timeframe = "15m";
  // retrieve the last 1000 candles
  const nrCandles = 1000;
  // model fitting should be precise within 3% spread
  const spreadPrecision = 0.03;
  // we are taking 100 price increments/decrements in each direction
  const priceSteps = 100;

  // compute the period in ms from the specified timeframe
  const period = MathHelper.periodToMs(timeframe);

  // retrieve the candles from the exchange
  const candles = await exchange.retrieveCandles(
    market,
    timeframe,
    undefined,
    nrCandles,
    true
  );

  // compute the price delta by using the open price of the first candle
  const openPrice = candles[0].open;
  // compute price delta based on spread and nr of steps
  const priceDelta = openPrice * (spreadPrecision / (2 * priceSteps));
  // compute lambda sums and counts
  const lambdaSumsBuy = new Array(priceSteps).fill(0);
  const lambdaCountsBuy = new Array(priceSteps).fill(0);
  const lambdaSumsSell = new Array(priceSteps).fill(0);
  const lambdaCountsSell = new Array(priceSteps).fill(0);
  for (let entryIndex = 0; entryIndex < candles.length / 2; entryIndex += 1) {
    // we assume that the midprice is between the previous and the next candles' close price
    const midPrice =
      candles[entryIndex].close * 0.5 + candles[entryIndex + 1].close * 0.5;
    const localDeltaTimesBuy = new Array(priceSteps).fill(0);
    const localDeltaTimesSell = new Array(priceSteps).fill(0);
    for (let c = entryIndex + 1; c < candles.length; c += 1) {
      const candle = candles[c];
      const priceDiffBuy = midPrice - candle.low;
      const priceDiffSell = candle.high - midPrice;
      for (let i = 0; i < priceSteps; i += 1) {
        if (localDeltaTimesBuy[i] <= 0 && priceDiffBuy > i * priceDelta) {
          localDeltaTimesBuy[i] =
            ((c - entryIndex) * period) / (1000 * 60 * 60 * 24); // conversion to days
        }
        if (localDeltaTimesSell[i] <= 0 && priceDiffSell > i * priceDelta) {
          localDeltaTimesSell[i] =
            ((c - entryIndex) * period) / (1000 * 60 * 60 * 24);
        }
      }
    }
    for (let i = 0; i < priceSteps; i += 1) {
      if (localDeltaTimesBuy[i] > 0) {
        lambdaSumsBuy[i] += localDeltaTimesBuy[i];
        lambdaCountsBuy[i] += 1;
      }
      if (localDeltaTimesSell[i] > 0) {
        lambdaSumsSell[i] += localDeltaTimesSell[i];
        lambdaCountsSell[i] += 1;
      }
    }
  }

  // compute log lambdas
  const logLambdasBuy = [];
  const logLambdasSell = [];
  for (let i = 0; i < priceSteps; i += 1) {
    const logLambdaBuy =
      lambdaSumsBuy[i] > 0
        ? Math.log(lambdaCountsBuy[i] / lambdaSumsBuy[i])
        : 0;
    const logLambdaSell =
      lambdaSumsSell[i] > 0
        ? Math.log(lambdaCountsSell[i] / lambdaSumsSell[i])
        : 0;
    logLambdasBuy.push([i * priceDelta, logLambdaBuy]);
    logLambdasSell.push([i * priceDelta, logLambdaSell]);
  }

  // perform a linear regression for the buy and sell data
  const linRegBuy = linearRegression(logLambdasBuy);
  const linRegSell = linearRegression(logLambdasSell);

  // return the buy and sell dynamic parameters
  return {
    buy: {
      A: Math.exp(linRegBuy.b),
      k: -linRegBuy.m
    },
    sell: {
      A: Math.exp(linRegSell.b),
      k: -linRegSell.m
    }
  };
}
