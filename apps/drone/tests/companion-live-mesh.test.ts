import { expect, test } from 'bun:test';
import { CompanionLiveMeshSessions } from '../src/hub/device-mesh/CompanionLiveMeshSessions';
import { DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT, readCompanionLiveSettings } from '../src/hub/companion/companion-live-settings';
import { withTempDroneDataDir } from './test-helpers';
import { capabilityEventPolicy, isGranted, COMPANION_RUN_OPERATIONS } from '@drone/device-protocol';
import { LIVE_AUDIO_TRANSPORT } from '@drone/device-protocol';
import type { LiveAudioEndpoint } from '../src/hub/device-mesh/mesh-live-audio-router';

function harness() {
  const sockets: Array<{ messages: any[]; closed: number; send(message: unknown): void; handle(message: unknown): void; close(): void }> = [];
  const events: any[] = [];
  const live = new CompanionLiveMeshSessions({
    emit: async (deviceId, payload) => { events.push({ deviceId, payload }); },
    createSocket(send) {
      const socket = { messages: [] as any[], closed: 0, send,
        handle(message: unknown) { this.messages.push(message); }, close() { this.closed++; } };
      sockets.push(socket); return socket;
    },
  });
  return { live, sockets, events };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('mesh Live isolates sessions by device and rejects stale controls after replacement', async () => {
  const h = harness();
  await h.live.invoke('phone', 'live.start', { sessionId: 'a', sdp: 'v=0' });
  await h.live.invoke('other', 'live.event', { sessionId: 'a', event: {} });
  expect(h.sockets[0].messages).toHaveLength(1);
  h.sockets[0].send({ type: 'live_ready', sdp: 'answer' }); await tick();
  expect(h.events).toEqual([{ deviceId: 'phone', payload: { sessionId: 'a', type: 'live_ready', sdp: 'answer' } }]);
  await h.live.invoke('phone', 'live.start', { sessionId: 'b', sdp: 'v=0' });
  expect(h.sockets[0].closed).toBe(1);
  await h.live.invoke('phone', 'live.close', { sessionId: 'a' });
  expect(h.sockets[1].closed).toBe(0);
  h.sockets[0].send({ type: 'live_error' }); await tick();
  expect(h.events).toHaveLength(1);
  await h.live.invoke('phone', 'live.ping', { sessionId: 'b' });
  expect(h.sockets[1].messages.at(-1)).toEqual({ type: 'live_ping' });
  h.live.revokeDevice('phone');
  expect(h.sockets[1].closed).toBe(1);
  h.live.close();
});

test('close arriving before start cannot create a billable session; shutdown prevents new starts', async () => {
  const h = harness();
  await h.live.invoke('phone', 'live.close', { sessionId: 'a' });
  expect(await h.live.invoke('phone', 'live.start', { sessionId: 'a', sdp: 'v=0' })).toEqual({ accepted: false });
  expect(h.sockets).toHaveLength(0);
  h.live.close();
  await expect(h.live.invoke('phone', 'live.start', { sessionId: 'b', sdp: 'v=0' })).rejects.toThrow('shutting down');
});

test('mobile Live settings use the existing Hub preference and validate writes', async () => {
  await withTempDroneDataDir('mobile-live-settings-', async () => {
    const h = harness();
    expect(await h.live.invoke('phone', 'live.settings.get', {})).toEqual({ enabled: false });
    await h.live.invoke('phone', 'live.settings.update', { enabled: true });
    expect(await readCompanionLiveSettings()).toEqual({ enabled: true, systemPrompt: DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT });
    expect(await h.live.invoke('phone', 'live.prompt.get', {})).toMatchObject({ systemPrompt: DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT, maxSystemPromptChars: 8_000 });
    await h.live.invoke('phone', 'live.prompt.update', { systemPrompt: 'Be gently humorous.' });
    expect(await readCompanionLiveSettings()).toEqual({ enabled: true, systemPrompt: 'Be gently humorous.' });
    await expect(h.live.invoke('phone', 'live.settings.update', { enabled: 'yes' })).rejects.toThrow('boolean');
    await expect(h.live.invoke('phone', 'live.prompt.update', { systemPrompt: 42 })).rejects.toThrow('string');
    expect(await readCompanionLiveSettings()).toEqual({ enabled: true, systemPrompt: 'Be gently humorous.' });
    h.live.close();
  });
});

test('Live events and settings require explicit permissions beyond existing backend access', () => {
  const grants = [{ capability: 'companion', version: 1, operations: [...COMPANION_RUN_OPERATIONS] }];
  expect(isGranted(grants, 'companion', 1, 'live.settings.get')).toBe(true);
  expect(isGranted([], 'companion', 1, 'live.settings.get')).toBe(false);
  expect(isGranted(grants, 'companion', 1, 'live.start')).toBe(false);
  expect(isGranted(grants, 'companion', 1, 'live.settings.update')).toBe(false);
  expect(isGranted(grants, 'companion', 1, 'live.prompt.get')).toBe(false);
  expect(isGranted(grants, 'companion', 1, 'live.prompt.update')).toBe(false);
  expect(capabilityEventPolicy('companion', 'live.event')?.requiredOperation).toBe('live.start');
});

test('mesh forwards PCM transport selection and audio only to the owning session', async () => {
  const h = harness();
  await h.live.invoke('phone', 'live.start', { sessionId: 'pcm', transport: 'pcm' });
  expect(h.sockets[0].messages[0]).toMatchObject({ type: 'live_start', transport: 'pcm' });
  const event = { type: 'session.input_audio.append', audio: 'AQI=' };
  await h.live.invoke('other', 'live.event', { sessionId: 'pcm', event });
  await h.live.invoke('phone', 'live.event', { sessionId: 'stale', event });
  expect(h.sockets[0].messages).toHaveLength(1);
  await h.live.invoke('phone', 'live.event', { sessionId: 'pcm', event });
  expect(h.sockets[0].messages.at(-1)).toEqual({ type: 'live_event', event });
  h.live.close();
});

test('mesh bounds audio waiting for a stalled receiver and closes the affected session', async () => {
  let release!: () => void;
  let send!: (event: unknown) => void;
  let closed = 0;
  const live = new CompanionLiveMeshSessions({
    emit: () => new Promise<void>((resolve) => { release = resolve; }),
    createSocket: (callback) => { send = callback; return { handle() {}, close() { closed++; } }; },
  });
  await live.invoke('phone', 'live.start', { sessionId: 'pcm', transport: 'pcm' });
  for (let i = 0; i < 100; i++) send({ type: 'live_event', event: { type: 'session.output_audio.delta', delta: 'A'.repeat(32000) } });
  await tick(); expect(closed).toBe(1);
  live.close(); release(); await tick();
});

test('stalled output audio does not delay control events or stream termination', async () => {
  const h = harness(); let release!: () => void; let onClose = () => {}; let closed = false;
  const audio: LiveAudioEndpoint = {
    send: () => new Promise<void>((resolve) => { release = resolve; }),
    close() { if (!closed) { closed = true; onClose(); } },
    onAudio() {}, onClose(listener) { onClose = listener; },
  };
  await h.live.invoke('phone', 'live.start', { sessionId: 'pcm', transport: 'pcm', audioTransport: LIVE_AUDIO_TRANSPORT }, audio);
  h.sockets[0].send({ type: 'live_event', event: { type: 'session.output_audio.delta', delta: 'AQI=' } });
  await tick();
  h.sockets[0].send({ type: 'live_event', event: { type: 'session.delegation.created' } });
  await tick();
  expect(h.events[0].payload.event.type).toBe('session.delegation.created');
  h.sockets[0].send({ type: 'live_closed' }); await tick();
  expect(closed).toBe(true); expect(h.sockets[0].closed).toBe(1);
  expect(h.events.at(-1).payload.type).toBe('live_closed');
  release(); h.live.close(); await tick();
});

test('unsupported streaming versions are rejected before allocating or replacing a backend session', async () => {
  const h = harness();
  await h.live.invoke('phone', 'live.start', { sessionId: 'active', transport: 'pcm' });
  await expect(h.live.invoke('phone', 'live.start', { sessionId: 'old', transport: 'pcm', audioTransport: 'mesh-pcm-v1' })).rejects.toThrow('Unsupported');
  expect(h.sockets).toHaveLength(1); expect(h.sockets[0].closed).toBe(0);
  h.live.close();
});
