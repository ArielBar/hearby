if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = (object, property) =>
    Object.prototype.hasOwnProperty.call(object, property);
}

const performanceNow =
  globalThis.nativePerformanceNow?.bind(globalThis) ?? Date.now;

if (!globalThis.performance) {
  globalThis.performance = {
    now: performanceNow,
  };
} else if (typeof globalThis.performance.now !== 'function') {
  globalThis.performance.now = performanceNow;
}

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket =
    require('react-native/Libraries/WebSocket/WebSocket').default;
}

const registerCallableModule =
  require('react-native/Libraries/Core/registerCallableModule').default;
const HMRClient = require('react-native/Libraries/Utilities/HMRClient').default;

registerCallableModule('HMRClient', HMRClient);

require('./src/main');
