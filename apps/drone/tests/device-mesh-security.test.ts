import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  capabilityRequestSigningText,
  routeAnnouncementSigningText,
  socketServerAuthSigningText,
  type SignedCapabilityRequest,
  type SignedRouteAnnouncement,
} from '@drone/device-protocol';
import {
  signDeviceText,
  verifyDeviceText,
  type LocalDeviceIdentity,
} from '../src/hub/device-mesh/device-identity';
import { DeviceMeshStore } from '../src/hub/device-mesh/device-mesh-store';
import { DeviceRouteManager } from '../src/hub/device-mesh/device-route-manager';

function identity(id: string): LocalDeviceIdentity {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    id,
    name: id,
    platform: 'desktop',
    publicKey: pair.publicKey.export({ format: 'jwk' }),
    privateKey: pair.privateKey,
  };
}

describe('device mesh signatures', () => {
  test('bind a capability request to its target and operation', () => {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = pair.publicKey.export({ format: 'jwk' });
    const identity: LocalDeviceIdentity = {
      id: 'device_test',
      name: 'Test',
      platform: 'desktop',
      publicKey,
      privateKey: pair.privateKey,
    };
    const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
      type: 'capability.request',
      version: 1,
      requestId: 'request-1',
      sourceDeviceId: 'device_test',
      targetDeviceId: 'desktop',
      capability: 'drone-control',
      capabilityVersion: 1,
      operation: 'drones.list',
      payload: {},
      issuedAt: '2026-07-13T00:00:00.000Z',
      expiresAt: '2026-07-13T00:01:00.000Z',
      nonce: 'nonce-1',
      maxHops: 1,
    };
    const signature = signDeviceText(identity, capabilityRequestSigningText(unsigned));
    expect(verifyDeviceText(publicKey, capabilityRequestSigningText(unsigned), signature)).toBe(
      true,
    );
    expect(
      verifyDeviceText(
        publicKey,
        capabilityRequestSigningText({ ...unsigned, operation: 'drone.create.host' }),
        signature,
      ),
    ).toBe(false);
  });

  test('bind a route update to its endpoint and sequence', () => {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = pair.publicKey.export({ format: 'jwk' });
    const identity: LocalDeviceIdentity = {
      id: 'device_route',
      name: 'Route test',
      platform: 'server',
      publicKey,
      privateKey: pair.privateKey,
    };
    const route: Omit<SignedRouteAnnouncement, 'signature'> = {
      type: 'mesh.route',
      version: 1,
      deviceId: identity.id,
      sequence: 4,
      endpoint: 'https://new.example.test',
      announcedAt: '2026-07-13T00:00:00.000Z',
      expiresAt: '2026-07-20T00:00:00.000Z',
    };
    const signature = signDeviceText(identity, routeAnnouncementSigningText(route));
    expect(verifyDeviceText(publicKey, routeAnnouncementSigningText(route), signature)).toBe(true);
    expect(
      verifyDeviceText(
        publicKey,
        routeAnnouncementSigningText({ ...route, sequence: 3 }),
        signature,
      ),
    ).toBe(false);
  });

  test('requires the endpoint to prove the expected device identity', () => {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = pair.publicKey.export({ format: 'jwk' });
    const identity: LocalDeviceIdentity = {
      id: 'device_server',
      name: 'Server',
      platform: 'server',
      publicKey,
      privateKey: pair.privateKey,
    };
    const proof = socketServerAuthSigningText(identity.id, 'device_phone', 'nonce-1');
    const signature = signDeviceText(identity, proof);
    expect(verifyDeviceText(publicKey, proof, signature)).toBe(true);
    expect(
      verifyDeviceText(
        publicKey,
        socketServerAuthSigningText(identity.id, 'device_attacker', 'nonce-1'),
        signature,
      ),
    ).toBe(false);
  });

  test('rejects signed route updates with an excessive lifetime', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-route-test-'));
    try {
      const self = identity('device_self');
      const remote = identity('device_remote');
      const store = new DeviceMeshStore(path.join(directory, 'state.json'), self);
      await store.read();
      const now = new Date();
      await store.upsertDiscoveredDevice({
        id: remote.id,
        name: remote.name,
        platform: remote.platform,
        publicKey: remote.publicKey,
        administrator: false,
        grants: [],
        endpoints: [],
        revokedAt: null,
        addedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      const unsigned: Omit<SignedRouteAnnouncement, 'signature'> = {
        type: 'mesh.route',
        version: 1,
        deviceId: remote.id,
        sequence: 1,
        endpoint: 'https://remote.example.test',
        announcedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 8 * 24 * 60 * 60_000).toISOString(),
      };
      const route = {
        ...unsigned,
        signature: signDeviceText(remote, routeAnnouncementSigningText(unsigned)),
      };
      expect(await new DeviceRouteManager(self, store).accept(route)).toBe(false);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
