import { expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import {
  COMPANION_CAPABILITY,
  DeviceHttpEventClient,
  LIVE_AUDIO_PATH,
  LIVE_AUDIO_TRANSPORT,
  LiveAudioClient,
  createLiveAudioOffer,
  capabilityRequestSigningText,
  socketAuthSigningText,
  type LiveAudioSocket,
  type SignedCapabilityRequest,
} from '@drone/device-protocol';
import { CapabilityRegistry } from '../src/hub/device-mesh/capability-registry';
import { DeviceMeshAuditStore } from '../src/hub/device-mesh/device-mesh-audit-store';
import { DeviceMeshRouter } from '../src/hub/device-mesh/device-mesh-router';
import { DeviceMeshStore } from '../src/hub/device-mesh/device-mesh-store';
import { DeviceRouteManager } from '../src/hub/device-mesh/device-route-manager';
import { DeviceRequestJournal } from '../src/hub/device-mesh/device-request-journal';
import { CompanionLiveMeshSessions } from '../src/hub/device-mesh/CompanionLiveMeshSessions';
import {
  signDeviceText,
  verifyDeviceText,
  type LocalDeviceIdentity,
} from '../src/hub/device-mesh/device-identity';

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
async function until(predicate: () => boolean) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 5_000) throw new Error('Timed out waiting for Live audio');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

for (const relayed of [false, true])
  test(`binary Live audio streams ${relayed ? 'through a relay' : 'directly'} without command journal or event traffic`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-live-stream-'));
    const phone = identity('phone');
    const hub = identity('hub');
    const relay = identity('relay');
    const routers: DeviceMeshRouter[] = [];
    const servers: http.Server[] = [];
    const registries: CapabilityRegistry[] = [];
    const stores: DeviceMeshStore[] = [];
    let client: DeviceHttpEventClient | undefined;
    let captured = 0;
    let backendClosed = 0;
    let played = 0;
    let sseAudio = 0;
    const originalNow = Date.now;
    let now = originalNow();
    // Simulate several minutes of media while exercising real HTTP and binary WebSockets.
    Date.now = () => now;
    try {
      async function host(self: LocalDeviceIdentity) {
        const dir = path.join(root, self.id);
        const store = new DeviceMeshStore(path.join(dir, 'state.json'), self);
        stores.push(store);
        await store.read();
        await store.update((state) => {
          state.networkId = 'live-test';
          for (const peer of [phone, hub, relay])
            if (peer.id !== self.id) {
              state.devices[peer.id] = {
                id: peer.id,
                name: peer.name,
                platform: peer.platform,
                publicKey: peer.publicKey,
                administrator: false,
                grants: [
                  {
                    capability: 'companion',
                    version: 1,
                    operations: ['live.start', 'live.event', 'live.ping', 'live.close'],
                  },
                ],
                endpoints: [],
                revokedAt: null,
                addedAt: new Date(now).toISOString(),
                updatedAt: new Date(now).toISOString(),
              };
            }
        });
        const capabilities = new CapabilityRegistry();
        registries.push(capabilities);
        const audit = new DeviceMeshAuditStore(path.join(dir, 'audit.json'));
        const router = new DeviceMeshRouter(
          self,
          store,
          capabilities,
          new DeviceRouteManager(self, store),
          audit,
          new DeviceRequestJournal(path.join(dir, 'journal')),
        );
        routers.push(router);
        if (self.id === hub.id) {
          const live = new CompanionLiveMeshSessions({
            emit: (deviceId, payload) =>
              router.broadcastCapabilityEvent('companion', 'live.event', payload, 'live.start', [
                deviceId,
              ]),
            createSocket: (send) => ({
              handle(message: any) {
                if (message.type === 'live_start') send({ type: 'live_ready', transport: 'pcm' });
                if (message.event?.type === 'session.input_audio.append') {
                  captured++;
                  send({
                    type: 'live_event',
                    event: { type: 'session.output_audio.delta', delta: message.event.audio },
                  });
                }
              },
              close() {
                backendClosed++;
              },
            }),
          });
          capabilities.register({
            descriptor: COMPANION_CAPABILITY,
            invoke: (operation, payload, context) =>
              live.invoke(context.sourceDevice.id, operation, payload as any, context.liveAudio),
            close: () => live.close(),
          });
        }
        const server = http.createServer((request, response) => {
          void router
            .handleHttp(request, response, new URL(request.url!, 'http://localhost'))
            .then((handled) => {
              if (!handled) response.writeHead(404).end();
            });
        });
        server.on('upgrade', (request, socket, head) => {
          if (!router.handleLiveAudioUpgrade(request, socket, head)) socket.destroy();
        });
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        return {
          router,
          store,
          dir,
          endpoint: `http://127.0.0.1:${(server.address() as any).port}`,
        };
      }
      const destination = await host(hub);
      const entry = relayed ? await host(relay) : destination;
      if (relayed) {
        await destination.store.update((state) => {
          state.devices[relay.id].endpoints = [entry.endpoint];
        });
        await (destination.router as any).connectToKnownPeers();
        await until(() => (entry.router as any).connections.has(hub.id));
      }
      // A guessed session token cannot attach an audio channel.
      const unauthorized = new WebSocket(entry.endpoint.replace('http:', 'ws:') + LIVE_AUDIO_PATH);
      await new Promise<void>((resolve) => {
        unauthorized.on('open', () => unauthorized.send(JSON.stringify({ token: 'wrong' })));
        unauthorized.on('error', () => undefined);
        unauthorized.on('close', () => resolve());
      });
      let ready = false;
      const responses = new Map<string, any>();
      client = new DeviceHttpEventClient(entry.endpoint, phone.id);
      client.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.type === 'auth.challenge')
          client!.send(
            JSON.stringify({
              type: 'auth.response',
              deviceId: phone.id,
              signature: signDeviceText(phone, socketAuthSigningText(phone.id, message.nonce)),
            }),
          );
        if (message.type === 'auth.ready') ready = true;
        if (message.type === 'capability.response') responses.set(message.requestId, message);
        if (
          message.type === 'capability.event' &&
          message.payload?.event?.type === 'session.output_audio.delta'
        )
          sseAudio++;
      };
      await until(() => ready);
      const socket = await client.openLiveAudioSocket(
        (url) => new WebSocket(url) as unknown as LiveAudioSocket,
      );
      const errors: string[] = [];
      const audioClient = new LiveAudioClient(socket, phone.id);
      const handshake = (sessionId: string) =>
        createLiveAudioOffer(
          { sourceDeviceId: phone.id, targetDeviceId: hub.id, sessionId },
          crypto.randomBytes(48),
          (text, signature) => verifyDeviceText(hub.publicKey, text, signature),
        );
      const audio = audioClient.open(
        hub.id,
        'voice',
        () => played++,
        (error) => errors.push(error),
        handshake('voice'),
      );
      let requestId = 0;
      async function request(operation: string, payload: unknown, ok = true) {
        const unsigned: Omit<SignedCapabilityRequest, 'signature'> = {
          type: 'capability.request',
          version: 1,
          requestId: `request-${++requestId}`,
          sourceDeviceId: phone.id,
          targetDeviceId: hub.id,
          capability: 'companion',
          capabilityVersion: 1,
          operation,
          payload,
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
          nonce: `nonce-${requestId}`,
          maxHops: 1,
        };
        client!.send(
          JSON.stringify({
            ...unsigned,
            signature: signDeviceText(phone, capabilityRequestSigningText(unsigned)),
          }),
        );
        await until(() => responses.has(unsigned.requestId));
        const response = responses.get(unsigned.requestId);
        expect(response.ok).toBe(ok);
        return response.ok ? response.result : response;
      }
      const started = await request('live.start', {
        sessionId: 'voice',
        transport: 'pcm',
        audioTransport: LIVE_AUDIO_TRANSPORT,
        audioOffer: audio.offer,
      });
      expect(started).toMatchObject({ audioTransport: LIVE_AUDIO_TRANSPORT });
      audio.accept(started.audioAnswer);
      const openingChunk = Buffer.alloc(24_000, 1).toString('base64');
      for (let i = 0; i < 16; i++) await audio.send(openingChunk);
      await until(() => played === 16 || errors.length > 0);
      expect(errors).toEqual([]);
      const microphoneChunk = Buffer.alloc(4_800, 1).toString('base64');
      for (let i = 0; i < 1_000; i++) {
        now += 100;
        await audio.send(microphoneChunk);
        await until(() => played === i + 17 || errors.length > 0);
        expect(errors).toEqual([]);
      }
      expect(captured).toBe(1_016);
      expect(played).toBe(1_016);
      expect(sseAudio).toBe(0);
      expect(await fs.readdir(path.join(destination.dir, 'journal'))).toHaveLength(1);
      expect(
        JSON.parse(await fs.readFile(path.join(destination.dir, 'audit.json'), 'utf8')),
      ).toHaveLength(1);
      await request('live.ping', { sessionId: 'voice' });
      // Grant changes terminate the active stream, including its relayed owner.
      await destination.router.accessChanged(phone.id);
      expect(backendClosed).toBeGreaterThan(0);
      await audio.send(microphoneChunk);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(captured).toBe(1_016);
      audio.close();
      // Stop must reach the backend even when no HTTP live.close is submitted.
      const stopped = audioClient.open(
        hub.id,
        'stop-without-rpc',
        () => played++,
        (error) => errors.push(error),
        handshake('stop-without-rpc'),
      );
      const stopStart = await request('live.start', {
        sessionId: 'stop-without-rpc',
        transport: 'pcm',
        audioTransport: LIVE_AUDIO_TRANSPORT,
        audioOffer: stopped.offer,
      });
      stopped.accept(stopStart.audioAnswer);
      const closedBeforeStop = backendClosed;
      stopped.close();
      await until(() => backendClosed > closedBeforeStop);
      expect(client.readyState).toBe(DeviceHttpEventClient.OPEN);
      if (relayed) {
        const downstream = (destination.router as any).connections.get(relay.id).ws;
        downstream.closeLiveAudio();
        const relaySide = (entry.router as any).connections.get(hub.id).ws;
        await until(() => !downstream.audioSocket && !relaySide.audioSocket);
        const resumed = audioClient.open(
          hub.id,
          'voice-2',
          () => played++,
          (error) => errors.push(error),
          handshake('voice-2'),
        );
        const resumedStart = await request('live.start', {
          sessionId: 'voice-2',
          transport: 'pcm',
          audioTransport: LIVE_AUDIO_TRANSPORT,
          audioOffer: resumed.offer,
        });
        expect(resumedStart).toMatchObject({ audioTransport: LIVE_AUDIO_TRANSPORT });
        resumed.accept(resumedStart.audioAnswer);
        now += 100;
        await resumed.send('AQI=');
        await until(() => captured === 1_017);
        const closedBeforeDisconnect = backendClosed;
        socket.close();
        await until(() => backendClosed > closedBeforeDisconnect);
        expect(client.readyState).toBe(DeviceHttpEventClient.OPEN);
        await request('live.ping', { sessionId: 'voice-2' });
        resumed.close();
        await client.openLiveAudioSocket((url) => new WebSocket(url) as unknown as LiveAudioSocket);
      }
      await destination.store.update((state) => {
        state.devices[phone.id].grants = [
          { capability: 'companion', version: 1, operations: ['live.start'] },
        ];
      });
      expect(
        await request(
          'live.start',
          { sessionId: 'denied', transport: 'pcm', audioTransport: LIVE_AUDIO_TRANSPORT },
          false,
        ),
      ).toMatchObject({ ok: false });
    } finally {
      Date.now = originalNow;
      client?.close();
      for (const router of routers) router.close();
      await Promise.all(registries.map((registry) => registry.close()));
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.closeAllConnections();
              server.close(() => resolve());
            }),
        ),
      );
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20_000);
