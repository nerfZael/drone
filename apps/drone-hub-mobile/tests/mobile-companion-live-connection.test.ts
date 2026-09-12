import { expect, test } from 'bun:test';
import type { LivePcmAudio, LivePcmCallbacks } from '@drone/assistant-chat';
import { MobileCompanionLiveConnection } from '../src/local-assistant/MobileCompanionLiveConnection';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(options: { delayedAudio?: boolean; rejectStart?: boolean; blockEvents?: boolean } = {}) {
  const coordinator = new MobileMicrophoneCoordinator();
  const requests: Array<{ operation: string; payload: any }> = [];
  const received: any[] = []; const errors: string[] = []; const ready: string[] = []; const played: string[] = [];
  let listener: ((event: any) => void) | undefined;
  let released = 0; let muted = false;
  let releaseEvent: (() => void) | undefined;
  let resolveAudio!: (audio: LivePcmAudio) => void;
  let capture!: LivePcmCallbacks;
  const audio: LivePcmAudio = { mute: (value) => { muted = value; }, play: (audio) => played.push(audio), resume: async () => {},
    release: async () => { released++; } };
  const connection = new MobileCompanionLiveConnection({
    targetDeviceId: 'hub', sessionId: 'voice', microphoneCoordinator: coordinator,
    openAudio: (callbacks) => {
      capture = callbacks; capture.onAudio('AQI=');
      return options.delayedAudio ? new Promise((resolve) => { resolveAudio = resolve; }) : Promise.resolve(audio);
    },
    request: async (_device, _capability, operation, payload) => {
      requests.push({ operation, payload });
      if (options.blockEvents && operation === 'live.event') await new Promise<void>((resolve) => { releaseEvent = resolve; });
      if (options.rejectStart && operation === 'live.start') throw new Error('No API credentials');
      return {};
    },
    subscribe: (_capability, _event, callback) => { listener = callback; return () => { listener = undefined; }; },
    onEvent: (event) => received.push(event), onReady: (model) => ready.push(model), onError: (error) => errors.push(error),
  });
  return { connection, coordinator, requests, received, errors, ready, played, muted: () => muted,
    capture: (audio: string) => capture.onAudio(audio), releaseEvent: () => releaseEvent?.(),
    finishAudio: () => resolveAudio(audio), released: () => released,
    emit: (payload: any, sourceDeviceId = 'hub') => listener?.({ sourceDeviceId, payload: { sessionId: 'voice', ...payload } }),
  };
}

test('mobile captures while connecting, drains opening speech in order, and scopes playback to its session', async () => {
  const h = harness();
  try {
    await h.connection.start(); h.capture('AwQ=');
    expect(h.muted()).toBe(false);
    expect(h.requests).toEqual([{ operation: 'live.start', payload: { sessionId: 'voice', transport: 'pcm' } }]);
    h.emit({ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' }, 'other');
    expect(h.ready).toEqual([]);
    h.emit({ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' }); h.capture('BQY='); await tick();
    expect(h.ready).toEqual(['chosen']);
    expect(h.requests.slice(1).map((request) => request.payload.event.audio)).toEqual(['AQIDBA==', 'BQY=']);
    h.emit({ type: 'live_event', sessionId: 'stale', event: { type: 'session.output_audio.delta', delta: 'bad' } });
    h.emit({ type: 'live_event', event: { type: 'session.output_audio.delta', delta: 'Bwg=' } });
    expect(h.played).toEqual(['Bwg=']);
    h.emit({ type: 'live_event', event: { type: 'session.delegation.created' } });
    expect(h.received).toEqual([{ type: 'session.delegation.created' }]);
  } finally { h.connection.close(); await tick(); }
  expect(h.coordinator.getSnapshot()).toBeNull(); expect(h.released()).toBe(1);
});

test('closing while native permission is pending holds the lease until late audio is released', async () => {
  const h = harness({ delayedAudio: true });
  const start = h.connection.start(); h.connection.close();
  expect(h.coordinator.acquire('single-shot')).toBeNull();
  h.finishAudio(); await start; await tick();
  expect(h.released()).toBe(1); expect(h.coordinator.getSnapshot()).toBeNull();
  expect(h.requests.some((request) => request.operation === 'live.start')).toBe(false);
  expect(h.errors).toEqual([]);
});

test('failed Live startup discards audio and ignores late ready events', async () => {
  const h = harness({ rejectStart: true });
  await h.connection.start(); await tick();
  h.emit({ type: 'live_ready', transport: 'pcm' }); h.capture('AwQ='); await tick();
  expect(h.errors).toEqual(['No API credentials']); expect(h.ready).toEqual([]);
  expect(h.requests.some((request) => request.operation === 'live.event')).toBe(false);
  expect(h.coordinator.getSnapshot()).toBeNull();
});

test('Live cannot take the microphone from another voice feature', async () => {
  const h = harness(); const lease = h.coordinator.acquire('continuous')!;
  await h.connection.start(); expect(h.errors[0]).toContain('Another voice feature');
  expect(h.coordinator.getSnapshot()).toBe('continuous');
  await lease.release();
});

test('mobile cancellation during backlog transmission drops all unsent speech', async () => {
  const h = harness({ blockEvents: true });
  await h.connection.start(); h.capture('AwQ='); h.emit({ type: 'live_ready', transport: 'pcm' });
  h.capture('BQY='); await tick();
  h.connection.close(); h.releaseEvent(); await tick();
  expect(h.requests.filter((request) => request.operation === 'live.event').map((request) => request.payload.event.audio)).toEqual(['AQIDBA==']);
});

test('mobile startup mute discards speech without unmuting on connection', async () => {
  const h = harness();
  try {
    await h.connection.start(); h.connection.mute(true); h.capture('AwQ=');
    h.emit({ type: 'live_ready', transport: 'pcm' }); await tick();
    expect(h.requests.filter((request) => request.operation === 'live.event').map((request) => request.payload.event.audio)).toEqual(['AAA=']);
    expect(h.muted()).toBe(true);
  } finally { h.connection.close(); await tick(); }
});

test('mobile sends backend result chunks in order and drops unsent results on close', async () => {
  const h = harness({ blockEvents: true });
  await h.connection.start();
  h.connection.send({ content: 'first' }); h.connection.send({ content: 'second' }); await tick();
  const chunks = () => h.requests.filter((request) => request.operation === 'live.event').map((request) => request.payload.event.content);
  expect(chunks()).toEqual(['first']); h.releaseEvent(); await tick(); expect(chunks()).toEqual(['first', 'second']);
  h.connection.send({ content: 'third' }); h.connection.close(); h.releaseEvent(); await tick();
  expect(chunks()).toEqual(['first', 'second']);
});
