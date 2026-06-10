import { AppRegistry } from 'react-native';
import App from './app/App';

// Test network connectivity (dev only)
if (__DEV__) {
  fetch('https://httpbin.org/get')
    .then((r) => console.log('[NET TEST] httpbin:', r.status))
    .catch((e) => console.error('[NET TEST] httpbin FAILED:', e.message));

  fetch('https://hear-by.com/api/search/nominatim?query=test&lang=en')
    .then((r) => console.log('[NET TEST] hear-by:', r.status))
    .catch((e) => console.error('[NET TEST] hear-by FAILED:', e.message));
}

AppRegistry.registerComponent('Mobile', () => App);
