import { expect, test } from 'bun:test';
import { MobileCompanionLiveConnection } from '../src/local-assistant/MobileCompanionLiveConnection';
import { MobileMicrophoneCoordinator } from '../src/local-assistant/mobile-microphone-coordinator';

function harness(options: { delayedAudio?: boolean; rejectStart?: boolean; blockEvents?: boolean } = {}) {
  const coordinator = new MobileMicrophoneCoordinator();
  const requests: Array<{ operation: string; payload: any }> = [];
  const received: any[] = [];
  const errors: string[] = [];
  const ready: string[] = [];
  let listener: ((event: any) => void) | undefined;
  let released = 0;
  let stopped = 0;
  let closed = 0;
  let releaseEvent: (() => void) | undefined;
  let resolveAudio!: (audio: any) => void;
  const channel: any = {};
  const track = { enabled: true, stop: () => { stopped++; } };
  const peer: any = {
    iceGatheringState: 'complete', connectionState: 'new', localDescription: { sdp: 'v=0 offer' },
    addTrack() {}, createDataChannel: () => channel, createOffer: async () => ({}),
    setLocalDescription: async () => {}, setRemoteDescription: async (value: unknown) => { peer.answer = value; },
    close: () => { closed++; },
  };
  const audio = { peer, microphone: { getTracks: () => [track] }, release: async () => { released++; track.stop(); peer.close(); } };
  const connection = new MobileCompanionLiveConnection({
    targetDeviceId: 'hub', sessionId: 'voice', microphoneCoordinator: coordinator,
    openAudio: () => options.delayedAudio ? new Promise((resolve) => { resolveAudio = resolve; }) : Promise.resolve(audio),
    request: async (_device, _capability, operation, payload) => {
      requests.push({ operation, payload });
      if (options.blockEvents && operation === 'live.event') await new Promise<void>((resolve) => { releaseEvent = resolve; });
      if (options.rejectStart && operation === 'live.start') throw new Error('No API credentials');
      return {};
    },
    subscribe: (_capability, _event, callback) => { listener = callback; return () => { listener = undefined; }; },
    onEvent: (event) => received.push(event), onReady: (model) => ready.push(model), onError: (error) => errors.push(error),
  });
  return { connection, coordinator, requests, received, errors, ready, track, peer, channel,
    releaseEvent: () => releaseEvent?.(), finishAudio: () => resolveAudio(audio), released: () => released, stopped: () => stopped, closed: () => closed,
    emit: (payload: any, sourceDeviceId = 'hub') => listener?.({ sourceDeviceId, payload: { sessionId: 'voice', ...payload } }),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('mobile Live negotiates over mesh, waits for session.started, filters sessions, and releases audio', async () => {
  const h = harness();
  try {
    await h.connection.start();
    expect(h.track.enabled).toBe(false);
    expect(h.requests[0]).toEqual({ operation: 'live.start', payload: { sessionId: 'voice', sdp: 'v=0 offer' } });
    h.emit({ type: 'live_ready', sdp: 'v=0 answer', backendModel: 'chosen' }, 'other');
    expect(h.peer.answer).toBeUndefined();
    h.emit({ type: 'live_ready', sdp: 'v=0 answer', backendModel: 'chosen' });
    expect(h.peer.answer).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    h.channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) });
    expect(h.ready).toEqual(['chosen']);
    expect(h.track.enabled).toBe(true);
    h.connection.mute(true); expect(h.track.enabled).toBe(false);
    h.connection.mute(false); expect(h.track.enabled).toBe(true);
    h.emit({ type: 'live_event', sessionId: 'stale', event: { type: 'ignored' } });
    h.emit({ type: 'live_event', event: { type: 'session.delegation.created' } });
    expect(h.received).toEqual([{ type: 'session.delegation.created' }]);
    h.connection.send({ type: 'session.commentary.append', content: 'Done', delegation_id: 'a' });
    await tick();
    expect(h.requests.at(-1)?.operation).toBe('live.event');
  } finally { h.connection.close(); }
  expect(h.track.enabled).toBe(false);
  await tick();
  expect(h.coordinator.getSnapshot()).toBeNull();
  expect(h.released()).toBe(1);
  expect(h.requests.at(-1)?.operation).toBe('live.close');
});

test('closing while native permission is pending keeps the lease until late audio is released', async () => {
  const h = harness({ delayedAudio: true });
  const start = h.connection.start();
  h.connection.close();
  expect(h.coordinator.acquire('single-shot')).toBeNull();
  h.finishAudio();
  await start; await tick();
  expect(h.released()).toBe(1);
  expect(h.coordinator.getSnapshot()).toBeNull();
  expect(h.requests.some((request) => request.operation === 'live.start')).toBe(false);
  expect(h.errors).toEqual([]);
});

test('failed Live startup releases the microphone and ignores late ready events', async () => {
  const h = harness({ rejectStart: true });
  await h.connection.start(); await tick();
  expect(h.errors).toEqual(['No API credentials']);
  expect(h.coordinator.getSnapshot()).toBeNull();
  h.channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) });
  expect(h.ready).toEqual([]);
  expect(h.track.enabled).toBe(false);
});

test('Live cannot take the microphone from another voice feature', async () => {
  const h = harness();
  const lease = h.coordinator.acquire('continuous')!;
  await h.connection.start();
  expect(h.errors[0]).toContain('Another voice feature');
  expect(h.coordinator.getSnapshot()).toBe('continuous');
  expect(h.requests.some((request) => request.operation === 'live.start')).toBe(false);
  await lease.release();
});


test('mobile sends spoken result chunks in order and drops unsent chunks after End voice', async () => {
  const h = harness({ blockEvents: true });
  try {
    await h.connection.start();
    h.connection.send({ content: 'first' }); h.connection.send({ content: 'second' });
    await tick();
    const chunks = () => h.requests.filter((request) => request.operation === 'live.event').map((request) => request.payload.event.content);
    expect(chunks()).toEqual(['first']);
    h.releaseEvent(); await tick();
    expect(chunks()).toEqual(['first', 'second']);
    h.connection.send({ content: 'third' });
    h.connection.close(); h.releaseEvent(); await tick();
    expect(chunks()).toEqual(['first', 'second']);
  } finally { h.releaseEvent(); h.connection.close(); }
});

test('mobile negotiates the early answer but waits for control attachment before unmuting', async () => {
  const h = harness();
  try {
    await h.connection.start();
    h.emit({ type: 'live_answer', sdp: 'early', backendModel: 'chosen' });
    expect(h.peer.answer).toEqual({ type: 'answer', sdp: 'early' });
    h.channel.onmessage({ data: JSON.stringify({ type: 'session.started' }) });
    expect(h.ready).toEqual([]);
    expect(h.track.enabled).toBe(false);
    h.connection.mute(true);
    h.emit({ type: 'live_ready', sdp: 'early', backendModel: 'chosen' });
    expect(h.ready).toEqual(['chosen']);
    expect(h.track.enabled).toBe(false);
    h.connection.mute(false);
    expect(h.track.enabled).toBe(true);
  } finally { h.connection.close(); await tick(); }
});
