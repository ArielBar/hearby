import { Platform, NativeModules } from 'react-native';

/**
 * Environment configuration
 * Uses React Native's built-in __DEV__ flag (true in debug, false in release builds)
 *
 * DEV_LAN_IP: Your Mac's local network IP for physical device testing.
 * Find it with: ipconfig getifaddr en0
 */
const DEV_LAN_IP = '192.168.1.192';

function getDevApiHost(): string {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000/api';
  }

  // Use the Metro bundler host if available (works for both simulator and device)
  const scriptURL =
    NativeModules.SourceCode?.scriptURL ??
    NativeModules.SourceCode?.getConstants?.()?.scriptURL;

  if (scriptURL) {
    const match = scriptURL.match(/^https?:\/\/([^:]+)/);
    if (match?.[1]) {
      return `http://${match[1]}:3000/api`;
    }
  }

  // Fallback: use LAN IP (works on physical device)
  return `http://${DEV_LAN_IP}:3000/api`;
}

const PROD_API_URL = 'https://hear-by.com/api';

export const ENV = {
  API_URL: PROD_API_URL,
  ENV_NAME: __DEV__ ? 'development' : 'production',
  IS_DEV: __DEV__,
} as const;
