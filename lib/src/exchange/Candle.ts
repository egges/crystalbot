// a few consts for accessing candle data
export enum CandleChannel {
    Timestamp = 0,
    Open = 1,
    High = 2,
    Low = 3,
    Close = 4,
    Volume = 5
}

export class Candle {

    private _data: number[] = [0, 0, 0, 0, 0, 0];
    
    constructor(data: number[]) {
        if (!data || data.length !== 6) {
            throw new Error("Retrieved incomplete candle data: " + JSON.stringify(data));
        }
        this._data = data;
    }

    public get timestamp(): number { return this._data[CandleChannel.Timestamp]; }
    public set timestamp(value: number) { this._data[CandleChannel.Timestamp] = value; }

    public get open(): number { return this._data[CandleChannel.Open]; }
    public set open(value: number) { this._data[CandleChannel.Open] = value; }

    public get high(): number { return this._data[CandleChannel.High]; }
    public set high(value: number) { this._data[CandleChannel.High] = value; }

    public get low(): number { return this._data[CandleChannel.Low]; }
    public set low(value: number) { this._data[CandleChannel.Low] = value; }

    public get close(): number { return this._data[CandleChannel.Close]; }
    public set close(value: number) { this._data[CandleChannel.Close] = value; }

    public get volume(): number { return this._data[CandleChannel.Volume]; }
    public set volume(value: number) { this._data[CandleChannel.Volume] = value; }

    public get averagePrice(): number {
        return (this.open + this.close + this.high + this.low) / 4;
    }

    public get quoteVolumeEstimate(): number {
        return this.averagePrice * this.volume;
    }

    public get raw(): number[] { return this._data; }

    public get json(): object {
        return {
            timestamp: this.timestamp,
            open: this.open,
            high: this.high,
            low: this.low,
            close: this.close,
            volume: this.volume
        };
    }

    public get(channel: CandleChannel) {
        return this._data[channel];
    }

    public static getCandleChannel(channel: CandleChannel, candles: Candle[]): number[] {
        // Construct the data channels
        const data = [];
        for (const candle of candles) {
            data.push(candle._data[channel]);
        }
        return data;
    }

    public static getCandleChannels(channels: CandleChannel[], candles: Candle[]): number[][] {
        // Construct the data channels
        const data: number[][] = [];
        for (const candle of candles) {
            const channelData: number[] = [];
            for (const channel of channels) {
                channelData.push(candle._data[channel]);
            }
            data.push(channelData);
        }
        return data;
    }
}
