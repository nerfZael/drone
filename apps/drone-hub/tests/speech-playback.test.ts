import { afterEach, describe, expect, test } from 'bun:test';

import {
  applySpeechPlaybackSettings,
  enqueueBase64SpeechAudio,
  playBase64SpeechAudio,
} from '../src/droneHub/media/speech-playback';

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
