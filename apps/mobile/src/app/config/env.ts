import { Platform } from 'react-native';

/**
 * Environment configuration
 * Uses React Native's built-in __DEV__ flag (true in debug, false in release builds)
 *
 * For physical device dev, update DEV_API_HOST to your Mac's LAN IP.
 */

const DEV_API_HOST = Platform.OS === 'android'
  ? 'http://10.0.2.2:3000/api'
  : 'http://localhost:3000/api';

const PROD_API_URL = 'https://hear-by.com/api';

export const ENV = {
  API_URL: __DEV__ ? DEV_API_HOST : PROD_API_URL,
  ENV_NAME: __DEV__ ? 'development' : 'production',
  IS_DEV: __DEV__,
} as const;
