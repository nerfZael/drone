import crypto from 'node:crypto';
import {
  providerCredentialEnvelopeSigningText,
  type ProviderCredentialEnvelope,
  type ProviderCredentialId,
  type ProviderCredentialRequest,
} from '@drone/device-protocol';
import { verifyDeviceText } from '../../device-identity';

export type { ProviderCredentialEnvelope, ProviderCredentialId, ProviderCredentialRequest };

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

function p256PublicKey(value: unknown): crypto.KeyObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('recipient encryption key is required'), {
      code: 'INVALID_REQUEST',
    });
  const key = value as JsonWebKey;
  if (key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y)
    throw Object.assign(new Error('recipient encryption key must be P-256'), {
      code: 'INVALID_REQUEST',
    });
  try {
    return crypto.createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y },
      format: 'jwk',
    });
  } catch {
    throw Object.assign(new Error('recipient encryption key is invalid'), {
      code: 'INVALID_REQUEST',
    });
  }
}

export function createProviderCredentialRequest(): {
  request: ProviderCredentialRequest;
  privateKey: crypto.KeyObject;
} {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    request: {
      version: 1,
      transferId: crypto.randomUUID(),
      recipientPublicKey: pair.publicKey.export({ format: 'jwk' }),
    },
    privateKey: pair.privateKey,
  };
}

export function sealProviderCredential(input: {
  request: ProviderCredentialRequest;
  credential: ProviderCredentialId;
  plaintext: string;
  senderDeviceId: string;
  recipientDeviceId: string;
}): Omit<ProviderCredentialEnvelope, 'signature'> {
  if (input.request.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.request.transferId))
    throw Object.assign(new Error('credential transfer request is invalid'), {
      code: 'INVALID_REQUEST',
    });
  if (Buffer.byteLength(input.plaintext) > 128 * 1024)
    throw Object.assign(new Error('credential payload is too large'), {
      code: 'CREDENTIAL_TOO_LARGE',
    });
  const recipientPublicKey = p256PublicKey(input.request.recipientPublicKey);
  const sender = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const sharedSecret = crypto.diffieHellman({
    privateKey: sender.privateKey,
    publicKey: recipientPublicKey,
  });
  const salt = crypto.randomBytes(32);
  const context = transferContext(
    input.request.transferId,
    input.senderDeviceId,
    input.recipientDeviceId,
    input.credential,
  );
  const key = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, context, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()]);
  return {
    version: 1,
    transferId: input.request.transferId,
    credential: input.credential,
    senderPublicKey: sender.publicKey.export({ format: 'jwk' }),
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

export function openProviderCredential(input: {
  envelope: ProviderCredentialEnvelope;
  privateKey: crypto.KeyObject;
  senderDeviceId: string;
  recipientDeviceId: string;
  senderIdentityPublicKey: JsonWebKey;
}): string {
  const envelope = input.envelope;
  if (envelope.version !== 1 || !envelope.transferId)
    throw new Error('credential envelope is invalid');
  const { signature, ...unsigned } = envelope;
  if (
    !verifyDeviceText(
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
  const sharedSecret = crypto.diffieHellman({
    privateKey: input.privateKey,
    publicKey: p256PublicKey(envelope.senderPublicKey),
  });
  const context = transferContext(
    envelope.transferId,
    input.senderDeviceId,
    input.recipientDeviceId,
    envelope.credential,
  );
  const key = Buffer.from(
    crypto.hkdfSync('sha256', sharedSecret, Buffer.from(envelope.salt, 'base64url'), context, 32),
  );
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
