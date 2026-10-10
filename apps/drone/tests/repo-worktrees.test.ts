import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { HubRouter } from '../src/hub/hub-router';
import { normalizeMcpChatAccessScope } from '../src/hub/mcp-chat-access';
import { createDroneHubMcpServer } from '../src/hub/mcp-server';
import type { McpTokenIdentity } from '../src/hub/mcp-tokens';
import { ShortLivedSingleFlightCache } from '../src/hub/repo-changes-scan-cache';
import { droneEntryForWorktree, parseGitWorktreeList, RepoWorktrees, type DroneRepoGit } from '../src/hub/repo-worktrees';
import { createRepositoryRouteHandler } from '../src/hub/routes/repository-operation-routes';
import { registerRepoWorktreeRoutes } from '../src/hub/routes/repo-worktree-routes';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

/** A repository with one linked worktree on branch "feature", in a temporary folder. */
function withRepo<T>(run: (repo: { main: string; feature: string }) => Promise<T>): Promise<T> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-worktrees-')));
  const main = path.join(root, 'main');
  const feature = path.join(root, 'feature-wt');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', feature);
  fs.mkdirSync(path.join(feature, 'src'));
  return run({ main, feature }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function hostGit(): (drone: any) => DroneRepoGit {
  return (drone) => ({
    runtime: 'host',
    mainPath: async () => drone.repoPath,
    run: async (cwd, args) => {
      const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  });
}

describe('repository worktrees', () => {
  test('parses git worktree list, skipping a bare repository', () => {
    expect(
      parseGitWorktreeList(
        [
          'worktree /repo.git',
          'bare',
          '',
          'worktree /work/a',
          'HEAD 1111111111111111111111111111111111111111',
          'branch refs/heads/feature/x',
          '',
          'worktree /work/b',
          'HEAD 2222222222222222222222222222222222222222',
          'detached',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      { path: '/work/a', branch: 'feature/x', head: '1111111111111111111111111111111111111111', main: true },
      { path: '/work/b', branch: null, head: '2222222222222222222222222222222222222222', main: false },
    ]);
  });

  test("lists the drone's checkout first and finds a worktree by branch or by a folder inside it", async () => {
    await withRepo(async ({ main, feature }) => {
      const worktrees = new RepoWorktrees(hostGit());
      const drone = { repoPath: main };
      const listed = await worktrees.list('d1', drone);
      expect(listed.map((worktree) => [worktree.path, worktree.branch, worktree.main])).toEqual([
        [main, 'main', true],
        [feature, 'feature', false],
      ]);
      expect((await worktrees.find('d1', drone, { branch: 'feature' })).path).toBe(feature);
      expect((await worktrees.find('d1', drone, { path: path.join(feature, 'src') })).path).toBe(feature);
      expect((await worktrees.require('d1', drone, `${feature}/`)).branch).toBe('feature');
      await expect(worktrees.require('d1', drone, os.tmpdir())).rejects.toMatchObject({ status: 404 });
      await expect(worktrees.find('d1', drone, { path: os.tmpdir() })).rejects.toMatchObject({ status: 404 });
      await expect(worktrees.find('d1', drone, { branch: 'nope' })).rejects.toMatchObject({ status: 404 });
    });
  });

  test('a worktree is read through the drone entry the repository routes already use', () => {
    expect(droneEntryForWorktree({ repoPath: '/a', repo: { dest: '/a' } }, 'host', '/b')).toEqual({ repoPath: '/b', repo: { dest: '/b' } });
    expect(droneEntryForWorktree({ repoPath: '/a' }, 'host', '/b')).toEqual({ repoPath: '/b' });
    expect(droneEntryForWorktree({ repo: { dest: '/work/repo', seededAt: 'x' } }, 'container', '/work/wt')).toEqual({
      repo: { dest: '/work/wt', seededAt: 'x' },
    });
  });

  test('chats report their worktree; the explorer lists worktrees with the chat it follows', async () => {
    await withRepo(async ({ main, feature }) => {
      const stored = new Map<string, unknown>();
      let result: { status: number; body: any } = { status: 0, body: null };
      let body: unknown = null;
      const router = new HubRouter(
        (_res, status, value) => {
          result = { status, body: value };
        },
        async () => body,
      );
      registerRepoWorktreeRoutes(router, {
        worktrees: new RepoWorktrees(hostGit()),
        resolveRepoDrone: async (ref) => ({ id: ref, drone: { repoPath: main }, runtime: 'host' }),
        readChatWorktree: async (chat) => stored.get(chat.chatName),
        writeChatWorktree: async (chat, worktree) => {
          if (chat.chatName === 'missing') throw Object.assign(new Error('unknown chat: missing'), { status: 404 });
          if (worktree) stored.set(chat.chatName, worktree);
          else stored.delete(chat.chatName);
        },
        now: () => '2026-10-10T00:00:00.000Z',
      });
      const call = async (method: string, url: string, payload: unknown = null) => {
        body = payload;
        await router.handle({ method } as any, {} as any, new URL(`http://hub.test${url}`));
        return result;
      };

      expect((await call('POST', '/api/drones/d1/chats/c1/worktree', { path: path.join(feature, 'src') })).body).toMatchObject({
        ok: true,
        main: false,
        worktree: { path: feature, branch: 'feature', reportedAt: '2026-10-10T00:00:00.000Z' },
      });
      const listed = (await call('GET', '/api/drones/d1/repo/worktrees?chat=c1')).body;
      expect(listed.worktrees.map((worktree: any) => worktree.path)).toEqual([main, feature]);
      expect(listed.chatWorktree).toMatchObject({ path: feature, branch: 'feature', available: true, main: false });
      expect((await call('GET', '/api/drones/d1/repo/worktrees?chat=other')).body.chatWorktree).toBeNull();

      // Reporting the main checkout, or clearing, leaves nothing stored.
      expect((await call('POST', '/api/drones/d1/chats/c1/worktree', { branch: 'main' })).body).toMatchObject({ main: true, worktree: null });
      expect(stored.has('c1')).toBe(false);
      await call('POST', '/api/drones/d1/chats/c1/worktree', { branch: 'feature' });
      expect((await call('POST', '/api/drones/d1/chats/c1/worktree', { clear: true })).body).toMatchObject({ worktree: null });
      expect(stored.has('c1')).toBe(false);

      expect((await call('POST', '/api/drones/d1/chats/c1/worktree', { path: os.tmpdir() })).status).toBe(404);
      expect((await call('POST', '/api/drones/d1/chats/missing/worktree', { branch: 'feature' })).status).toBe(404);

      // A worktree removed after it was reported is no longer available to follow.
      await call('POST', '/api/drones/d1/chats/c1/worktree', { branch: 'feature' });
      git(main, 'worktree', 'remove', '--force', feature);
      await new Promise((resolve) => setTimeout(resolve, 3_100));
      expect((await call('GET', '/api/drones/d1/repo/worktrees?chat=c1')).body.chatWorktree).toMatchObject({ available: false });
    });
  }, 15_000);

  test('the repository routes read a listed worktree and refuse any other folder', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const response = () => ({
      statusCode: 0,
      headersSent: false,
      writableEnded: false,
      setHeader: () => {},
      end(this: any, data: string) {
        responses.push({ status: this.statusCode, body: JSON.parse(data) });
        this.writableEnded = true;
      },
    });
    const summaries: string[] = [];
    const handler = createRepositoryRouteHandler({
      buildReviewScopeId: () => 'scope',
      droneRuntime: (drone: any) => drone.runtime,
      isRepoAttachedDrone: () => true,
      looksLikeMissingContainerError: () => false,
      looksLikeRepoUnavailableError: () => false,
      gitTopLevel: async (repoPath: string) => repoPath,
      gitRepoChangesSummary: async (repoRoot: string) => {
        summaries.push(repoRoot);
        return { branch: { head: 'x' }, counts: {}, entries: [] };
      },
      repoChangesScanCache: new ShortLivedSingleFlightCache(),
      resolveDroneOrRespond: async () => ({ id: 'd1', drone: { runtime: 'host', repoPath: '/repo' } }),
      repoWorktrees: {
        require: async (_id: string, _drone: any, requested: string) => {
          if (requested === '/repo') return { path: '/repo', branch: 'main', head: null, main: true };
          if (requested === '/wt') return { path: '/wt', branch: 'feature', head: null, main: false };
          throw Object.assign(new Error(`not a worktree of this drone's repository: ${requested}`), { status: 404 });
        },
      },
    } as any);
    const get = async (query: string) =>
      await handler({
        req: { headers: {} } as any,
        res: response() as any,
        url: new URL(`http://hub.test/api/drones/d1/repo/changes${query}`),
        method: 'GET',
        parts: ['api', 'drones', 'd1', 'repo', 'changes'],
      });

    await get('');
    await get('?worktree=%2Fwt');
    await get('?worktree=%2Frepo');
    await get('?worktree=%2Fetc');
    // The main checkout named as a worktree is the main checkout (served from the scan cache here).
    expect(summaries).toEqual(['/repo', '/wt']);
    expect(responses.map((entry) => entry.status)).toEqual([200, 200, 200, 404]);
    expect(responses.map((entry) => entry.body.repoRoot)).toEqual(['/repo', '/wt', '/repo', undefined]);
    expect(responses[3].body).toMatchObject({ ok: false, code: 'worktree_unavailable' });
  });
});

describe('set_current_worktree MCP tool', () => {
  const chatPrincipal: McpTokenIdentity = {
    kind: 'chat',
    tokenId: 'chat:drone-a:default',
    name: 'drone-a/default',
    droneId: 'drone-a',
    chatName: 'main chat',
    chatId: 'chat-1',
    accessScope: normalizeMcpChatAccessScope({}, 'drone-a'),
    selectedDroneRefs: [],
  } as any;

  test("reports the chat's worktree to the Hub, and clears it", async () => {
    const previous = { fetch: globalThis.fetch, url: process.env.DRONE_HUB_BASE_URL, token: process.env.DRONE_TOKEN };
    const requests: Array<{ path: string; body: any }> = [];
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ path: url.pathname, body });
      return Response.json(
        body?.clear
          ? { ok: true, worktree: null, main: true }
          : { ok: true, main: false, worktree: { path: '/work/wt', branch: 'feature', reportedAt: 'now' } },
      );
    }) as typeof fetch;
    process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
    process.env.DRONE_TOKEN = 'worktree-tool-test-token';
    try {
      const server = createDroneHubMcpServer({ principal: chatPrincipal });
      const client = new Client({ name: 'test', version: '0.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'set_current_worktree')).toBe(true);

      const set = await client.callTool({ name: 'set_current_worktree', arguments: { path: '/work/wt/src' } });
      expect(set.structuredContent).toMatchObject({ mainCheckout: false, worktree: { path: '/work/wt', branch: 'feature' } });
      const cleared = await client.callTool({ name: 'set_current_worktree', arguments: { clear: true } });
      expect(cleared.structuredContent).toMatchObject({ mainCheckout: true, worktree: null });
      expect(requests).toEqual([
        { path: '/api/drones/drone-a/chats/main%20chat/worktree', body: { path: '/work/wt/src' } },
        { path: '/api/drones/drone-a/chats/main%20chat/worktree', body: { clear: true } },
      ]);
    } finally {
      globalThis.fetch = previous.fetch;
      if (previous.url == null) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previous.url;
      if (previous.token == null) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previous.token;
    }
  });
});
