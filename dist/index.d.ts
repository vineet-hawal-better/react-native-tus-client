/** Object used to setup a tus upload */
interface Options {
    /** URL used to create a new upload */
    endpoint: string;
    chunkSize: number;
    requestPayloadSize: number;
    /** An object with custom header values used in all requests. */
    headers?: object;
    /** An object with string values used as additional meta data
     * which will be passed along to the server when (and only when)
     * creating a new upload. Can be used for filenames, file types etc.
     */
    metadata?: object;
    /**
     * A function called once an error appears.
     * @param error and Error instance
     */
    onError?(error: Error): void;
    /**
     * A function that will be called each time progress information is available.
     * @param bytesUploaded number of bytes uploaded
     * @param bytesTotal number of total bytes
     */
    onProgress?(bytesUploaded: number, bytesTotal: number): void;
    /**
     * A function called when the upload finished successfully.
     */
    onSuccess?(): void;
}
/** Class representing a tus upload */
declare class Upload {
    /**
     * Reference to the file absolute path.
     */
    readonly file: string;
    /**
     * The URL used to upload the file generated by the library.
     * The client will set this property to the new upload URL.
     */
    url: string;
    private options;
    private subscriptions;
    private uploadId;
    private aborting;
    /**
     *
     * @param file The file absolute path.
     * @param settings The options argument used to setup your tus upload.
     */
    constructor(file: string, options: Options);
    /**
     * Start or resume the upload using the specified file.
     * If no file property is available the error handler will be called.
     */
    start(): void;
    /**
     * Abort the currently running upload request and don't continue.
     * You can resume the upload by calling the start method again.
     */
    abort(): void;
    private resume();
    private emitError(error);
    private createUpload();
    private subscribe();
    private unsubscribe();
    private onSuccess();
    private onProgress(bytesUploaded, bytesTotal);
    private onError(error);
}
export { Options, Upload };
