import { LIVE_AUDIO_TRANSPORT, LIVE_AUDIO_AUTH_SUITE } from '@drone/device-protocol';
import { expect, test } from 'bun:test';
import type { LivePcmAudio, LivePcmCallbacks } from '@drone/assistant-chat';
import { MobileCompanionLiveConnection } from '../src/local-assistant/MobileCompanionLiveConnection';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const offer = { suite: LIVE_AUDIO_AUTH_SUITE, publicKey: 'test-key' };

function harness(options: { delayedAudio?: boolean; delayedStream?: boolean; legacyHub?: boolean; rejectStart?: boolean; blockEvents?: boolean; rejectAnswer?: boolean; delayedStart?: boolean; rejectClose?: boolean; silentAudio?: boolean } = {}) {
  const coordinator = new MobileMicrophoneCoordinator();
  const requests: Array<{ operation: string; payload: any }> = [];
  const received: any[] = []; const errors: string[] = []; const ready: string[] = []; const played: string[] = [];
  let capturing = 0;
  let listener: ((event: any) => void) | undefined;
  let released = 0; let muted = false;
  let releaseEvent: (() => void) | undefined;
  let streamClosed = 0;
  let finishStream!: () => void;
  let finishStart!: () => void;
  let accepted = 0;
  let resolveAudio!: (audio: LivePcmAudio) => void;
  let capture!: LivePcmCallbacks;
  const audio: LivePcmAudio = { mute: (value) => { muted = value; }, play: (audio) => played.push(audio), resume: async () => {},
    release: async () => { released++; } };
  const streamed: string[] = [];
  let playback: (audio: string) => void = () => {};
  const connection = new MobileCompanionLiveConnection({
    targetDeviceId: 'hub', sessionId: 'voice', microphoneCoordinator: coordinator,
    openLiveAudio: async (_target, _session, onAudio) => {
      playback = onAudio;
      if (options.delayedStream) await new Promise<void>((resolve) => { finishStream = resolve; });
      return { offer, accept() { if (options.rejectAnswer) throw new Error('Invalid Hub Live audio signature'); accepted++; }, send: async (audio) => { streamed.push(audio); if (options.blockEvents) await new Promise<void>((resolve) => { releaseEvent = resolve; }); }, close() { streamClosed++; } };
    },
    openAudio: (callbacks) => {
      capture = callbacks; if (!options.silentAudio) capture.onAudio('AQI=');
      return options.delayedAudio ? new Promise((resolve) => { resolveAudio = resolve; }) : Promise.resolve(audio);
    },
    request: async (_device, _capability, operation, payload) => {
      requests.push({ operation, payload });
      if (options.blockEvents && operation === 'live.event') await new Promise<void>((resolve) => { releaseEvent = resolve; });
      if (options.rejectStart && operation === 'live.start') throw new Error('No API credentials');
      if (options.delayedStart && operation === 'live.start') await new Promise<void>((resolve) => { finishStart = resolve; });
      if (options.rejectClose && operation === 'live.close') throw new Error('Too many mesh requests from this peer');
      return operation === 'live.start' && !options.legacyHub ? { audioTransport: LIVE_AUDIO_TRANSPORT } : {};
    },
    subscribe: (_capability, _event, callback) => { listener = callback; return () => { listener = undefined; }; },
    onEvent: (event) => received.push(event), onReady: (model) => ready.push(model), onError: (error) => errors.push(error),
    onCapturing: () => { capturing++; },
  });
  return { connection, coordinator, requests, streamed, capturing: () => capturing, finishStart: () => finishStart(), accepted: () => accepted, finishStream: () => finishStream(), streamClosed: () => streamClosed, playback: (audio: string) => playback(audio), received, errors, ready, played, muted: () => muted,
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
    expect(h.requests).toEqual([{ operation: 'live.start', payload: { sessionId: 'voice', transport: 'pcm', audioTransport: LIVE_AUDIO_TRANSPORT, audioOffer: offer } }]);
    h.emit({ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' }, 'other');
    expect(h.ready).toEqual([]);
    h.emit({ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' }); h.capture('BQY='); await tick();
    expect(h.ready).toEqual(['chosen']);
    expect(h.streamed).toEqual(['AQIDBA==', 'BQY=']);
    h.emit({ type: 'live_event', sessionId: 'stale', event: { type: 'session.output_audio.delta', delta: 'bad' } });
    h.playback('Bwg=');
    expect(h.played).toEqual(['Bwg=']);
    h.emit({ type: 'live_event', event: { type: 'session.delegation.created' } });
    expect(h.received).toEqual([{ type: 'session.delegation.created' }]);
  } finally { h.connection.close(); await tick(); }
  expect(h.coordinator.getSnapshot()).toBeNull(); expect(h.released()).toBe(1);
});

test('capture is announced once the recorder runs, before any audio chunk and before the Hub answers', async () => {
  const h = harness({ silentAudio: true, delayedStart: true });
  try {
    const start = h.connection.start(); await tick();
    expect(h.capturing()).toBe(1);
    expect(h.ready).toEqual([]);
    h.capture('AwQ='); h.capture('BQY=');
    expect(h.capturing()).toBe(1);
    h.finishStart(); await start;
    h.emit({ type: 'live_ready', transport: 'pcm', backendModel: 'chosen' }); await tick();
    expect(h.streamed).toEqual(['AwQFBg==']);
  } finally { h.connection.close(); await tick(); }
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
  expect(h.streamed).toEqual(['AQIDBA==']);
});

test('mobile startup mute discards speech without unmuting on connection', async () => {
  const h = harness();
  try {
    await h.connection.start(); h.connection.mute(true); h.capture('AwQ=');
    h.emit({ type: 'live_ready', transport: 'pcm' }); await tick();
    expect(h.streamed).toEqual(['AAA=']);
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


test('closing while audio transport opens releases capture and retires the late stream', async () => {
  const h = harness({ delayedStream: true });
  const start = h.connection.start(); await tick();
  await h.connection.close();
  expect(h.released()).toBe(1);
  h.finishStream(); await start;
  expect(h.streamClosed()).toBe(1);
  expect(h.requests.some((request) => request.operation === 'live.start')).toBe(false);
  expect(h.streamed).toEqual([]);
});

test('mobile requires streaming negotiation and never falls back to audio requests', async () => {
  const h = harness({ legacyHub: true });
  await h.connection.start(); await tick();
  expect(h.errors).toEqual(['Update the Hub to use Live audio streaming.']);
  expect(h.streamClosed()).toBe(1);
  expect(h.requests.some((request) => request.operation === 'live.event')).toBe(false);
  expect(h.released()).toBe(1);
});

test('an invalid Hub answer discards opening speech and releases capture', async () => {
  const h = harness({ rejectAnswer: true });
  await h.connection.start(); await tick();
  expect(h.errors).toEqual(['Invalid Hub Live audio signature']);
  expect(h.streamed).toEqual([]); expect(h.released()).toBe(1); expect(h.streamClosed()).toBe(1);
});

test('Stop completes a late key exchange for stream termination even when the HTTP close fails', async () => {
  const h = harness({ delayedStart: true, rejectClose: true });
  const start = h.connection.start(); await tick();
  await h.connection.close(); h.finishStart(); await start; await tick();
  expect(h.accepted()).toBe(1); expect(h.streamClosed()).toBe(1);
  expect(h.streamed).toEqual([]); expect(h.ready).toEqual([]); expect(h.errors).toEqual([]);
  expect(h.released()).toBe(1);
});
