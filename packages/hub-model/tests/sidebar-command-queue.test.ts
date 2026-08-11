import { describe, expect, test } from 'bun:test';
import { createSidebarCommandQueue } from '../src/sidebar';

describe('sidebar command queue', () => {
  test('starts writes in order and continues after a rejected write', async () => {
    const queue = createSidebarCommandQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = queue.enqueue(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      throw new Error('failed');
    });
    const second = queue.enqueue(async () => {
      events.push('second:start');
      return 'ok';
    });
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await expect(first).rejects.toThrow('failed');
    await expect(second).resolves.toBe('ok');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });
});
