import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';
import {
  DRONE_CONTROL_CAPABILITY,
  capabilityRequestSigningText,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { DeviceHttpChannel } from '../src/hub/device-mesh/device-http-channel';

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
      ws: {
        readyState: DeviceHttpChannel.OPEN,
        send: (value: string) => sent.push(JSON.parse(value)),
      },
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
      const cancellation = new AbortController();
      const invocationKey = `${phone.id}:cancellation-isolation`;
      (router as any).activeInvocations.set(invocationKey, {
        channel: connection.ws,
        controller: cancellation,
      });
      const cancel = Buffer.from(
        JSON.stringify({
          type: 'capability.cancel',
          sourceDeviceId: phone.id,
          targetDeviceId: desktop.id,
          requestId: 'cancellation-isolation',
        }),
      );
      await (router as any).onMessage({ ...connection, ws: { ...connection.ws } }, cancel);
      expect(cancellation.signal.aborted).toBe(false);
      await (router as any).onMessage(connection, cancel);
      expect(cancellation.signal.aborted).toBe(true);
      (router as any).activeInvocations.delete(invocationKey);
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

  test('replacing a relay connection cancels its direct and relayed transfer owners', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-router-lifecycle-'));
    const desktop = identity('desktop-a', 'desktop');
    const relay = identity('relay-a', 'phone');
    const source = identity('source-a', 'phone');
    const store = new DeviceMeshStore(path.join(root, 'state.json'), desktop);
    await store.read();
    await store.update((state) => {
      for (const device of [relay, source]) {
        state.devices[device.id] = {
          id: device.id,
          name: device.name,
          platform: device.platform,
          publicKey: device.publicKey,
          administrator: false,
          grants: [
            { capability: DRONE_CONTROL_CAPABILITY.id, version: 1, operations: ['files.list'] },
          ],
          endpoints: [],
          revokedAt: null,
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
    });
    const capabilities = new CapabilityRegistry();
    const disconnected: string[] = [];
    let invokedOperation = '';
    const started = Promise.withResolvers<void>();
    capabilities.register({
      descriptor: DRONE_CONTROL_CAPABILITY,
      async invoke(operation, _payload, context) {
        invokedOperation = operation;
        started.resolve();
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
          if (context.signal?.aborted) abort();
          else context.signal?.addEventListener('abort', abort, { once: true });
        });
      },
      disconnectDevice(deviceId) {
        disconnected.push(deviceId);
      },
    });
    const router = new DeviceMeshRouter(
      desktop,
      store,
      capabilities,
      new DeviceRouteManager(desktop, store),
      new DeviceMeshAuditStore(path.join(root, 'audit.json')),
    );
    class FakeSocket extends EventEmitter {
      readyState = DeviceHttpChannel.OPEN;
      bufferedAmount = 0;
      send(_value: string, callback?: (error?: Error) => void) {
        callback?.();
      }
      close() {
        this.readyState = 3;
        this.emit('close');
      }
    }
    const oldSocket = new FakeSocket();
    const nextSocket = new FakeSocket();
    const oldConnection = { peerDeviceId: relay.id, outbound: true, ws: oldSocket } as any;
    const nextConnection = { peerDeviceId: relay.id, outbound: true, ws: nextSocket } as any;
    (router as any).attach(oldConnection);
    const issuedAt = new Date();
    const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
      type: 'capability.request',
      version: 1,
      requestId: 'relayed-request',
      sourceDeviceId: source.id,
      targetDeviceId: desktop.id,
      capability: DRONE_CONTROL_CAPABILITY.id,
      capabilityVersion: 1,
      operation: 'files.list',
      payload: {},
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
      nonce: 'relayed-nonce',
      maxHops: 1,
    };
    const request = {
      ...unsigned,
      signature: signDeviceText(source, capabilityRequestSigningText(unsigned)),
    };
    try {
      const invocation = (router as any).onMessage(
        oldConnection,
        Buffer.from(JSON.stringify(request)),
      );
      await started.promise;
      expect(invokedOperation).toBe('files.list');
      expect([...oldConnection.capabilitySourceDeviceIds]).toEqual([source.id]);

      (router as any).attach(nextConnection);
      await invocation;

      expect(oldConnection.lifecycle.signal.aborted).toBe(true);
      expect(disconnected.filter((id) => id === relay.id)).toHaveLength(1);
      expect(disconnected.filter((id) => id === source.id)).toHaveLength(1);
      expect(oldConnection.capabilitySourceDeviceIds.size).toBe(0);
    } finally {
      router.close();
      await capabilities.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('keeps a transfer owner live until its last relay connection closes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-router-multi-route-'));
    const desktop = identity('desktop-a', 'desktop');
    const capabilities = new CapabilityRegistry();
    const disconnected: string[] = [];
    capabilities.register({
      descriptor: DRONE_CONTROL_CAPABILITY,
      async invoke() {
        return {};
      },
      disconnectDevice(deviceId) {
        disconnected.push(deviceId);
      },
    });
    const store = new DeviceMeshStore(path.join(root, 'state.json'), desktop);
    const router = new DeviceMeshRouter(
      desktop,
      store,
      capabilities,
      new DeviceRouteManager(desktop, store),
      new DeviceMeshAuditStore(path.join(root, 'audit.json')),
    );
    const sourceId = 'source-a';
    const relayA = {
      peerDeviceId: 'relay-a',
      outbound: true,
      ws: {} as WebSocket,
      lifecycle: new AbortController(),
      capabilitySourceDeviceIds: new Set([sourceId]),
    };
    const relayB = {
      peerDeviceId: 'relay-b',
      outbound: true,
      ws: {} as WebSocket,
      lifecycle: new AbortController(),
      capabilitySourceDeviceIds: new Set([sourceId]),
    };
    (router as any).capabilitySourceSockets.set(sourceId, new Set([relayA.ws, relayB.ws]));
    try {
      (router as any).cleanupConnectionCapabilities(relayA);
      expect(disconnected).toContain(relayA.peerDeviceId);
      expect(disconnected).not.toContain(sourceId);
      expect((router as any).capabilitySourceSockets.get(sourceId)).toEqual(new Set([relayB.ws]));

      (router as any).cleanupConnectionCapabilities(relayB);
      expect(disconnected).toContain(relayB.peerDeviceId);
      expect(disconnected.filter((id) => id === sourceId)).toHaveLength(1);
      expect((router as any).capabilitySourceSockets.has(sourceId)).toBe(false);
    } finally {
      router.close();
      await capabilities.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
