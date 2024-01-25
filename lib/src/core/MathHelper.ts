export default class MathHelper {

    public static toFixed(num: number, fixed: number): number {
        const re = new RegExp("^-?\\d+(?:\.\\d{0," + (fixed || -1) + "})?");
        const matches = num.toString().match(re);
        if (!matches || matches.length === 0) {
            throw new Error(`Cannot convert [${num}] to fixed decimals.`);
        }
        return Number.parseFloat(num.toString().match(re)[0]);
    }

    public static periodToMs(period: string): number {
        const periodStr = period.toLowerCase().trim()
        let periodUnit = 1000;
        const periodUnitStr = periodStr[periodStr.length - 1];
        switch (periodUnitStr) {
            case "s": periodUnit = 1000; break;
            case "m": periodUnit = 60000; break;
            case "h": periodUnit = 3600000; break;
            case "d": periodUnit = 86400000; break;
        }
        const periodNumber = Number(periodStr.substr(0, periodStr.length - 1));
        return periodNumber * periodUnit;
    }

    public static gaussian(mu: number = 0, sigma: number = 1, nSamples: number = 6){
        let total = 0;
        for(let i = 0; i < nSamples; i += 1) {
           total += Math.random();
        }
        return sigma * (total - nSamples / 2) / (nSamples / 2) + mu;
    }

    public static clamp(num: number, min: number, max: number): number {
        return Math.min(Math.max(min, num), max);
    }

    public static randomBetween(min: number, max: number): number {
        return Math.random() * (max - min) + min;
    }
    
}
