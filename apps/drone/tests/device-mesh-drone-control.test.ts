import { describe, expect, test } from 'bun:test';
import {
  createDroneControlCapability,
  deviceMeshDroneSummary,
} from '../src/hub/device-mesh/drone-control-capability';

describe('device mesh drone summaries', () => {
  test('preserves the sidebar hierarchy fields needed by mobile clients', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'drone_child',
        name: 'Child',
        runtime: 'container',
        group: 'Review',
        repoPath: '/work/repo',
        fleetParentId: 'drone_parent',
        chats: ['default', 'review'],
        busyChats: ['review'],
        lastMessageAt: '2026-07-14T10:00:00.000Z',
        statusOk: false,
        statusError: 'offline',
      }),
    ).toMatchObject({
      id: 'drone_child',
      repoPath: '/work/repo',
      fleetParentId: 'drone_parent',
      group: 'Review',
      chats: ['default', 'review'],
      busyChats: ['review'],
      lastMessageAt: '2026-07-14T10:00:00.000Z',
      statusOk: false,
      statusError: 'offline',
    });
  });

  test('accepts registry chat maps and nested repo paths', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'drone_a',
        repoPath: '',
        repo: { path: '/nested/repo' },
        chats: { default: {}, planning: {} },
      }),
    ).toMatchObject({
      repoPath: '/nested/repo',
      chats: ['default', 'planning'],
      fleetParentId: null,
    });
  });

  test('returns timestamps and desktop sidebar ordering from drones.list', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const pathname = new URL(String(input)).pathname;
      const url = new URL(String(input));
      requestedPaths.push(`${pathname}${url.search}`);
      const body =
        pathname === '/api/drones'
          ? {
              ok: true,
              drones: [
                {
                  id: 'one',
                  name: 'One',
                  repoPath: '/work/one',
                  lastMessageAt: '2026-07-14T10:00:00.000Z',
                },
                { id: 'loose', name: 'Loose', repoPath: '' },
              ],
            }
          : pathname === '/api/repos'
            ? { ok: true, repos: [{ path: '/work/one' }, { path: '/work/empty' }] }
            : pathname === '/api/repos/branches'
              ? {
                  ok: true,
                  hostBranch: url.searchParams.get('repoPath') === '/work/one' ? 'main' : null,
                  remoteBranches:
                    url.searchParams.get('repoPath') === '/work/one'
                      ? [{ name: 'origin/main', remote: 'origin', branch: 'main' }]
                      : [],
                }
              : pathname === '/api/groups'
                ? {
                    ok: true,
                    groups: [{ name: 'Review', createdAt: '2026-07-13T10:00:00.000Z' }],
                  }
                : {
                    ok: true,
                    uiPreferences: {
                      sidebarGroupOrder: ['repo:repo:/work/one'],
                      sidebarDroneOrderByGroup: { 'group:Ungrouped': ['one'] },
                      sidebarNodeOrderByParent: { root: ['drone:one'] },
                    },
                  };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('drones.list', { includeCreateOptions: true }),
      ).resolves.toMatchObject({
        schemaVersion: 6,
        drones: [{ id: 'one', lastMessageAt: '2026-07-14T10:00:00.000Z' }, { id: 'loose' }],
        repoPathByDroneId: { one: '/work/one' },
        sidebar: {
          registeredRepoPaths: ['/work/one', '/work/empty'],
          groupCreatedAtByName: { Review: '2026-07-13T10:00:00.000Z' },
          sidebarGroupOrder: ['repo:repo:/work/one'],
          sidebarDroneOrderByGroup: { 'group:Ungrouped': ['one'] },
          sidebarNodeOrderByParent: { root: ['drone:one'] },
        },
        createOptions: {
          repos: [
            {
              path: '/work/one',
              hostBranch: null,
              remoteBranches: [],
              branchesLoaded: false,
            },
            {
              path: '/work/empty',
              hostBranch: null,
              remoteBranches: [],
              branchesLoaded: false,
            },
          ],
        },
      });
      expect(requestedPaths.some((path) => path.startsWith('/api/repos/branches'))).toBe(false);

      await expect(
        capability.invoke('drones.list', { createRepoPath: '/work/one' }),
      ).resolves.toEqual({
        schemaVersion: 6,
        createRepo: {
          path: '/work/one',
          hostBranch: 'main',
          remoteBranches: [{ name: 'origin/main', remote: 'origin', branch: 'main' }],
          branchesError: null,
          branchesLoaded: true,
          nextCursor: null,
        },
      });
      expect(requestedPaths).toContain('/api/repos/branches?repoPath=%2Fwork%2Fone');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('bounds lazy branch pages and rejects unregistered repository paths', async () => {
    const originalFetch = globalThis.fetch;
    let branchRequests = 0;
    const remoteBranches = Array.from({ length: 700 }, (_, index) => ({
      name: `origin/${index}-${'n'.repeat(580)}`,
      remote: 'origin',
      branch: `${index}-${'b'.repeat(580)}`,
    }));
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/repos') {
        return Response.json({ ok: true, repos: [{ path: '/work/large' }] });
      }
      if (url.pathname === '/api/repos/branches') {
        branchRequests += 1;
        return Response.json({ ok: true, hostBranch: 'main', remoteBranches });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const firstPage: any = await capability.invoke('drones.list', {
        createRepoPath: '/work/large',
      });
      expect(Buffer.byteLength(JSON.stringify(firstPage))).toBeLessThan(220 * 1024);
      expect(firstPage.createRepo.remoteBranches.length).toBeGreaterThan(0);
      expect(firstPage.createRepo.remoteBranches.length).toBeLessThan(500);
      expect(firstPage.createRepo.branchesLoaded).toBe(false);
      expect(firstPage.createRepo.nextCursor).toBeGreaterThan(0);

      const secondPage: any = await capability.invoke('drones.list', {
        createRepoPath: '/work/large',
        createRepoCursor: firstPage.createRepo.nextCursor,
      });
      expect(Buffer.byteLength(JSON.stringify(secondPage))).toBeLessThan(220 * 1024);
      expect(secondPage.createRepo.remoteBranches[0]?.name).toBe(
        remoteBranches[firstPage.createRepo.nextCursor]?.name,
      );

      await expect(
        capability.invoke('drones.list', { createRepoPath: '/work/not-registered' }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(branchRequests).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards the desktop-equivalent drone creation options', async () => {
    const originalFetch = globalThis.fetch;
    let request: { method: string; body: any } | null = null;
    globalThis.fetch = (async (_input, init) => {
      request = {
        method: String(init?.method ?? 'GET'),
        body: JSON.parse(String(init?.body ?? '{}')),
      };
      return new Response(JSON.stringify({ ok: true, id: 'created' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('drone.create.container', {
        name: 'mobile-drone',
        group: 'review',
        repoPath: '/work/drone',
        draft: true,
        persistVolume: true,
        repoBranchSource: 'remote',
        remoteBranch: 'origin/mobile',
        seedAgent: { kind: 'builtin', id: 'codex' },
        seedModel: 'gpt-5.2-codex',
        seedReasoning: 'high',
        seedAgentPermissionMode: 'read-only',
        seedPrompt: 'Review the app',
      });
      expect(request).toMatchObject({
        method: 'POST',
        body: {
          name: 'mobile-drone',
          group: 'review',
          repoPath: '/work/drone',
          runtime: 'container',
          draft: true,
          persistVolume: true,
          repoBranchSource: 'remote',
          remoteBranch: 'origin/mobile',
          seedAgent: { kind: 'builtin', id: 'codex' },
          seedChat: 'default',
          seedModel: 'gpt-5.2-codex',
          seedReasoning: 'high',
          seedAgentPermissionMode: 'read-only',
          seedPrompt: 'Review the app',
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('proxies agent-scoped create model catalogs with reasoning metadata', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          ok: true,
          models: [
            { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', reasoningLevels: ['low', 'high'] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('drones.list', {
          createModelAgent: 'codex',
          createModelRuntime: 'host',
          refreshCreateModels: true,
        }),
      ).resolves.toMatchObject({
        schemaVersion: 5,
        createModelCatalog: {
          models: [{ id: 'gpt-5.2-codex', reasoningLevels: ['low', 'high'] }],
        },
      });
      expect(requestedUrl).toBe(
        'http://127.0.0.1:7777/api/model-catalog?agent=codex&runtime=host&refresh=1',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards chat model discovery and updates', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      return new Response(
        JSON.stringify(
          String(input).includes('/models')
            ? { ok: true, models: [{ id: 'gpt-5', label: 'GPT-5' }], source: 'live' }
            : { ok: true },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.models', {
          droneId: 'drone one',
          chatName: 'default',
          refresh: true,
        }),
      ).resolves.toMatchObject({
        models: [{ id: 'gpt-5', label: 'GPT-5' }],
        source: 'live',
      });
      await capability.invoke('chat.update', {
        droneId: 'drone one',
        chatName: 'default',
        model: 'gpt-5',
      });
      expect(requests.map((request) => request.url)).toEqual([
        'http://127.0.0.1:7777/api/drones/drone%20one/chats/default/models?refresh=1',
        'http://127.0.0.1:7777/api/drones/drone%20one/chats/default/config',
      ]);
      expect(requests[1]).toMatchObject({ method: 'POST', body: '{"model":"gpt-5"}' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns durable pending prompts and forwards per-prompt cancellation', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string }> = [];
    let markReadBody = '';
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, method: String(init?.method ?? 'GET') });
      if (url.endsWith('/read')) {
        markReadBody = String(init?.body ?? '');
      }
      const body = url.endsWith('/pending')
        ? {
            ok: true,
            pending: [
              {
                id: 'prompt-2',
                at: '2026-07-15T12:00:00.000Z',
                prompt: 'Make a PR',
                state: 'queued',
              },
            ],
          }
        : url.endsWith('/pending/prompt-2')
          ? { ok: true, cancelled: true, promptId: 'prompt-2' }
          : url.endsWith('/read')
            ? {
                ok: true,
                readState: {
                  unread: false,
                  latestAgentTurnId: 'turn-1',
                  latestAgentRevision: 2,
                },
              }
            : {
                ok: true,
                turns: [{ turn: 1, prompt: 'Review the code' }],
                readState: {
                  unread: true,
                  latestAgentTurnId: 'turn-1',
                  latestAgentRevision: 2,
                },
              };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const readResult = capability.invoke(
        'chat.read',
        { droneId: 'Untitled 6', chatName: 'default' },
        { sourceDevice: { id: 'phone-1' } } as never,
      );
      await expect(readResult).resolves.toMatchObject({
        turns: [{ turn: 1, prompt: 'Review the code' }],
        pending: [{ id: 'prompt-2', prompt: 'Make a PR', state: 'queued' }],
        readState: {
          unread: false,
          latestAgentTurnId: 'turn-1',
          latestAgentRevision: 2,
        },
      });
      expect(markReadBody).toBe(
        '{"latestAgentTurnId":"turn-1","latestAgentRevision":2,"updatedByDeviceId":"phone-1"}',
      );
      await expect(
        capability.invoke('chat.stop', {
          droneId: 'Untitled 6',
          chatName: 'default',
          promptId: 'prompt-2',
        }),
      ).resolves.toMatchObject({ cancelled: true, promptId: 'prompt-2' });
      expect(requests).toContainEqual({
        url: 'http://127.0.0.1:7777/api/drones/Untitled%206/chats/default/pending/prompt-2',
        method: 'DELETE',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards permission-scoped pull request reads and actions', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      });
      const url = String(input);
      const body = url.endsWith('/merge')
        ? { ok: true, number: 596, merged: true }
        : url.endsWith('/close')
          ? { ok: true, number: 596, state: 'closed' }
          : { ok: true, github: { owner: 'nerfzael', repo: 'drone' }, pullRequests: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await capability.invoke('repo.pull-requests.read', {
        droneId: 'drone one',
        state: 'all',
      });
      await capability.invoke('repo.pull-requests.merge', {
        droneId: 'drone one',
        pullNumber: 596,
        method: 'squash',
      });
      await capability.invoke('repo.pull-requests.close', {
        droneId: 'drone one',
        pullNumber: 596,
      });

      expect(requests).toEqual([
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/repo/pull-requests?state=all',
          method: 'GET',
          body: '',
        },
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/repo/pull-requests/596/merge',
          method: 'POST',
          body: '{"method":"squash"}',
        },
        {
          url: 'http://127.0.0.1:7777/api/drones/drone%20one/repo/pull-requests/596/close',
          method: 'POST',
          body: '{}',
        },
      ]);
      await expect(
        capability.invoke('repo.pull-requests.merge', {
          droneId: 'drone one',
          pullNumber: 0,
        }),
      ).rejects.toThrow('pullNumber must be a positive integer');
      await expect(
        capability.invoke('repo.pull-requests.close', {
          droneId: 'drone one',
          pullNumber: true,
        }),
      ).rejects.toThrow('pullNumber must be a positive integer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
