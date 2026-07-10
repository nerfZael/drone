import { describe, expect, test } from 'bun:test';
import { createSingleFlightPoller, singleFlightByKey } from '../src/droneHub/changes/singleFlight';

describe('changes polling single flight', () => {
  test('does not schedule the next poll until the active poll finishes', async () => {
    let finish: (() => void) | null = null;
    let calls = 0;
    const timers: Array<() => void> = [];
    const poller = createSingleFlightPoller({
      intervalMs: 5_000,
      poll: async () => {
        calls += 1;
        await new Promise<void>((resolve) => { finish = resolve; });
      },
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {},
    });

    poller.start();
    expect(calls).toBe(1);
    expect(timers).toHaveLength(0);
    const samePoll = poller.pollNow();
    expect(calls).toBe(1);
    finish?.();
    await samePoll;
    expect(timers).toHaveLength(1);
    poller.stop();
  });

  test('shares a keyed request while preserving the resolved value for every caller', async () => {
    const inFlight = new Map<string, Promise<number>>();
    let calls = 0;
    const load = async () => {
      calls += 1;
      await Promise.resolve();
      return 42;
    };
    const [left, right] = await Promise.all([
      singleFlightByKey(inFlight, 'drone-a', load),
      singleFlightByKey(inFlight, 'drone-a', load),
    ]);
    expect([left, right]).toEqual([42, 42]);
    expect(calls).toBe(1);
  });

  test('continues scheduling after a synchronous poll failure', async () => {
    const timers: Array<() => void> = [];
    const poller = createSingleFlightPoller({
      intervalMs: 5_000,
      poll: (() => { throw new Error('sync failure'); }) as () => Promise<void>,
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {},
    });
    poller.start();
    await expect(poller.pollNow()).rejects.toThrow('sync failure');
    expect(timers).toHaveLength(1);
    poller.stop();
  });
});
