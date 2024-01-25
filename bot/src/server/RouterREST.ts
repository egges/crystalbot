import express              = require("express");
import Router               from "./Router";
import mongoose             = require("mongoose");

export default class RouterREST extends Router {

    protected model: mongoose.Model<mongoose.Document>;
    
    constructor(model: mongoose.Model<mongoose.Document>) {
        super();
        this.model = model;
        this.createRoutes();
    }

    public createRoutes() {
        this.get("/count", this.countDocuments);         // counts the number of documents adhering to a filter
        this.get("/:key", this.findDocumentById);        // read a single document given an id
        this.get("/", this.findDocuments);               // read a list of documents with skip, limit and filter options
        this.post("/", this.createDocument);         // create a document (content passed in JSON body)
        this.put("/:key", this.updateDocument);      // update a document given an id and content passed as a JSON body
        this.delete("/:key", this.deleteDocument);   // delete a document given an id
    }

    public get path(): string {
        return "/" + this.model.collection.collectionName;
    }

    public async createDocument(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!await this.preCreateDocument(request, response, next)) {
            return;
        }
        let instance = new this.model(request.body);
        if (!await this.postCreateDocument(instance, request, response, next)) {
            return;
        }
        await instance.save();
        response.status(200).send(instance._id.toString());
    }

    public async findDocumentById(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.params.key) {
            response.status(400).send({
                error: "Missing id."
            });
            return;
        }
        if (!await this.preFindDocumentById(request, response, next)) {
            return;
        }
        let id = request.params.key;
        let instance = await this.model.findById(id).exec();
        if (!instance) {
            response.status(404).send();
            return;
        }
        const instanceJSON = instance.toJSON();
        if (!await this.postFindDocumentById(instanceJSON, request, response, next)) {
            return;
        }
        response.status(200).send(instanceJSON);
    }

    public async findDocuments(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!await this.preFindDocuments(request, response, next)) {
            return;
        }
        // read the filter
        let filter = {};
        if (request.query.filter) {
            filter = JSON.parse(request.query.filter);
        }

        // read the projection
        let projection = null;
        if (request.query.projection) {
            projection = JSON.parse(request.query.projection);
        }

        // construct the query
        let query = this.model.find(filter, projection);
        if (request.query.sort) {
            query = query.sort(JSON.parse(request.query.sort));
        }
        if (request.query.skip) {
            query = query.skip(Number(request.query.skip));
        }
        if (request.query.limit) {
            query = query.limit(Number(request.query.limit));
        }
        let instances = await query.exec();
        let instancesJSON = [];
        for (let instance of instances) {
            instancesJSON.push(instance.toJSON());
        }
        if (!await this.postFindDocuments(instancesJSON, request, response, next)) {
            return;
        }
        response.status(200).send(instancesJSON);
    }

    public async countDocuments(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!await this.preCountDocuments(request, response, next)) {
            return;
        }
        let filter = {};
        if (request.query.filter) {
            filter = JSON.parse(request.query.filter);
        }
        let query = this.model.count(filter);
        let count = await query.exec();
        if (!await this.postCountDocuments(count, request, response, next)) {
            return;
        }
        response.status(200).send(count.toString());
    }

    public async deleteDocument(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.params.key) {
            response.status(400).send({
                error: "Missing id."
            });
            return;
        }
        if (!await this.preDeleteDocument(request, response, next)) {
            return;
        }
        let id = request.params.key;
        const document = await this.model.findByIdAndRemove(id).exec();
        if (!await this.postDeleteDocument(document, request, response, next)) {
            return;
        }
        response.status(200).send();
    }

    public async updateDocument(request: express.Request, response: express.Response, next: express.NextFunction) {
        if (!request.params.key) {
            response.status(400).send({
                error: "Missing id."
            });
            return;
        }
        if (!await this.preUpdateDocument(request, response, next)) {
            return;
        }
        const document = await this.model.findByIdAndUpdate(request.params.key, request.body, { new: true }).exec();
        if (!await this.postUpdateDocument(document, request, response, next)) {
            return;
        }
        response.status(200).send();
    }

    // **********************************************************
    // Pre and post methods
    // **********************************************************

    public async preCreateDocument(request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async postCreateDocument(instance: mongoose.Document, request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async preFindDocumentById(request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async postFindDocumentById(instance: object, request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async preFindDocuments(request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async postFindDocuments(instances: object[], request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async preCountDocuments(request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async postCountDocuments(count: number, request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async preDeleteDocument(request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async postDeleteDocument(instance: mongoose.Document, request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async preUpdateDocument(request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }

    public async postUpdateDocument(instance: mongoose.Document, request: express.Request, response: express.Response, next: express.NextFunction): Promise<boolean> {
        return true;
    }
}
