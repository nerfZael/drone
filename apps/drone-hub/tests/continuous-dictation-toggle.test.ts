import { describe, expect, test } from 'bun:test';
import type { ContinuousVoiceSessionStatus } from '@drone/assistant-chat';
import { createContinuousDictationToggle } from '../src/droneHub/chat/create-continuous-dictation-toggle';

function deferred() {
  let resolve = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('continuous dictation toggle', () => {
  test('keeps composer text when dictation stops and starts again', async () => {
    let status: ContinuousVoiceSessionStatus = 'listening';
    let composerText = 'Existing dictation';
    const toggle = createContinuousDictationToggle({
      getStatus: () => status,
      start: async () => {
        status = 'listening';
        return true;
      },
      stop: async () => {
        status = 'stopping';
        composerText = `${composerText}\nFinal dictated phrase`;
        status = 'idle';
      },
      cancel: () => {
        status = 'idle';
      },
      onStartIntent: () => undefined,
    });
    toggle.sync(true);

    await toggle.toggle();
    expect(composerText).toBe('Existing dictation\nFinal dictated phrase');
    expect(status).toBe('idle');

    await toggle.toggle();
    expect(composerText).toBe('Existing dictation\nFinal dictated phrase');
    expect(status).toBe('listening');
  });

  test('preserves composer text during a rapid restart', async () => {
    let status: ContinuousVoiceSessionStatus = 'listening';
    const composerText = 'Existing dictation';
    let starts = 0;
    let cancels = 0;
    const stopFinished = deferred();
    const toggle = createContinuousDictationToggle({
      getStatus: () => status,
      start: async () => {
        starts += 1;
        status = 'listening';
        return true;
      },
      stop: async () => {
        status = 'stopping';
        await stopFinished.promise;
        status = 'idle';
      },
      cancel: () => {
        cancels += 1;
        status = 'idle';
        stopFinished.resolve();
      },
      onStartIntent: () => undefined,
    });
    toggle.sync(true);

    const stop = toggle.toggle();
    expect(status).toBe('stopping');
    expect(composerText).toBe('Existing dictation');

    const restart = toggle.toggle();
    expect(composerText).toBe('Existing dictation');
    expect(cancels).toBe(1);

    await Promise.all([stop, restart]);
    expect(starts).toBe(1);
    expect(status).toBe('listening');
  });

  test('cancels an in-flight start when toggled off without opening a second recording', async () => {
    let status: ContinuousVoiceSessionStatus = 'idle';
    let generation = 0;
    let starts = 0;
    let stops = 0;
    const permissionFinished = deferred();
    const toggle = createContinuousDictationToggle({
      getStatus: () => status,
      start: async () => {
        starts += 1;
        const attempt = ++generation;
        status = 'starting';
        await permissionFinished.promise;
        if (attempt !== generation) return false;
        status = 'listening';
        return true;
      },
      stop: async () => {
        stops += 1;
        status = 'idle';
      },
      cancel: () => {
        generation += 1;
        status = 'idle';
        permissionFinished.resolve();
      },
      onStartIntent: () => undefined,
    });

    const start = toggle.toggle();
    const stop = toggle.toggle();
    await Promise.all([start, stop]);

    expect(starts).toBe(1);
    expect(stops).toBe(0);
    expect(status).toBe('idle');
  });

  test('does not run a queued restart after its provider lifecycle ends', async () => {
    let status: ContinuousVoiceSessionStatus = 'listening';
    let starts = 0;
    const stopFinished = deferred();
    const toggle = createContinuousDictationToggle({
      getStatus: () => status,
      start: async () => {
        starts += 1;
        status = 'listening';
        return true;
      },
      stop: async () => {
        status = 'stopping';
        await stopFinished.promise;
        status = 'idle';
      },
      cancel: () => {
        status = 'idle';
        stopFinished.resolve();
      },
      onStartIntent: () => undefined,
    });
    toggle.sync(true);

    const stop = toggle.toggle();
    const restart = toggle.toggle();
    toggle.deactivate();
    await Promise.all([stop, restart]);

    expect(starts).toBe(0);
    expect(status).toBe('idle');
  });
});
