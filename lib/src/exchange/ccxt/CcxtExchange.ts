import * as ccxt from "ccxt";
import { Candle } from "../Candle";
import IOrder from "../IOrder";
import { IOrderBook } from "../IOrderBook";
import { ICcxtExchange } from "./ICcxtExchange";
import { OrderType } from "../OrderType";
import { OrderSide } from "../OrderSide";
import { cleanCandleData } from "../ExchangeHelper";
import { IBalance } from "../Balance";
import ModelEvent from "../../models/ModelEvent";
import { ILogger, createLogger } from "../../core/log";
import { ICcxtExchangeOptions } from "./ICcxtExchangeOptions";
import { ITrade } from "../../exchange/ITrade";

export class CcxtExchange implements ICcxtExchange {
  private _exchange: ccxt.Exchange;
  protected log: ILogger;

  private constructor() {}

  public static async create(
    options: ICcxtExchangeOptions
  ): Promise<ICcxtExchange> {
    if (!ccxt[options.exchangeName]) {
      throw new Error(`Unknown ccxt exchange name: ${options.exchangeName}.`);
    }

    const exchange = new CcxtExchange();
    exchange.log = createLogger({
      application: `ccxt/${options.exchangeName}`,
      level: options.logLevel
    });

    // create the ccxt exchange
    exchange.log.notice(`Creating ccxt exchange.`);
    const exchangeOptions =
      !options.apiKey || !options.apiSecret
        ? undefined
        : {
            apiKey: options.apiKey,
            secret: options.apiSecret,
            password: options.password,
            options: {
              adjustForTimeDifference: true,
              verbose: options.verbose
            }
          };
    exchange._exchange = new ccxt[options.exchangeName](exchangeOptions);
    exchange;

    // setup rate limiting
    if (options.rateLimit) {
      exchange._exchange.rateLimit = options.rateLimit;
    }
    exchange._exchange.enableRateLimit = true;

    // schedule a reload of the markets every 24 hours
    setInterval(async () => {
      exchange.log.notice(`Loading markets.`);
      return exchange._exchange.loadMarkets();
    }, 1000 * 60 * 60 * 24);

    // load the markets
    exchange.log.notice(`Loading markets.`);
    await exchange._exchange.loadMarkets();
    exchange.log.notice(`Exchange created.`);

    return exchange;
  }

  public get name(): string {
    return this._exchange.name.toLowerCase();
  }

  public async loadMarkets() {
    return this._exchange.loadMarkets(true);
  }

  public getMarkets(fiatCurrency?: string): string[] {
    return this._exchange.symbols.filter(
      symbol => !fiatCurrency || symbol.split("/")[1] === fiatCurrency
    );
  }

  public market(symbol: string) {
    return this._exchange.market(symbol);
  }

  public getMinDealAmount(market: string): number {
    const marketInfo = this._exchange.market(market);
    if (!marketInfo) {
      return 1;
    } else {
      return marketInfo.limits.amount.min;
    }
  }

  public get rateLimit(): number {
    return this._exchange.rateLimit;
  }
  public set rateLimit(value: number) {
    this._exchange.rateLimit = value;
  }

  public get enableRateLimit(): boolean {
    return this._exchange.enableRateLimit;
  }
  public set enableRateLimit(value: boolean) {
    this._exchange.enableRateLimit = value;
  }

  public async fetchBalance(): Promise<Record<string, IBalance>> {
    const ccxtBalances = await this._exchange.fetchBalance();
    delete ccxtBalances.info;
    delete ccxtBalances.free;
    delete ccxtBalances.used;
    delete ccxtBalances.total;
    const currencies = Object.keys(ccxtBalances);
    const balances = {};
    for (const currency of currencies) {
      balances[currency] = {
        free: ccxtBalances[currency].free,
        used: ccxtBalances[currency].used
      };
    }
    return balances;
  }

  public async fetchTickers(
    markets?: string[],
    fiatCurrency?: string
  ): Promise<Record<string, number[]>> {
    markets = markets || Object.keys(this._exchange.markets);
    if (fiatCurrency) {
      markets = Object.keys(this._exchange.markets).filter(value =>
        value.endsWith(fiatCurrency)
      );
    }
    // for binance, retrieve all tickers at once
    if (this.name === "binance") {
      markets = undefined;
    }
    // if there is a fetchTickers method, use that
    let ccxtTickers = null;
    if (this._exchange.has.fetchTickers) {
      ccxtTickers = await this._exchange.fetchTickers(markets);
    } else {
      // otherwise, call fetchTicker per market
      const promises = [];
      ccxtTickers = {};
      for (const market of markets) {
        promises.push(
          (async () => {
            ccxtTickers[market] = await this._exchange.fetchTicker(market);
          })()
        );
      }
      await Promise.all(promises);
    }
    const resultMarkets = Object.keys(ccxtTickers);
    const tickers: Record<string, number[]> = {};
    for (const market of resultMarkets) {
      const tickerData = ccxtTickers[market];
      tickers[market] = [
        tickerData.timestamp,
        tickerData.bid,
        tickerData.ask,
        tickerData.last,
        tickerData.baseVolume,
        tickerData.quoteVolume
      ];
    }
    return tickers;
  }

  public async fetchOpenOrders(symbol?: string): Promise<IOrder[]> {
    const ccxtOrders = await this._exchange.fetchOpenOrders(symbol);
    const orders = [];
    for (const ccxtOrder of ccxtOrders) {
      orders.push({
        id: ccxtOrder.id,
        timestamp: ccxtOrder.timestamp,
        status: ccxtOrder.status,
        market: ccxtOrder.symbol,
        type: ccxtOrder.type as OrderType,
        side: ccxtOrder.side as OrderSide,
        price: Number(ccxtOrder.price),
        amount: Number(ccxtOrder.amount),
        fee: Number(ccxtOrder.cost),
        filled: Number(ccxtOrder.filled),
        remaining: Number(ccxtOrder.remaining)
      });
    }
    return orders;
  }

  public async fetchOrderBook(
    markets: string[],
    limit?: number
  ): Promise<Record<string, IOrderBook>> {
    const orderBook: Record<string, IOrderBook> = {};
    await Promise.all(
      markets.map(market =>
        (async () => {
          orderBook[market] = await this._exchange.fetchOrderBook(
            market,
            limit
          );
          delete orderBook[market]["timestamp"];
          delete orderBook[market]["datetime"];
          delete orderBook[market]["nonce"];
        })()
      )
    );
    return orderBook;
  }

  public async createOrder(
    symbol: string,
    type: OrderType,
    side: OrderSide,
    amount: number,
    price?: number,
    params?: any
  ): Promise<string> {
    const priceToPrecision = price
      ? Number(this._exchange.priceToPrecision(symbol, price))
      : undefined;
    const amountToPrecision = Number(
      this._exchange.amountToPrecision(symbol, amount)
    );

    try {
      const result = await this._exchange.createOrder(
        symbol,
        type,
        side,
        amountToPrecision,
        priceToPrecision,
        params
      );
      this.log.debug(
        `Ccxt exchange create order result: ${JSON.stringify(result)}.`
      );
      return result.id;
    } catch (error) {
      this.log.crit(
        `An error occurred while creating ${type} ${side} order for market ${symbol}. Price: ${price}, amount: ${amount}.`
      );
      this.log.crit(error.toString());
      this.log.crit(error.message);
      throw new Error(
        `An error occurred while creating ${type} ${side} order for market ${symbol}. Price: ${price}, amount: ${amount}.`
      );
    }
  }

  public async cancelOrder(order: IOrder) {
    this.log.notice(`Cancelling ccxt order: ${JSON.stringify(order)}.`);
    if (this.name === "kucoin") {
      // kucoin requires a symbol and an order side
      return this._exchange.cancelOrder(order.id, order.market, {
        type: order.side.toUpperCase()
      });
    } else if (this.name === "binance") {
      // binance requires a symbol
      return this._exchange.cancelOrder(order.id, order.market);
    } else {
      return this._exchange.cancelOrder(order.id);
    }
  }

  public async deposit(currency: string, amount: string, address: string) {
    return this._exchange.deposit(currency, amount, address);
  }

  public async withdraw(currency: string, amount: number, address: string) {
    return this._exchange.withdraw(currency, amount, address);
  }

  public async fetchTrades(
    markets: string[],
    since?: number,
    limit?: number
  ): Promise<Record<string, ITrade[]>> {
    if (!this._exchange.has.fetchTrades) {
      return {};
    }
    const trades: Record<string, ITrade[]> = {};
    await Promise.all(
      markets.map(market =>
        (async () => {
          trades[market] = [];
          const ccxtTrades = await this._exchange.fetchTrades(
            market,
            since,
            limit
          );
          for (const trade of ccxtTrades) {
            trades[market].push({
              market: trade.symbol,
              price: trade.price,
              amount: trade.amount,
              side: trade.side as OrderSide,
              timestamp: trade.timestamp
            });
          }
        })()
      )
    );
    return trades;
  }

  public async retrieveCandles(
    market: string,
    timeframe?: string,
    since?: number,
    limit?: number,
    cleanData: boolean = true
  ): Promise<Candle[]> {
    if (!this._exchange.has.fetchOHLCV) {
      this.log.error(`Exchange is not capable of fetching OHLCV candles.`);
      return null;
    }
    if (!limit) {
      limit = undefined;
    }
    try {
      const candlesRaw = await this._exchange.fetchOHLCV(
        market,
        timeframe,
        since,
        limit
      );
      const candles = [];
      for (const candle of candlesRaw) {
        candles.push(new Candle(candle));
      }
      if (cleanData) {
        cleanCandleData(candles);
      }
      return candles;
    } catch (error) {
      this.log.error(error.toString());
      return null;
    }
  }

  // Syncing

  public async post(exchangeId: string, type: string, data?: any) {
    await ModelEvent.create({
      exchangeId,
      timestamp: Date.now(),
      type,
      data
    });
  }
}
