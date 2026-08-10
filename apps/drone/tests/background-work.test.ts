import { describe, expect, test } from 'bun:test';

import { KeyedWorkQueue } from '../src/background/keyed-work-queue';
import { ManagedLoop } from '../src/background/managed-loop';
import { DaemonPromptEventMonitor } from '../src/hub/daemon-prompt-event-monitor';
import { ChatStateMaintenanceScheduler } from '../src/hub/chat-state-maintenance';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ManagedLoop', () => {
  test('does not overlap runs and waits for active work on stop', async () => {
    const gate = deferred();
    let starts = 0;
    const loop = new ManagedLoop({
      intervalMs: 5,
      run: async () => {
        starts += 1;
        await gate.promise;
      },
    });

    loop.start();
    await Bun.sleep(20);
    expect(starts).toBe(1);

    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await Bun.sleep(10);
    expect(stopped).toBe(false);

    gate.resolve();
    await stopping;
    await Bun.sleep(15);
    expect(starts).toBe(1);
  });

  test('coalesces wake-ups received during an active run', async () => {
    const firstGate = deferred();
    let starts = 0;
    const loop = new ManagedLoop({
      run: async () => {
        starts += 1;
        if (starts === 1) await firstGate.promise;
      },
    });

    loop.start();
    await Bun.sleep(10);
    loop.wake();
    loop.wake();
    firstGate.resolve();
    await Bun.sleep(20);
    expect(starts).toBe(2);
    await loop.stop();
  });
});

describe('KeyedWorkQueue', () => {
  test('bounds concurrency and suppresses duplicate queued keys', async () => {
    const gates = new Map([
      ['a', deferred()],
      ['b', deferred()],
    ]);
    const started: string[] = [];
    const queue = new KeyedWorkQueue<string>({
      key: (value) => value,
      concurrency: () => 1,
      run: async (value) => {
        started.push(value);
        await gates.get(value)!.promise;
      },
    });

    expect(queue.enqueue('a')).toBe('queued');
    expect(queue.enqueue('b')).toBe('queued');
    expect(queue.enqueue('b')).toBe('duplicate');
    await Bun.sleep(10);
    expect(started).toEqual(['a']);
    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(1);

    gates.get('a')!.resolve();
    await Bun.sleep(10);
    expect(started).toEqual(['a', 'b']);
    gates.get('b')!.resolve();
    await queue.stop();
  });

  test('can request one rerun when the same key is active', async () => {
    const firstGate = deferred();
    let starts = 0;
    const queue = new KeyedWorkQueue<string>({
      key: (value) => value,
      concurrency: () => 1,
      run: async () => {
        starts += 1;
        if (starts === 1) await firstGate.promise;
      },
    });

    queue.enqueue('a');
    await Bun.sleep(10);
    expect(queue.enqueue('a', { rerunIfActive: true })).toBe('active');
    expect(queue.enqueue('a', { rerunIfActive: true })).toBe('active');
    firstGate.resolve();
    await Bun.sleep(20);
    expect(starts).toBe(2);
    await queue.stop();
  });

  test('stops intake, drops pending work, and waits for active work', async () => {
    const gate = deferred();
    const started: string[] = [];
    const queue = new KeyedWorkQueue<string>({
      key: (value) => value,
      concurrency: () => 1,
      run: async (value) => {
        started.push(value);
        await gate.promise;
      },
    });

    queue.enqueue('active');
    queue.enqueue('pending');
    await Bun.sleep(10);
    let stopped = false;
    const stopping = queue.stop().then(() => {
      stopped = true;
    });

    expect(queue.enqueue('late')).toBe('stopped');
    expect(queue.queuedCount).toBe(0);
    expect(stopped).toBe(false);
    gate.resolve();
    await stopping;
    expect(started).toEqual(['active']);
  });
});

describe('DaemonPromptEventMonitor', () => {
  test('aborts retry waits and settles monitor tasks on close', async () => {
    const sleepStarted = deferred();
    let sleepAborted = false;
    let resolveCalls = 0;
    const monitor = new DaemonPromptEventMonitor({
      normalizeDroneId: (value) => value,
      resolveClient: async () => {
        resolveCalls += 1;
        throw new Error('daemon unavailable');
      },
      onTerminalPrompt: async () => {},
      sleep: async (_milliseconds, signal) => {
        sleepStarted.resolve();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              sleepAborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    });

    monitor.ensure('drone-a');
    await sleepStarted.promise;
    await monitor.close();

    expect(sleepAborted).toBe(true);
    monitor.ensure('drone-b');
    await Bun.sleep(10);
    expect(resolveCalls).toBe(1);

    monitor.start();
    monitor.ensure('drone-b');
    await Bun.sleep(10);
    expect(resolveCalls).toBe(2);
    await monitor.close();
  });
});

describe('ChatStateMaintenanceScheduler', () => {
  test('rejects late schedules after close and accepts them after restart', async () => {
    let runs = 0;
    const scheduler = new ChatStateMaintenanceScheduler({
      normalizeDroneId: (value) => value,
      normalizeChatName: (value) => value,
      run: () => {
        runs += 1;
      },
      logError: () => {},
      throttleMs: 0,
    });

    scheduler.close();
    scheduler.schedule({ droneId: 'drone-a', chatName: 'default', chatEntry: {} });
    await Bun.sleep(10);
    expect(runs).toBe(0);

    scheduler.start();
    scheduler.schedule({ droneId: 'drone-a', chatName: 'default', chatEntry: {} });
    await Bun.sleep(10);
    expect(runs).toBe(1);
    scheduler.close();
  });
});
