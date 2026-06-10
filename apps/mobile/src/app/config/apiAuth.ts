/**
 * API Authentication — HMAC-signed requests (zero dependencies).
 *
 * Instead of sending a static API key (easy to grep from binary),
 * we send a time-based HMAC signature that the backend verifies.
 *
 * Each request includes:
 *   X-Hearby-Timestamp: unix timestamp (seconds)
 *   X-Hearby-Signature: HMAC-SHA256(timestamp + ":" + path, secret)
 *
 * The backend verifies the signature and rejects requests with
 * timestamps older than 5 minutes (replay protection).
 */

// --- Pure JS SHA-256 + HMAC (no external dependencies) ---

function sha256(message: Uint8Array): Uint8Array {
  const K: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const msgLen = message.length;
  const bitLen = msgLen * 8;
  const padLen = (msgLen % 64 < 56 ? 56 : 120) - (msgLen % 64);
  const padded = new Uint8Array(msgLen + padLen + 8);
  padded.set(message);
  padded[msgLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(
    padded.length - 8,
    Math.floor(bitLen / 0x100000000),
    false,
  );

  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 =
        rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const result = new Uint8Array(32);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0, false);
  rv.setUint32(4, h1, false);
  rv.setUint32(8, h2, false);
  rv.setUint32(12, h3, false);
  rv.setUint32(16, h4, false);
  rv.setUint32(20, h5, false);
  rv.setUint32(24, h6, false);
  rv.setUint32(28, h7, false);
  return result;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let keyBlock = key;
  if (keyBlock.length > blockSize) {
    keyBlock = sha256(keyBlock);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(keyBlock);

  const ipad = new Uint8Array(blockSize + message.length);
  const opad = new Uint8Array(blockSize + 32);

  for (let i = 0; i < blockSize; i++) {
    ipad[i] = paddedKey[i] ^ 0x36;
    opad[i] = paddedKey[i] ^ 0x5c;
  }
  ipad.set(message, blockSize);
  const innerHash = sha256(ipad);
  opad.set(innerHash, blockSize);
  return sha256(opad);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function strToBytes(str: string): Uint8Array {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    arr[i] = str.charCodeAt(i);
  }
  return arr;
}

// --- Obfuscated secret (XOR-encoded, not a greppable plain string) ---

const _o = [
  0x0c, 0x53, 0x58, 0x13, 0x06, 0x1f, 0x5d, 0x04, 0x57, 0x13, 0x51, 0x41,
  0x5d, 0x57, 0x04, 0x11, 0x04, 0x4c, 0x58, 0x50, 0x56, 0x42, 0x55, 0x48,
  0x5d, 0x00, 0x56, 0x17, 0x54, 0x1c, 0x5e, 0x06, 0x59, 0x47, 0x54, 0x4f,
  0x5b, 0x00, 0x00, 0x43, 0x00, 0x4f, 0x58, 0x06, 0x56, 0x10, 0x52, 0x1d,
  0x5f, 0x5c, 0x07, 0x46, 0x56, 0x49, 0x51, 0x55, 0x04, 0x41, 0x52, 0x4b,
  0x0a, 0x04, 0x52, 0x16,
];
const _k = 'hearby';

function _d(): string {
  return _o
    .map((c, i) => String.fromCharCode(c ^ _k.charCodeAt(i % _k.length)))
    .join('');
}

let _cachedSecret: string | null = null;
function getSecret(): string {
  if (!_cachedSecret) {
    _cachedSecret = _d();
  }
  return _cachedSecret;
}

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@hearby_device_id';

// Stable device identifier persisted across app sessions
let _deviceId: string | null = null;
let _deviceIdPromise: Promise<string> | null = null;

function generateDeviceId(): string {
  return `${Platform.OS}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function loadOrCreateDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      _deviceId = stored;
      return stored;
    }
  } catch {
    // storage read failed, generate new
  }

  const newId = generateDeviceId();
  _deviceId = newId;
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
  } catch {
    // best effort persist
  }
  return newId;
}

function getDeviceId(): string {
  if (_deviceId) return _deviceId;
  // Kick off async load, return temporary sync ID for first request
  if (!_deviceIdPromise) {
    _deviceIdPromise = loadOrCreateDeviceId();
  }
  // Fallback for the very first call before async resolves
  _deviceId = generateDeviceId();
  _deviceIdPromise.then((id) => { _deviceId = id; });
  return _deviceId;
}

// Pre-load device ID at module init
_deviceIdPromise = loadOrCreateDeviceId();

/**
 * Generate signed headers for an API request.
 * @param path - The API path (e.g., "/pois/enrich")
 */
export function getSignedHeaders(path: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}:${path}`;
  const sig = hmacSha256(strToBytes(getSecret()), strToBytes(message));

  return {
    'X-Hearby-Timestamp': timestamp,
    'X-Hearby-Signature': toHex(sig),
    'X-Device-Id': getDeviceId(),
  };
}
