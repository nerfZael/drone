import { expect, test } from 'bun:test';
import { openBrowserLivePcmAudio } from '../src/droneHub/companion/browser-live-pcm-audio';

function harness(options: { pendingClose?: boolean; pendingResume?: boolean; pendingPermission?: boolean } = {}) {
  const originals = new Map(['AudioContext', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let finishClose!: () => void;
  let allowMicrophone!: () => void;
  let stopped = 0; let closed = 0; let scheduled = 0;
  const errors: string[] = [];
  const track = { enabled: true, onended: null, stop() { stopped++; } };
  const microphone = { getTracks: () => [track] };
  class FakeContext {
    sampleRate = 24_000; currentTime = 0; state = 'running'; destination = {};
    resume() { return options.pendingResume ? new Promise<void>(() => {}) : Promise.resolve(); }
    close() { closed++; return options.pendingClose ? new Promise<void>((resolve) => { finishClose = resolve; }) : Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} }; }
    createBuffer(_channels: number, samples: number) {
      return { duration: samples / 24_000, getChannelData: () => new Float32Array(samples) };
    }
    createBufferSource() { return { buffer: null, onended: null, connect() {}, disconnect() {}, stop() {}, start() { scheduled++; } }; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: () => options.pendingPermission ? new Promise((resolve) => { allowMicrophone = () => resolve(microphone); }) : Promise.resolve(microphone),
  } } });
  const abort = new AbortController();
  return { abort, errors, open: () => openBrowserLivePcmAudio({ signal: abort.signal, onAudio() {}, onError: (error) => errors.push(error) }, () => {}),
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
