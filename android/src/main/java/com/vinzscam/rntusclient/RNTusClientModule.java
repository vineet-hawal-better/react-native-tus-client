package com.vinzscam.rntusclient;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import io.tus.java.client.TusURLMemoryStore;
import io.tus.java.client.TusUpload;
import io.tus.java.client.ProtocolException;
import io.tus.java.client.TusClient;
import io.tus.java.client.TusExecutor;
import io.tus.java.client.TusUploader;

public class RNTusClientModule extends ReactContextBaseJavaModule {

    private final String ON_ERROR = "onError";
    private final String ON_SUCCESS = "onSuccess";
    private final String ON_PROGRESS = "onProgress";

    private final ReactApplicationContext reactContext;
    private static Map<String, TusRunnable> executorsMap = new HashMap<String, TusRunnable>();
    private ExecutorService pool;

    public RNTusClientModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        pool = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
    }

    @Override
    public String getName() {
        return "RNTusClient";
    }

    @ReactMethod
    public void createUpload(String fileUrl, ReadableMap options, Callback callback) {
        String endpoint = options.getString("endpoint");
        int chunkSize = options.getInt("chunkSize");
        int requestPayloadSize = options.getInt("requestPayloadSize");

        try {
            String uploadId = UUID.randomUUID().toString();
            TusRunnable executor = new TusRunnable(fileUrl, chunkSize, requestPayloadSize, uploadId, endpoint);
            executorsMap.put(uploadId, executor);
            callback.invoke(uploadId);
        } catch (FileNotFoundException | MalformedURLException e) {
            callback.invoke((Object) null, e.getMessage());
        }
    }

    @ReactMethod
    public void resume(String uploadId, String fileUrl, String endpoint, int chunkSize, int requestPayloadSize,
            Callback callback) {
        try {
            TusRunnable existingExecutor = executorsMap.get(uploadId);
            if (existingExecutor != null) {
                existingExecutor.run();
                return;
            }
            TusRunnable executor = new TusRunnable(fileUrl, chunkSize, requestPayloadSize, uploadId, endpoint);
            executorsMap.put(uploadId, executor);
            executor.run();
            callback.invoke(true);

        } catch (FileNotFoundException | MalformedURLException e) {
            callback.invoke(false);
        }
    }

    @ReactMethod
    protected void makeAttempt() throws ProtocolException, IOException {
      uploader = client.resumeOrCreateUpload(upload);
      uploader.setChunkSize(1024);
      uploader.setRequestPayloadSize(10 * 1024 * 1024);

      do {
        long totalBytes = upload.getSize();
        long bytesUploaded = uploader.getOffset();
        WritableMap params = Arguments.createMap();
        params.putString("uploadId", uploadId);
        params.putDouble("bytesWritten", bytesUploaded);
        params.putDouble("bytesTotal", totalBytes);
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(ON_PROGRESS, params);
      }while(uploader.uploadChunk() > -1 && !shouldFinish);

      uploader.finish();
    }

    @ReactMethod
    public void abort(String uploadId, Callback callback) {
        try {
            TusRunnable executor = executorsMap.get(uploadId);
            if (executor != null) {
                executor.finish();
            }
            callback.invoke((Object) null);
        } catch (IOException | ProtocolException e) {
            callback.invoke(e);
        }
    }

    class TusRunnable extends TusExecutor implements Runnable {
        private TusUpload upload;
        private TusUploader uploader;
        private String uploadId;
        private int chunkSize;
        private int requestPayloadSize;

        private TusClient client;
        private Timer progressTicker;
        private boolean shouldFinish;
        private boolean isRunning;

        public TusRunnable(String fileUrl, int chunkSize, int requestPayloadSize, String uploadId, String endpoint)
                throws FileNotFoundException, MalformedURLException {
            this.uploadId = uploadId;
            this.chunkSize = chunkSize;
            this.requestPayloadSize = requestPayloadSize;

            client = new TusClient();
            client.setUploadCreationURL(new URL(endpoint));

            client.enableResuming(new TusURLMemoryStore());

            File file = new File(fileUrl);
            upload = new TusUpload(file);

            shouldFinish = false;
            isRunning = false;
        }

        protected void makeAttempt() throws ProtocolException, IOException {
            uploader = client.resumeOrCreateUpload(upload);
            uploader.setChunkSize(chunkSize);
            uploader.setRequestPayloadSize(requestPayloadSize);

            progressTicker = new Timer();

            progressTicker.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {
                    sendProgressEvent(upload.getSize(), uploader.getOffset());
                }
            }, 0, 500);

            do {
            } while (uploader.uploadChunk() > -1 && !shouldFinish);

            progressTicker.cancel();
            sendProgressEvent(upload.getSize(), upload.getSize());
            uploader.finish();
        }

        private void sendProgressEvent(long bytesTotal, long bytesUploaded) {
            WritableMap params = Arguments.createMap();

            params.putString("uploadId", uploadId);
            params.putDouble("bytesWritten", bytesUploaded);
            params.putDouble("bytesTotal", bytesTotal);

            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(ON_PROGRESS, params);
        }

        public void finish() throws ProtocolException, IOException {
            if (isRunning) {
                shouldFinish = true;
            } else {
                if (uploader != null) {
                    uploader.finish();
                }
                if (progressTicker != null) {
                    progressTicker.cancel();
                }
            }
        }

        @Override
        public void run() {
            isRunning = true;
            try {
                makeAttempts();
                String uploadUrl = uploader.getUploadURL().toString();
                executorsMap.remove(this.uploadId);
                WritableMap params = Arguments.createMap();
                params.putString("uploadId", uploadId);
                params.putString("uploadUrl", uploadUrl);
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(ON_SUCCESS, params);
            } catch (ProtocolException | IOException e) {
                WritableMap params = Arguments.createMap();
                params.putString("uploadId", uploadId);
                params.putString("error", e.toString());
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(ON_ERROR, params);
            }
            isRunning = false;
        }
    }
}
