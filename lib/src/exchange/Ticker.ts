import Types        from "../core/Types";

export interface ITicker {
    timestamp: number;
    bid: number;
    ask: number;
    last: number;
    baseVolume: number;
    quoteVolume: number;
}

export default class Ticker {
    private _data: number[];

    public constructor(data: number[] | object) {
        if (Types.isObject(data)) {
            const dataObj = data as any;
            this._data = [
                dataObj.timestamp,
                dataObj.bid,
                dataObj.ask,
                dataObj.last,
                dataObj.baseVolume,
                dataObj.quoteVolume
            ]
        } else {
            const dataArray = data as number[];
            if (dataArray.length !== 6) {
                throw new Error("Cannot store market data since array length is not 6: " + data);
                this._data = [null, null, null, null, null, null];
                return;
            }
            this._data = dataArray;
        }
    }

    public get timestamp(): number { return this._data[0]; }
    public get bid(): number { return this._data[1]; }
    public get ask(): number { return this._data[2]; }
    public get last(): number { return this._data[3]; }
    public get baseVolume(): number { return this._data[4]; }
    public get quoteVolume(): number { return this._data[5]; }

    public get average(): number {
        return (this.bid + this.ask) / 2;
    }

    public get spread(): number {
        return this.ask - this.bid;
    }

    public get json(): object {
        return {
            timestamp: this.timestamp || null,
            bid: this.bid || null,
            ask: this.ask || null,
            last: this.last || null,
            baseVolume: this.baseVolume || null,
            quoteVolume: this.quoteVolume || null
        };
    }

    public get raw(): number[] {
        return this._data;
    }
}