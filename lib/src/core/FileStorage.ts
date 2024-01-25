import config from "../config";

// Imports the Google Cloud client library
const { Storage } = require("@google-cloud/storage");

// Format: exchangeid/currency/starttimestamp-endtimestamp.json

export default class FileStorage {
    // Needed for Singleton behavior
    public static instance = new FileStorage();
    private constructor() {
        this._storage = new Storage({
            projectId: config.google.projectId,
            keyFilename: "./google-auth.json"
        });
    }

    private _storage: Storage;

    public async getFileList(prefix?: string): Promise<string[]> {
        const options = {};
        if (prefix) {
            options["prefix"] = prefix;
        }
        const results = await this._storage.bucket(config.google.dataBucket).getFiles(options);
        const files = [];
        for (const file of results[0]) {
            files.push(file.name);
        }
        return files;
    }

    public async uploadStringToFile(contents: string, filename: string) {
        return this._storage.bucket(config.google.dataBucket).file(filename).save(contents);
    }

    public async deleteFile(filename: string) {
        return this._storage.bucket(config.google.dataBucket).file(filename).delete();
    }

    public async readFileContentsAsString(filename: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let content = "";
            this._storage.bucket(config.google.dataBucket).file(filename).createReadStream()
                .on("data", (data) => {
                    content += data;
                }).on("end", function() {
                    resolve(content);
                }).on("error", (error) => {
                    reject(error);
                });
        });
    }
}