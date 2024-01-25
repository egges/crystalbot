import Url              from "../core/Url";
import HttpRequest      from "../core/HttpRequest";

export default class RestModel {

    /** whether the object currently has any unsaved changes */
    private _dirty: boolean;
    private _dirtyKeys: string[];

    private _readAccessKey: string;
    private _writeAccessKey: string;

    /**
     * Indicates whether the object should autosave itself whenever a property
     * value is changed.
     *
     * @type {boolean}
     * @memberOf F4RESTModel
     */
    public autoSave: boolean;

    /**
     * Time interval (in seconds) at which the object should autosave itself. This only has
     * an effect when the autoSave property is set to true.
     *
     * @private
     * @type {number}
     * @memberOf F4RESTModel
     */
    private _autoSaveInterval: number;

    /**
     * Delay (in seconds) between the start of the autosave interval and the firing of the
     * onInitiateAutoSave event.
     *
     * @private
     * @type {number}
     * @memberOf F4RESTModel
     */
    private _autoSaveEventDelay: number;

    /**
     * Indicates whether a save is currently in progress (used for autosaving).
     *
     * @private
     * @type {boolean}
     * @memberOf F4RESTModel
     */
    private _saveInProgress: boolean;

    // Autosave timeouts
    private _timeoutSave: NodeJS.Timer;
    private _timeoutAutoSaveEvent: NodeJS.Timer;
    private _timeoutInitAutoSave: NodeJS.Timer;

    /**
     *  Actual data that is defined in the model.
     *
     * @protected
     * @type {F4JsonObject}
     * @memberOf F4RESTModel
     */
    protected model: any;

    /**
     * Name of the collection that this model belongs to.
     *
     * @protected
     * @type {string}
     * @memberOf F4RESTModel
     */
    protected collName: string;

    /**
     * Creates an instance of F4RESTModel.
     *
     * @param {F4Environment} environment
     * @param {string} collName
     *
     * @memberOf F4RESTModel
     */
    constructor(collName: string, data?: object, autoSave: boolean = false) {
        this.collName = collName;
        this.clear();
        this.autoSave = false;
        this._autoSaveInterval = 5;
        this._autoSaveEventDelay = 0;
        this._saveInProgress = false;
        this._dirtyKeys = [];
        if (data) {
            this.setFromJSON(data);
            this._dirty = false;
            this._dirtyKeys = [];
        }
        this.autoSave = autoSave;
    }

    /**
     * Clears the model.
     *
     * @memberOf F4RESTModel
     */
    public clear() {
        this.model = {
            _id: null
        };
        this._dirty = false;
        this._dirtyKeys = [];
    }

    // ********************************************
    // Methods for core database operations
    // ********************************************

    /**
     * Creates a new document in the collection from the data passed as a JSON object. Depending on
     * the model that is used, you can set your own id (through the _id property in the data object),
     * or an id is automatically generated for you when the document is saved.
     *
     * @param {F4JsonObject} data               data to store in the document
     * @returns {Promise<string>}               id of the document
     *
     * @memberOf F4RESTModel
     */
    public async create(data: object): Promise<string> {
        const result = await HttpRequest.instance.callApiMethod(`/${this.collName}`, "post", data);
        return result;
    }

    /**
     * Given an id, finds the document. If a document of the given id doesn't exist, an exception is thrown.
     *
     * @param {(string | number)} id            id of the document
     * @returns {Promise<F4JsonObject>}         the document contents
     *
     * @memberOf F4RESTModel
     */
    public async findById(id: string | number): Promise<object> {
        const result = await HttpRequest.instance.callApiMethod(`/${this.collName}/${id}`, "get");
        return result;
    }

    /**
     * Finds a single document, given a filter. If a document can't be found that adheres to the filter, the
     * method returns null.
     *
     * @param {F4JsonObject} filter             filter that defines the constraints
     * @param {F4JsonObject} [projection=null]  defines the projection (in other words: which fields to return)
     * @returns {Promise<F4JsonObject>}         a document adhering to the filter; null if no such document exists
     *
     * @memberOf F4RESTModel
     */
    public async findOne(filter: object, projection: object = null): Promise<object> {
        const result = await this.find(filter, projection, null, 0, 1);
        if (result.length > 0) {
            return result[0];
        } else {
            return null;
        }
    }

    /**
     * Finds all the documents that adhere to a filter in an array. Optionally, you can provide a number of documents
     * to skip as well as a limit (both are 0 by default meaning that the method returns all documents).
     *
     * @param {F4JsonObject} [filter={}]            an optional filter in JSON format
     * @param {F4JsonObject} [projection=null]      defines the projection (in other words: which fields to return)
     * @param {F4JsonObject} [sort=null]            document that defines the sort order
     * @param {number} [skip=0]                     how many documents should be skipped
     * @param {number} [limit=0]                    limit on how many document should be returned
     * @returns {Promise<F4JsonArray>}              an array of JSON objects containing the documents' content
     *
     * @memberOf F4RESTModel
     */
    public async find(filter: object = {}, projection: object = null, sort: object = null, skip: number = 0, limit: number = 0): Promise<Array<any>> {
        const url = new Url(this.collName);
        url.querySet("skip", skip);
        url.querySet("limit", limit);
        url.querySet("filter", JSON.stringify(filter));
        url.querySet("projection", JSON.stringify(projection));
        url.querySet("sort", JSON.stringify(sort));
        return HttpRequest.instance.callApiMethod(url, "get");
    }

    /**
     * Counts the number of documents adhering to a filter.
     *
     * @param {F4JsonObject} [filter={}]            an optional filter in JSON format
     * @returns {Promise<number>}                   the number of documents that adhere to the filter
     *
     * @memberOf F4RESTModel
     */
    public async count(filter: object = {}): Promise<number> {
        const url = new Url(`/${this.collName}/count`);
        url.querySet("filter", JSON.stringify(filter));
        const result = await HttpRequest.instance.callApiMethod(url, "get");
        return result;
    }

    /**
     * Deletes a document given an id. Does nothing if the document doesn't exist.
     *
     * @param {(string | number)} id                id of the document to delete
     *
     * @memberOf F4RESTModel
     */
    public async deleteById(id: string | number) {
        const url = new Url(`/${this.collName}/${id}`);
        return HttpRequest.instance.callApiMethod(url, "delete");
    }

    /**
     * Updates a document of a given id with the data provided in JSON format. Does nothing
     * if the document doesn't exist.
     *
     * @param {(string | number)} id                id of the document to update
     * @param {F4JsonObject} data                   updated data
     *
     * @memberOf F4RESTModel
     */
    public async update(id: string | number, data: object) {
        const url = new Url(`/${this.collName}/${id}`);
        return HttpRequest.instance.callApiMethod(url, "put", data);
    }

    // ********************************************
    // Single document operations
    // ********************************************

    /**
     * Reads the current document from the database. If you have set an id or provided an id as parameter, that id is used to retrieve
     * the document. Otherwise, a filter is constructed from the data you filled in and the first document adhering
     * to the filter is retrieved. If no document can be found, an exception is thrown.
     *
     * @param {(string | number)} [id]              id of the document to read
     * @memberOf F4RESTModel
     */
    public async read(id?: string | number) {
        if (id || this.id) {
            const result = await this.findById(id || this.id);
            if (!result) {
                throw new Error(`Document with id ${this.id} not found.`);
            }
            this.model = result;
        } else {
            const result = await this.findOne(this.raw(false));
            if (!result) {
                throw new Error(`No document found matching data ${JSON.stringify(this.raw(false))}.`);
            }
            this.model = result;
        }
    }

    /**
     * Stores this document in the database. Depending on whether the document already exists, the document
     * is updated, or a new document is created.
     *
     * @memberOf F4RESTModel
     */
    public async save() {
        if (!this._dirty) {
            return;
        }
        this._dirty = false;

        // Clear pending autosave
        this._clearAutoSaveTimeouts();

        this._saveInProgress = true;
        if (this.onSave) {
            this.onSave();
        }

        const isUpdate = this.id && await this.exists();
        try {
            if (isUpdate) {
                await this.update(this.id, this.raw(true, true));
            } else {
                this.model._id = await this.create(this.raw(false));
            }

            this._dirtyKeys = [];

            if (this.onSaveComplete) {
                this.onSaveComplete();
            }
        } catch (err) {
            if (this.onSaveError) {
                this.onSaveError(err);
            }
        }

        this._saveInProgress = false;
    }

    /** Clears any timeouts set by the initiateAutoSave function. */
    private _clearAutoSaveTimeouts() {
        if (this._timeoutSave) {
            clearTimeout(this._timeoutSave);
        }
        if (this._timeoutAutoSaveEvent) {
            clearTimeout(this._timeoutAutoSaveEvent);
        }
        if (this._timeoutInitAutoSave) {
            clearTimeout(this._timeoutInitAutoSave);
        }
    }

    /**
     * Deletes this document. If you have set an id or provided an id as parameter, that id is used to delete the document. Otherwise,
     * a filter is constructed from the data you filled in and the first document adhering
     * to the filter is deleted.
     *
     * @param {(string | number)} [id]      id of the document to delete
     * @memberOf F4RESTModel
     */
    public async delete(id?: string | number) {
        if (!id && !this.id) {
            await this.read();
        }
        await this.deleteById(id || this.id);
        this.clear();
    }

    /**
     * Checks whether a document exists, based on the content in the document. If you set an id or provided an id as parameter, that id
     * is used to check whether the document exists. Otherwise, a filter is constructed from the data you
     * filled in the model.
     *
     * @param {(string | number)} [id]      id of the document to check for existence
     * @returns {Promise<boolean>}          true if a document adhering to the model data exists; false otherwise
     *
     * @memberOf F4RESTModel
     */
    public async exists(id?: string | number): Promise<boolean> {
        if (id || this.id) {
            return await this.count({ _id: id || this.id }) > 0;
        } else {
            return await this.count(this.raw(false)) > 0;
        }
    }

    /**
     * Returns the id of this object.
     *
     * @type {F4JsonValue}
     * @memberOf F4RESTModel
     */
    public get id(): string | number {
        return this.model._id as string | number;
    }

    /**
     * Sets the id of this object.
     *
     * @memberOf F4RESTModel
     */
    public set id(value: string | number) {
        this.set("_id", value);
    }

    /**
     * Sets a key to a given value. If the key is _id, it sets the id of this object.
     *
     * @param {string} key              key of the property to be changed
     * @param {F4JsonValue} value       new value of the property
     *
     * @memberOf F4RESTModel
     */
    public set(key: string, value: any) {
        // if the value is the same, don't do anything

        if (this.model[key] === value) {
            return;
        }
        // update the value and slots in any attached behaviors
        this.model[key] = value;
        this.markDirty(key);
    }

    public markDirty(key: string) {
        // automatically save after a number of seconds
        if (!this._dirty && this.autoSave) {
            this._initiateAutoSave();
        }
        this._dirty = true;
        this._dirtyKeys.push(key);
    }
    /**
     * Start the autosave process.
     *
     * @private
     *
     * @memberOf F4RESTModel
     */
    private _initiateAutoSave() {
        if (this._saveInProgress) {
            // if a save is in progress, check again in 1 second
            this._timeoutInitAutoSave = setTimeout(() => {
                this._initiateAutoSave();
                this._timeoutInitAutoSave = null;
            }, 1000);
        } else {
            // fire event
            if (this.onInitiateAutoSave) {
                this._timeoutAutoSaveEvent = setTimeout(() => {
                    this.onInitiateAutoSave();
                    this._timeoutAutoSaveEvent = null;
                }, this._autoSaveEventDelay * 1000);
            }
            // do save
            this._timeoutSave = setTimeout(() => {
                this._timeoutSave = null;
                this.save(); // async
            }, this._autoSaveInterval * 1000);
        }
    }

    /**
     * Given a key, returns the corresponding value.
     *
     * @param {string} key              key of the property to read
     * @returns {F4JsonValue}
     *
     * @memberOf F4RESTModel
     */
    public get(key: string): any {
        if (key === "_id") {
            return this.id;
        }
        return this.model[key];
    }

    /**
     * Sets the keys and values from a JSON data structure.
     *
     * @param {F4JsonObject} data       the JSON data to set the object from
     *
     * @memberOf F4RESTModel
     */
    public setFromJSON(data: any) {
        for (const key in data) {
            if (data.hasOwnProperty(key)) {
                this.set(key, data[key]);
            }
        }
    }

    /**
     * Returns a raw representation of this object.
     *
     * @readonly
     * @type {F4JsonObject}
     * @memberOf F4RESTModel
     */
    public raw(includeNullItems: boolean = true, onlyDirtyKeys: boolean = false): any {
        const data = {};
        for (const key in this.model) {
            if (this.model.hasOwnProperty(key)) {
                if ((this.model[key] !== null || includeNullItems) && (!onlyDirtyKeys || this._dirtyKeys.indexOf(key) >= 0)) {
                    data[key] = this.model[key];
                }
            }
        }
        return data;
    }

    public get json(): any {
        return this.raw(true);
    }

    // ********************************************
    // Common read-only schema properties
    // ********************************************

    public get createdAt(): Date {
        return new Date(this.model._createdAt as string);
    }

    public get updatedAt(): Date {
        return new Date(this.model._updatedAt as string);
    }

    // Saving intervals

    /**
     * Time interval (in seconds) at which the object should autosave itself. This only has
     * an effect when the autoSave property is set to true.
     *
     * @memberof F4RESTModel
     */
    public set autoSaveInterval(value: number) {
        // Interval should not be negative
        this._autoSaveInterval = Math.max(0, value);
    }
    public get autoSaveInterval(): number { return this._autoSaveInterval; }

    /**
     * Delay (in seconds) between the start of the autosave interval and the firing of the
     * onInitiateAutoSave event.
     *
     * @memberof F4RESTModel
     */
    public set autoSaveEventDelay(value: number) {
        // Delay should not be longer than the autosave interval and not negative
        this._autoSaveEventDelay = Math.max(0, Math.min(this._autoSaveInterval, value));
    }
    public get autoSaveEventDelay(): number { return this._autoSaveEventDelay; }

    // Save events

    private _onInitiateAutoSave: () => void;
    /**
     * Event triggered when the autosave timer is initiated.
     * Can delayed using autoSaveEventDelay.
     * @memberof F4RESTModel
     */
    public set onInitiateAutoSave(value: () => void) { this._onInitiateAutoSave = value; }
    public get onInitiateAutoSave(): () => void { return this._onInitiateAutoSave; }

    private _onSave: () => void;
    /**
     * Event triggered when the save request is sent to the backend.
     * @memberof F4RESTModel
     */
    public set onSave(value: () => void) { this._onSave = value; }
    public get onSave(): () => void { return this._onSave; }

    private _onSaveComplete: () => void;
    /**
     * Event triggered when the backend has successfully saved the object.
     * @memberof F4RESTModel
     */
    public set onSaveComplete(value: () => void) { this._onSaveComplete = value; }
    public get onSaveComplete(): () => void { return this._onSaveComplete; }

    private _onSaveError: (error: any) => void;
    /**
     * Event triggered when the backend returns an error while saving.
     * @memberof F4RESTModel
     */
    public set onSaveError(value: (error: any) => void) { this._onSaveError = value; }
    public get onSaveError(): (error: any) => void { return this._onSaveError; }
}
