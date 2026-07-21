import { describe, expect, test } from 'bun:test';
import { DroneApiRequestError } from '../src/host/api';
import {
  createDroneDaemonWorktreeHasher,
  hashDroneFileContentsBatch,
  runGitInDroneViaDaemon,
} from '../src/hub/drone-repo';
import { ShortLivedSingleFlightCache } from '../src/hub/repo-changes-scan-cache';
import { createRepositoryRouteHandler } from '../src/hub/routes/repository-operation-routes';

describe('repository changes fast path', () => {
  test('coalesces identical scans and serves the short-lived cached result', async () => {
    let now = 1_000;
    let resolveScan: ((value: string) => void) | null = null;
    let scans = 0;
    const cache = new ShortLivedSingleFlightCache<string>(2_000, () => now);
    const load = () => {
      scans += 1;
      return new Promise<string>((resolve) => {
        resolveScan = resolve;
      });
    };
    const first = cache.getOrLoad('repo', load);
    const second = cache.getOrLoad('repo', load);
    expect(scans).toBe(1);
    resolveScan?.('summary');
    expect(await Promise.all([first, second])).toEqual(['summary', 'summary']);
    expect(await cache.getOrLoad('repo', load)).toBe('summary');
    expect(scans).toBe(1);

    cache.invalidate('repo');
    expect(
      await cache.getOrLoad('repo', async () => {
        scans += 1;
        return 'invalidated-summary';
      }),
    ).toBe('invalidated-summary');
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
    const stale = cache.getOrLoad(
      'repo',
      () =>
        new Promise<string>((resolve) => {
          resolveStale = resolve;
        }),
    );

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
    expect(calls[0].args).toEqual(['hash-object', '--no-filters', '--', 'src/a.ts', 'src/b.ts']);
    expect(hashes.get('src/a.ts')).toBe('a'.repeat(40));
    expect(hashes.get('src/b.ts')).toBe('b'.repeat(40));
  });

  test('runs container change scans through the drone daemon', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const response = {
      writableEnded: false,
      statusCode: 0,
      setHeader: () => {},
      end(data: string) {
        responses.push({ status: this.statusCode, body: JSON.parse(data) });
        this.writableEnded = true;
      },
    };
    const droneEntry = {
      id: 'drone-one',
      name: 'Drone One',
      runtime: 'container',
      hostPort: 4321,
      token: 'daemon-token',
      repoPath: '/work/repo',
    };
    const daemonCalls: any[] = [];
    let dockerGitCalls = 0;
    const handler = createRepositoryRouteHandler({
      buildReviewScopeId: () => 'review-scope',
      createDroneDaemonGitRunner: (entry: any) => async (input: any) => {
        daemonCalls.push({ droneEntry: entry, ...input });
        return { code: 0, stdout: '', stderr: '' };
      },
      createDroneDaemonWorktreeHasher: () => async () => new Map(),
      droneRepoChangesSummary: async (input: any) => {
        const result = await input.runGit({
          container: 'drone-one',
          repoPathInContainer: '/work/repo',
          args: ['status', '--porcelain=v2'],
        });
        expect(result.code).toBe(0);
        return {
          repoRoot: '/work/repo',
          summary: {
            branch: { head: 'main', upstream: null, oid: null, ahead: 0, behind: 0 },
            counts: { changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
            entries: [],
          },
        };
      },
      droneRepoPathInContainer: () => '/work/repo',
      droneRuntime: () => 'container',
      isRepoAttachedDrone: () => true,
      looksLikeMissingContainerError: () => false,
      looksLikeRepoUnavailableError: () => false,
      repoChangesScanCache: new ShortLivedSingleFlightCache(),
      resolveDroneOrRespond: async () => ({ id: 'drone-one', drone: droneEntry }),
      runGitInDrone: async () => {
        dockerGitCalls += 1;
        return { code: 0, stdout: '', stderr: '' };
      },
    } as any);

    expect(
      await handler({
        req: { headers: {} } as any,
        res: response as any,
        url: new URL('http://hub.test/api/drones/drone-one/repo/changes'),
        method: 'GET',
        parts: ['api', 'drones', 'drone-one', 'repo', 'changes'],
      }),
    ).toBe(true);
    expect(dockerGitCalls).toBe(0);
    expect(daemonCalls).toEqual([
      {
        droneEntry,
        container: 'drone-one',
        repoPathInContainer: '/work/repo',
        args: ['status', '--porcelain=v2'],
      },
    ]);
    expect(responses).toEqual([
      {
        status: 200,
        body: {
          ok: true,
          id: 'drone-one',
          name: 'Drone One',
          repoRoot: '/work/repo',
          reviewScopeId: 'review-scope',
          branch: { head: 'main', upstream: null, oid: null, ahead: 0, behind: 0 },
          counts: { changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
          entries: [],
        },
      },
    ]);
  });

  test('reports an unavailable container daemon without trying Docker exec', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    let dockerGitCalls = 0;
    const handler = createRepositoryRouteHandler({
      buildReviewScopeId: () => 'review-scope',
      createDroneDaemonGitRunner: () => async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'daemon_unavailable' });
      },
      createDroneDaemonWorktreeHasher: () => async () => new Map(),
      droneRepoChangesSummary: async (input: any) => {
        await input.runGit({
          container: 'drone-one',
          repoPathInContainer: '/work/repo',
          args: ['status', '--porcelain=v2'],
        });
        throw new Error('unreachable');
      },
      droneRepoPathInContainer: () => '/work/repo',
      droneRuntime: () => 'container',
      isRepoAttachedDrone: () => true,
      looksLikeMissingContainerError: () => false,
      looksLikeRepoUnavailableError: () => false,
      repoChangesScanCache: new ShortLivedSingleFlightCache(),
      resolveDroneOrRespond: async () => ({
        id: 'drone-one',
        drone: {
          id: 'drone-one',
          name: 'Drone One',
          runtime: 'container',
          hostPort: 4321,
          token: 'daemon-token',
          repoPath: '/work/repo',
        },
      }),
      runGitInDrone: async () => {
        dockerGitCalls += 1;
        return { code: 0, stdout: '', stderr: '' };
      },
    } as any);

    const handled = await handler({
      req: { headers: {} } as any,
      res: {
        writableEnded: false,
        statusCode: 0,
        setHeader: () => {},
        end(data: string) {
          responses.push({ status: this.statusCode, body: JSON.parse(data) });
          this.writableEnded = true;
        },
      } as any,
      url: new URL('http://hub.test/api/drones/drone-one/repo/changes'),
      method: 'GET',
      parts: ['api', 'drones', 'drone-one', 'repo', 'changes'],
    });

    expect(handled).toBe(true);
    expect(dockerGitCalls).toBe(0);
    expect(responses).toEqual([
      {
        status: 503,
        body: {
          ok: false,
          error: 'Drone daemon is unavailable. Check that the drone is running and try again.',
          code: 'daemon_unavailable',
          id: 'drone-one',
          name: 'Drone One',
        },
      },
    ]);
  });

  test('sends Git commands to the configured daemon HTTP endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; authorization: string | null; body: any }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        authorization: headers.get('authorization'),
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      return new Response(
        JSON.stringify({
          ok: true,
          code: 0,
          stdout: 'status-output',
          stderr: '',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await runGitInDroneViaDaemon({
        droneEntry: { hostPort: 4567, token: 'secret-token' },
        repoPathInContainer: '/work/repo',
        args: ['status', '--porcelain=v2'],
      });
      expect(result).toMatchObject({ code: 0, stdout: 'status-output', stderr: '' });
      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:4567/v1/workspace/exec',
          authorization: 'Bearer secret-token',
          body: {
            cmd: 'git',
            args: ['-C', '/work/repo', 'status', '--porcelain=v2'],
            timeoutMs: 30_000,
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not report daemon application errors as connection failures', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'command too large' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const error = await runGitInDroneViaDaemon({
        droneEntry: { hostPort: 4567, token: 'secret-token' },
        repoPathInContainer: '/work/repo',
        args: ['status'],
      })
        .then(() => null)
        .catch((value) => value);

      expect(error).toBeInstanceOf(DroneApiRequestError);
      expect(error.statusCode).toBe(413);
      expect(error.code).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('splits very large changed-file lists across daemon requests', async () => {
    const originalFetch = globalThis.fetch;
    const requestPathCounts: number[] = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      requestPathCounts.push(body.paths.length);
      return new Response(
        JSON.stringify({ ok: true, hashes: [], cacheHits: 0, hashed: 0, durationMs: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const hashWorktree = createDroneDaemonWorktreeHasher({
        hostPort: 4567,
        token: 'secret-token',
      });
      const hashes = await hashWorktree({
        repoRoot: '/work/repo',
        repoRelativePaths: Array.from({ length: 5_001 }, (_, index) => `src/file-${index}.ts`),
      });

      expect(hashes.size).toBe(0);
      expect(requestPathCounts).toEqual([5_000, 1]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
