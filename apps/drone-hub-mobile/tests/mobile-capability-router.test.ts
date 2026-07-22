import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';
import { fromByteArray } from 'base64-js';
import {
  capabilityRequestSigningText,
  DRONE_CONTROL_CAPABILITY,
  type MeshDevice,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { MobileCapabilityRouter } from '../src/mesh/mobile-capability-router';
import type { MobileDeviceIdentity } from '../src/security/device-identity';

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function identity(id: string, seed: number): MobileDeviceIdentity {
  const privateKey = p256.utils.randomSecretKey(new Uint8Array(48).fill(seed));
  const publicBytes = p256.getPublicKey(privateKey, false);
  return {
    id,
    name: id,
    platform: 'android',
    publicKey: {
      crv: 'P-256',
      ext: true,
      key_ops: ['verify'],
      kty: 'EC',
      x: base64Url(publicBytes.slice(1, 33)),
      y: base64Url(publicBytes.slice(33, 65)),
    },
    async sign(text) {
      return base64Url(p256.sign(encoder.encode(text), privateKey));
    },
  };
}

function member(
  source: MobileDeviceIdentity,
  administrator: boolean,
  grants: MeshDevice['grants'] = [],
): MeshDevice {
  return {
    id: source.id,
    name: source.name,
    platform: 'desktop',
    publicKey: source.publicKey,
    administrator,
    grants,
    endpoints: [],
    revokedAt: null,
    addedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

async function request(
  source: MobileDeviceIdentity,
  targetDeviceId: string,
  overrides: Partial<SignedCapabilityRequest> = {},
): Promise<SignedCapabilityRequest> {
  const now = new Date();
  const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
    type: 'capability.request',
    version: 1,
    requestId: 'request-1',
    sourceDeviceId: source.id,
    targetDeviceId,
    capability: 'drone-control',
    capabilityVersion: 1,
    operation: 'drones.list',
    payload: {},
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    nonce: 'nonce-1',
    maxHops: 1,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'signature'),
    ),
  } as Omit<SignedCapabilityRequest, 'signature'>;
  return {
    ...unsigned,
    signature: overrides.signature ?? (await source.sign(capabilityRequestSigningText(unsigned))),
  };
}

describe('MobileCapabilityRouter', () => {
  test('dispatches a signed drone request from a paired administrator and caches its response', async () => {
    const phone = identity('device_phone', 3);
    const desktop = identity('device_desktop', 7);
    const devices = [member(desktop, true)];
    let invocations = 0;
    const router = new MobileCapabilityRouter(
      phone,
      () => devices,
      (id) =>
        id === 'drone-control'
          ? {
              descriptor: DRONE_CONTROL_CAPABILITY,
              invoke: async () => {
                invocations += 1;
                return { drones: [{ id: 'phone-drone' }] };
              },
            }
          : undefined,
    );
    const input = await request(desktop, phone.id);

    const first = await router.handle(input);
    const duplicate = await router.handle(input);
    const conflictingDuplicate = await router.handle(
      await request(desktop, phone.id, { payload: { changed: true }, nonce: 'nonce-2' }),
    );

    expect(first).toMatchObject({
      ok: true,
      sourceDeviceId: phone.id,
      targetDeviceId: desktop.id,
      result: { drones: [{ id: 'phone-drone' }] },
    });
    expect(duplicate).toEqual(first);
    expect(conflictingDuplicate).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_REQUEST_ID' },
    });
    expect(invocations).toBe(1);
  });

  test('rejects invalid signatures', async () => {
    const phone = identity('device_phone', 11);
    const desktop = identity('device_desktop', 13);
    const router = new MobileCapabilityRouter(
      phone,
      () => [member(desktop, true)],
      () => ({ descriptor: DRONE_CONTROL_CAPABILITY, invoke: async () => ({ drones: [] }) }),
    );

    expect(await router.handle(await request(desktop, phone.id, { signature: 'invalid' }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SIGNATURE' },
    });
  });

  test('does not expose phone drone control to a non-administrator without a grant', async () => {
    const phone = identity('device_phone', 17);
    const desktop = identity('device_desktop', 19);
    const router = new MobileCapabilityRouter(
      phone,
      () => [member(desktop, false)],
      () => ({ descriptor: DRONE_CONTROL_CAPABILITY, invoke: async () => ({ drones: [] }) }),
    );

    expect(await router.handle(await request(desktop, phone.id))).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
  });

  test('honors explicit phone capability grants for non-administrator devices', async () => {
    const phone = identity('device_phone', 31);
    const desktop = identity('device_desktop', 37);
    const granted = member(desktop, false, [
      { capability: 'drone-control', version: 1, operations: ['drones.list'] },
    ]);
    const router = new MobileCapabilityRouter(
      phone,
      () => [granted],
      () => ({ descriptor: DRONE_CONTROL_CAPABILITY, invoke: async () => ({ drones: [] }) }),
    );

    expect(await router.handle(await request(desktop, phone.id))).toMatchObject({ ok: true });
  });

  test('returns immediately when the phone capability has not registered yet', async () => {
    const phone = identity('device_phone', 23);
    const desktop = identity('device_desktop', 29);
    const router = new MobileCapabilityRouter(phone, () => [member(desktop, true)], () => undefined);

    expect(await router.handle(await request(desktop, phone.id))).toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_UNAVAILABLE' },
    });
  });
});
