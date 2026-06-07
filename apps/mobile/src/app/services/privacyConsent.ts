import { Platform } from 'react-native';
import {
  getTrackingStatus,
  requestTrackingPermission,
  TrackingStatus,
} from 'react-native-tracking-transparency';
import mobileAds, { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import { FeatureFlags } from '../config/featureFlags';

/**
 * Handles all privacy consent flows required by Apple & Google before
 * initializing ads or tracking SDKs.
 *
 * Flow:
 * 1. Google UMP consent (GDPR / US privacy)
 * 2. iOS App Tracking Transparency (ATT)
 * 3. Initialize AdMob with appropriate consent status
 */
export async function requestPrivacyConsent(): Promise<void> {
  if (!FeatureFlags.ENABLE_ADS) return;

  try {
    // Step 1: Google UMP — required for GDPR (EU) and US privacy regulations
    const consentInfo = await AdsConsent.requestInfoUpdate();
    if (
      consentInfo.status === AdsConsentStatus.REQUIRED ||
      consentInfo.status === AdsConsentStatus.UNKNOWN
    ) {
      await AdsConsent.loadAndShowConsentFormIfRequired();
    }

    // Step 2: iOS ATT — required for iOS 14.5+
    if (Platform.OS === 'ios') {
      const trackingStatus = await getTrackingStatus();
      if (trackingStatus === 'not-determined') {
        await requestTrackingPermission();
      }
    }

    // Step 3: Initialize Mobile Ads SDK after consent is resolved
    await mobileAds().initialize();
  } catch (error) {
    console.warn('[PrivacyConsent] Error during consent flow:', error);
    // Still attempt to init ads with non-personalized fallback
    try {
      await mobileAds().initialize();
    } catch (_) {}
  }
}

/**
 * Returns whether the user has granted tracking permission (iOS) or
 * consent (Android via UMP). Use this to decide personalized vs
 * non-personalized ads.
 */
export async function canShowPersonalizedAds(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status: TrackingStatus = await getTrackingStatus();
    return status === 'authorized';
  }
  // Android: check UMP consent status
  const consentInfo = await AdsConsent.requestInfoUpdate();
  return consentInfo.status === AdsConsentStatus.OBTAINED;
}
