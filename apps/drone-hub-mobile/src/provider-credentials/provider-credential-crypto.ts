import * as Crypto from 'expo-crypto';
import {
  providerCredentialEnvelopeSigningText,
  type ProviderCredentialEnvelope,
  type ProviderCredentialId,
} from '@drone/device-protocol';
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromByteArray, toByteArray } from 'base64-js';
import { verifyP256Signature } from '../security/device-identity';

export type { ProviderCredentialId };

function base64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return toByteArray(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
}

function publicKeyBytes(key: JsonWebKey): Uint8Array {
  if (key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y)
    throw new Error('credential envelope has an invalid sender key');
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  bytes.set(base64UrlBytes(key.x), 1);
  bytes.set(base64UrlBytes(key.y), 33);
  return bytes;
}

function transferContext(
  transferId: string,
  senderDeviceId: string,
  recipientDeviceId: string,
  credential: ProviderCredentialId,
): string {
  return [
    'drone-provider-credential-v1',
    transferId,
    senderDeviceId,
    recipientDeviceId,
    credential,
  ].join('\n');
}

export async function createProviderCredentialRequest() {
  const privateKey = p256.utils.randomSecretKey(await Crypto.getRandomBytesAsync(48));
  const publicBytes = p256.getPublicKey(privateKey, false);
  return {
    privateKey,
    request: {
      version: 1 as const,
      transferId: Crypto.randomUUID(),
      recipientPublicKey: {
        kty: 'EC',
        crv: 'P-256',
        ext: true,
        x: base64Url(publicBytes.slice(1, 33)),
        y: base64Url(publicBytes.slice(33, 65)),
      } satisfies JsonWebKey,
    },
  };
}

export async function openProviderCredential(input: {
  envelope: ProviderCredentialEnvelope;
  privateKey: Uint8Array;
  transferId: string;
  credential: ProviderCredentialId;
  senderDeviceId: string;
  recipientDeviceId: string;
  senderIdentityPublicKey: JsonWebKey;
}): Promise<string> {
  const { envelope } = input;
  if (
    envelope.version !== 1 ||
    envelope.transferId !== input.transferId ||
    envelope.credential !== input.credential
  )
    throw new Error('credential envelope does not match this request');
  const { signature, ...unsigned } = envelope;
  if (
    !verifyP256Signature(
      input.senderIdentityPublicKey,
      providerCredentialEnvelopeSigningText(
        unsigned,
        input.senderDeviceId,
        input.recipientDeviceId,
      ),
      signature,
    )
  )
    throw new Error('credential envelope signature is invalid');
  const sharedPoint = p256.getSharedSecret(
    input.privateKey,
    publicKeyBytes(envelope.senderPublicKey),
  );
  const context = transferContext(
    envelope.transferId,
    input.senderDeviceId,
    input.recipientDeviceId,
    envelope.credential,
  );
  const keyBytes = hkdf(
    sha256,
    sharedPoint.slice(1),
    base64UrlBytes(envelope.salt),
    new TextEncoder().encode(context),
    32,
  );
  const key = await Crypto.AESEncryptionKey.import(keyBytes);
  const sealed = Crypto.AESSealedData.fromParts(
    base64UrlBytes(envelope.iv),
    base64UrlBytes(envelope.ciphertext),
    base64UrlBytes(envelope.tag),
  );
  const plaintext = await Crypto.aesDecryptAsync(sealed, key, {
    additionalData: new TextEncoder().encode(context),
  });
  return new TextDecoder().decode(plaintext);
}
