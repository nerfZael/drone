import { describe, expect, test } from 'bun:test';
import { hashDroneFileContentsBatch } from '../src/hub/drone-repo';
import { ShortLivedSingleFlightCache } from '../src/hub/repo-changes-scan-cache';

describe('repository changes fast path', () => {
  test('coalesces identical scans and serves the short-lived cached result', async () => {
    let now = 1_000;
    let resolveScan: ((value: string) => void) | null = null;
    let scans = 0;
    const cache = new ShortLivedSingleFlightCache<string>(2_000, () => now);
    const load = () => {
      scans += 1;
      return new Promise<string>((resolve) => { resolveScan = resolve; });
    };
    const first = cache.getOrLoad('repo', load);
    const second = cache.getOrLoad('repo', load);
    expect(scans).toBe(1);
    resolveScan?.('summary');
    expect(await Promise.all([first, second])).toEqual(['summary', 'summary']);
    expect(await cache.getOrLoad('repo', load)).toBe('summary');
    expect(scans).toBe(1);

    cache.invalidate('repo');
    expect(await cache.getOrLoad('repo', async () => {
      scans += 1;
      return 'invalidated-summary';
    })).toBe('invalidated-summary');
    expect(scans).toBe(2);

    now += 2_001;
    const expired = cache.getOrLoad('repo', async () => {
      scans += 1;
      return 'new-summary';
    });
    expect(await expired).toBe('new-summary');
    expect(scans).toBe(3);
  });

  test('does not let a post-mutation request join a stale in-flight scan', async () => {
    const cache = new ShortLivedSingleFlightCache<string>();
    let resolveStale: ((value: string) => void) | null = null;
    const stale = cache.getOrLoad('repo', () => new Promise<string>((resolve) => {
      resolveStale = resolve;
    }));

    cache.invalidate('repo');
    const fresh = cache.getOrLoad('repo', async () => 'fresh');
    expect(await fresh).toBe('fresh');
    resolveStale?.('stale');
    expect(await stale).toBe('stale');
    expect(await cache.getOrLoad('repo', async () => 'unexpected')).toBe('fresh');
  });

  test('hashes all changed container files in one git execution', async () => {
    const calls: any[] = [];
    const hashes = await hashDroneFileContentsBatch({
      container: 'drone-one',
      repoPathInContainer: '/work/repo',
      repoRelativePaths: ['src/a.ts', 'src/b.ts'],
      runGit: async (opts) => {
        calls.push(opts);
        return {
          code: 0,
          stdout: `${'a'.repeat(40)}\n${'b'.repeat(40)}\n`,
          stderr: '',
        };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      'hash-object', '--no-filters', '--', 'src/a.ts', 'src/b.ts',
    ]);
    expect(hashes.get('src/a.ts')).toBe('a'.repeat(40));
    expect(hashes.get('src/b.ts')).toBe('b'.repeat(40));
  });
});
