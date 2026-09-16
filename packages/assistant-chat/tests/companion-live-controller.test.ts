import { expect, test } from 'bun:test';
import { CompanionLiveController, type CompanionLiveConnectionOptions, type CompanionLivePlatform } from '../src/CompanionLiveController.js';
import { CompanionClientController } from '../src/companion-client.js';
import type { CompanionServerMessage } from '../src/companion.js';

test('reconnect preserves mute, backs off, ignores old callbacks, and stops after End', async () => {
  const h = harness();
  await h.live.start(target);
  const first = h.connections[0];
  first.options.onReady('backend');
  h.live.toggleMute();
  first.options.onError('disconnected');
  expect(first.closed).toBe(1);
  expect(h.live.getSnapshot()).toMatchObject({ status: 'connecting', muted: true });
  h.scheduled[0].callback();
  await tick();
  const second = h.connections[1];
  expect(second.muted).toBe(true);
  first.options.onReady('stale');
  first.options.onError('stale');
  first.options.onStop();
  expect(h.live.getSnapshot().status).toBe('connecting');
  second.options.onError('offline');
  expect(h.scheduled.map((entry) => entry.delay)).toEqual([1000, 2000]);
  h.scheduled[1].callback();
  await tick();
  h.connections[2].options.onReady('backend');
  h.connections[2].options.onError('disconnected again');
  expect(h.scheduled.map((entry) => entry.delay)).toEqual([1000, 2000, 1000]);
  await h.live.stop();
  expect(h.scheduled[2].cancelled).toBe(true);
  h.scheduled[2].callback();
  await tick();
  expect(h.connections).toHaveLength(3);
  expect(h.live.getSnapshot()).toMatchObject({ status: 'idle', muted: false, hasStarted: true });
  h.live.reset();
  expect(h.live.getSnapshot().hasStarted).toBe(false);
});

test('cancel during preparation cannot open audio later; a new start waits for it to settle', async () => {
  const preparation = deferred();
  let preparations = 0;
  const h = harness({ prepare: async () => { if (++preparations === 1) await preparation.promise; } });
  const abort = new AbortController();
  const first = h.live.start(target, abort.signal);
  await tick();
  abort.abort();
  expect(h.live.getSnapshot().status).toBe('idle');
  const next = h.live.start(target);
  await tick();
  expect(preparations).toBe(1);
  preparation.resolve();
  await Promise.all([first, next]);
  expect(preparations).toBe(2);
  expect(h.connections).toHaveLength(1);
  await h.live.stop();
});

test('pause/resume waits for audio cleanup and End cancels a waiting resume', async () => {
  const release = deferred();
  const h = harness({}, () => release.promise);
  await h.live.start(target);
  h.live.pause();
  const resume = h.live.resume();
  await tick();
  expect(h.connections).toHaveLength(1);
  const end = h.live.stop();
  release.resolve();
  await Promise.all([resume, end]);
  expect(h.connections).toHaveLength(1);
  expect(h.live.getSnapshot().status).toBe('idle');
});

test('a cancelled retry callback cannot create a second attempt while cleanup is pending', async () => {
  const release = deferred();
  const h = harness({}, () => release.promise);
  await h.live.start(target);
  h.connections[0].options.onError('disconnected');
  h.scheduled[0].callback();
  await tick();
  h.live.pause();
  const resume = h.live.resume();
  h.scheduled[0].callback();
  release.resolve();
  await resume;
  expect(h.connections).toHaveLength(2);
  h.connections[1].options.onReady('current');
  expect(h.live.getSnapshot().status).toBe('listening');
  await h.live.stop();
});

test('startup cancellation never ends an established session or a newer resume', async () => {
  const start = deferred();
  const h = harness({}, undefined, () => start.promise);
  const firstAbort = new AbortController();
  const first = h.live.start(target, firstAbort.signal);
  await tick();
  h.live.pause();
  const resumed = h.live.resume();
  await tick();
  firstAbort.abort();
  expect(h.connections).toHaveLength(2);
  expect(h.connections[1].closed).toBe(0);
  start.resolve();
  await Promise.all([first, resumed]);
  h.connections[1].options.onReady('backend');
  const attached = new AbortController();
  await h.live.start(target, attached.signal);
  attached.abort();
  expect(h.live.getSnapshot().status).toBe('listening');
  await h.live.stop();
});

test('aborting the initiating request after startup does not end the call', async () => {
  const h = harness();
  const abort = new AbortController();
  await h.live.start(target, abort.signal);
  abort.abort();
  h.connections[0].options.onReady('backend');
  expect(h.live.getSnapshot().status).toBe('listening');
  await h.live.stop();
});

test('backend completions during preparation wait for readiness', async () => {
  let receive!: (message: CompanionServerMessage) => void;
  let messageId = '';
  let cancellations = 0;
  const backend = new CompanionClientController({ createId: () => 'backend' });
  await backend.submitPrompt({ prompt: 'work', executeTool: () => ({}), createTransport: () => ({
    open: async (options) => { receive = options.onMessage; },
    sendPrompt: (input) => { messageId = input.messageId; }, sendToolResult() {},
    cancel() { cancellations++; }, close() {},
  }) });
  const prepare = deferred();
  const h = harness({ prepare: () => prepare.promise }, undefined, undefined, backend);
  const starting = h.live.start(target);
  receive({ type: 'reply', messageId, reply: 'Finished' });
  receive({ type: 'status', messageId, status: 'completed' });
  prepare.resolve();
  await starting;
  expect(h.connections[0].sent).toEqual([]);
  h.connections[0].options.onReady('backend');
  expect(h.connections[0].sent).toEqual([{ type: 'session.thinking.append', delegation_id: null, content: 'Finished' }]);
  h.live.pause();
  expect(cancellations).toBe(0);
  await h.live.stop();
  await backend.close();
});

test('browser playback recovery is exposed without stale playback updates', async () => {
  const h = harness();
  await h.live.start(target);
  const first = h.connections[0];
  first.options.onPlaybackBlocked(true);
  h.live.play();
  expect(first.played).toBe(1);
  expect(h.live.getSnapshot().playbackBlocked).toBe(true);
  await h.live.stop();
  first.options.onPlaybackBlocked(true);
  expect(h.live.getSnapshot().playbackBlocked).toBe(false);
});

test('a setup failure retries and a disabled platform cannot start capture', async () => {
  let available = false;
  let prepared = 0;
  const h = harness({ canStart: () => available, prepare: async () => { if (++prepared === 1) throw new Error('Permission unavailable'); } });
  await h.live.start(target);
  expect(h.live.getSnapshot().hasStarted).toBe(false);
  available = true;
  await h.live.start(target);
  expect(h.live.getSnapshot().status).toBe('connecting');
  h.scheduled[0].callback();
  await tick();
  expect(h.connections).toHaveLength(1);
  await h.live.stop();
});

test('failed paused controls end the session without reviving it or blocking cleanup', async () => {
  const h = harness({ stopped: async (_released, paused) => { if (paused) throw new Error('Controls unavailable'); } });
  await h.live.start(target);
  h.live.pause();
  await tick();
  expect(h.live.getSnapshot().status).toBe('idle');
  await h.live.resume();
  expect(h.connections).toHaveLength(1);
  await h.live.stop();
});


test('a subscriber can cancel startup while its connecting snapshot is published', async () => {
  const h = harness();
  const abort = new AbortController();
  const unsubscribe = h.live.subscribe(() => {
    if (h.live.getSnapshot().status === 'connecting') abort.abort();
  });
  try {
    await h.live.start(target, abort.signal);
    expect(h.connections).toHaveLength(0);
    expect(h.live.getSnapshot().status).toBe('idle');
  } finally { unsubscribe(); await h.live.stop(); }
});

test('failed control updates cannot let a resumed session overtake microphone cleanup', async () => {
  const released = deferred();
  const h = harness({ stopped: async () => { throw new Error('Controls unavailable'); } }, () => released.promise);
  let resumed: Promise<void> | undefined;
  try {
    await h.live.start(target);
    h.live.pause();
    resumed = h.live.resume();
    await tick();
    expect(h.connections).toHaveLength(1);
    released.resolve();
    await resumed;
    expect(h.connections).toHaveLength(2);
  } finally { released.resolve(); await resumed; await h.live.stop(); }
});

for (const phase of ['startup', 'reconnect']) test(`pause during ${phase} notification prevents connection`, async () => {
  const h = harness();
  if (phase === 'reconnect') {
    await h.live.start(target);
    h.connections[0].options.onReady('backend');
  }
  const count = h.connections.length;
  const unsubscribe = h.live.subscribe(() => {
    if (h.live.getSnapshot().status === 'connecting') h.live.pause();
  });
  try {
    if (phase === 'reconnect') h.connections[0].options.onError('disconnected');
    else await h.live.start(target);
    for (const retry of h.scheduled) retry.callback();
    await tick();
    expect(h.live.getSnapshot().status).toBe('paused');
    expect(h.connections).toHaveLength(count);
  } finally { unsubscribe(); await h.live.stop(); }
});

const target = { id: 'hub', name: 'Hub', run: async () => 'reply' };

function harness(platform: Partial<CompanionLivePlatform> = {}, release = async () => {}, start = async () => {}, backend?: CompanionClientController) {
  const connections: Array<{ options: CompanionLiveConnectionOptions; closed: number; muted: boolean; played: number; sent: Record<string, unknown>[] }> = [];
  const scheduled: Array<{ callback(): void; delay: number; cancelled: boolean }> = [];
  const live = new CompanionLiveController({
    createConnection(options) {
      const record = { options, closed: 0, muted: false, played: 0, sent: [] as Record<string, unknown>[] };
      connections.push(record);
      return {
        start,
        close: async () => { record.closed++; await release(); },
        mute: (muted) => { record.muted = muted; },
        play: async () => { record.played++; },
        send: (event) => { record.sent.push(event); },
      };
    },
    schedule(callback, delay) {
      const entry = { callback, delay, cancelled: false };
      scheduled.push(entry);
      return () => { entry.cancelled = true; };
    },
    ...platform,
  }, backend);
  return { live, connections, scheduled };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function tick() { await new Promise((resolve) => setTimeout(resolve, 0)); }
