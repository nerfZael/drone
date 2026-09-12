import { expect, test } from 'bun:test';
import { CompanionLiveMeshSessions } from '../src/hub/device-mesh/CompanionLiveMeshSessions';
import { DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT, readCompanionLiveSettings } from '../src/hub/companion/companion-live-settings';
import { withTempDroneDataDir } from './test-helpers';
import { capabilityEventPolicy, isGranted, COMPANION_RUN_OPERATIONS } from '@drone/device-protocol';

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
