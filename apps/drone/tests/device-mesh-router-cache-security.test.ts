import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  DRONE_CONTROL_CAPABILITY,
  capabilityRequestSigningText,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { WebSocket } from 'ws';

import { CapabilityRegistry } from '../src/hub/device-mesh/capability-registry';
import { DeviceMeshAuditStore } from '../src/hub/device-mesh/device-mesh-audit-store';
import { DeviceMeshRouter } from '../src/hub/device-mesh/device-mesh-router';
import { DeviceMeshStore } from '../src/hub/device-mesh/device-mesh-store';
import { DeviceRouteManager } from '../src/hub/device-mesh/device-route-manager';
import { signDeviceText, type LocalDeviceIdentity } from '../src/hub/device-mesh/device-identity';

function identity(id: string, platform: 'desktop' | 'phone'): LocalDeviceIdentity {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    id,
    name: id,
    platform,
    publicKey: pair.publicKey.export({ format: 'jwk' }),
    privateKey: pair.privateKey,
  };
}

describe('device mesh router response replay', () => {
  test('revalidates an exact cached request and purges responses on disconnect', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-router-cache-'));
    const desktop = identity('desktop-a', 'desktop');
    const phone = identity('phone-a', 'phone');
    const store = new DeviceMeshStore(path.join(root, 'state.json'), desktop);
    await store.read();
    await store.update((state) => {
      state.devices[phone.id] = {
        id: phone.id,
        name: phone.name,
        platform: phone.platform,
        publicKey: phone.publicKey,
        administrator: false,
        grants: [
          { capability: DRONE_CONTROL_CAPABILITY.id, version: 1, operations: ['drones.list'] },
        ],
        endpoints: [],
        revokedAt: null,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    const capabilities = new CapabilityRegistry();
    let invokes = 0;
    let disconnects = 0;
    capabilities.register({
      descriptor: DRONE_CONTROL_CAPABILITY,
      async invoke() {
        invokes += 1;
        return { drones: [] };
      },
      disconnectDevice() {
        disconnects += 1;
      },
    });
    const router = new DeviceMeshRouter(
      desktop,
      store,
      capabilities,
      new DeviceRouteManager(desktop, store),
      new DeviceMeshAuditStore(path.join(root, 'audit.json')),
    );
    const sent: any[] = [];
    const connection = {
      peerDeviceId: phone.id,
      outbound: false,
      ws: { readyState: WebSocket.OPEN, send: (value: string) => sent.push(JSON.parse(value)) },
    } as any;
    const issuedAt = new Date();
    const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
      type: 'capability.request',
      version: 1,
      requestId: 'request-one',
      sourceDeviceId: phone.id,
      targetDeviceId: desktop.id,
      capability: DRONE_CONTROL_CAPABILITY.id,
      capabilityVersion: 1,
      operation: 'drones.list',
      payload: {},
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
      nonce: 'nonce-one',
      maxHops: 1,
    };
    const request: SignedCapabilityRequest = {
      ...unsigned,
      signature: signDeviceText(phone, capabilityRequestSigningText(unsigned)),
    };
    try {
      await (router as any).onMessage(connection, Buffer.from(JSON.stringify(request)));
      await (router as any).onMessage(connection, Buffer.from(JSON.stringify(request)));
      expect(invokes).toBe(1);
      expect(sent.at(-1)).toMatchObject({ ok: true, result: { drones: [] } });

      await store.update((state) => {
        state.devices[phone.id].grants = [];
      });
      await (router as any).onMessage(connection, Buffer.from(JSON.stringify(request)));
      expect(invokes).toBe(1);
      expect(sent.at(-1)).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });

      await store.update((state) => {
        state.devices[phone.id].revokedAt = new Date().toISOString();
      });
      await (router as any).onMessage(connection, Buffer.from(JSON.stringify(request)));
      expect(invokes).toBe(1);
      expect(sent.at(-1)).toMatchObject({ ok: false, error: { code: 'DEVICE_REVOKED' } });

      expect((router as any).responses.size).toBe(1);
      router.disconnect(phone.id);
      expect((router as any).responses.size).toBe(0);
      expect(disconnects).toBe(1);
    } finally {
      router.close();
      await capabilities.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
