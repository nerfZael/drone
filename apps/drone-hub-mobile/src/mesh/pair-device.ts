import * as Crypto from 'expo-crypto';
import {
  pairingClaimSigningText,
  parsePairingPayload,
  type PairingClaim,
  type PairingApproval,
  type PairingPayload,
} from '@drone/device-protocol';
import type { MobileDeviceIdentity } from '../security/device-identity';
import { mobileDeviceIdForPublicKey } from '../security/device-identity';

async function responseJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error ?? `Pairing failed (${response.status})`));
  return body;
}

export function readPairingCode(value: string): PairingPayload {
  return parsePairingPayload(JSON.parse(value));
}

function publicKey(value: unknown): JsonWebKey {
  if (!value || typeof value !== 'object') throw new Error('Pairing approval has an invalid key');
  const key = value as JsonWebKey;
  if (key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y)
    throw new Error('Pairing approval has an invalid key');
  return key;
}

export async function validatePairingApproval(
  payload: PairingPayload,
  approval: PairingApproval,
  identity: MobileDeviceIdentity,
): Promise<PairingApproval> {
  if (!approval || typeof approval !== 'object' || !String(approval.networkId ?? '').trim())
    throw new Error('Pairing approval is incomplete');
  if (String(approval.endpoint ?? '').replace(/\/+$/, '') !== payload.endpoint)
    throw new Error('Pairing approval returned a different endpoint');
  if (
    !Array.isArray(approval.devices) ||
    approval.devices.length === 0 ||
    approval.devices.length > 200
  )
    throw new Error('Pairing approval has an invalid device list');
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  for (const device of approval.devices) {
    const deviceId = String(device?.id ?? '');
    if (!deviceId || seen.has(deviceId)) throw new Error('Pairing approval has duplicate devices');
    if ((await mobileDeviceIdForPublicKey(publicKey(device.publicKey))) !== deviceId)
      throw new Error('Pairing approval device ID does not match its public key');
    const deviceName = String(device?.name ?? '')
      .trim()
      .toLowerCase();
    if (!deviceName || seenNames.has(deviceName))
      throw new Error('Pairing approval requires unique device names');
    seen.add(deviceId);
    seenNames.add(deviceName);
  }
  if (!seen.has(payload.inviterDeviceId))
    throw new Error('Pairing approval does not contain the inviting device');
  if (approval.device?.id !== identity.id || !seen.has(identity.id))
    throw new Error('Pairing approval was issued for a different phone');
  if (!Array.isArray(approval.capabilities)) approval.capabilities = [];
  return approval;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Pairing cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Pairing cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function claimPairing(
  payload: PairingPayload,
  identity: MobileDeviceIdentity,
  signal?: AbortSignal,
  discovered = false,
): Promise<{
  pendingId: string;
  claimSecret: string;
}> {
  const claimSecret = Crypto.getRandomBytes(32).reduce(
    (text, byte) => `${text}${byte.toString(16).padStart(2, '0')}`,
    '',
  );
  const unsignedClaim: Omit<PairingClaim, 'signature'> = {
    token: payload.token,
    claimSecret,
    inviterDeviceId: payload.inviterDeviceId,
    endpoint: payload.endpoint,
    expiresAt: payload.expiresAt,
    device: identity,
  };
  const response = await fetch(
    `${payload.endpoint}/api/device-mesh/${discovered ? 'pairing/request' : 'invitations/claim'}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      redirect: 'error',
      body: JSON.stringify({
        ...unsignedClaim,
        signature: await identity.sign(pairingClaimSigningText(unsignedClaim)),
      }),
    },
  );
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
    if (Date.now() >= Date.parse(payload.expiresAt))
      throw new Error('Pairing request expired. Find the Hub and request approval again.');
    const url = `${payload.endpoint}/api/device-mesh/invitations/${encodeURIComponent(pendingId)}/status?claimSecret=${encodeURIComponent(claimSecret)}`;
    const body = await responseJson(
      await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        redirect: 'error',
      }),
    );
    if (body.status === 'approved') return body.approval as PairingApproval;
    if (body.status === 'rejected')
      throw new Error('The other device rejected this pairing request.');
    await wait(2_000, signal);
  }
  throw new Error('Pairing cancelled');
}
