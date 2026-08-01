import { describe, expect, test } from 'bun:test';

import { createSidebarDroneMutationQueue } from '../src/droneHub/app/sidebar-drone-mutation-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('sidebar drone mutation queue', () => {
  test('serializes mutations that touch the same drone', async () => {
    const queue = createSidebarDroneMutationQueue();
    const firstDone = deferred<void>();
    const events: string[] = [];
    const first = queue.enqueue(['alpha'], async () => {
      events.push('first:start');
      await firstDone.promise;
      events.push('first:end');
    });
    const second = queue.enqueue(['alpha'], async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    firstDone.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  test('runs mutations for unrelated drones concurrently', async () => {
    const queue = createSidebarDroneMutationQueue();
    const firstDone = deferred<void>();
    const events: string[] = [];
    const first = queue.enqueue(['alpha'], async () => {
      events.push('alpha:start');
      await firstDone.promise;
    });
    const second = queue.enqueue(['bravo'], async () => {
      events.push('bravo:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['alpha:start', 'bravo:start']);
    firstDone.resolve();
    await Promise.all([first, second]);
  });

  test('serializes partially overlapping multi-drone mutations', async () => {
    const queue = createSidebarDroneMutationQueue();
    const firstDone = deferred<void>();
    const events: string[] = [];
    const first = queue.enqueue(['alpha', 'bravo'], async () => {
      events.push('first:start');
      await firstDone.promise;
    });
    const second = queue.enqueue(['bravo', 'charlie'], async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    firstDone.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'second:start']);
  });
});
