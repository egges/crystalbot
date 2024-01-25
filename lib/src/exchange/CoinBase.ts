import coinbase     = require('coinbase');

export default class CoinBase {

    private _coinbaseClient = null;

    // Needed for Singleton behavior
    public static instance = new CoinBase();
    private constructor() {
    }

    public initialize(access: { apiKey: string, apiSecret: string }) {
        this._coinbaseClient = new coinbase.Client(access);
    }

    public async getAccounts() {
        return new Promise((resolve, reject) => {
            this._coinbaseClient.getAccounts({}, (err, accounts) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(accounts);
                }
            });
        });
    }

    public async getSellPrice(market: string, amount: number) {
        market = market.split("/").join("-");
        return new Promise((resolve, reject) => {
            this._coinbaseClient.getSellPrice({ "currencyPair": market }, (err, obj) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(Math.trunc(amount * obj.data.amount * 100) / 100);
                }
            });
        });
    }
}