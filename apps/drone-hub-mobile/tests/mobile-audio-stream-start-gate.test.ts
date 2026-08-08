import { describe, expect, test } from 'bun:test';
import { MobileAudioStreamStartGate } from '../src/local-assistant/mobile-audio-stream-start-gate';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('mobile audio stream start gate', () => {
  test('cancels startup before native capture begins', async () => {
    const gate = new MobileAudioStreamStartGate();
    const audioMode = deferred();
    let nativeStarts = 0;
    let nativeStops = 0;
    const start = gate.start(async (isCurrent) => {
      await audioMode.promise;
      if (!isCurrent()) return;
      nativeStarts += 1;
    });
    const cancel = gate.cancel(() => {
      nativeStops += 1;
    });

    audioMode.resolve();
    await cancel;

    expect(await start).toBe(false);
    expect(nativeStarts).toBe(0);
    expect(nativeStops).toBe(2);
  });

  test('stops again after a native start that was already pending', async () => {
    const gate = new MobileAudioStreamStartGate();
    const nativeStart = deferred();
    let nativeStops = 0;
    const start = gate.start(async (isCurrent) => {
      expect(isCurrent()).toBe(true);
      await nativeStart.promise;
    });
    const cancel = gate.cancel(() => {
      nativeStops += 1;
    });

    nativeStart.resolve();
    await cancel;

    expect(await start).toBe(false);
    expect(nativeStops).toBe(2);
  });

  test('coalesces rapid duplicate starts', async () => {
    const gate = new MobileAudioStreamStartGate();
    const activation = deferred();
    let starts = 0;
    const operation = async () => {
      starts += 1;
      await activation.promise;
    };
    const first = gate.start(operation);
    const second = gate.start(operation);

    activation.resolve();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(starts).toBe(1);
  });

  test('allows retry after a failed native start', async () => {
    const gate = new MobileAudioStreamStartGate();

    await expect(
      gate.start(async () => {
        throw new Error('native start failed');
      }),
    ).rejects.toThrow('native start failed');

    expect(await gate.start(async () => undefined)).toBe(true);
  });
});
