#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

@interface HearbyTts : RCTEventEmitter <RCTBridgeModule, AVSpeechSynthesizerDelegate>
@property (nonatomic, strong) AVSpeechSynthesizer *synthesizer;
@property (nonatomic, strong) AVPlayer *audioPlayer;
@property (nonatomic, copy) NSString *defaultLanguage;
@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, assign) BOOL isStreamingAudio;
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
  return @[@"tts-finish", @"tts-cancel", @"tts-pause", @"tts-resume", @"tts-error", @"tts-start"];
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
    // Re-activate audio session before each utterance to handle interruptions
    NSError *sessionError = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    [session setCategory:AVAudioSessionCategoryPlayback
                    mode:AVAudioSessionModeDefault
                 options:AVAudioSessionCategoryOptionDuckOthers
                   error:&sessionError];
    [session setActive:YES error:&sessionError];
    if (sessionError) {
      NSLog(@"[HearbyTts] Audio session activation failed: %@", sessionError);
    }

    if (self.synthesizer.isSpeaking) {
      [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }

    // Workaround: iOS bug where AVSpeechSynthesizer silently fails after stop.
    // Recreating the instance ensures a clean state for each new utterance.
    self.synthesizer = [[AVSpeechSynthesizer alloc] init];
    self.synthesizer.delegate = self;

    AVSpeechUtterance *utterance = [[AVSpeechUtterance alloc] initWithString:text];

    // Select the most natural-sounding voice available for the language
    AVSpeechSynthesisVoice *voice = [self bestVoiceForLanguage:self.defaultLanguage];
    utterance.voice = voice;
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.88;
    utterance.pitchMultiplier = 1.05;
    utterance.preUtteranceDelay = 0.1;
    utterance.postUtteranceDelay = 0.05;

    if (self.hasListeners) {
      [self sendEventWithName:@"tts-start" body:@{@"language": self.defaultLanguage}];
    }
    [self.synthesizer speakUtterance:utterance];
  });
}

// Select highest quality voice: premium > enhanced > default
- (AVSpeechSynthesisVoice *)bestVoiceForLanguage:(NSString *)language {
  NSArray<AVSpeechSynthesisVoice *> *allVoices = [AVSpeechSynthesisVoice speechVoices];
  
  AVSpeechSynthesisVoice *premiumVoice = nil;
  AVSpeechSynthesisVoice *enhancedVoice = nil;
  AVSpeechSynthesisVoice *defaultVoice = nil;

  for (AVSpeechSynthesisVoice *v in allVoices) {
    if (![v.language hasPrefix:[language substringToIndex:MIN(2, language.length)]]) {
      continue;
    }
    // Prefer exact language match (e.g., he-IL over he)
    BOOL exactMatch = [v.language.lowercaseString isEqualToString:language.lowercaseString];
    
    if (v.quality == AVSpeechSynthesisVoiceQualityPremium) {
      if (!premiumVoice || exactMatch) premiumVoice = v;
    } else if (v.quality == AVSpeechSynthesisVoiceQualityEnhanced) {
      if (!enhancedVoice || exactMatch) enhancedVoice = v;
    } else {
      if (!defaultVoice || exactMatch) defaultVoice = v;
    }
  }

  AVSpeechSynthesisVoice *best = premiumVoice ?: enhancedVoice ?: defaultVoice;
  if (best) {
    NSLog(@"[HearbyTts] Using voice: %@ (quality: %ld)", best.name, (long)best.quality);
    return best;
  }

  // Final fallback
  return [AVSpeechSynthesisVoice voiceWithLanguage:language]
    ?: [AVSpeechSynthesisVoice voiceWithLanguage:@"en-US"];
}

RCT_EXPORT_METHOD(playAudioFromURL:(NSString *)urlString) {
  dispatch_async(dispatch_get_main_queue(), ^{
    // Stop any existing playback
    if (self.synthesizer.isSpeaking) {
      [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
    if (self.audioPlayer) {
      [self.audioPlayer pause];
      self.audioPlayer = nil;
    }

    NSURL *url = [NSURL URLWithString:urlString];
    if (!url) {
      if (self.hasListeners) {
        [self sendEventWithName:@"tts-error" body:@{@"message": @"Invalid audio URL"}];
      }
      return;
    }

    self.isStreamingAudio = YES;
    AVPlayerItem *item = [AVPlayerItem playerItemWithURL:url];
    self.audioPlayer = [AVPlayer playerWithPlayerItem:item];

    // Observe when playback finishes
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(audioDidFinishPlaying:)
                                                 name:AVPlayerItemDidPlayToEndTimeNotification
                                               object:item];
    // Observe playback failure
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(audioDidFailPlaying:)
                                                 name:AVPlayerItemFailedToPlayToEndTimeNotification
                                               object:item];

    if (self.hasListeners) {
      [self sendEventWithName:@"tts-start" body:@{@"mode": @"streaming"}];
    }
    [self.audioPlayer play];
  });
}

- (void)audioDidFinishPlaying:(NSNotification *)notification {
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:AVPlayerItemDidPlayToEndTimeNotification
                                                object:notification.object];
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:AVPlayerItemFailedToPlayToEndTimeNotification
                                                object:notification.object];
  self.isStreamingAudio = NO;
  if (self.hasListeners) {
    [self sendEventWithName:@"tts-finish" body:nil];
  }
}

- (void)audioDidFailPlaying:(NSNotification *)notification {
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:AVPlayerItemDidPlayToEndTimeNotification
                                                object:notification.object];
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:AVPlayerItemFailedToPlayToEndTimeNotification
                                                object:notification.object];
  self.isStreamingAudio = NO;
  if (self.hasListeners) {
    [self sendEventWithName:@"tts-error" body:@{@"message": @"Streaming playback failed"}];
  }
}

RCT_EXPORT_METHOD(stop) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.isStreamingAudio && self.audioPlayer) {
      [self.audioPlayer pause];
      self.audioPlayer = nil;
      self.isStreamingAudio = NO;
      if (self.hasListeners) {
        [self sendEventWithName:@"tts-cancel" body:nil];
      }
    } else if (self.synthesizer.isSpeaking) {
      [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
  });
}

RCT_EXPORT_METHOD(pause) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.isStreamingAudio && self.audioPlayer) {
      [self.audioPlayer pause];
      if (self.hasListeners) {
        [self sendEventWithName:@"tts-pause" body:nil];
      }
    } else if (self.synthesizer.isSpeaking) {
      [self.synthesizer pauseSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
  });
}

RCT_EXPORT_METHOD(resume) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.isStreamingAudio && self.audioPlayer) {
      [self.audioPlayer play];
      if (self.hasListeners) {
        [self sendEventWithName:@"tts-resume" body:nil];
      }
    } else if (self.synthesizer.isPaused) {
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
