import Url              from "./Url";
import Types            from "./Types";
import * as axios       from "axios";
import config           from "../config";

/**
 * @classdesc Component for performing a http request.
 *
 * @class F4ComponentHTTPRequest
 * @copyright 2017 Fans4Music B.V.
 */
export default class HttpRequest {

    public apiKey: string;

    // Needed for Singleton behavior
    public static instance = new HttpRequest();
    private constructor() {
    }

    // *****************************************
    // Common HTTP(s) requests
    // *****************************************

    public async get(url: Url | string, data?: object, auth: boolean = true): Promise<any> {
        return this.request(url, "get", auth, data);
    }

    public async post(url: Url | string, data?: object, auth: boolean = true): Promise<any> {
        return this.request(url, "post", auth, data);
    }

    public async put(url: Url | string, data?: object, auth: boolean = true): Promise<any> {
        return this.request(url, "put", auth, data);
    }

    public async delete(url: Url | string, data?: object, auth: boolean = true): Promise<any> {
        return this.request(url, "delete", auth, data);
    }

    /**
     * This method performs an API call and directly returns the result as a JSON value. If the URL doesn't contain
     * a domain, the default backend is used. This throws and error if the status code is not 200.
     *
     * @param {(F4Url | string)} url        url to call
     * @param {string} type                 type of API call
     * @param {F4JsonObject} data           data to send along with the API call
     * @returns {Promise<F4JsonValue>}      Resulting JSON data
     * @memberof F4ComponentHTTPRequest
     */
    public async callApiMethod(url: Url | string, type: string, data?: object): Promise<any> {
        const typedUrl: Url = Types.isString(url) ? new Url(url as string) : url as Url;
        if (!typedUrl.domain) {
            typedUrl.domain = config.api;
        }
        typedUrl.querySet("accessKey", this.apiKey);
        const result = await this.request(typedUrl, type, false, data);
        if (result.statusCode !== 200) {
            throw new Error(`${result.body} [${result.statusCode}].`);
        }
        return result.body;
    }

    // *****************************************
    // Low level HTTP(S) request methods
    // *****************************************

    public async request(url: Url | string, type: string, auth: boolean = true, data?: object): Promise<any> {
        type = type.toLowerCase();
        if (type !== "get" && type !== "put" && type !== "post" && type !== "delete") {
            throw new Error("Unsupported HTTP method: " + type + ". Please use a RESTful HTTP method (GET, PUT, POST, or DELETE).");
        }
        const typedUrl: Url = Types.isString(url) ? new Url(url as string) : url as Url;

        // extract the parameters
        const params = typedUrl.query;

        // create the request config
        typedUrl.queryClear();
        const config = {
            method: type,
            url: typedUrl.toString(),
            withCredentials: auth,
            params: params,
            data: data
        };

        const result = await axios.default(config);

        return {
            statusCode: result.status,
            body: result.data
        };
    }
}
