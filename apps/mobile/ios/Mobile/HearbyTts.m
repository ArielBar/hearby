#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

@interface HearbyTts : RCTEventEmitter <RCTBridgeModule, AVSpeechSynthesizerDelegate>
@property (nonatomic, strong) AVSpeechSynthesizer *synthesizer;
@property (nonatomic, copy) NSString *defaultLanguage;
@property (nonatomic, assign) BOOL hasListeners;
@end

@implementation HearbyTts

RCT_EXPORT_MODULE();

- (instancetype)init {
  self = [super init];
  if (self) {
    _synthesizer = [[AVSpeechSynthesizer alloc] init];
    _synthesizer.delegate = self;
    _defaultLanguage = @"he-IL";
    _hasListeners = NO;

    // Configure audio session to ignore silent switch
    NSError *error = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    [session setCategory:AVAudioSessionCategoryPlayback
                    mode:AVAudioSessionModeDefault
                 options:AVAudioSessionCategoryOptionDuckOthers
                   error:&error];
    [session setActive:YES error:&error];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[@"tts-finish", @"tts-cancel", @"tts-pause", @"tts-resume"];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

RCT_EXPORT_METHOD(setLanguage:(NSString *)language) {
  self.defaultLanguage = language;
}

RCT_EXPORT_METHOD(activateAudioSession) {
  NSError *error = nil;
  AVAudioSession *session = [AVAudioSession sharedInstance];
  [session setCategory:AVAudioSessionCategoryPlayback
                  mode:AVAudioSessionModeDefault
               options:AVAudioSessionCategoryOptionDuckOthers
                 error:&error];
  [session setActive:YES error:&error];
}

RCT_EXPORT_METHOD(speak:(NSString *)text) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.synthesizer.isSpeaking) {
      [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
    AVSpeechUtterance *utterance = [[AVSpeechUtterance alloc] initWithString:text];
    utterance.voice = [AVSpeechSynthesisVoice voiceWithLanguage:self.defaultLanguage];
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.85;
    [self.synthesizer speakUtterance:utterance];
  });
}

RCT_EXPORT_METHOD(stop) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.synthesizer.isSpeaking) {
      [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
  });
}

RCT_EXPORT_METHOD(pause) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.synthesizer.isSpeaking) {
      [self.synthesizer pauseSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
  });
}

RCT_EXPORT_METHOD(resume) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.synthesizer.isPaused) {
      [self.synthesizer continueSpeaking];
    }
  });
}

#pragma mark - AVSpeechSynthesizerDelegate

- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didFinishSpeechUtterance:(AVSpeechUtterance *)utterance {
  if (self.hasListeners) {
    [self sendEventWithName:@"tts-finish" body:nil];
  }
}

- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didCancelSpeechUtterance:(AVSpeechUtterance *)utterance {
  if (self.hasListeners) {
    [self sendEventWithName:@"tts-cancel" body:nil];
  }
}

- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didPauseSpeechUtterance:(AVSpeechUtterance *)utterance {
  if (self.hasListeners) {
    [self sendEventWithName:@"tts-pause" body:nil];
  }
}

- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didContinueSpeechUtterance:(AVSpeechUtterance *)utterance {
  if (self.hasListeners) {
    [self sendEventWithName:@"tts-resume" body:nil];
  }
}

@end
