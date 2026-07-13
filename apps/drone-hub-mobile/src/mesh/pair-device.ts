import * as Crypto from 'expo-crypto';
import {
  parsePairingPayload,
  type PairingApproval,
  type PairingPayload,
} from '@drone/device-protocol';
import type { MobileDeviceIdentity } from '../security/device-identity';

async function responseJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error ?? `Pairing failed (${response.status})`));
  return body;
}

export function readPairingCode(value: string): PairingPayload {
  return parsePairingPayload(JSON.parse(value));
}

export async function claimPairing(
  payload: PairingPayload,
  identity: MobileDeviceIdentity,
): Promise<{
  pendingId: string;
  claimSecret: string;
}> {
  const claimSecret = Crypto.getRandomBytes(32).reduce(
    (text, byte) => `${text}${byte.toString(16).padStart(2, '0')}`,
    '',
  );
  const response = await fetch(`${payload.endpoint}/api/device-mesh/invitations/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: payload.token, claimSecret, device: identity }),
  });
  const body = await responseJson(response);
  return { pendingId: String(body.pendingId), claimSecret };
}

export async function waitForPairingApproval(
  payload: PairingPayload,
  pendingId: string,
  claimSecret: string,
  signal: AbortSignal,
): Promise<PairingApproval> {
  while (!signal.aborted) {
    const url = `${payload.endpoint}/api/device-mesh/invitations/${encodeURIComponent(pendingId)}/status?claimSecret=${encodeURIComponent(claimSecret)}`;
    const body = await responseJson(await fetch(url, { signal }));
    if (body.status === 'approved') return body.approval as PairingApproval;
    if (body.status === 'rejected')
      throw new Error('The other device rejected this pairing request.');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Pairing cancelled'));
        },
        { once: true },
      );
    });
  }
  throw new Error('Pairing cancelled');
}
