import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { p256 } from '@noble/curves/nist.js';
import { fromByteArray, toByteArray } from 'base64-js';
import { canonicalJson, type DevicePublicIdentity } from '@drone/device-protocol';

const PRIVATE_KEY_NAME = 'droneHub.devicePrivateKey.v1';
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return toByteArray(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array {
  return new Uint8Array(value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

async function readPrivateKey(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(PRIVATE_KEY_NAME);
  if (stored) {
    const key = hexToBytes(stored);
    if (p256.utils.isValidSecretKey(key)) return key;
  }
  const key = p256.utils.randomSecretKey(await Crypto.getRandomBytesAsync(48));
  await SecureStore.setItemAsync(PRIVATE_KEY_NAME, bytesToHex(key), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

export type MobileDeviceIdentity = DevicePublicIdentity & {
  sign(text: string): Promise<string>;
};

export async function mobileDeviceIdForPublicKey(publicKey: JsonWebKey): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalJson({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x, y: publicKey.y }),
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return `device_${digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 24)}`;
}

export async function loadDeviceIdentity(name = 'Android phone'): Promise<MobileDeviceIdentity> {
  const privateKey = await readPrivateKey();
  const publicBytes = p256.getPublicKey(privateKey, false);
  const publicKey: JsonWebKey = {
    crv: 'P-256',
    ext: true,
    key_ops: ['verify'],
    kty: 'EC',
    x: base64Url(publicBytes.slice(1, 33)),
    y: base64Url(publicBytes.slice(33, 65)),
  };
  const id = await mobileDeviceIdForPublicKey(publicKey);
  return {
    id,
    name,
    platform: 'android',
    publicKey,
    async sign(text) {
      return base64Url(p256.sign(encoder.encode(text), privateKey));
    },
  };
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
    return p256.verify(base64UrlBytes(signature), encoder.encode(text), raw);
  } catch {
    return false;
  }
}
