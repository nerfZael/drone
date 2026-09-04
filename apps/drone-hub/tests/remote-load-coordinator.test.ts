import { describe, expect, test } from 'bun:test';

import { createRemoteLoadCoordinator } from '../src/droneHub/app/remote-load-coordinator';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe('remote load coordinator', () => {
  test('queues one trailing event refresh behind an in-flight poll', async () => {
    const first = deferred();
    const calls: boolean[] = [];
    const coordinator = createRemoteLoadCoordinator(async (_key, options) => {
      calls.push(options.quiet);
      if (calls.length === 1) await first.promise;
    });

    const poll = coordinator.request('drones', { quiet: true });
    const event = coordinator.request('drones', { quiet: true });
    void coordinator.request('drones', { quiet: true });
    expect(calls).toEqual([true]);
    first.resolve();
    await Promise.all([poll, event]);
    expect(calls).toEqual([true, true]);
  });

  test('queues a reconnect refresh after an in-flight failure', async () => {
    const first = deferred();
    let calls = 0;
    const coordinator = createRemoteLoadCoordinator(async () => {
      calls += 1;
      if (calls === 1) await first.promise;
    });

    const poll = coordinator.request('drones', { quiet: true });
    const reconnect = coordinator.request('drones', { quiet: false });
    first.reject(new Error('disconnected request failed'));

    await expect(poll).rejects.toThrow('disconnected request failed');
    await expect(reconnect).rejects.toThrow('disconnected request failed');
    expect(calls).toBe(2);
  });

  test('preserves a non-quiet selection load queued behind a quiet read failure', async () => {
    const first = deferred();
    const calls: boolean[] = [];
    const coordinator = createRemoteLoadCoordinator(async (_key, options) => {
      calls.push(options.quiet);
      if (calls.length === 1) await first.promise;
    });

    const quiet = coordinator.request('drone\0chat', { quiet: true });
    const selected = coordinator.request('drone\0chat', { quiet: false });
    first.reject(new Error('quiet read failed'));
    await expect(quiet).rejects.toThrow('quiet read failed');
    await expect(selected).rejects.toThrow('quiet read failed');
    expect(calls).toEqual([true, false]);
  });

  test('isolates chat keys and cancels queued work on selection cleanup', async () => {
    const first = deferred();
    const calls: string[] = [];
    const coordinator = createRemoteLoadCoordinator(async (key) => {
      calls.push(key);
      if (key === 'old' && calls.length === 1) await first.promise;
    });

    const old = coordinator.request('old', { quiet: true });
    void coordinator.request('old', { quiet: true });
    coordinator.reset();
    const next = coordinator.request('next', { quiet: false });
    first.resolve();
    await Promise.all([old, next]);
    expect(calls).toEqual(['old', 'next']);
  });
});
