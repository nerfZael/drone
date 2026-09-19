import { afterEach, describe, expect, test } from 'bun:test';

import {
  applySpeechPlaybackSettings,
  enqueueBase64SpeechAudio,
  holdSpeechPlayback,
  playBase64SpeechAudio,
} from '../src/droneHub/media/speech-playback';
import { connectCompanionVolume, getCompanionVolume, setCompanionVolume } from '../src/droneHub/companion/companion-volume';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as any).window;
});

describe('speech playback', () => {
  test('decodes WAV audio, starts playback, and releases the object URL when it ends', async () => {
    const listeners = new Map<string, () => void>();
    const revoked: string[] = [];
    let playedUrl = '';
    class FakeAudio {
      constructor(url: string) {
        playedUrl = url;
      }

      addEventListener(name: string, listener: () => void) {
        listeners.set(name, listener);
      }

      async play() {}
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        atob,
        Audio: FakeAudio,
        URL: {
          createObjectURL: () => 'blob:speech',
          revokeObjectURL: (url: string) => revoked.push(url),
        },
      },
    });

    const playback = playBase64SpeechAudio({ data: 'AQID', mimeType: 'audio/wav', volume: 0.4 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(playedUrl).toBe('blob:speech');
    expect(revoked).toEqual([]);

    listeners.get('ended')?.();
    await playback;
    expect(revoked).toEqual(['blob:speech']);
  });

  test('plays queued audio one at a time in enqueue order', async () => {
    const listeners: Array<Map<string, () => void>> = [];
    const played: string[] = [];
    let objectUrlSequence = 0;
    class FakeAudio {
      private readonly events = new Map<string, () => void>();

      volume = 1;

      constructor(private readonly url: string) {
        listeners.push(this.events);
      }

      addEventListener(name: string, listener: () => void) {
        this.events.set(name, listener);
      }

      async play() {
        played.push(`${this.url}:${this.volume}`);
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        atob,
        Audio: FakeAudio,
        URL: {
          createObjectURL: () => `blob:speech-${++objectUrlSequence}`,
          revokeObjectURL: () => {},
        },
      },
    });

    const first = enqueueBase64SpeechAudio({ data: 'AQ==', volume: 0.25 });
    const second = enqueueBase64SpeechAudio({ data: 'Ag==', volume: 0.8 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(played).toEqual(['blob:speech-1:0.25']);

    listeners[0]?.get('ended')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(played).toEqual(['blob:speech-1:0.25', 'blob:speech-2:0.8']);

    listeners[1]?.get('ended')?.();
    await Promise.all([first, second]);
  });

  test('rejects unsupported audio types', async () => {
    await expect(playBase64SpeechAudio({ data: 'AQID', mimeType: 'audio/mpeg' })).rejects.toThrow(
      'Unsupported speech audio type',
    );
  });

  test('mute settings stop current playback and discard already queued audio', async () => {
    const listeners: Array<Map<string, () => void>> = [];
    const played: string[] = [];
    const paused: string[] = [];
    let objectUrlSequence = 0;
    class FakeAudio {
      private readonly events = new Map<string, () => void>();

      volume = 1;

      constructor(private readonly url: string) {
        listeners.push(this.events);
      }

      addEventListener(name: string, listener: () => void) {
        this.events.set(name, listener);
      }

      async play() {
        played.push(`${this.url}:${this.volume}`);
      }

      pause() {
        paused.push(this.url);
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        atob,
        Audio: FakeAudio,
        URL: {
          createObjectURL: () => `blob:speech-${++objectUrlSequence}`,
          revokeObjectURL: () => {},
        },
      },
    });

    const first = enqueueBase64SpeechAudio({ data: 'AQ==', volume: 1 });
    const second = enqueueBase64SpeechAudio({ data: 'Ag==', volume: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    applySpeechPlaybackSettings({ enabled: true, muted: true, volume: 0.4 });
    await Promise.all([first, second]);

    expect(played).toEqual(['blob:speech-1:1']);
    expect(paused).toEqual(['blob:speech-1']);

    applySpeechPlaybackSettings({ enabled: true, muted: false, volume: 0.4 });
    const resumed = enqueueBase64SpeechAudio({ data: 'Aw==', volume: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(played).toEqual(['blob:speech-1:1', 'blob:speech-2:0.4']);
    listeners[1]?.get('ended')?.();
    await resumed;
  });
});

describe('speech playback while the user records', () => {
  function fakeWindow() {
    const audios: FakeAudio[] = [];
    class FakeAudio {
      listeners = new Map<string, () => void>();
      paused = true; plays = 0; pauses = 0; currentTime = 2; volume = 1;
      constructor(public url: string) { audios.push(this); }
      addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener); }
      async play() { this.paused = false; this.plays++; }
      pause() { this.paused = true; this.pauses++; }
      end() { this.listeners.get('ended')?.(); }
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { atob, Audio: FakeAudio, URL: { createObjectURL: () => 'blob:speech', revokeObjectURL: () => {} } } });
    return audios;
  }
  const clip = { data: Buffer.from('RIFF').toString('base64'), mimeType: 'audio/wav' };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  test('queued speech waits for the recording to end and then plays', async () => {
    const audios = fakeWindow();
    applySpeechPlaybackSettings({ enabled: true, muted: false, volume: 1 });
    const release = holdSpeechPlayback();
    const spoken = enqueueBase64SpeechAudio(clip);
    await tick();
    expect(audios).toHaveLength(0);
    release();
    await tick();
    expect(audios).toHaveLength(1);
    expect(audios[0].plays).toBe(1);
    audios[0].end();
    await spoken;
  });

  test('speech already playing pauses when recording starts and resumes just before where it stopped', async () => {
    const audios = fakeWindow();
    applySpeechPlaybackSettings({ enabled: true, muted: false, volume: 1 });
    const spoken = enqueueBase64SpeechAudio(clip);
    await tick();
    expect(audios[0].plays).toBe(1);
    // Two recorders (Companion and a chat) may overlap; speech stays paused until both are done.
    const first = holdSpeechPlayback(); const second = holdSpeechPlayback();
    expect(audios[0].paused).toBe(true);
    first(); first();
    expect(audios[0].paused).toBe(true);
    second();
    expect(audios[0].paused).toBe(false);
    expect(audios[0].plays).toBe(2);
    expect(audios[0].currentTime).toBeCloseTo(1.4);
    audios[0].end();
    await spoken;
  });

  test('muting while held cancels instead of resuming later', async () => {
    const audios = fakeWindow();
    applySpeechPlaybackSettings({ enabled: true, muted: false, volume: 1 });
    const spoken = enqueueBase64SpeechAudio(clip);
    await tick();
    const release = holdSpeechPlayback();
    const waiting = enqueueBase64SpeechAudio(clip);
    applySpeechPlaybackSettings({ enabled: true, muted: true, volume: 1 });
    await spoken;
    release();
    await waiting;
    expect(audios).toHaveLength(1);
    expect(audios[0].plays).toBe(1);
    applySpeechPlaybackSettings({ enabled: true, muted: false, volume: 1 });
  });
});

// Last in this file: the speech settings are module state, and the tests above rely on their defaults.
test('muting speech silences the live voice and leaves the Companion volume, which the cue sounds use, alone', () => {
  const gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const parameter = () => ({ value: 0 });
  const context = { destination: {}, createGain: () => gain,
    createDynamicsCompressor: () => ({ threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(), connect() {}, disconnect() {} }) };
  try {
    setCompanionVolume(1.2);
    const voice = connectCompanionVolume(context as unknown as AudioContext);
    expect(gain.gain.value).toBe(1.2);
    applySpeechPlaybackSettings({ enabled: true, muted: true, volume: 1 });
    expect(gain.gain.value).toBe(0);
    expect(getCompanionVolume()).toBe(1.2);
    setCompanionVolume(0.8);
    expect(gain.gain.value).toBe(0);
    applySpeechPlaybackSettings({ enabled: true, muted: false, volume: 1 });
    expect(gain.gain.value).toBe(0.8);
    voice.release();
    applySpeechPlaybackSettings({ enabled: true, muted: true, volume: 1 });
    expect(gain.gain.value).toBe(0.8);
  } finally { applySpeechPlaybackSettings({ enabled: true, muted: false, volume: 1 }); setCompanionVolume(1); }
});
