import fs                   = require("fs");

export default class FileReader {
    public static async read(file: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            fs.readFile(file, "utf8", (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }
}