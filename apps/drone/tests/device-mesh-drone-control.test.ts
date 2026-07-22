import { describe, expect, test } from 'bun:test';
import {
  createDroneControlCapability,
  deviceMeshDroneSummary,
} from '../src/hub/device-mesh/drone-control-capability';
import { autoRenameCreatedDroneFromPrompt } from '../src/hub/device-mesh/auto-rename-created-drone';

describe('device mesh drone summaries', () => {
  test('preserves the sidebar hierarchy fields needed by mobile clients', () => {
    expect(
      deviceMeshDroneSummary({
        id: 'drone_child',
        name: 'Child',
        runtime: 'container',
        group: 'Review',
        repoPath: '/work/repo',
        cwd: '/work/repo/subdir',
        fleetParentId: 'drone_parent',
        chats: ['default', 'review'],
        busyChats: ['review'],
        approvalChats: ['default'],
        lastMessageAt: '2026-07-14T10:00:00.000Z',
        statusOk: false,
        statusError: 'offline',
      }),
    ).toMatchObject({
      id: 'drone_child',
      repoPath: '/work/repo',
      cwd: '/work/repo/subdir',
      repoAttached: true,
      fleetParentId: 'drone_parent',
      group: 'Review',
      chats: ['default', 'review'],
      busyChats: ['review'],
      approvalChats: ['default'],
      approvalRequired: true,
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
        autoRename: true,
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
      expect((request as { body: any } | null)?.body.autoRename).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('forwards mobile drone renames to the Hub rename endpoint', async () => {
    const originalFetch = globalThis.fetch;
    let request: { path: string; method: string; body: any } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = {
        path: new URL(String(input)).pathname,
        method: String(init?.method ?? 'GET'),
        body: JSON.parse(String(init?.body ?? '{}')),
      };
      return Response.json({ ok: true, id: 'drone-one', newName: 'Review drone' });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('drone.rename', {
          droneId: 'drone-one',
          newName: 'Review drone',
        }),
      ).resolves.toMatchObject({ ok: true, newName: 'Review drone' });
      expect(request).toEqual({
        path: '/api/drones/drone-one/rename',
        method: 'POST',
        body: { newName: 'Review drone', source: 'drone-hub-mobile' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('schedules automatic naming for unnamed mobile-created drones', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string; body: any }> = [];
    let resolveSuggestion: ((response: Response) => void) | null = null;
    globalThis.fetch = (async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({
        path,
        method: String(init?.method ?? 'GET'),
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      if (path === '/api/drones') return Response.json({ ok: true, id: 'created-mobile' });
      if (path === '/api/drones/name-from-message') {
        return await new Promise<Response>((resolve) => {
          resolveSuggestion = resolve;
        });
      }
      return Response.json({ ok: true, renamed: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('drone.create.container', {
          seedAgent: { kind: 'builtin', id: 'codex' },
          autoRename: true,
          autoRenamePrompt: 'Review the Android app',
        }),
      ).resolves.toMatchObject({
        id: 'created-mobile',
        autoRenameScheduled: true,
      });
      expect(requests[0]).toMatchObject({
        path: '/api/drones',
        body: {
          runtime: 'container',
        },
      });
      expect(requests[0]?.body.autoRenamePrompt).toBeUndefined();
      expect(requests[1]).toMatchObject({
        path: '/api/drones/name-from-message',
        body: {
          message: 'Review the Android app',
          source: 'mobile-create-auto-rename',
          droneId: 'created-mobile',
        },
      });

      resolveSuggestion?.(Response.json({ ok: true, name: 'Review Android App' }));
      for (let attempt = 0; attempt < 10 && requests.length < 3; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(requests[2]).toMatchObject({
        path: '/api/drones/created-mobile/rename',
        body: {
          newName: 'Review Android App',
          source: 'mobile-create-auto-rename',
          attempt: 1,
          suggestedBase: 'Review Android App',
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('chooses a numbered automatic name when the first suggestion is already used', async () => {
    const originalFetch = globalThis.fetch;
    const renameBodies: any[] = [];
    globalThis.fetch = (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/drones/name-from-message') {
        return Response.json({ ok: true, name: 'Review Android App' });
      }
      if (path === '/api/drones/drone-1/rename') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        renameBodies.push(body);
        if (renameBodies.length === 1) {
          return Response.json(
            { ok: false, error: 'drone already exists: Review Android App' },
            { status: 409 },
          );
        }
        return Response.json({ ok: true, renamed: true });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      await expect(
        autoRenameCreatedDroneFromPrompt(
          { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' },
          'drone-1',
          'Review the Android app',
        ),
      ).resolves.toBe('Review Android App (2)');
      expect(renameBodies.map((body) => body.newName)).toEqual([
        'Review Android App',
        'Review Android App (2)',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('keeps a successful create when automatic naming is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    let createBody: any = null;
    console.warn = (...args: unknown[]) => warnings.push(args);
    globalThis.fetch = (async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/drones') {
        createBody = JSON.parse(String(init?.body ?? '{}'));
        return Response.json({ ok: true, id: 'created-without-name' });
      }
      return Response.json(
        { ok: false, error: 'Connect Codex or configure an OpenAI API key in Settings.' },
        { status: 412 },
      );
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('drone.create.host', {
          seedPrompt: 'Review the Android app',
          autoRename: true,
        }),
      ).resolves.toMatchObject({ id: 'created-without-name', autoRenameScheduled: true });
      expect(createBody).toMatchObject({
        runtime: 'host',
        seedPrompt: 'Review the Android app',
      });
      expect(createBody.autoRename).toBeUndefined();
      expect(createBody.autoRenamePrompt).toBeUndefined();
      for (let attempt = 0; attempt < 10 && warnings.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(String(warnings[0]?.[0] ?? '')).toContain('mobile-created drone auto-rename failed');
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
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

  test('rejects native thread ids that do not belong to the selected chat', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
      if (url.pathname.endsWith('/native')) {
        return Response.json({ ok: true, nativeChatId: 'native-for-selected-chat' });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.update', {
          droneId: 'drone-1',
          chatName: 'default',
          nativeChatId: 'another-native-thread',
          model: 'gpt-5',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(requestedPaths).toEqual(['/api/drones/drone-1/chats/default/native']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses the Hub-selected provider catalog for native chat model choices', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/native')) {
        return Response.json({
          ok: true,
          nativeChatId: 'native-chat-1',
          threads: [
            {
              id: 'native-chat-1',
              provider: 'openai',
              model: 'gpt-5.6-sol',
              thinkingLevel: 'low',
            },
          ],
        });
      }
      if (url.pathname === '/api/model-catalog') {
        return Response.json({
          ok: true,
          provider: 'codex',
          defaultModel: {
            provider: 'codex',
            model: 'gpt-5.6-sol',
            thinkingLevel: 'medium',
          },
          models: [
            {
              provider: 'codex',
              id: 'gpt-5.6-sol',
              label: 'GPT-5.6 Sol',
              reasoningLevels: ['off', 'low', 'medium', 'high'],
              defaultReasoningLevel: 'medium',
            },
          ],
        });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.models', {
          droneId: 'drone-1',
          chatName: 'default',
          nativeChatId: 'native-chat-1',
        }),
      ).resolves.toMatchObject({
        provider: 'codex',
        model: 'gpt-5.6-sol',
        reasoning: 'medium',
        models: [{ provider: 'codex', id: 'gpt-5.6-sol' }],
      });
      expect(requestedPaths).toEqual([
        '/api/drones/drone-1/chats/default/native',
        '/api/model-catalog?agent=native',
      ]);
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

  test('loads a historical file diff through the existing chat read permission', async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);
      return Response.json({
        ok: true,
        diff: {
          path: 'src/a.ts',
          patch: '+new line\n',
          truncated: false,
          owner: { droneId: 'drone-1', chatName: 'default', promptId: 'prompt-1' },
        },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.read', {
          droneId: 'drone-1',
          chatName: 'default',
          diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
          diffPath: 'src/a.ts',
        }),
      ).resolves.toMatchObject({
        diff: { path: 'src/a.ts', patch: '+new line\n', truncated: false },
      });
      expect(requestedPaths).toEqual([
        '/api/agent-run-diffs/018fdce7-6e20-7d31-a78c-3f95d665cc72/file?path=src%2Fa.ts',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('validates native historical diffs without opening the native session', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      requests.push({ path: `${url.pathname}${url.search}`, method: String(init?.method ?? 'GET') });
      if (url.pathname.endsWith('/native')) {
        return Response.json({ ok: true, nativeChatId: 'native-chat-1' });
      }
      return Response.json({
        ok: true,
        diff: {
          path: 'src/a.ts',
          patch: '+new line\n',
          owner: { droneId: 'drone-1', threadId: 'native-chat-1', turnId: 'turn-1' },
        },
      });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      await expect(
        capability.invoke('chat.read', {
          droneId: 'drone-1',
          chatName: 'default',
          diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
          diffPath: 'src/a.ts',
        }),
      ).resolves.toMatchObject({ diff: { patch: '+new line\n' } });
      expect(requests).toEqual([
        {
          path: '/api/agent-run-diffs/018fdce7-6e20-7d31-a78c-3f95d665cc72/file?path=src%2Fa.ts',
          method: 'GET',
        },
        { path: '/api/drones/drone-1/chats/default/native', method: 'GET' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('bounds historical diffs to a safe mobile response size', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        diff: {
          path: 'src/large.ts',
          patch: `+${'x'.repeat(300 * 1024)}\n`,
          truncated: false,
          owner: { droneId: 'drone-1', chatName: 'default', promptId: 'prompt-1' },
        },
      })) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const result: any = await capability.invoke('chat.read', {
        droneId: 'drone-1',
        chatName: 'default',
        diffArtifactId: '018fdce7-6e20-7d31-a78c-3f95d665cc72',
        diffPath: 'src/large.ts',
      });

      expect(result.diff.truncated).toBe(true);
      expect(Buffer.byteLength(result.diff.patch)).toBeLessThanOrEqual(80 * 1024);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(220 * 1024);
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

  test('returns chunked text and media file previews', async () => {
    const originalFetch = globalThis.fetch;
    const chunkRequests: string[] = [];
    const metadataRequests: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const filePath = url.searchParams.get('path');
      if (url.pathname.endsWith('/fs/file')) {
        metadataRequests.push(String(url.searchParams.get('metadata') ?? ''));
        const body = filePath?.endsWith('.md')
          ? {
              ok: true,
              path: '/work/repo/README.md',
              kind: 'text',
              mime: 'text/markdown',
              content: '# Preview',
              size: 9,
              mtimeMs: 100,
            }
          : {
              ok: true,
              path: '/work/repo/demo.mp4',
              kind: 'video',
              mime: 'video/mp4',
              size: 6,
              mtimeMs: 200,
            };
        return Response.json(body);
      }
      if (url.pathname.endsWith('/fs/chunk')) {
        chunkRequests.push(`${url.searchParams.get('offset')}:${url.searchParams.get('limit')}`);
        return Response.json({
          ok: true,
          kind: 'binary-chunk',
          mime: 'video/mp4',
          size: 6,
          offset: 0,
          nextOffset: 6,
          eof: true,
          dataBase64: Buffer.from([1, 2, 3, 4, 5, 6]).toString('base64'),
        });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    }) as typeof fetch;
    try {
      const capability = createDroneControlCapability({
        baseUrl: () => 'http://127.0.0.1:7777',
        apiToken: 'test',
      });
      const textResult: any = await capability.invoke('file.preview', {
        droneId: 'one',
        path: '/work/repo/README.md',
      });
      const decodedText = JSON.parse(
        Buffer.from(textResult.contentChunk.dataBase64, 'base64').toString('utf8'),
      );
      expect(decodedText).toMatchObject({
        kind: 'text',
        mime: 'text/markdown',
        content: '# Preview',
      });

      await expect(
        capability.invoke('file.preview', {
          droneId: 'one',
          path: '/work/repo/demo.mp4',
        }),
      ).resolves.toMatchObject({
        preview: { kind: 'video', mime: 'video/mp4', size: 6 },
        mediaChunk: {
          encoding: 'base64-binary',
          offset: 0,
          bytes: 6,
          totalBytes: 6,
          done: true,
        },
      });
      expect(chunkRequests).toEqual(['0:131072']);
      expect(metadataRequests).toEqual(['', '1']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
