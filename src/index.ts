import {
  NativeModules,
  NativeEventEmitter
} from 'react-native';

const { RNTusClient } = NativeModules;

const tusEventEmitter = new NativeEventEmitter(RNTusClient);

/** Object used to setup a tus upload */
interface Options {
  /** URL used to create a new upload */
  endpoint: string;
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
  onError? (error: Error): void;
  /**
   * A function that will be called each time progress information is available.
   * @param bytesUploaded number of bytes uploaded
   * @param bytesTotal number of total bytes
   */
  onProgress? (bytesUploaded: number, bytesTotal: number): void;
  /**
   * A function called when the upload finished successfully.
   */
  onSuccess? (): void;
}

const defaultOptions = {
  headers: { },
  metadata: { }
};

/** Class representing a tus upload */
class Upload {
  /**
   * Reference to the file absolute path.
   */
  public readonly file: string;
  /**
   * The URL used to upload the file generated by the library.
   * The client will set this property to the new upload URL.
   */
  public url: string;

  private options: Options;
  private subscriptions: any[] = [];
  private uploadId: string;

  /**
   *
   * @param file The file absolute path.
   * @param settings The options argument used to setup your tus upload.
   */
  constructor (file: string, options: Options) {
    this.file = file;
    this.options = Object.assign({ }, defaultOptions, options);
  }

  /**
   * Start or resume the upload using the specified file.
   * If no file property is available the error handler will be called.
   */
  public async start () {
    if (!this.file) {
      this.emitError(new Error(
        'tus: no file or stream to upload provided'
      ));
      return;
    }

    if (!this.options.endpoint) {
      this.emitError(new Error(
        'tus: no endpoint provided'
      ));
      return;
    }

    if (!this.uploadId) {
      await this.createUpload();
    }

    this.resume();
  }

  /**
   * Abort the currently running upload request and don't continue.
   * You can resume the upload by calling the start method again.
   */
  public abort () {
    if (this.uploadId) {
      RNTusClient.abort(this.uploadId, (err?: Error) => {
        if (err) {
          this.emitError(err);
        }
      });
    }
  }

  private resume () {
    RNTusClient.resume(this.uploadId, (hasBeenResumed: boolean) => {
      if (!hasBeenResumed) {
        this.emitError(new Error('Error while resuming the upload'));
      }
    });
  }

  private emitError (error: Error) {
    if (this.options.onError) {
      this.options.onError(error);
    } else {
      throw error;
    }
  }

  private createUpload (): Promise<void> {
    return new Promise((resolve, reject) => {

      const { metadata, headers, endpoint } = this.options;
      const settings = { metadata, headers, endpoint };

      RNTusClient.createUpload(
        this.file,
        settings,
        (uploadId: string) => {
          this.uploadId = uploadId;
          if (uploadId == null) {
            reject(null);
          } else {
            this.subscribe();
            resolve();
          }
        }
      );
    });
  }

  private subscribe () {
    this.subscriptions.push(tusEventEmitter.addListener(
      'onSuccess',
      payload => {
        if (payload.uploadId === this.uploadId) {
          this.url = payload.uploadUrl;
          this.onSuccess();
          this.unsubscribe();
        }
      }
    ));
    this.subscriptions.push(tusEventEmitter.addListener(
      'onError',
      payload => {
        if (payload.uploadId === this.uploadId) {
          this.onError(payload.error);
        }
      }
    ));
    this.subscriptions.push(tusEventEmitter.addListener(
      'onProgress',
      payload => {
        if (payload.uploadId === this.uploadId) {
          this.onProgress(
            payload.bytesWritten,
            payload.bytesTotal
          );
        }
      }
    ));
  }

  private unsubscribe () {
    this.subscriptions.forEach(subscription =>
      subscription.remove()
    );
  }

  private onSuccess () {
    this.options.onSuccess && this.options.onSuccess();
  }

  private onProgress (bytesUploaded: number, bytesTotal: number) {
    this.options.onProgress
      && this.options.onProgress(bytesUploaded, bytesTotal);
  }

  private onError (error: Error) {
    this.options.onError && this.options.onError(error);
  }
}

export {
  Options,
  Upload
};