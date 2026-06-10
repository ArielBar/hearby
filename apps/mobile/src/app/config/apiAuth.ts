import HmacSHA256 from 'crypto-js/hmac-sha256';
import Hex from 'crypto-js/enc-hex';

/**
 * API Authentication — HMAC-signed requests.
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

// Obfuscated secret — XOR-encoded so it's not a plain string in the bundle.
// The actual secret is "hb_prod_s3cr3t_2024_m0b1l3" XOR'd with key "hearby"
const _o = [
  0x00, 0x07, 0x3e, 0x02, 0x10, 0x16, 0x0c, 0x3a, 0x12, 0x41, 0x01, 0x0b,
  0x5b, 0x11, 0x3e, 0x40, 0x52, 0x4b, 0x5c, 0x3a, 0x0c, 0x42, 0x00, 0x48,
  0x04, 0x56,
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

/**
 * Generate signed headers for an API request.
 * @param path - The API path (e.g., "/api/search/geocode")
 */
export function getSignedHeaders(path: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}:${path}`;
  const signature = HmacSHA256(message, getSecret()).toString(Hex);

  return {
    'X-Hearby-Timestamp': timestamp,
    'X-Hearby-Signature': signature,
  };
}
