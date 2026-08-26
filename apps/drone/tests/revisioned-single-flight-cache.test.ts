import { describe, expect, test } from 'bun:test';

import { RevisionedSingleFlightCache } from '../src/hub/revisioned-single-flight-cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('RevisionedSingleFlightCache', () => {
  test('caches each key until the shared revision is invalidated', async () => {
    const cache = new RevisionedSingleFlightCache<'active' | 'summary', string>();
    let activeLoads = 0;
    let summaryLoads = 0;

    const loadActive = () => `active-${++activeLoads}`;
    const loadSummary = () => `summary-${++summaryLoads}`;

    expect(await cache.getOrLoad('active', loadActive)).toBe('active-1');
    expect(await cache.getOrLoad('active', loadActive)).toBe('active-1');
    expect(await cache.getOrLoad('summary', loadSummary)).toBe('summary-1');
    expect(await cache.getOrLoad('summary', loadSummary)).toBe('summary-1');

    cache.invalidate();

    expect(await cache.getOrLoad('active', loadActive)).toBe('active-2');
    expect(await cache.getOrLoad('summary', loadSummary)).toBe('summary-2');
  });

  test('shares one in-flight load for concurrent callers of the same key', async () => {
    const cache = new RevisionedSingleFlightCache<string, string>();
    const pending = deferred<string>();
    let loads = 0;
    const load = () => {
      loads += 1;
      return pending.promise;
    };

    const first = cache.getOrLoad('active', load);
    const second = cache.getOrLoad('active', load);
    await Promise.resolve();

    expect(loads).toBe(1);
    pending.resolve('model');
    expect(await first).toBe('model');
    expect(await second).toBe('model');
  });

  test('does not publish a stale in-flight result after invalidation', async () => {
    const cache = new RevisionedSingleFlightCache<string, string>();
    const stale = deferred<string>();
    const fresh = deferred<string>();

    const staleRead = cache.getOrLoad('active', () => stale.promise);
    await Promise.resolve();
    cache.invalidate();
    const freshRead = cache.getOrLoad('active', () => fresh.promise);
    await Promise.resolve();

    fresh.resolve('fresh');
    expect(await freshRead).toBe('fresh');
    stale.resolve('stale');
    expect(await staleRead).toBe('stale');
    expect(await cache.getOrLoad('active', () => 'unexpected')).toBe('fresh');
  });
});
