import { NativeModules, NativeEventEmitter, Platform } from "react-native";
const { RNTusClient } = NativeModules;
const tusEventEmitter = new NativeEventEmitter(RNTusClient);
const defaultOptions = {
    headers: {},
    metadata: {}
};
/** Class representing a tus upload */
class Upload {
    /**
     *
     * @param settings The options argument used to setup your tus upload.
     */
    constructor(options) {
        this.subscriptions = [];
        this.aborting = false;
        this.options = Object.assign({}, defaultOptions, options);
        if (this.options.uploadId) {
            this.uploadId = this.options.uploadId;
            delete this.options.uploadId;
        }
    }
    /**
     * Start or resume the upload using the specified file.
     * If no file property is available the error handler will be called.
     */
    start() {
        this.aborting = false;
        if (!this.options.file && !this.uploadId) {
            this.emitError(new Error("tus: no file or stream to upload provided"));
            return;
        }
        if (!this.options.endpoint) {
            this.emitError(new Error("tus: no endpoint provided"));
            return;
        }
        (this.uploadId ? Promise.resolve() : this.createUpload())
            .then(() => this.resume())
            .catch(e => this.emitError(e));
    }
    /**
     * Abort the currently running upload request and don't continue.
     * You can resume the upload by calling the start method again.
     */
    abort() {
        if (this.uploadId) {
            this.aborting = true;
            if (Platform.OS === "ios") {
                RNTusClient.abort(this.uploadId, this.options.endpoint, this.options.chunkSize, (err) => {
                    if (err) {
                        this.emitError(err);
                    }
                });
            }
            else {
                RNTusClient.abort(this.uploadId, (err) => {
                    if (err) {
                        this.emitError(err);
                    }
                });
            }
        }
    }
    resume() {
        if (Platform.OS === "ios") {
            RNTusClient.resume(this.uploadId, this.options.endpoint, this.options.chunkSize, (hasBeenResumed) => {
                if (!hasBeenResumed) {
                    this.emitError(new Error("Error while resuming the upload"));
                }
            });
        }
        else {
            RNTusClient.resume(this.uploadId, (hasBeenResumed) => {
                if (!hasBeenResumed) {
                    this.emitError(new Error("Error while resuming the upload"));
                }
            });
        }
        if (!this.subscriptions.length) {
            this.subscribe();
        }
    }
    emitError(error) {
        if (this.options.onError) {
            this.options.onError(error);
        }
        else {
            throw error;
        }
    }
    createUpload() {
        return new Promise((resolve, reject) => {
            const { file, metadata, headers, endpoint, chunkSize, requestPayloadSize } = this.options;
            const settings = {
                metadata,
                headers,
                endpoint,
                chunkSize,
                requestPayloadSize
            };
            RNTusClient.createUpload(file, settings, (uploadId, errorMessage) => {
                this.uploadId = uploadId;
                if (uploadId == null) {
                    const error = errorMessage ? new Error(errorMessage) : null;
                    reject(error);
                }
                else {
                    this.subscribe();
                    resolve();
                }
            });
        });
    }
    subscribe() {
        this.subscriptions.push(tusEventEmitter.addListener("onSuccess", payload => {
            if (payload.uploadId === this.uploadId) {
                this.url = payload.uploadUrl;
                if (!this.aborting) {
                    this.onSuccess();
                    this.aborting = false;
                }
                this.unsubscribe();
            }
        }));
        this.subscriptions.push(tusEventEmitter.addListener("onError", payload => {
            if (payload.uploadId === this.uploadId && !this.aborting) {
                this.onError(payload.error);
            }
        }));
        this.subscriptions.push(tusEventEmitter.addListener("onProgress", payload => {
            if (payload.uploadId === this.uploadId && !this.aborting) {
                this.onProgress(payload.bytesWritten, payload.bytesTotal);
            }
        }));
    }
    unsubscribe() {
        this.subscriptions.forEach(subscription => subscription.remove());
    }
    onSuccess() {
        this.options.onSuccess && this.options.onSuccess();
    }
    onProgress(bytesUploaded, bytesTotal) {
        this.options.onProgress &&
            this.options.onProgress(bytesUploaded, bytesTotal);
    }
    onError(error) {
        this.options.onError && this.options.onError(error);
    }
}
export { Upload };
//# sourceMappingURL=index.js.map