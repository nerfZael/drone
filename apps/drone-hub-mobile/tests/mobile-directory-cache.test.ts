import { describe, expect, test } from 'bun:test';

import {
  MobileDirectoryContextCache,
  mobileDirectoryErrorMode,
  retainMobileExplorerEntries,
  type MobileDirectoryState,
} from '../src/drones/mobile-directory-cache';

function loaded(path: string): MobileDirectoryState {
  return {
    entries: [{ name: path, path, kind: 'directory', isGitIgnored: false }],
    loading: false,
    error: null,
    loaded: true,
  };
}

describe('mobile directory cache', () => {
  test('bounds directories by LRU while retaining the root', () => {
    const cache = new MobileDirectoryContextCache();
    cache.update([{ path: '/', state: loaded('/') }], '/', 3);
    cache.update([{ path: '/one', state: loaded('/one') }], '/', 3);
    cache.update([{ path: '/two', state: loaded('/two') }], '/', 3);
    cache.update([{ path: '/one', state: cache.directories['/one']! }], '/', 3);
    cache.update([{ path: '/three', state: loaded('/three') }], '/', 3);

    expect(Object.keys(cache.directories)).toHaveLength(3);
    expect(cache.directories['/']).toBeDefined();
    expect(cache.directories['/one']).toBeDefined();
    expect(cache.directories['/two']).toBeUndefined();
  });

  test('retains directory and record identity for an unchanged response', () => {
    const cache = new MobileDirectoryContextCache();
    const initial = loaded('/');
    const record = cache.update([{ path: '/', state: initial }], '/');
    const retainedEntries = retainMobileExplorerEntries(initial.entries, [
      { ...initial.entries[0]! },
    ]);
    const unchanged = cache.update(
      [{ path: '/', state: { ...initial, entries: retainedEntries } }],
      '/',
    );

    expect(retainedEntries).toBe(initial.entries);
    expect(unchanged).toBe(record);
    expect(unchanged['/']).toBe(initial);
  });

  test('distinguishes cold errors from stale root and child refresh errors', () => {
    const cold = { ...loaded('/'), entries: [], loaded: false, error: 'offline' };
    const staleRoot = { ...loaded('/'), error: 'offline' };
    const staleChild = { ...loaded('/child'), error: 'offline' };
    expect(mobileDirectoryErrorMode(cold)).toBe('cold');
    expect(mobileDirectoryErrorMode(staleRoot)).toBe('stale');
    expect(mobileDirectoryErrorMode(staleChild)).toBe('stale');
  });

  test('drops renamed directory identities and descendants without touching siblings', () => {
    const cache = new MobileDirectoryContextCache();
    cache.update(
      [
        { path: '/', state: loaded('/') },
        { path: '/old', state: loaded('/old') },
        { path: '/old/child', state: loaded('/old/child') },
        { path: '/new', state: loaded('/new') },
        { path: '/sibling', state: loaded('/sibling') },
      ],
      '/',
    );

    cache.deletePaths(['/old', '/new']);
    expect(cache.directories['/old']).toBeUndefined();
    expect(cache.directories['/old/child']).toBeUndefined();
    expect(cache.directories['/new']).toBeUndefined();
    expect(cache.directories['/sibling']).toBeDefined();
  });
});
