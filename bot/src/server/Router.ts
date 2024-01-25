import express      = require("express");
import access       from "../access";

/**
 * Type that defines a router handler function (with request, response, and next functions).
 *
 * @export
 * @type IRouterHandler
 */
export type IRouterHandler = (request: express.Request, response: express.Response, next: express.NextFunction) => any;

/**
 * This class represents a generic router that correctly deals with authentication and error
 * handling in promises.
 *
 * @export
 * @class Router
 * @copyright 2018 CrystalBot
 */
export default class Router {

    /**
     * Reference to the express router object.
     *
     * @type {express.Router}
     * @memberOf F4Router
     */
    public router: express.Router;

    /**
     * Creates an instance of Router.
     *
     * @memberOf Router
     */
    constructor() {
        this.router = express.Router();
    }

    // **********************************************************
    // Main router methods (GET, POST, PUT, DELETE)
    // **********************************************************

    protected get(path: string, handler: IRouterHandler) {
        this.router.get(path, this.wrap(handler));
    }

    protected post(path: string, handler: IRouterHandler) {
        this.router.post(path, this.wrap(handler));
    }

    protected put(path: string, handler: IRouterHandler) {
        this.router.put(path, this.wrap(handler));
    }

    protected delete(path: string, handler: IRouterHandler) {
        this.router.delete(path, this.wrap(handler));
    }

    /**
     * This is a wrapper method that calls a handler method and properly deals with errors that are 
     * thrown in a promise. Errors are returned as a JSON response containing the error.
     *
     * @private
     * @param {IRouterHandler} handler          handler function to be called
     * @returns {IRouterHandler}                router handler function to be passed to express
     *
     * @memberOf F4Router
     */
    protected wrap(handler: IRouterHandler): IRouterHandler {
        return (request, response, next) => {
            if (request.query.accessKey !== access.apiKey) {
                response.status(401).send();
                return;
            }
            const result = handler.call(this, request, response, next);
            if (result && result.catch) {
                result.catch((error) => {
                    next(error);
                });
            }
        };
    }
}
