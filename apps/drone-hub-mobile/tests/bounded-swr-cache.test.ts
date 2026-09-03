import { describe, expect, test } from 'bun:test';

import { BoundedSwrCache } from '../src/drones/bounded-swr-cache';
import { mobileDirectoryCacheKey, mobileFileCacheKey } from '../src/drones/mobile-file-cache-key';

describe('BoundedSwrCache', () => {
  test('retains equal identity and evicts the least recently viewed entry', () => {
    const evicted: string[] = [];
    const cache = new BoundedSwrCache<{ id: string }>({
      maxEntries: 2,
      maxAgeMs: 100,
      onEvict: (value) => evicted.push(value.id),
    });
    const first = cache.set('first', { id: 'first' });
    cache.set('second', { id: 'second' });
    expect(cache.set('first', { id: 'first' }, (left, right) => left.id === right.id)).toBe(first);
    cache.set('third', { id: 'third' });
    expect(cache.get('second')).toBeUndefined();
    expect(evicted).toEqual(['second']);
  });

  test('expires stale entries and runs cleanup', () => {
    let now = 10;
    const evicted: string[] = [];
    const cache = new BoundedSwrCache<string>({
      maxEntries: 2,
      maxAgeMs: 20,
      now: () => now,
      onEvict: (value) => evicted.push(value),
    });
    cache.set('chat', 'cached');
    now = 31;
    expect(cache.get('chat')).toBeUndefined();
    expect(evicted).toEqual(['cached']);
  });

  test('shares remote workspace previews across chats while isolating phone-local chats', () => {
    const base = {
      targetId: 'device',
      droneId: 'drone',
      path: '/workspace/file.ts',
      line: null,
    };
    expect(mobileFileCacheKey({ ...base, chatName: 'one', phoneTarget: false })).toBe(
      mobileFileCacheKey({ ...base, chatName: 'two', phoneTarget: false }),
    );
    expect(mobileFileCacheKey({ ...base, chatName: 'one', phoneTarget: true })).not.toBe(
      mobileFileCacheKey({ ...base, chatName: 'two', phoneTarget: true }),
    );
  });

  test('shares remote workspace directories across chats while isolating phone-local roots', () => {
    const remote = { targetId: 'device', droneId: 'drone', rootPath: '/workspace' };
    expect(mobileDirectoryCacheKey({ ...remote, chatName: 'one' })).toBe(
      mobileDirectoryCacheKey({ ...remote, chatName: 'two' }),
    );
    const local = { ...remote, rootPath: '' };
    expect(mobileDirectoryCacheKey({ ...local, chatName: 'one' })).not.toBe(
      mobileDirectoryCacheKey({ ...local, chatName: 'two' }),
    );
  });
});
