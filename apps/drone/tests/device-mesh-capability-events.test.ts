import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  capabilityEventSigningText,
  type CapabilityEvent,
  type CapabilityGrant,
} from '@drone/device-protocol';
import { WebSocket } from 'ws';

import { CapabilityRegistry } from '../src/hub/device-mesh/capability-registry';
import { DeviceMeshAuditStore } from '../src/hub/device-mesh/device-mesh-audit-store';
import { DeviceMeshHttp } from '../src/hub/device-mesh/device-mesh-http';
import { DeviceMeshRouter } from '../src/hub/device-mesh/device-mesh-router';
import { DeviceMeshStore } from '../src/hub/device-mesh/device-mesh-store';
import { DeviceRouteManager } from '../src/hub/device-mesh/device-route-manager';
import { signDeviceText, type LocalDeviceIdentity } from '../src/hub/device-mesh/device-identity';

type Harness = {
  root: string;
  identity: LocalDeviceIdentity;
  store: DeviceMeshStore;
  capabilities: CapabilityRegistry;
  audit: DeviceMeshAuditStore;
  router: DeviceMeshRouter;
};

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

async function harness(
  localIdentity: LocalDeviceIdentity,
  devices: LocalDeviceIdentity[],
  grants: Record<string, CapabilityGrant[]> = {},
): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-capability-event-'));
  const store = new DeviceMeshStore(path.join(root, 'state.json'), localIdentity);
  await store.read();
  await store.update((state) => {
    for (const device of devices) {
      if (device.id === localIdentity.id) continue;
      state.devices[device.id] = {
        id: device.id,
        name: device.name,
        platform: device.platform,
        publicKey: device.publicKey,
        administrator: true,
        grants: grants[device.id] ?? [],
        endpoints: [],
        revokedAt: null,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  });
  const capabilities = new CapabilityRegistry();
  const audit = new DeviceMeshAuditStore(path.join(root, 'audit.json'));
  const router = new DeviceMeshRouter(
    localIdentity,
    store,
    capabilities,
    new DeviceRouteManager(localIdentity, store),
    audit,
  );
  return { root, identity: localIdentity, store, capabilities, audit, router };
}

async function closeHarnesses(...items: Harness[]) {
  for (const item of items) {
    item.router.close();
    await item.capabilities.close();
    await fs.rm(item.root, { recursive: true, force: true });
  }
}

function signedEvent(
  source: LocalDeviceIdentity,
  targetDeviceId: string,
  input: { eventId?: string; event?: string; payload?: Record<string, any> } = {},
): CapabilityEvent {
  const issuedAt = new Date();
  const unsigned: Omit<CapabilityEvent, 'signature'> = {
    type: 'capability.event',
    version: 1,
    eventId: input.eventId ?? crypto.randomUUID(),
    sourceDeviceId: source.id,
    targetDeviceId,
    capability: 'drone-control',
    capabilityVersion: 1,
    event: input.event ?? 'drones.changed',
    payload: input.payload ?? { reason: 'registry_write' },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
    maxHops: 1,
  };
  return {
    ...unsigned,
    signature: signDeviceText(source, capabilityEventSigningText(unsigned)),
  };
}

function fakeSocket(sendValue: (value: string) => void = () => undefined) {
  return {
    readyState: WebSocket.OPEN,
    send: sendValue,
    close: () => undefined,
  } as any;
}

describe('device mesh capability events', () => {
  test('accepts only signed allowlisted bounded events and rate-limits an authenticated peer', async () => {
    const receiver = identity('receiver');
    const source = identity('source');
    const target = await harness(receiver, [receiver, source]);
    const closes: Array<[number, string]> = [];
    const connection = {
      peerDeviceId: source.id,
      outbound: false,
      ws: { ...fakeSocket(), close: (code: number, reason: string) => closes.push([code, reason]) },
    };
    const events: CapabilityEvent[] = [];
    target.router.subscribeCapabilityEvents((event) => events.push(event as CapabilityEvent));
    try {
      const duplicate = signedEvent(source, receiver.id);
      await (target.router as any).onMessage(connection, Buffer.from(JSON.stringify(duplicate)));
      await (target.router as any).onMessage(connection, Buffer.from(JSON.stringify(duplicate)));
      await (target.router as any).onMessage(
        connection,
        Buffer.from(
          JSON.stringify(signedEvent(source, receiver.id, { event: 'untrusted.changed' })),
        ),
      );
      await (target.router as any).onMessage(
        connection,
        Buffer.from(
          JSON.stringify(
            signedEvent(source, receiver.id, { payload: { text: 'x'.repeat(9 * 1024) } }),
          ),
        ),
      );
      const invalidSignature = signedEvent(source, receiver.id);
      invalidSignature.signature = 'invalid';
      await (target.router as any).onMessage(
        connection,
        Buffer.from(JSON.stringify(invalidSignature)),
      );
      for (let index = 0; index < 130; index += 1) {
        await (target.router as any).onMessage(
          connection,
          Buffer.from(
            JSON.stringify(signedEvent(source, receiver.id, { eventId: crypto.randomUUID() })),
          ),
        );
      }

      // Invalid envelopes consume only the transport budget. Valid signed events are limited
      // independently by their logical source and event policy.
      expect(events).toHaveLength(120);
      expect(events[0]?.eventId).toBe(duplicate.eventId);

      for (let index = 0; index < 466; index += 1) {
        await (target.router as any).onMessage(
          connection,
          Buffer.from(
            JSON.stringify({
              type: 'capability.event',
              sourceDeviceId: source.id,
              event: 'unknown',
            }),
          ),
        );
      }
      expect(closes).toEqual([[4008, 'capability event rate limit reached']]);
    } finally {
      await closeHarnesses(target);
    }
  });

  test('attributes relayed event rates to each signed source', async () => {
    const receiver = identity('receiver');
    const relay = identity('relay');
    const sourceA = identity('source-a');
    const sourceB = identity('source-b');
    const target = await harness(receiver, [receiver, relay, sourceA, sourceB]);
    const closes: Array<[number, string]> = [];
    const connection: any = {
      peerDeviceId: relay.id,
      outbound: false,
      ws: { ...fakeSocket(), close: (code: number, reason: string) => closes.push([code, reason]) },
    };
    const events: CapabilityEvent[] = [];
    target.router.subscribeCapabilityEvents((event) => events.push(event as CapabilityEvent));
    try {
      (target.router as any).capabilityEventSourceTimes.set(
        sourceA.id,
        Array.from({ length: 600 }, () => Date.now()),
      );
      await (target.router as any).onMessage(
        connection,
        Buffer.from(JSON.stringify(signedEvent(sourceA, receiver.id))),
      );
      await (target.router as any).onMessage(
        connection,
        Buffer.from(JSON.stringify(signedEvent(sourceB, receiver.id))),
      );

      expect(events.map((event) => event.sourceDeviceId)).toEqual([sourceB.id]);
      expect(closes).toEqual([]);
    } finally {
      await closeHarnesses(target);
    }
  });

  test('forwards one signed targeted hop without notifying the relay or unauthorized peers', async () => {
    const deviceA = identity('device-a');
    const deviceB = identity('device-b');
    const deviceC = identity('device-c');
    const grant = {
      capability: 'drone-control',
      version: 1,
      operations: ['chat.read'],
    } satisfies CapabilityGrant;
    const [a, b, c] = await Promise.all([
      harness(deviceA, [deviceA, deviceB, deviceC]),
      harness(deviceB, [deviceA, deviceB, deviceC]),
      harness(deviceC, [deviceA, deviceB, deviceC], { [deviceA.id]: [grant] }),
    ]);
    const pending: Promise<void>[] = [];
    const connectionAFromB: any = {
      peerDeviceId: deviceB.id,
      outbound: false,
      ws: null,
    };
    const connectionBFromA: any = {
      peerDeviceId: deviceA.id,
      outbound: true,
      ws: null,
    };
    connectionAFromB.ws = fakeSocket((value) => {
      pending.push((b.router as any).onMessage(connectionBFromA, Buffer.from(value)));
    });
    connectionBFromA.ws = fakeSocket((value) => {
      pending.push((a.router as any).onMessage(connectionAFromB, Buffer.from(value)));
    });
    const connectionBFromC: any = {
      peerDeviceId: deviceC.id,
      outbound: false,
      ws: null,
    };
    const connectionCFromB: any = {
      peerDeviceId: deviceB.id,
      outbound: true,
      ws: null,
    };
    connectionBFromC.ws = fakeSocket((value) => {
      pending.push((c.router as any).onMessage(connectionCFromB, Buffer.from(value)));
    });
    connectionCFromB.ws = fakeSocket((value) => {
      pending.push((b.router as any).onMessage(connectionBFromC, Buffer.from(value)));
    });
    (a.router as any).connections.set(deviceB.id, connectionAFromB);
    (b.router as any).connections.set(deviceA.id, connectionBFromA);
    (b.router as any).connections.set(deviceC.id, connectionBFromC);
    (c.router as any).connections.set(deviceB.id, connectionCFromB);
    const receivedA: CapabilityEvent[] = [];
    const receivedB: CapabilityEvent[] = [];
    a.router.subscribeCapabilityEvents((event) => receivedA.push(event as CapabilityEvent));
    b.router.subscribeCapabilityEvents((event) => receivedB.push(event as CapabilityEvent));
    try {
      await c.router.broadcastCapabilityEvent(
        'drone-control',
        'chat.changed',
        { droneId: 'drone', chatName: 'default', reason: 'canonical_history_changed' },
        'chat.read',
      );
      while (pending.length > 0) await Promise.all(pending.splice(0));

      expect(receivedA).toHaveLength(1);
      expect(receivedA[0]).toMatchObject({
        sourceDeviceId: deviceC.id,
        targetDeviceId: deviceA.id,
        event: 'chat.changed',
      });
      expect(receivedB).toEqual([]);

      await (b.router as any).onMessage(
        connectionBFromA,
        Buffer.from(JSON.stringify(receivedA[0])),
      );
      while (pending.length > 0) await Promise.all(pending.splice(0));
      expect(receivedA).toHaveLength(1);
    } finally {
      await closeHarnesses(a, b, c);
    }
  });

  test('fans out across authenticated relays, prefers direct delivery, and suppresses duplicates', async () => {
    const deviceA = identity('device-a');
    const deviceB = identity('old-relay-b');
    const deviceC = identity('device-c');
    const deviceD = identity('relay-d');
    const grant = {
      capability: 'drone-control',
      version: 1,
      operations: ['chat.read'],
    } satisfies CapabilityGrant;
    const [a, b, c, d] = await Promise.all([
      harness(deviceA, [deviceA, deviceB, deviceC, deviceD], { [deviceC.id]: [grant] }),
      harness(deviceB, [deviceA, deviceB, deviceC, deviceD]),
      harness(deviceC, [deviceA, deviceB, deviceC, deviceD]),
      harness(deviceD, [deviceA, deviceB, deviceC, deviceD]),
    ]);
    const pending: Promise<void>[] = [];
    let sendsToB = 0;
    let sendsToD = 0;
    const incoming = (router: DeviceMeshRouter, peerDeviceId: string) => ({
      peerDeviceId,
      outbound: false,
      ws: fakeSocket(),
    });
    const bFromA = incoming(b.router, deviceA.id);
    const dFromA = incoming(d.router, deviceA.id);
    const cFromB = incoming(c.router, deviceB.id);
    const cFromD = incoming(c.router, deviceD.id);
    (a.router as any).connections.set(deviceB.id, {
      peerDeviceId: deviceB.id,
      outbound: true,
      ws: fakeSocket((value) => {
        sendsToB += 1;
        // This simulates an older relay that authenticates but does not understand events.
        if (sendsToB > 1) pending.push((b.router as any).onMessage(bFromA, Buffer.from(value)));
      }),
    });
    (a.router as any).connections.set(deviceD.id, {
      peerDeviceId: deviceD.id,
      outbound: true,
      ws: fakeSocket((value) => {
        sendsToD += 1;
        pending.push((d.router as any).onMessage(dFromA, Buffer.from(value)));
      }),
    });
    (d.router as any).connections.set(deviceC.id, {
      peerDeviceId: deviceC.id,
      outbound: true,
      ws: fakeSocket((value) => pending.push((c.router as any).onMessage(cFromD, Buffer.from(value)))),
    });
    const received: CapabilityEvent[] = [];
    c.router.subscribeCapabilityEvents((event) => received.push(event as CapabilityEvent));
    try {
      await a.router.broadcastCapabilityEvent(
        'drone-control',
        'chat.changed',
        { droneId: 'drone', chatName: 'default' },
        'chat.read',
        [deviceC.id],
      );
      while (pending.length > 0) await Promise.all(pending.splice(0));
      expect(received).toHaveLength(1);
      expect(sendsToB).toBe(1);
      expect(sendsToD).toBe(1);

      (b.router as any).connections.set(deviceC.id, {
        peerDeviceId: deviceC.id,
        outbound: true,
        ws: fakeSocket((value) => pending.push((c.router as any).onMessage(cFromB, Buffer.from(value)))),
      });
      await a.router.broadcastCapabilityEvent(
        'drone-control',
        'chat.changed',
        { droneId: 'drone', chatName: 'default' },
        'chat.read',
        [deviceC.id],
      );
      while (pending.length > 0) await Promise.all(pending.splice(0));
      expect(received).toHaveLength(2);

      let directSends = 0;
      (a.router as any).connections.set(deviceC.id, {
        peerDeviceId: deviceC.id,
        outbound: true,
        ws: fakeSocket((value) => {
          directSends += 1;
          pending.push((c.router as any).onMessage(incoming(c.router, deviceA.id), Buffer.from(value)));
        }),
      });
      const relaySendsBeforeDirect = sendsToB + sendsToD;
      await a.router.broadcastCapabilityEvent(
        'drone-control',
        'chat.changed',
        { droneId: 'drone', chatName: 'default' },
        'chat.read',
        [deviceC.id],
      );
      while (pending.length > 0) await Promise.all(pending.splice(0));
      expect(directSends).toBe(1);
      expect(sendsToB + sendsToD).toBe(relaySendsBeforeDirect);
      expect(received).toHaveLength(3);

      await a.store.update((state) => {
        state.devices[deviceC.id]!.revokedAt = new Date().toISOString();
      });
      await a.router.broadcastCapabilityEvent(
        'drone-control',
        'chat.changed',
        { droneId: 'drone', chatName: 'default' },
        'chat.read',
        [deviceC.id],
      );
      expect(directSends).toBe(1);
    } finally {
      await closeHarnesses(a, b, c, d);
    }
  });

  test('disconnects an SSE client as soon as it applies backpressure', async () => {
    const desktop = identity('desktop');
    const target = await harness(desktop, [desktop]);
    const http = new DeviceMeshHttp(
      desktop,
      target.store,
      target.capabilities,
      target.router,
      target.audit,
      'token',
    );
    const keepAlive = setInterval(() => undefined, 60_000);
    keepAlive.unref?.();
    const response: any = {
      destroyed: false,
      write: () => false,
      destroy() {
        this.destroyed = true;
      },
    };
    (http as any).eventClients.set(response, keepAlive);
    try {
      (http as any).publishChange('state');
      expect(response.destroyed).toBe(true);
      expect((http as any).eventClients.size).toBe(0);
    } finally {
      http.close();
      await closeHarnesses(target);
    }
  });
});
