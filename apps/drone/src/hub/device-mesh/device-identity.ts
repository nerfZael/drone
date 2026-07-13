import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalJson,
  socketAuthSigningText,
  type DevicePublicIdentity,
} from '@drone/device-protocol';

export type LocalDeviceIdentity = DevicePublicIdentity & {
  privateKey: crypto.KeyObject;
};

export function deviceIdForPublicKey(publicKey: JsonWebKey): string {
  return `device_${crypto
    .createHash('sha256')
    .update(
      canonicalJson({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x, y: publicKey.y }),
    )
    .digest('base64url')
    .slice(0, 24)}`;
}

export async function loadOrCreateDeviceIdentity(rootDir: string): Promise<LocalDeviceIdentity> {
  const privateKeyPath = path.join(rootDir, 'identity-private.pem');
  await fs.mkdir(rootDir, { recursive: true });
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey(await fs.readFile(privateKeyPath, 'utf8'));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    privateKey = pair.privateKey;
    await fs.writeFile(
      privateKeyPath,
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      { mode: 0o600 },
    );
  }
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  return {
    id: deviceIdForPublicKey(publicKey),
    name: os.hostname() || 'Drone Hub',
    platform: process.platform === 'linux' ? 'server' : 'desktop',
    publicKey,
    privateKey,
  };
}

export function signDeviceText(identity: LocalDeviceIdentity, text: string): string {
  return crypto
    .sign('sha256', Buffer.from(text), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
}

export function signSocketChallenge(identity: LocalDeviceIdentity, nonce: string): string {
  return signDeviceText(identity, socketAuthSigningText(identity.id, nonce));
}

export function verifyDeviceText(publicKey: JsonWebKey, text: string, signature: string): boolean {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(text),
      {
        key: crypto.createPublicKey({ key: publicKey as crypto.JsonWebKey, format: 'jwk' }),
        dsaEncoding: 'ieee-p1363',
      },
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}
