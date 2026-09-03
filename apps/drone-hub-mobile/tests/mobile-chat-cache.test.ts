import { describe, expect, test } from 'bun:test';

import { BoundedSwrCache } from '../src/drones/bounded-swr-cache';
import {
  invalidateMobileChatCache,
  mobileChatCacheScopeIncludes,
  mobileChatCacheKey,
} from '../src/drones/mobile-chat-cache';

describe('mobile chat cache invalidation', () => {
  test('does not reuse deleted or renamed chat history when a name is recreated', () => {
    const cache = new BoundedSwrCache<string>({ maxEntries: 8, maxAgeMs: 120_000 });
    const oldKey = mobileChatCacheKey('target', 'drone', 'old');
    const newKey = mobileChatCacheKey('target', 'drone', 'new');
    cache.set(oldKey, 'old transcript');
    cache.set(newKey, 'previous new-name transcript');

    invalidateMobileChatCache(cache, { targetId: 'target', droneId: 'drone', chatName: 'old' });
    invalidateMobileChatCache(cache, { targetId: 'target', droneId: 'drone', chatName: 'new' });
    expect(cache.get(oldKey)).toBeUndefined();
    expect(cache.get(newKey)).toBeUndefined();

    cache.set(oldKey, 'recreated transcript');
    invalidateMobileChatCache(cache, { targetId: 'target', droneId: 'drone', chatName: 'old' });
    expect(cache.get(oldKey)).toBeUndefined();
  });

  test('invalidates an active read only when its logical identity is in scope', () => {
    const active = { targetId: 'target', droneId: 'drone', chatName: 'default' };
    expect(mobileChatCacheScopeIncludes({ targetId: 'target' }, active)).toBe(true);
    expect(
      mobileChatCacheScopeIncludes(
        { targetId: 'target', droneId: 'drone', chatName: 'default' },
        active,
      ),
    ).toBe(true);
    expect(
      mobileChatCacheScopeIncludes(
        { targetId: 'target', droneId: 'drone', chatName: 'other' },
        active,
      ),
    ).toBe(false);
    expect(mobileChatCacheScopeIncludes({ targetId: 'other' }, active)).toBe(false);
  });

  test('clears the target after an unscoped topology event without touching another device', () => {
    const cache = new BoundedSwrCache<string>({ maxEntries: 8, maxAgeMs: 120_000 });
    cache.set(mobileChatCacheKey('target', 'one', 'default'), 'one');
    cache.set(mobileChatCacheKey('target', 'two', 'default'), 'two');
    const other = mobileChatCacheKey('other', 'one', 'default');
    cache.set(other, 'other');

    invalidateMobileChatCache(cache, { targetId: 'target' });
    expect(cache.get(mobileChatCacheKey('target', 'one', 'default'))).toBeUndefined();
    expect(cache.get(mobileChatCacheKey('target', 'two', 'default'))).toBeUndefined();
    expect(cache.get(other)).toBe('other');
  });
});
