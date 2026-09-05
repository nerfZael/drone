import { describe, expect, test } from 'bun:test';
import { MobileChatReadCoordinator } from '../src/drones/mobile-chat-read-coordinator';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('MobileChatReadCoordinator', () => {
  test('cancels obsolete reads and allows A → B → A without joining the old A', async () => {
    const coordinator = new MobileChatReadCoordinator(() => undefined);
    const oldA = deferred();
    let oldSignal!: AbortSignal;
    const first = coordinator.request('a', async (signal) => {
      oldSignal = signal;
      await oldA.promise;
    });
    coordinator.cancelExcept('b');
    expect(oldSignal.aborted).toBe(true);
    const second = coordinator.request('a', async () => {});
    expect(second).not.toBe(first);
    await second;
    oldA.resolve();
    await first;
    expect(coordinator.isActive('a')).toBe(false);
  });

  test('continuous refresh requests still let each completed snapshot be applied', async () => {
    const coordinator = new MobileChatReadCoordinator(() => undefined);
    const reads = [deferred(), deferred()];
    const applied: number[] = [];
    let calls = 0;
    const task = async (signal: AbortSignal) => {
      const index = calls++;
      await reads[index]!.promise;
      if (!signal.aborted) applied.push(index);
    };
    const first = coordinator.request('chat', task);
    for (let i = 0; i < 20; i++) coordinator.request('chat', task);
    reads[0]!.resolve();
    await first;
    expect(applied).toEqual([0]);
    expect(calls).toBe(2);
    reads[1]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([0, 1]);
  });

  test('coalesces repeated refreshes and runs one trailing read without overlap', async () => {
    const activeStates: boolean[] = [];
    const reads = [deferred(), deferred()];
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      const read = reads[calls++]!;
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await read.promise;
      } finally {
        active -= 1;
      }
    };
    const key = 'device\u0000drone\u0000chat';
    let coordinator!: MobileChatReadCoordinator;
    coordinator = new MobileChatReadCoordinator(() => activeStates.push(coordinator.isActive(key)));

    const first = coordinator.request(key, task);
    const joined = coordinator.request(key, task);

    expect(joined).toBe(first);
    expect(calls).toBe(1);
    reads[0]!.resolve();
    await first;
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);

    reads[1]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(activeStates).toEqual([true, true, false]);
  });

  test('a failed read still allows the queued refresh to run', async () => {
    const reads = [deferred(), deferred()];
    let calls = 0;
    const coordinator = new MobileChatReadCoordinator(() => undefined);
    const task = async () => await reads[calls++]!.promise;

    const first = coordinator.request('chat', task);
    coordinator.request('chat', task).catch(() => undefined);
    reads[0]!.reject(new Error('timed out'));
    await expect(first).rejects.toThrow('timed out');
    await Promise.resolve();
    expect(calls).toBe(2);

    reads[1]!.resolve();
    await Promise.resolve();
  });

  test('coalesces each chat independently while different chats are loading', async () => {
    const reads = new Map([
      ['chat-a', [deferred(), deferred()]],
      ['chat-b', [deferred(), deferred()]],
    ]);
    const calls = new Map<string, number>();
    const coordinator = new MobileChatReadCoordinator(() => undefined);
    const task = (key: string) => async () => {
      const index = calls.get(key) ?? 0;
      calls.set(key, index + 1);
      await reads.get(key)![index]!.promise;
    };

    const firstA = coordinator.request('chat-a', task('chat-a'));
    const firstB = coordinator.request('chat-b', task('chat-b'));
    coordinator.request('chat-a', task('chat-a')).catch(() => undefined);
    coordinator.request('chat-b', task('chat-b')).catch(() => undefined);

    expect(coordinator.isActive('chat-a')).toBe(true);
    expect(coordinator.isActive('chat-b')).toBe(true);
    expect(calls).toEqual(
      new Map([
        ['chat-a', 1],
        ['chat-b', 1],
      ]),
    );

    reads.get('chat-a')![0]!.resolve();
    reads.get('chat-b')![0]!.resolve();
    await Promise.all([firstA, firstB]);
    await Promise.resolve();
    expect(calls).toEqual(
      new Map([
        ['chat-a', 2],
        ['chat-b', 2],
      ]),
    );

    reads.get('chat-a')![1]!.resolve();
    reads.get('chat-b')![1]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.isActive('chat-a')).toBe(false);
    expect(coordinator.isActive('chat-b')).toBe(false);
  });
});
