import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import {
  COMPANION_CAPABILITY,
  capabilityRequestSigningText,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { CapabilityRegistry } from '../src/hub/device-mesh/capability-registry';
import { DeviceHttpChannel } from '../src/hub/device-mesh/device-http-channel';
import { DeviceMeshAuditStore } from '../src/hub/device-mesh/device-mesh-audit-store';
import { DeviceMeshRouter } from '../src/hub/device-mesh/device-mesh-router';
import { DeviceMeshStore } from '../src/hub/device-mesh/device-mesh-store';
import { DeviceRouteManager } from '../src/hub/device-mesh/device-route-manager';
import { signDeviceText, type LocalDeviceIdentity } from '../src/hub/device-mesh/device-identity';

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
  run: (h: {
    send(operation: string, payload?: unknown, peer?: string): Promise<any>;
    revoke(): Promise<unknown>;
  }) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-live-rate-'));
  const desktop = identity('desktop');
  const phone = identity('phone');
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
        {
          capability: 'companion',
          version: 1,
          operations: ['live.event', 'live.ping', 'live.close'],
        },
      ],
      endpoints: [],
      revokedAt: null,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
  const capabilities = new CapabilityRegistry();
  capabilities.register({
    descriptor: COMPANION_CAPABILITY,
    async invoke() {
      return { accepted: true };
    },
  });
  const audit = new DeviceMeshAuditStore(path.join(root, 'audit.json'));
  // Exercise routing, signatures, grants and invocation without thousands of audit disk writes.
  audit.record = async () => {};
  const router = new DeviceMeshRouter(
    desktop,
    store,
    capabilities,
    new DeviceRouteManager(desktop, store),
    audit,
  );
  let response: any;
  const ws = {
    readyState: DeviceHttpChannel.OPEN,
    send: (value: string) => {
      response = JSON.parse(value);
    },
  };
  let sequence = 0;
  try {
    await run({
      async send(operation, payload = {}, peer = phone.id) {
        const now = Date.now();
        const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
          type: 'capability.request',
          version: 1,
          requestId: `request-${++sequence}`,
          sourceDeviceId: phone.id,
          targetDeviceId: desktop.id,
          capability: 'companion',
          capabilityVersion: 1,
          operation,
          payload,
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
          nonce: `nonce-${sequence}`,
          maxHops: 1,
        };
        const request = {
          ...unsigned,
          signature: signDeviceText(phone, capabilityRequestSigningText(unsigned)),
        };
        response = undefined;
        await (router as any).onMessage(
          { peerDeviceId: peer, outbound: false, ws },
          JSON.stringify(request),
        );
        return response;
      },
      revoke: () =>
        store.update((state) => {
          state.devices[phone.id].grants = [];
        }),
    });
  } finally {
    router.close();
    await capabilities.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

const audio = { sessionId: 'live', event: { type: 'session.input_audio.append', audio: 'AQI=' } };

test('Live audio sustains mobile capture, stays bounded, and leaves room for controls', async () => {
  await harness(async ({ send }) => {
    for (let i = 0; i < 3_000; i++) {
      expect(await send('live.event', audio)).toMatchObject({ ok: true });
    }
    expect(await send('live.event', audio)).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    expect(await send('live.ping')).toMatchObject({ ok: true });
    expect(await send('live.close')).toMatchObject({ ok: true });
    // Another authenticated hop has its own allowance, even for the same original source.
    expect(await send('live.event', audio, 'relay')).toMatchObject({ ok: true });
  });
}, 20_000);

test('non-audio Live events retain the control limit, and audio still requires permission', async () => {
  await harness(async ({ send, revoke }) => {
    for (let i = 0; i < 120; i++) {
      expect(
        await send('live.event', { event: { type: 'session.input_audio.commit' } }),
      ).toMatchObject({ ok: true });
    }
    expect(await send('live.ping', audio)).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    expect(await send('live.event', audio)).toMatchObject({ ok: true });
    await revoke();
    expect(await send('live.event', audio)).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
  });
});
