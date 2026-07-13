import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
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
});
