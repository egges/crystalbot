import { ICcxtExchange }        from "./ICcxtExchange";
import { CcxtExchange }         from "./CcxtExchange";
import { ICcxtExchangeOptions } from "./ICcxtExchangeOptions";

export class CcxtExchangeManager {

    protected static exchanges: Record<string, ICcxtExchange> = {};

    public static async getExchange(doc: ICcxtExchangeOptions): Promise<ICcxtExchange> {
        // create the ccxt exchange if it doesn't exist
        if (!this.exchanges[doc.id]) {
            this.exchanges[doc.id] = await CcxtExchange.create(doc);
        }
        return this.exchanges[doc.id];
    }    
}
