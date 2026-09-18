import { expect, test } from 'bun:test';
import { openBrowserLivePcmAudio } from '../src/droneHub/companion/browser-live-pcm-audio';
import type { AnnouncementPlayback } from '../src/droneHub/companion/CompanionLiveAnnouncement';
import { getCompanionVolume, setCompanionVolume } from '../src/droneHub/companion/companion-volume';

function harness(options: { pendingClose?: boolean; pendingResume?: boolean; pendingPermission?: boolean } = {}) {
  const originals = new Map(['AudioContext', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let finishClose!: () => void;
  let allowMicrophone!: () => void;
  let stopped = 0; let closed = 0; let scheduled = 0;
  const errors: string[] = [];
  const playback: unknown[] = [];
  let now = 0; let nodesStopped = 0;
  const starts: number[] = [];
  const nodes: Array<{ onended: (() => void) | null }> = [];
  const gains: Array<{ gain: { value: number } }> = []; const targets: unknown[] = []; let gainsReleased = 0;
  const announcements: AnnouncementPlayback[] = [];
  const blocked: boolean[] = [];
  const track = { enabled: true, onended: null, stop() { stopped++; } };
  const microphone = { getTracks: () => [track] };
  class FakeContext {
    sampleRate = 24_000; get currentTime() { return now; } state = options.pendingResume ? 'suspended' : 'running'; destination = {};
    resume() { return options.pendingResume ? new Promise<void>(() => {}) : Promise.resolve(); }
    close() { closed++; return options.pendingClose ? new Promise<void>((resolve) => { finishClose = resolve; }) : Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} }; }
    createBuffer(_channels: number, samples: number) {
      return { duration: samples / 24_000, getChannelData: () => new Float32Array(samples) };
    }
    createGain() { const node = { gain: { value: 1 }, connect() {}, disconnect() { gainsReleased++; } }; gains.push(node); return node; }
    createDynamicsCompressor() { const param = () => ({ value: 0 }); return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {} }; }
    createBufferSource() {
      const node = { buffer: null, onended: null, connect(target: unknown) { targets.push(target); }, disconnect() {}, stop() { nodesStopped++; }, start(when: number) { scheduled++; starts.push(when); } };
      nodes.push(node);
      return node;
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: () => options.pendingPermission ? new Promise((resolve) => { allowMicrophone = () => resolve(microphone); }) : Promise.resolve(microphone),
  } } });
  const abort = new AbortController();
  return { gains, targets, gainsReleased: () => gainsReleased, abort, errors, starts, playback, announcements, blocked, track, ended: (index: number) => nodes[index].onended?.(),
    at: (time: number) => { now = time; }, nodesStopped: () => nodesStopped,
    open: (announcement = false) => openBrowserLivePcmAudio({ signal: abort.signal, onAudio() {}, onPlayback: event => playback.push(event), onError: (error) => errors.push(error) }, value => blocked.push(value),
      announcement ? { muted: true, onAnnouncementPlayback: event => announcements.push(event) } : {}),
    finishClose: () => finishClose(), allowMicrophone: () => allowMicrophone(),
    stopped: () => stopped, closed: () => closed, scheduled: () => scheduled,
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test('browser abort and explicit release share the pending audio shutdown', async () => {
  const h = harness({ pendingClose: true });
  try {
    const audio = await h.open();
    h.abort.abort();
    let released = false;
    const release = audio.release().then(() => { released = true; });
    await Promise.resolve();
    expect(h.stopped()).toBe(1); expect(h.closed()).toBe(1); expect(released).toBe(false);
    h.finishClose(); await release;
    expect(released).toBe(true);
  } finally { h.restore(); }
});

test('browser cancellation settles startup while autoplay resume is pending', async () => {
  const h = harness({ pendingResume: true });
  try {
    const pending = h.open();
    await Promise.resolve();
    h.abort.abort();
    await expect(pending).rejects.toThrow('Voice conversation ended.');
    expect(h.stopped()).toBe(1); expect(h.closed()).toBe(1);
  } finally { h.restore(); }
});

test('browser stops a microphone granted after cancellation', async () => {
  const h = harness({ pendingPermission: true });
  try {
    const pending = h.open(); h.abort.abort(); h.allowMicrophone();
    await expect(pending).rejects.toThrow('Voice conversation ended.');
    expect(h.stopped()).toBe(1); expect(h.closed()).toBe(1);
  } finally { h.restore(); }
});

test('browser playback limit includes the incoming chunk', async () => {
  const h = harness();
  try {
    const audio = await h.open();
    const threeSeconds = Buffer.alloc(48_000 * 3).toString('base64');
    audio.play(threeSeconds); audio.play(threeSeconds);
    expect(h.scheduled()).toBe(1);
    expect(h.errors).toEqual(['Live voice playback fell behind. Start again.']);
    await audio.release();
  } finally { h.restore(); }
});


test('browser absorbs delayed chunks without gaps or growing playback latency', async () => {
  const h = harness();
  try {
    const audio = await h.open();
    const chunk = Buffer.alloc(4800).toString('base64'); // 100 ms
    let arrival = 0;
    for (let i = 0; i < 40; i++) {
      const delay = ({ 5: 0.08, 15: 0.16, 25: 0.24 } as Record<number, number>)[i] ?? 0;
      arrival = Math.max(arrival, i / 10 + delay); // Ordered, sometimes batched delivery.
      h.at(arrival); audio.play(chunk);
      expect(h.starts[i]).toBeCloseTo(0.25 + i / 10, 8);
    }
    expect(h.errors).toEqual([]);
    await audio.release();
  } finally { h.restore(); }
});

test('browser rebuilds reserve after starvation and plays a short final chunk', async () => {
  const h = harness();
  try {
    const audio = await h.open();
    const chunk = Buffer.alloc(4800).toString('base64');
    audio.play(chunk);
    h.at(1); audio.play(chunk);
    h.at(1.1); audio.play(Buffer.alloc(480).toString('base64')); // 10 ms tail
    expect(h.starts).toEqual([0.25, 1.25, 1.35]);
    await audio.release();
    expect(h.nodesStopped()).toBe(3);
    h.at(2); audio.play(chunk);
    expect(h.starts).toHaveLength(3);
  } finally { h.restore(); }
});

test('browser backlog bound includes the reserve', async () => {
  const h = harness();
  try {
    const audio = await h.open();
    audio.play(Buffer.alloc(48_000 * 3).toString('base64'));
    audio.play(Buffer.alloc(48_000 * 1.8).toString('base64'));
    expect(h.starts).toHaveLength(1);
    expect(h.errors).toEqual(['Live voice playback fell behind. Start again.']);
    await audio.release();
  } finally { h.restore(); }
});

test('playback timing reports the audio-clock reserve without claiming audio has completed', async () => {
  const h = harness();
  try {
    const audio = await h.open();
    audio.play(btoa('\0'.repeat(4800)), 7);
    expect(h.playback).toEqual([{ stage: 'scheduled', sampleId: 7, queueMs: 250, durationMs: 100 }]);
    await audio.release();
    expect(h.playback).toHaveLength(1);
  } finally { h.restore(); }
});

test('announcement playback distinguishes silence and waits for actual audio completion', async () => {
  const h = harness();
  try {
    const audio = await h.open(true);
    expect(h.track.enabled).toBe(false);
    audio.play(Buffer.alloc(4_800).toString('base64'));
    audio.play(Buffer.alloc(4_800, 32).toString('base64'));
    expect(h.announcements).toEqual([{ stage: 'scheduled', silent: true }, { stage: 'scheduled', silent: false }]);
    h.ended(0); h.ended(1);
    expect(h.announcements.slice(2)).toEqual([{ stage: 'completed', silent: true }, { stage: 'completed', silent: false }]);
    await audio.release();
  } finally { h.restore(); }
});

test('automatic announcement exposes blocked playback without hanging startup on an autoplay gesture', async () => {
  const h = harness({ pendingResume: true });
  try {
    const audio = await h.open(true);
    expect(h.blocked).toEqual([true]);
    expect(h.track.enabled).toBe(false);
    await audio.release();
    expect(h.closed()).toBe(1);
  } finally { h.restore(); }
});

test('live voice plays through the Companion volume, follows the slider while speaking, and lets go on release', async () => {
  const h = harness();
  try {
    setCompanionVolume(1.5);
    const audio = await h.open();
    expect(h.gains).toHaveLength(1);
    expect(h.gains[0].gain.value).toBe(1.5);
    audio.play(Buffer.alloc(4_800).toString('base64'));
    expect(h.targets).toEqual([h.gains[0]]);
    setCompanionVolume(0.4);
    expect(h.gains[0].gain.value).toBe(0.4);
    setCompanionVolume(9);
    expect(getCompanionVolume()).toBe(2);
    await audio.release();
    expect(h.gainsReleased()).toBe(1);
    setCompanionVolume(1);
    expect(h.gains[0].gain.value).toBe(2);
  } finally { setCompanionVolume(1); h.restore(); }
});
