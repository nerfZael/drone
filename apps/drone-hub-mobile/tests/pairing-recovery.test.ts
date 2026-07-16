import { describe, expect, test } from 'bun:test';
import type { MeshDevice, PairingPayload } from '@drone/device-protocol';
import { assertKnownRecoveryTarget } from '../src/mesh/pairing-recovery';
import type { MeshProfile } from '../src/mesh/mesh-storage';

function device(id: string, revokedAt: string | null = null): MeshDevice {
  return {
    id,
    name: id,
    platform: 'desktop',
    publicKey: {},
    administrator: false,
    grants: [],
    endpoints: [],
    revokedAt,
    addedAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  };
}

const payload: PairingPayload = {
  version: 1,
  endpoint: 'https://hub.example.test',
  token: 'pairing-token',
  inviterDeviceId: 'device_desktop',
  expiresAt: '2026-07-16T18:00:00.000Z',
};

function profile(devices: MeshDevice[]): MeshProfile {
  return {
    networkId: 'network_current',
    devices,
    connections: [],
    capabilitiesByDevice: {},
  };
}

describe('pairing recovery target validation', () => {
  test('allows first enrollment and recovery through a known active device', () => {
    expect(() => assertKnownRecoveryTarget(payload, null)).not.toThrow();
    expect(() =>
      assertKnownRecoveryTarget(payload, profile([device('device_desktop')])),
    ).not.toThrow();
  });

  test('rejects unknown and revoked inviters before consuming their invitation', () => {
    expect(() => assertKnownRecoveryTarget(payload, profile([device('device_other')]))).toThrow(
      'not from a device in your current mesh',
    );
    expect(() =>
      assertKnownRecoveryTarget(
        payload,
        profile([device('device_desktop', '2026-07-16T12:00:00.000Z')]),
      ),
    ).toThrow('not from a device in your current mesh');
  });
});
