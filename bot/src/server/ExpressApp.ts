import express                     = require("express");
import bodyParser                  = require("body-parser");
import cors                        = require("cors");
import Router                      from "./Router";

/**
 * This component sets up the express framework.
 *
 * @class ExpressApp
 * @copyright 2018 CrystalBot
 */
export default class ExpressApp {

    /**
     * Reference to the express app.
     *
     * @private
     * @type {express.Express}
     * @memberof ExpressApp
     */
    private _app: express.Express;

    constructor() {
        this._app = express();
        this.use(cors());
        this.use(bodyParser.json({limit: '50mb'}));
        this.use(express.static("backtestdata"));
    }

    public get app(): express.Express { return this._app; }

    // **********************************************************
    // Dealing with routers
    // **********************************************************

    /**
     * Add a router.
     *
     * @param {string} path             path of the router
     * @param {Router} router           router reference
     *
     * @memberof ExpressApp
     */
    public addRoute(path: string, router: Router) {
        console.log(`[${new Date().toUTCString()}] Adding router for ${path}.`);
        this._app.use(path, router.router);
    }

    /**
     * Start the server and listen for requests on a given port.
     *
     * @param {number} port         port to listen on
     *
     * @memberof ExpressApp
     */
    public listen(port: number) {
        // setup error handling
        this._app.use((err, request, response, next) => {
            console.error(err);
            response.status(500);
            response.send(err);
        });

        // start listening
        this._app.listen(port);
    }

    /**
     * Tell the express app to use a certain handler.
     *
     * @param {express.Handler} handler             reference to the handler
     *
     * @memberof ExpressApp
     */
    public use(handler: express.Handler) {
        this._app.use(handler);
    }
}
