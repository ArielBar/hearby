/**
 * Feature Flags — hard-coded toggles for monetization features.
 * Set to `true` to enable, `false` to disable entirely.
 */
export const FeatureFlags = {
  /** Controls AdMob rewarded ads before audio playback */
  ENABLE_ADS: false,

  /** Controls RevenueCat in-app purchases and the paywall */
  ENABLE_PURCHASES: false,
} as const;
