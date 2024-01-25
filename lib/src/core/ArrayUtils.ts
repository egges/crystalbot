
export default class ArrayUtils {
    /**
     * Creates a map out of an array be choosing what property to key by
     * @param {object[]} array Array that will be converted into a map
     * @param {string} prop Name of property to key by
     * @return {object} The mapped array. Example:
     *     mapFromArray([{a:1,b:2}, {a:3,b:4}], 'a')
     *     returns {1: {a:1,b:2}, 3: {a:3,b:4}}
     */
    public static mapFromArray<T>(array: T[], prop: string): Record<string, T> {
        const map: Record<string, T> = {};
        for (let i = 0; i < array.length; i += 1) {
            map[array[i][prop]] = array[i];
        }
        return map;
    }
}

export function tail<T> (array: T[], offset: number = 0): T {
    return array[array.length - (1 + offset)];
}

export function head<T> (array: T[], offset: number = 0): T {
    return array[offset];
}