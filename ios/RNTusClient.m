#import "RNTusClient.h"
#import "TUSKit.h"
#import "RCTUtils.h"

#define ON_SUCCESS @"onSuccess"
#define ON_ERROR @"onError"
#define ON_PROGRESS @"onProgress"

@interface RNTusClient ()

@property(nonatomic, strong, readonly) NSMutableDictionary<NSString*, TUSSession*> *sessions;
@property(nonatomic, strong, readonly) TUSUploadStore *uploadStore;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSString *, NSString *> *endpoints;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSString *, NSDictionary *> *progressStates;
@property(nonatomic, assign) BOOL progressNotificationScheduled;

@end

@implementation RNTusClient

@synthesize uploadStore = _uploadStore;

- (id)init {
    if(self = [super init]) {
        _sessions = [NSMutableDictionary new];
        _endpoints = [NSMutableDictionary new];
        _progressStates = [NSMutableDictionary new];
        _progressNotificationScheduled = NO;
    }
    return self;
}

- (TUSUploadStore *)uploadStore {
    if(_uploadStore == nil) {
        NSURL *applicationSupportURL = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] lastObject];
        _uploadStore = [[TUSFileUploadStore alloc] initWithURL:[applicationSupportURL URLByAppendingPathComponent:@"__tusUploadStore.tmp"]];
    }
    return _uploadStore;
}

- (TUSSession *)sessionFor:(NSString *)endpoint {
    TUSSession *session = [_sessions objectForKey:endpoint];
    if(session == nil) {
        session = [[TUSSession alloc] initWithEndpoint:[[NSURL alloc] initWithString:endpoint] dataStore:self.uploadStore allowsCellularAccess:YES];
        [self.sessions setObject:session forKey:endpoint];
    }
    return session;
}

- (TUSResumableUpload *)restoreUpload:(NSString *)uploadId onEndpoint:(NSString *)endpoint withChunkSize:(NSString *)chunkSize {
    TUSSession *session = [self sessionFor:endpoint];
    TUSResumableUpload *upload = [session restoreUpload:uploadId];

    [self configureUpload:upload onEndpoint:endpoint withChunkSize:chunkSize];
    return upload;
}

- (void)sendProgressEvents {
    self.progressNotificationScheduled = NO;

    for(NSString* uploadId in self.progressStates) {
        NSMutableDictionary *body = [[NSMutableDictionary alloc] initWithDictionary:self.progressStates[uploadId]];
        [body setObject:uploadId forKey:@"uploadId"];  
        [self sendEventWithName:ON_PROGRESS body:body];
    }

    [self.progressStates removeAllObjects];
}

- (void)configureUpload:(TUSResumableUpload *)upload onEndpoint:(NSString *)endpoint withChunkSize:(NSString *)chunkSize {
    [upload setChunkSize:[(NSNumber *)chunkSize integerValue]];

    [self.endpoints setObject:endpoint forKey: upload.uploadId];

    __weak TUSResumableUpload *_upload = upload;
    __weak RNTusClient *weakSelf = self;
    
    upload.resultBlock = ^(NSURL * _Nonnull fileURL) {
        if(weakSelf.progressStates[_upload.uploadId] != nil) {
            [weakSelf.progressStates removeObjectForKey:_upload.uploadId];
        }
        [weakSelf sendEventWithName:ON_SUCCESS body:@{
            @"uploadId": _upload.uploadId,
            @"uploadUrl": fileURL.absoluteString
        }];
    };

    upload.failureBlock = ^(NSError * _Nonnull error) {
        if(weakSelf.progressStates[_upload.uploadId] != nil) {
            [weakSelf.progressStates removeObjectForKey:_upload.uploadId];
        }
        [weakSelf sendEventWithName:ON_ERROR body:@{ @"uploadId": _upload.uploadId, @"error": RCTJSErrorFromNSError(error) }];
    };

    upload.progressBlock = ^(int64_t bytesWritten, int64_t bytesTotal) {
        NSDictionary *progressState = @{
            @"bytesWritten": [NSNumber numberWithLongLong: bytesWritten],
            @"bytesTotal": [NSNumber numberWithLongLong:bytesTotal]
        };
        [weakSelf.progressStates setObject:progressState forKey:_upload.uploadId];
        
        if(weakSelf.progressNotificationScheduled == NO) {
            [weakSelf performSelector:@selector(sendProgressEvents) withObject:nil afterDelay:0.5];
            weakSelf.progressNotificationScheduled = YES;
        }
    };
}

- (dispatch_queue_t)methodQueue
{
    return dispatch_get_main_queue();
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;  // only do this if your module initialization relies on calling UIKit!
}

RCT_EXPORT_MODULE()


- (NSArray<NSString *> *)supportedEvents
{
    return @[ON_SUCCESS, ON_ERROR, ON_PROGRESS];
}

RCT_EXPORT_METHOD(createUpload:(NSString *)fileUrl
                  options:(NSDictionary *)options
                  onCreated:(RCTResponseSenderBlock)onCreatedCallback
                  )
{
    NSString *endpoint = [NSString stringWithString: options[@"endpoint"]];
    NSString *chunkSize = options[@"chunkSize"];
    NSDictionary *headers = options[@"headers"];
    NSDictionary *metadata = options[@"metadata"];

    TUSSession *session = [self sessionFor:endpoint];

    NSURL *url = [NSURL fileURLWithPath:[fileUrl hasPrefix:@"file://"]
      ? [fileUrl substringFromIndex:7]
      : fileUrl
    ];
    TUSResumableUpload *upload = [session createUploadFromFile:url retry:-1 headers:headers metadata:metadata];

    [self configureUpload:upload onEndpoint:endpoint withChunkSize:chunkSize];

    onCreatedCallback(@[upload.uploadId]);
}

RCT_EXPORT_METHOD(resume:(NSString *)uploadId onEndpoint:(NSString *)endpoint withChunkSize:(NSString *)chunkSize withCallback:(RCTResponseSenderBlock)callback)
{
    TUSResumableUpload *upload = [self restoreUpload:uploadId onEndpoint:endpoint withChunkSize:chunkSize];
    if(upload == nil) {
      callback(@[@NO]);
      return;
    }
    [upload resume];
    callback(@[@YES]);
}

RCT_EXPORT_METHOD(abort:(NSString *)uploadId onEndpoint:(NSString *)endpoint withChunkSize:(NSString *)chunkSize withCallback:(RCTResponseSenderBlock)callback)
{
    TUSResumableUpload *upload = [self restoreUpload:uploadId onEndpoint:endpoint withChunkSize:chunkSize];
    if(upload != nil) {
      [upload stop];
    }
    callback(@[]);
}

@end
