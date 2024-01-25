export interface IBalance {
    free: number;
    used: number;
    locked?: number;
}

export default class Balance {
    private _free: number = 0;
    private _used: number = 0;
    private _locked: number = 0;
    protected _minimumAmount = 0.000001;

    public constructor(data?: Partial<IBalance>) {
        if (data) {
            this._free = data.free;
            this._used = data.used;
            this._locked = data.locked || 0;
        }
    }

    public get free(): number { return Math.max(0, this._free - this._locked); }
    public get used(): number { return this._used; }
    public get locked(): number { return this._locked; }
    public get total(): number { return this.free + this.used; }

    public get json(): object {
        return {
            free: this._free,
            used: this._used,
            locked: this._locked,
            total: this.total
        };
    }

    public toString(): string {
        return JSON.stringify(this.json);
    }
}