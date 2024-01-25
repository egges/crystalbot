export default class Types {

    /**
     * Checks whether something is a number.
     *
     * @static
     * @param {*} obj           the value to check
     * @returns {boolean}       true if the value is a number; false otherwise
     *
     * @memberOf F4Json
     */
    public static isNumber(obj: any): boolean {
        if (obj === null || obj === undefined) { return false; }
        return typeof obj === "number" || (typeof obj === "object" && obj.constructor === Number);
    }

    /**
     * Checks whether something is a boolean.
     *
     * @static
     * @param {*} obj           the value to check
     * @returns {boolean}       true if the value is a boolean; false otherwise
     *
     * @memberOf F4Json
     */
    public static isBoolean(obj: any): boolean {
        if (obj === null || obj === undefined) { return false; }
        return typeof obj === "boolean" || (typeof obj === "object" && obj.constructor === Boolean);
    }


    /**
     * Checks whether something is a string.
     *
     * @static
     * @param {*} obj           the value to check
     * @returns {boolean}       true if the value is a string; false otherwise
     * @memberOf F4Json
     */
    public static isString(obj: any): boolean {
        if (obj === null || obj === undefined) { return false; }
        return Object.prototype.toString.call(obj) === "[object String]";
    }

    /**
     * Checks whether something is an array.
     *
     * @static
     * @param {*} obj           the value to check
     * @returns {boolean}       true if the value is an array; false otherwise
     * @memberOf F4Json
     */
    public static isArray(obj: any): boolean {
        if (!obj) { return false; }
        return Object.prototype.toString.call(obj) === "[object Array]";
    }

    /**
     * Checks whether something is an object.
     *
     * @static
     * @param {*} obj           the value to check
     * @returns {boolean}       true if the value is an object; false otherwise
     * @memberOf F4Json
     */
    public static isObject(obj: any): boolean {
        if (!obj) { return false; }
        return typeof obj === "object" && obj.constructor === Object;
    }

    /**
     * Checks whether something is a date.
     *
     * @static
     * @param {*} obj           the value to check
     * @returns {boolean}       true if the value is a Date object; false otherwise
     * @memberOf F4Json
     */
    public static isDate(obj: any): boolean {
        if (!obj) { return false; }
        return typeof obj === "object" && obj.constructor === Date;
    }
}
