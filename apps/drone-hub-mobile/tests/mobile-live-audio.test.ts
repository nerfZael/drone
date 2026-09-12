import { expect, mock, test } from 'bun:test';
const calls: string[] = [];
let failMicrophone = false; let stopped!: () => void;
let sequence = 0;
let pauseMode = false;
let finishMode: (() => void) | undefined;
let pauseMicrophone = false;
let finishMicrophone: (() => void) | undefined;
let recordingMode = false;
let microphoneRunning = false;
const listeners = new Map<string, (event: any) => void>();
mock.module('react-native', () => ({ Platform: { OS: 'android' }, AppState: { currentState: 'active' } }));
mock.module('expo-crypto', () => ({ randomUUID: () => `audio-${++sequence}` }));
mock.module('expo-audio', () => ({
  getRecordingPermissionsAsync: async () => ({ granted: true }), requestRecordingPermissionsAsync: async () => ({ granted: true }),
  requestNotificationPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async (mode: { shouldPlayInBackground: boolean }) => {
    if (pauseMode && mode.shouldPlayInBackground) await new Promise<void>((resolve) => { finishMode = resolve; });
    recordingMode = mode.shouldPlayInBackground;
    calls.push(`background:${mode.shouldPlayInBackground}`);
  },
}));
mock.module('../src/local-assistant/mobile-live-background', () => ({
  startMobileLiveBackground: async (onStopped: () => void) => { calls.push('service.start'); stopped = onStopped; return async () => { calls.push('service.stop'); }; },
}));
mock.module('expo-modules-core', () => ({ requireOptionalNativeModule: () => ({
  startPcm: async (id: string) => {
    calls.push('microphone.open'); if (failMicrophone) throw new Error('Microphone unavailable');
    if (pauseMicrophone) await new Promise<void>((resolve) => { finishMicrophone = resolve; });
    microphoneRunning = true;
    listeners.get('pcmAudio')?.({ id, audio: 'AQI=' });
  },
  stopPcm: async () => { microphoneRunning = false; calls.push('microphone.stop'); },
  playPcm: async (_id: string, audio: string) => { calls.push(`play:${audio}`); },
  mutePcm: async () => {},
  addListener: (event: string, callback: (event: any) => void) => {
    listeners.set(event, callback); return { remove() { listeners.delete(event); } };
  },
}) }));
const { openMobileLiveAudio } = await import('../src/local-assistant/openMobileLiveAudio');

test('native Live captures during startup and releases audio before background protection', async () => {
  calls.length = 0; const captured: string[] = []; let stopRequested = false;
  const audio = await openMobileLiveAudio({ onAudio: (data) => captured.push(data), onError() {} }, () => { stopRequested = true; });
  expect(calls).toEqual(['service.start', 'background:true', 'microphone.open']); expect(captured).toEqual(['AQI=']);
  listeners.get('pcmAudio')?.({ id: 'stale', audio: 'AwQ=' }); expect(captured).toHaveLength(1);
  audio.play('BQY='); expect(calls.at(-1)).toBe('play:BQY=');
  stopped(); expect(stopRequested).toBe(true);
  await audio.release(); await audio.release();
  expect(calls.slice(-3)).toEqual(['microphone.stop', 'background:false', 'service.stop']); expect(listeners.size).toBe(0);
});

test('native startup failure releases microphone, listeners and background protection', async () => {
  calls.length = 0; failMicrophone = true;
  try {
    await expect(openMobileLiveAudio({ onAudio() {}, onError() {} })).rejects.toThrow('Microphone unavailable');
    expect(calls).toEqual(['service.start', 'background:true', 'microphone.open', 'microphone.stop', 'background:false', 'service.stop']);
    expect(listeners.size).toBe(0);
  } finally { failMicrophone = false; }
});

test('aborting pending audio setup cannot open the microphone after cleanup', async () => {
  calls.length = 0; pauseMode = true;
  const abort = new AbortController();
  Object.defineProperty(abort.signal, 'throwIfAborted', { value: undefined });
  const pending = openMobileLiveAudio({ signal: abort.signal, onAudio() {}, onError() {} });
  const failed = pending.catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  abort.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).not.toContain('service.stop');
  finishMode?.();
  await failed;
  pauseMode = false;
  expect(calls).not.toContain('microphone.open');
  expect(calls.filter((call) => call === 'microphone.stop')).toHaveLength(1);
  expect(calls.at(-1)).toBe('service.stop');
  expect(recordingMode).toBe(false);
  expect(listeners.size).toBe(0);
});

test('aborting native microphone startup waits for its completion before stopping it', async () => {
  calls.length = 0; pauseMicrophone = true;
  const abort = new AbortController(); const captured: string[] = [];
  const pending = openMobileLiveAudio({ signal: abort.signal, onAudio: (audio) => captured.push(audio), onError() {} });
  const failed = pending.catch((error) => error);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).not.toContain('microphone.stop');
    finishMicrophone?.();
    expect(await failed).toBeInstanceOf(Error);
    expect(captured).toEqual([]);
    expect(microphoneRunning).toBe(false);
    expect(recordingMode).toBe(false);
    expect(calls.slice(-3)).toEqual(['microphone.stop', 'background:false', 'service.stop']);
    expect(listeners.size).toBe(0);
  } finally { pauseMicrophone = false; finishMicrophone?.(); await failed; }
});

test('paused Live stops capture and plays its cue before releasing shared audio mode', async () => {
  calls.length = 0;
  const audio = await openMobileLiveAudio({ onAudio() {}, onError() {} }, () => {}, {
    backgroundAlreadyStarted: true,
    onCaptureStopped: async () => { expect(microphoneRunning).toBe(false); calls.push('cue.stopped'); },
  });
  await audio.release();
  expect(calls).toEqual(['background:true', 'microphone.open', 'microphone.stop', 'cue.stopped', 'background:false']);
});
