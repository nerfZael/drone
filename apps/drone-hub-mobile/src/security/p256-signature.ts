import { p256 } from '@noble/curves/nist.js';
import { toByteArray } from 'base64-js';

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return toByteArray(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
}

export function verifyP256Signature(
  publicKey: JsonWebKey,
  text: string,
  signature: string,
): boolean {
  try {
    if (!publicKey.x || !publicKey.y) return false;
    const raw = new Uint8Array(65);
    raw[0] = 4;
    raw.set(base64UrlBytes(publicKey.x), 1);
    raw.set(base64UrlBytes(publicKey.y), 33);
    return p256.verify(base64UrlBytes(signature), new TextEncoder().encode(text), raw, {
      lowS: false,
    });
  } catch {
    return false;
  }
}
