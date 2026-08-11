import { describe, expect, test } from 'bun:test';

import { ASSISTANT_TOOL_SUMMARIES } from '../src/hub/assistant/assistant-config';
import { createInProcessDroneHubMcpClient } from '../src/hub/assistant/in-process-drone-hub-mcp';
import { changeRequestBelongsToChat } from '../src/hub/change-requests/change-request-mcp-tools';
import { normalizeMcpChatAccessScope } from '../src/hub/mcp-chat-access';
import { authorizeDroneHubMcpTool, imageToolResult } from '../src/hub/mcp-server';
import { droneStatusSummary } from '../src/hub/mcp-summaries';
import { upsertStoredSpeechSettings } from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

describe('Drone Hub MCP server summaries', () => {
  test('shows Drone Hub summary busy state as in progress', () => {
    expect(droneStatusSummary({ status: 'ready', busy: true })).toBe('busy');
    expect(droneStatusSummary({ status: 'ready', busyChats: ['default'] })).toBe('busy');
  });
});

describe('Drone Hub MCP server tool results', () => {
  test('puts image content before text and omits structuredContent', () => {
    const result = imageToolResult({
      text: 'Captured whiteboard main as a 64x64 PNG.',
      data: Buffer.from('png').toString('base64'),
      mimeType: 'image/png',
      metadata: { width: 64, height: 64, byteLength: 3 },
    });

    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: 'image',
      data: Buffer.from('png').toString('base64'),
      mimeType: 'image/png',
      _meta: { width: 64, height: 64, byteLength: 3 },
    });
    expect(result.content[1]).toEqual({
      type: 'text',
      text: 'Captured whiteboard main as a 64x64 PNG.',
    });
  });
});

describe('Drone Hub MCP principal authorization', () => {
  const dronePrincipal = {
    principal: { kind: 'drone' as const, tokenId: 'token', name: 'Drone token', droneId: 'drone-a' },
  };

  test('allows a drone principal to use its own chats', () => {
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'read_chat', { drone: 'drone-a' })).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'list_workflows', { drone: 'drone-a' })).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'execute_workflow', {
      drone: 'drone-a',
      workflowId: 'wf-1',
    })).not.toThrow();
  });

  test('rejects cross-drone and host-wide operations', () => {
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'send_message', { drone: 'drone-b' })).toThrow('scoped to drone drone-a');
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'get_workflow_run', {
      drone: 'drone-b',
      runId: 'run-1',
    })).toThrow('scoped to drone drone-a');
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'create_drone', {})).toThrow('not authorized');
  });

  test('allows host principals to use all domain tools', () => {
    const host = { principal: { kind: 'host' as const, tokenId: 'host', name: 'Host token' } };
    expect(() => authorizeDroneHubMcpTool(host, 'create_drone', {})).not.toThrow();
  });

  test('enforces the native read, write, and execute scope shape for chat principals', () => {
    const chatPrincipal = {
      kind: 'chat' as const,
      tokenId: 'chat:drone-a:default',
      name: 'Drone A / default',
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      accessScope: {
        readMode: 'all' as const,
        writeMode: 'selected' as const,
        executeMode: 'selected' as const,
        droneIds: ['drone-a'],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      selectedDroneRefs: ['drone-a', 'Drone A'],
    };
    const scoped = { principal: chatPrincipal };
    expect(() => authorizeDroneHubMcpTool(scoped, 'read_chat', { drone: 'drone-b' })).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(scoped, 'create_chat', { drone: 'drone-b' })).toThrow('write scope');
    expect(() => authorizeDroneHubMcpTool(scoped, 'send_message', { drone: 'drone-b' })).toThrow('execute scope');
    expect(() => authorizeDroneHubMcpTool(scoped, 'send_message', { drone: 'Drone A' })).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(scoped, 'create_drone', { name: 'Child' })).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(scoped, 'create_drone', { name: 'Child', parent: 'drone-b' })).not.toThrow();
    const cloneScoped = {
      principal: {
        ...chatPrincipal,
        accessScope: { ...chatPrincipal.accessScope, readMode: 'selected' as const },
      },
    };
    expect(() => authorizeDroneHubMcpTool(cloneScoped, 'create_drone', { name: 'Child', parent: 'drone-b' })).toThrow('read scope');
    expect(() => authorizeDroneHubMcpTool(cloneScoped, 'create_drone', { name: 'Child', parent: 'drone-a' })).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(cloneScoped, 'clone_drone', { source: 'drone-b', name: 'Child' })).toThrow('read scope');
    expect(() => authorizeDroneHubMcpTool(cloneScoped, 'clone_drone', { source: 'drone-a', name: 'Child' })).not.toThrow();
  });

  test('uses native defaults and includes the owner whenever a scope is selected', () => {
    expect(normalizeMcpChatAccessScope({}, 'drone-a')).toMatchObject({
      readMode: 'all',
      writeMode: 'selected',
      executeMode: 'selected',
      changeRequestCreate: true,
      changeRequestMerge: false,
      droneIds: ['drone-a'],
    });
    expect(
      normalizeMcpChatAccessScope(
        {
          readMode: 'all',
          writeMode: 'all',
          executeMode: 'all',
          droneIds: ['drone-a'],
        },
        'drone-a',
      ).droneIds,
    ).toEqual([]);
  });

  test('keeps change-request creation and merge as separate chat permissions', () => {
    const principal = {
      kind: 'chat' as const,
      tokenId: 'chat:drone-a:default',
      name: 'Drone A / default',
      droneId: 'drone-a',
      chatName: 'default',
      chatId: 'chat-a',
      accessScope: normalizeMcpChatAccessScope({}, 'drone-a'),
      selectedDroneRefs: ['drone-a'],
    };
    expect(() => authorizeDroneHubMcpTool(
      { principal },
      'create_change_request',
      {},
    )).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(
      { principal },
      'merge_change_request',
      { requestId: 'cr-1' },
    )).toThrow('not allowed to merge change requests');
    expect(() => authorizeDroneHubMcpTool(
      {
        principal: {
          ...principal,
          accessScope: { ...principal.accessScope, changeRequestMerge: true },
        },
      },
      'merge_change_request',
      { requestId: 'cr-1' },
    )).not.toThrow();
  });

  test('uses the stable chat id for change-request ownership', () => {
    const principal = {
      kind: 'chat' as const,
      tokenId: 'chat:drone-a:renamed',
      name: 'Drone A / renamed',
      droneId: 'drone-a',
      chatName: 'renamed',
      chatId: 'chat-a',
      accessScope: normalizeMcpChatAccessScope({}, 'drone-a'),
      selectedDroneRefs: ['drone-a'],
    };
    expect(changeRequestBelongsToChat(
      { droneId: 'drone-a', chatId: 'chat-a', chatName: 'old-name' },
      principal,
    )).toBe(true);
    expect(changeRequestBelongsToChat(
      { droneId: 'drone-a', chatId: 'different-chat', chatName: 'renamed' },
      principal,
    )).toBe(false);
    expect(changeRequestBelongsToChat(
      { droneId: 'drone-a', chatName: 'renamed' },
      principal,
    )).toBe(true);
  });

  test('enforces assistant read and write scopes for host principals', () => {
    const assistant = {
      principal: { kind: 'host' as const, tokenId: 'assistant', name: 'Assistant' },
      allowedDroneRefs: ['drone-a', 'Allowed'],
      allowedWriteDroneRefs: ['drone-a'],
      allowedDroneIds: ['drone-a'],
    };
    expect(() => authorizeDroneHubMcpTool(assistant, 'read_chat', { drone: 'Allowed' })).not.toThrow();
    expect(() => authorizeDroneHubMcpTool(assistant, 'read_chat', { drone: 'drone-b' })).toThrow('not authorized');
    expect(() => authorizeDroneHubMcpTool(assistant, 'create_chat', { drone: 'Allowed' })).toThrow('not authorized');
    expect(() => authorizeDroneHubMcpTool(assistant, 'rename_drones', {
      renames: [{ drone: 'drone-b', newName: 'Nope' }],
    })).toThrow('not authorized');
    expect(() => authorizeDroneHubMcpTool(assistant, 'create_drone', { name: 'New draft', draft: true })).not.toThrow();
  });

});

describe('Drone Hub assistant MCP transport', () => {
  test('loads the authorized Hub catalog through an in-process MCP client', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-', async () => {
      const client = await createInProcessDroneHubMcpClient({
        correlationId: 'thread-one',
        allowedDroneRefs: [],
        allowedWriteDroneRefs: [],
        allowedDroneIds: [],
      });
      const catalog = await client.listTools();
      const catalogNames = catalog.tools.map((tool) => tool.name).sort();
      const displayedMcpNames = ASSISTANT_TOOL_SUMMARIES.filter((tool) => tool.group?.kind === 'mcp' && tool.group.id === 'drone-hub').map((tool) => tool.name).sort();
      expect(displayedMcpNames).toEqual(catalogNames);
      await client.close();
    });
  });

  test('uses the shared rename command without a loopback HTTP request', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-rename-', async () => {
      const previousFetch = globalThis.fetch;
      const renames: any[] = [];
      globalThis.fetch = (async (input) => {
        throw new Error(`unexpected loopback request: ${String(input)}`);
      }) as typeof fetch;
      const client = await createInProcessDroneHubMcpClient({
        correlationId: 'thread-rename',
        allowedDroneRefs: ['drone-a'],
        allowedWriteDroneRefs: ['drone-a'],
        allowedDroneIds: ['drone-a'],
        hubServices: {
          drones: {
            rename: async (input: any) => {
              renames.push(input);
              return {
                ok: true,
                id: 'drone-a',
                oldName: 'Untitled 1',
                newName: input.newName,
                renamed: true,
              };
            },
          },
        } as any,
      });
      try {
        const result = await client.callTool({
          name: 'rename_drones',
          arguments: { drone: 'drone-a', newName: 'Review proposals' },
        });
        expect(result.structuredContent).toMatchObject({ ok: true, total: 1 });
        expect(renames).toEqual([
          {
            droneRef: 'drone-a',
            newName: 'Review proposals',
            source: 'drone-hub-mcp',
          },
        ]);
      } finally {
        await client.close();
        globalThis.fetch = previousFetch;
      }
    });
  });

  test('uses the Hub application for in-process group mutations', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-group-', async () => {
      const previousFetch = globalThis.fetch;
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const moves: any[] = [];
      globalThis.fetch = (async (input) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input : input.url,
        );
        if (url.pathname === '/api/drones/summary') {
          return Response.json({
            ok: true,
            drones: [{ id: 'drone-a', name: 'Drone A', repoPath: '/repo' }],
          });
        }
        throw new Error(`unexpected loopback request: ${url.pathname}`);
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'assistant-test-token';
      let groupCreated = false;
      const group = {
        id: 'group-a',
        repoPath: '/repo',
        name: 'Review',
        label: 'Review',
        parentId: null,
        createdAt: null,
        updatedAt: null,
        droneCount: 0,
        pendingCount: 0,
        totalCount: 0,
      };
      const client = await createInProcessDroneHubMcpClient({
        correlationId: 'thread-group',
        allowedDroneRefs: ['drone-a'],
        allowedWriteDroneRefs: ['drone-a'],
        allowedDroneIds: ['drone-a'],
        hubServices: {
          repositories: {
            list: async () => ({
              ok: true,
              repos: [{ path: '/repo', addedAt: null, remoteUrl: null, github: null }],
              count: 1,
            }),
          },
          groups: {
            list: async () => ({
              ok: true,
              groups: groupCreated ? [group] : [],
              total: groupCreated ? 1 : 0,
            }),
            create: async () => {
              groupCreated = true;
              return { ok: true, ...group };
            },
            setDroneGroup: async (input: any) => {
              moves.push(input);
              return {
                ok: true,
                group: 'Review',
                moved: [{ id: 'drone-a', groupId: 'group-a' }],
                rejected: [],
                total: 1,
              };
            },
          },
          settings: {
            uiPreferences: {
              read: async () => ({ ok: true, uiPreferences: {}, version: null }),
              update: async ({ uiPreferences }: any) => ({
                ok: true,
                uiPreferences,
                version: 1,
              }),
            },
          },
        } as any,
      });
      try {
        const repos = await client.callTool({ name: 'list_repos', arguments: {} });
        expect(repos.structuredContent).toMatchObject({
          ok: true,
          count: 1,
          repos: [{ path: '/repo' }],
        });
        const created = await client.callTool({
          name: 'create_group',
          arguments: { name: 'Review', repoPath: '/repo' },
        });
        expect(created.structuredContent).toMatchObject({
          ok: true,
          id: 'group-a',
          group: 'Review',
        });
        const result = await client.callTool({
          name: 'set_drone_group',
          arguments: { drone: 'drone-a', groupId: 'group-a' },
        });
        expect(result.structuredContent).toMatchObject({
          ok: true,
          group: 'Review',
          total: 1,
        });
        expect(moves).toEqual([{ droneIds: ['drone-a'], groupId: 'group-a' }]);
      } finally {
        await client.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('hides speak from new Built-in MCP catalogs when speech is disabled globally', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-speech-disabled-', async () => {
      await upsertStoredSpeechSettings({ enabled: false });
      const client = await createInProcessDroneHubMcpClient({
        correlationId: 'thread-speech-disabled',
        allowedDroneRefs: [],
        allowedWriteDroneRefs: [],
        allowedDroneIds: [],
      });
      expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('speak');
      await client.close();
    });
  });

  test('uses read access when creating chat resource subscriptions', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-subscription-read-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      let createRequests = 0;
      globalThis.fetch = (async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input : input.url,
        );
        const method = String(init?.method ?? 'GET').toUpperCase();
        if (url.pathname === '/api/resource-subscriptions/chat-resource/target-chat') {
          return Response.json({
            ok: true,
            resource: { chatId: 'target-chat', droneId: 'drone-b', chatName: 'default' },
          });
        }
        if (url.pathname === '/api/resource-subscriptions' && method === 'POST') {
          createRequests += 1;
          return Response.json({
            ok: true,
            created: true,
            subscription: {
              id: 'subscription-1',
              provider: 'drone-hub',
              resourceType: 'chat',
              resourceId: 'target-chat',
              events: ['chat.idle'],
              status: 'active',
            },
          });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'managed-chat-test-token';

      const principal = (readDroneIds: string[], executeMode: 'all' | 'selected') => ({
        kind: 'chat' as const,
        tokenId: 'chat:drone-a:default',
        name: 'Drone A / default',
        droneId: 'drone-a',
        chatName: 'default',
        chatId: 'subscriber-chat',
        accessScope: {
          readMode: 'selected' as const,
          writeMode: 'all' as const,
          executeMode,
          droneIds: readDroneIds,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        selectedDroneRefs: readDroneIds,
      });
      let allowedClient: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      let deniedClient: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        allowedClient = await createInProcessDroneHubMcpClient({
          correlationId: 'subscription-read-allowed',
          principal: principal(['drone-a', 'drone-b'], 'selected'),
        });
        const allowed = await allowedClient.callTool({
          name: 'subscribe_to_resource_events',
          arguments: {
            provider: 'drone-hub',
            resourceType: 'chat',
            resourceId: 'target-chat',
            events: ['chat.idle'],
          },
        });
        expect(allowed.isError).not.toBe(true);

        deniedClient = await createInProcessDroneHubMcpClient({
          correlationId: 'subscription-read-denied',
          principal: principal(['drone-a'], 'all'),
        });
        const denied = await deniedClient.callTool({
          name: 'subscribe_to_resource_events',
          arguments: {
            provider: 'drone-hub',
            resourceType: 'chat',
            resourceId: 'target-chat',
            events: ['chat.idle'],
          },
        });
        expect(denied.isError).toBe(true);
        expect(createRequests).toBe(1);
      } finally {
        await allowedClient?.close();
        await deniedClient?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('creates cron subscriptions in the timezone last reported by the user interface', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-cron-subscription-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      let requestBody: any = null;
      let userContextRequests = 0;
      globalThis.fetch = (async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input : input.url,
        );
        if (url.pathname === '/api/settings/user-context') {
          userContextRequests += 1;
          return Response.json({
            ok: true,
            userContext: { timeZone: 'America/Los_Angeles' },
          });
        }
        if (url.pathname === '/api/resource-subscriptions/cron') {
          requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          return Response.json({
            ok: true,
            created: true,
            subscription: {
              id: 'cron-subscription-1',
              provider: 'drone-hub',
              resourceType: 'cron',
              resourceId: 'v1:hourly',
              resourceConfig: { expression: '0 * * * *', timeZone: 'America/Los_Angeles' },
              events: ['cron.triggered'],
              intent: 'Check the deployment.',
              nextEventAt: '2026-08-05T13:00:00.000Z',
              status: 'active',
              cursor: { hidden: true },
              subscriber: { chatId: 'subscriber-chat' },
            },
          });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'managed-chat-test-token';

      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'cron-subscription',
          principal: {
            kind: 'chat',
            tokenId: 'chat:drone-a:default',
            name: 'Drone A / default',
            droneId: 'drone-a',
            chatName: 'default',
            chatId: 'subscriber-chat',
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['drone-a'],
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            selectedDroneRefs: ['drone-a'],
          },
        });
        const result = await client.callTool({
          name: 'subscribe_to_cron',
          arguments: {
            expression: '0 * * * *',
            intent: 'Check the deployment.',
          },
        });
        expect(result.isError).not.toBe(true);
        expect(requestBody).toMatchObject({
          expression: '0 * * * *',
          timeZone: 'America/Los_Angeles',
          intent: 'Check the deployment.',
          subscriber: {
            chatId: 'subscriber-chat',
            droneId: 'drone-a',
            chatName: 'default',
          },
        });
        expect(result.structuredContent).toMatchObject({
          ok: true,
          created: true,
          subscription: {
            id: 'cron-subscription-1',
            resourceType: 'cron',
            nextEventAt: '2026-08-05T13:00:00.000Z',
          },
        });
        expect((result.structuredContent as any)?.subscription?.cursor).toBeUndefined();
        expect((result.structuredContent as any)?.subscription?.subscriber).toBeUndefined();

        await client.callTool({
          name: 'subscribe_to_cron',
          arguments: {
            expression: '0 22 * * *',
            timeZone: 'Europe/Paris',
            intent: 'Run the nightly report.',
          },
        });
        expect(requestBody).toMatchObject({
          expression: '0 22 * * *',
          timeZone: 'Europe/Paris',
          intent: 'Run the nightly report.',
        });
        expect(userContextRequests).toBe(1);
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('keeps same-named repository groups isolated across MCP list, create, move, and reorder tools', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-groups-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const repoA = '/repo/a';
      const repoB = '/repo/b';
      const groups = [
        { id: 'grp_repo_a', repoPath: repoA, name: 'review', label: 'review', parentId: null, totalCount: 1 },
        { id: 'grp_repo_b', repoPath: repoB, name: 'review', label: 'review', parentId: null, totalCount: 2 },
      ];
      const drones = [
        { id: 'a-1', name: 'A 1', repoPath: repoA, group: 'review', groupId: 'grp_repo_a' },
        { id: 'a-loose', name: 'A loose', repoPath: repoA, group: null, groupId: null },
        {
          id: 'a-child',
          name: 'A child',
          repoPath: repoA,
          group: null,
          groupId: null,
          fleetParentId: 'a-loose',
        },
        { id: 'b-1', name: 'B 1', repoPath: repoB, group: 'review', groupId: 'grp_repo_b' },
        { id: 'b-2', name: 'B 2', repoPath: repoB, group: 'review', groupId: 'grp_repo_b' },
        { id: 'b-3', name: 'B 3', repoPath: repoB, group: null, groupId: null },
      ];
      let uiPreferences: any = {
        sidebarGroupingMode: 'groups',
        collapsedGroups: { review: true },
        collapsedDroneSections: { 'chats:b-1': true },
        sidebarGroupOrder: ['group-id:grp_repo_a', 'group-id:grp_repo_b'],
        sidebarDroneOrderByGroup: {
          'group-id:grp_repo_a': ['a-1'],
          'group-id:grp_repo_b': ['b-1', 'b-2'],
        },
        sidebarNodeOrderByParent: {
          'folder:review': ['drone:a-1', 'drone:b-1', 'drone:b-2'],
          [`folder:repo:${repoA}`]: [
            'drone:a-loose',
            `folder:repo-scope:repo:${repoA}:review`,
          ],
        },
      };
      const requests: Array<{ pathname: string; search: string; method: string; body?: any }> = [];
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        const body = method !== 'GET' && typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, search: url.search, method, ...(body === undefined ? {} : { body }) });
        if (url.pathname === '/api/drones/summary' && method === 'GET') {
          return Response.json({ ok: true, drones });
        }
        if (url.pathname === '/api/groups' && method === 'GET') {
          const repoPath = url.searchParams.has('repoPath') ? url.searchParams.get('repoPath') : null;
          const visible = repoPath == null ? groups : groups.filter((group) => group.repoPath === repoPath);
          return Response.json({ ok: true, groups: visible, total: visible.length });
        }
        if (url.pathname === '/api/groups' && method === 'POST') {
          const created = {
            id: 'grp_new_a',
            repoPath: body.repoPath,
            name: body.name,
            label: body.name,
            parentId: null,
            createdAt: '2026-07-31T12:00:00.000Z',
            totalCount: 0,
          };
          groups.push(created);
          return Response.json({ ok: true, ...created }, { status: 201 });
        }
        if (url.pathname === '/api/drones/group-set' && method === 'POST') {
          const target = drones.find((drone) => drone.id === body.droneIds?.[0]);
          if (target) {
            target.group = 'review';
            target.groupId = body.groupId;
          }
          return Response.json({
            ok: true,
            group: 'review',
            moved: target ? [{ id: target.id, name: target.name, previousGroup: null, group: 'review' }] : [],
            rejected: [],
            total: 1,
          });
        }
        if (url.pathname === '/api/settings/ui-preferences' && method === 'GET') {
          return Response.json({ ok: true, uiPreferences });
        }
        if (url.pathname === '/api/settings/ui-preferences' && method === 'POST') {
          uiPreferences = body.uiPreferences;
          return Response.json({ ok: true, uiPreferences });
        }
        return Response.json({ ok: false, error: `unexpected request: ${method} ${url.pathname}${url.search}` }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'assistant-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'thread-repo-groups',
          allowedDroneRefs: drones.flatMap((drone) => [drone.id, drone.name]),
          allowedWriteDroneRefs: drones.flatMap((drone) => [drone.id, drone.name]),
          allowedDroneIds: drones.map((drone) => drone.id),
        });

        const listed = await client.callTool({ name: 'list_groups', arguments: { repoPath: repoA } });
        expect(listed.structuredContent).toMatchObject({
          ok: true,
          total: 1,
          groups: [{ id: 'grp_repo_a', repoPath: repoA, name: 'review' }],
        });
        expect(requests.some((request) => request.method === 'GET' && request.search === '?repoPath=%2Frepo%2Fa')).toBe(true);

        const listedDrones = await client.callTool({
          name: 'list_drones',
          arguments: { repoPath: repoA, group: 'review' },
        });
        expect(listedDrones.structuredContent).toMatchObject({
          count: 1,
          drones: [{ id: 'a-1', repoPath: repoA, group: 'review', groupId: 'grp_repo_a' }],
        });

        const created = await client.callTool({
          name: 'create_group',
          arguments: { repoPath: repoA, name: 'ready' },
        });
        expect(created.structuredContent).toMatchObject({
          ok: true,
          id: 'grp_new_a',
          repoPath: repoA,
          name: 'ready',
          groupOrder: { updated: true },
        });
        expect(uiPreferences.sidebarGroupOrder).toEqual([
          'group-id:grp_new_a',
          'group-id:grp_repo_a',
          'group-id:grp_repo_b',
        ]);
        expect(uiPreferences.sidebarNodeOrderByParent[`folder:repo:${repoA}`]).toEqual([
          `folder:repo-scope:repo:${repoA}:ready`,
          'drone:a-loose',
          `folder:repo-scope:repo:${repoA}:review`,
        ]);
        const createRequest = requests.find((request) => request.pathname === '/api/groups' && request.method === 'POST');
        expect(createRequest?.body).toEqual({ name: 'ready', repoPath: repoA });

        const moved = await client.callTool({
          name: 'set_drone_group',
          arguments: { drone: 'b-3', groupId: 'grp_repo_b' },
        });
        expect(moved.isError).not.toBe(true);
        const moveRequest = requests.find((request) => request.pathname === '/api/drones/group-set');
        expect(moveRequest?.body).toEqual({ droneIds: ['b-3'], groupId: 'grp_repo_b' });

        const groupSetRequestCount = requests.filter((request) => request.pathname === '/api/drones/group-set').length;
        const crossRepoMove = await client.callTool({
          name: 'set_drone_group',
          arguments: { drone: 'a-1', groupId: 'grp_repo_b' },
        });
        expect(crossRepoMove.isError).toBe(true);
        expect(JSON.stringify(crossRepoMove.content)).toContain('different repository');
        expect(requests.filter((request) => request.pathname === '/api/drones/group-set')).toHaveLength(groupSetRequestCount);

        const reordered = await client.callTool({
          name: 'reorder_drones',
          arguments: { drones: ['b-2'], groupId: 'grp_repo_b', beforeDrone: 'b-1' },
        });
        expect(reordered.structuredContent).toMatchObject({
          ok: true,
          repoPath: repoB,
          group: 'review',
          groupId: 'grp_repo_b',
          sidebarDroneOrder: ['b-2', 'b-1', 'b-3'],
        });
        expect(uiPreferences.sidebarDroneOrderByGroup['group-id:grp_repo_b']).toEqual(['b-2', 'b-1', 'b-3']);
        expect(uiPreferences.sidebarDroneOrderByGroup['group-id:grp_repo_a']).toEqual(['a-1']);
        expect(uiPreferences.sidebarDroneOrderByGroup['group:review']).toBeUndefined();
        expect(uiPreferences.sidebarNodeOrderByParent['folder:review']).toEqual([
          'drone:b-2',
          'drone:b-1',
          'drone:b-3',
          'drone:a-1',
        ]);
        expect(uiPreferences.collapsedGroups).toEqual({ review: true });
        expect(uiPreferences.collapsedDroneSections).toEqual({ 'chats:b-1': true });
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('uses repo-scoped UI defaults when creating a draft drone', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-draft-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const repoPath = process.cwd();
      const requests: Array<{ pathname: string; method: string; body?: any }> = [];
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        const body = method === 'POST' && typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, method, ...(body === undefined ? {} : { body }) });
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({
            ok: true,
            updatedAt: '2026-08-07T10:00:00.000Z',
            uiPreferences: {
              spawnContextByRepoKey: {
                [repoPath]: {
                  spawnAgentKey: 'builtin:codex',
                  spawnModel: 'gpt-5.6-codex',
                  spawnReasoning: 'high',
                  spawnAgentPermissionMode: 'execute',
                  spawnApprovalPolicy: 'auto',
                  repoBranchSource: 'host',
                  repoCreateRemoteBranch: '',
                },
              },
            },
          });
        }
        if (url.pathname === '/api/repos' && method === 'GET') {
          return Response.json({
            ok: true,
            repos: [{ path: repoPath, label: 'drone' }],
          });
        }
        if (url.pathname === '/api/drones' && method === 'POST') {
          return Response.json({ ok: true, id: 'draft-1', name: 'New draft', runtime: 'container', phase: 'draft', draft: true }, { status: 201 });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'assistant-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'thread-draft',
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
        });
        const result = await client.callTool({
          name: 'create_drone',
          arguments: {
            name: 'New draft',
            draft: true,
            repoPath,
            agentsMd: '# Draft-specific instructions',
          },
        });
        expect(result.structuredContent).toMatchObject({
          ok: true,
          phase: 'draft',
          drone: { id: 'draft-1', name: 'New draft', status: 'draft' },
          raw: { draft: true, phase: 'draft' },
        });
        expect(requests.map((request) => `${request.method} ${request.pathname}`)).toEqual([
          'GET /api/repos',
          'GET /api/settings/ui-preferences',
          'POST /api/drones',
        ]);
        expect(requests[2]?.body).toMatchObject({
          name: 'New draft',
          runtime: 'container',
          draft: true,
          repoPath,
          agentsMd: '# Draft-specific instructions',
          seedAgent: { kind: 'builtin', id: 'codex' },
          seedModel: 'gpt-5.6-codex',
          seedReasoning: 'high',
          seedApprovalPolicy: 'none',
        });
        const rejected = await client.callTool({
          name: 'create_drone',
          arguments: {
            name: 'Invalid Cursor draft',
            draft: true,
            repoPath,
            agent: 'cursor',
            approvalPolicy: 'none',
          },
        });
        expect(rejected.isError).toBe(true);
        expect(JSON.stringify(rejected.content)).toContain(
          'approvalPolicy is only available for Codex drones',
        );
        const rejectedPermissionMode = await client.callTool({
          name: 'create_drone',
          arguments: {
            name: 'Invalid Cursor access draft',
            draft: true,
            repoPath,
            agent: 'cursor',
            agentPermissionMode: 'read',
          },
        });
        expect(rejectedPermissionMode.isError).toBe(true);
        expect(JSON.stringify(rejectedPermissionMode.content)).toContain(
          'agentPermissionMode is only available for Codex and Blip drones',
        );
        const acceptedExecuteMode = await client.callTool({
          name: 'create_drone',
          arguments: {
            name: 'Cursor execute draft',
            draft: true,
            repoPath,
            agent: 'cursor',
            agentPermissionMode: 'execute',
          },
        });
        expect(acceptedExecuteMode.isError).not.toBe(true);
        const createRequests = requests.filter(
          (request) => request.pathname === '/api/drones' && request.method === 'POST',
        );
        expect(createRequests[1]?.body).toMatchObject({
          name: 'Cursor execute draft',
          seedAgent: { kind: 'builtin', id: 'cursor' },
        });
        expect(createRequests[1]?.body.seedAgentPermissionMode).toBeUndefined();
        expect(
          createRequests,
        ).toHaveLength(2);
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('does not report a seeded drone ready before its initial message is durable', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-seed-ready-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      let summaryReads = 0;
      let stateReads = 0;
      globalThis.fetch = (async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input : input.url,
        );
        const method = String(init?.method ?? 'GET').toUpperCase();
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({ ok: false, error: 'not found' }, { status: 404 });
        }
        if (url.pathname === '/api/drones' && method === 'POST') {
          return Response.json(
            {
              ok: true,
              id: 'seeded-1',
              name: 'Seeded child',
              runtime: 'container',
              phase: 'starting',
              initialMessage: {
                chat: 'default',
                promptId: 'initial-1',
                pendingState: 'queued',
              },
            },
            { status: 202 },
          );
        }
        if (url.pathname === '/api/drones/summary') {
          summaryReads += 1;
          return Response.json({
            ok: true,
            drones: [
              {
                id: 'seeded-1',
                name: 'Seeded child',
                runtime: 'container',
                ...(summaryReads === 1 ? { hubPhase: 'seeding' } : {}),
                status: 'ready',
              },
            ],
          });
        }
        if (url.pathname === '/api/drones/seeded-1/chats/default/state') {
          stateReads += 1;
          return Response.json({
            ok: true,
            pending:
              stateReads === 1
                ? []
                : [
                    {
                      id: 'initial-1',
                      at: '2026-07-29T17:25:33.880Z',
                      prompt: 'Initial task',
                      state: 'queued',
                    },
                  ],
            transcripts: [],
          });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'assistant-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'thread-seed-ready',
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
        });
        const result = await client.callTool({
          name: 'create_drone',
          arguments: {
            name: 'Seeded child',
            initialMessage: 'Initial task',
          },
        });

        expect(result.structuredContent).toMatchObject({
          ok: true,
          phase: 'ready',
          drone: { id: 'seeded-1', name: 'Seeded child', status: 'ready' },
        });
        expect(summaryReads).toBe(3);
        expect(stateReads).toBe(2);
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('uses only explicit managed-chat parents and immediately grants all selected access kinds', async () => {
    await withTempDroneDataDir('drone-managed-chat-child-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const requests: Array<{ pathname: string; method: string; body?: any }> = [];
      let childCreated = false;
      let cloneCreated = false;
      let managedAccessScope = {
        readMode: 'selected',
        writeMode: 'selected',
        executeMode: 'selected',
        droneIds: ['owner'],
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        const body = method !== 'GET' && typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, method, ...(body === undefined ? {} : { body }) });
        if (url.pathname === '/api/drones/summary') {
          return Response.json({
            ok: true,
            drones: [
              { id: 'owner', name: 'Owner', runtime: 'container' },
              ...(childCreated ? [{ id: 'child-1', name: 'Child', runtime: 'container' }] : []),
              ...(cloneCreated ? [{ id: 'clone-1', name: 'Clone', runtime: 'container' }] : []),
            ],
          });
        }
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({ ok: false, error: 'not found' }, { status: 404 });
        }
        if (url.pathname === '/api/drones' && method === 'POST') {
          if (body.cloneFrom) {
            cloneCreated = true;
            return Response.json({ ok: true, id: 'clone-1', name: 'Clone', runtime: 'container', phase: 'starting' }, { status: 202 });
          }
          childCreated = true;
          return Response.json({ ok: true, id: 'child-1', name: 'Child', runtime: 'container', phase: 'draft', draft: true }, { status: 201 });
        }
        if (url.pathname === '/api/drones/owner/chats/default/mcp-access' && method === 'PUT') {
          managedAccessScope = {
            ...managedAccessScope,
            droneIds: [...new Set([...managedAccessScope.droneIds, ...(body.addDroneIds ?? [])])],
            updatedAt: '2026-01-02T00:00:00.000Z',
          };
          return Response.json({ ok: true, available: true, accessScope: managedAccessScope });
        }
        if (url.pathname === '/api/drones/child-1/chats' && method === 'GET') {
          return Response.json({ ok: true, chats: ['default'] });
        }
        if (url.pathname === '/api/drones/child-1/chats' && method === 'POST') {
          return Response.json({ ok: true, chat: body.name }, { status: 201 });
        }
        if (url.pathname === '/api/drones/child-1/chats/default/prompt' && method === 'POST') {
          return Response.json({ ok: true, id: 'child-1', promptId: 'prompt-1', pendingState: 'queued' });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'managed-chat-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'managed-chat-child',
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
          principal: {
            kind: 'chat',
            tokenId: 'chat:owner:default',
            name: 'Owner / default',
            droneId: 'owner',
            chatName: 'default',
            chatId: 'owner-default',
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['owner'],
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            selectedDroneRefs: ['owner', 'Owner'],
          },
        });
        const created = await client.callTool({
          name: 'create_drone',
          arguments: { name: 'Child', parent: 'owner', draft: true },
        });
        expect(created.structuredContent).toMatchObject({
          ok: true,
          phase: 'draft',
          drone: { id: 'child-1', name: 'Child' },
          accessScope: {
            readMode: 'selected',
            writeMode: 'selected',
            executeMode: 'selected',
            droneIds: ['owner', 'child-1'],
          },
        });
        const createRequest = requests.find(
          (request) => request.pathname === '/api/drones' && request.method === 'POST',
        );
        expect(createRequest?.body).toMatchObject({
          name: 'Child',
          runtime: 'container',
          fleetParentId: 'owner',
        });
        const scopeRequest = requests.find(
          (request) =>
            request.pathname === '/api/drones/owner/chats/default/mcp-access' &&
            request.method === 'PUT',
        );
        expect(scopeRequest?.body).toEqual({ addDroneIds: ['child-1'] });

        const cloned = await client.callTool({
          name: 'clone_drone',
          arguments: { source: 'owner', name: 'Clone', completion: 'accepted' },
        });
        expect(cloned.structuredContent).toMatchObject({
          ok: true,
          phase: 'accepted',
          drone: { id: 'clone-1', name: 'Clone' },
          accessScope: {
            readMode: 'selected',
            writeMode: 'selected',
            executeMode: 'selected',
            droneIds: ['owner', 'child-1', 'clone-1'],
          },
        });
        const cloneRequest = requests.find(
          (request) =>
            request.pathname === '/api/drones' &&
            request.method === 'POST' &&
            request.body?.cloneFrom,
        );
        expect(cloneRequest?.body).toMatchObject({
          name: 'Clone',
          runtime: 'container',
          cloneFrom: 'owner',
        });
        expect(cloneRequest?.body.fleetParentId).toBeUndefined();

        const read = await client.callTool({
          name: 'list_chats',
          arguments: { drone: 'child-1' },
        });
        const write = await client.callTool({
          name: 'create_chat',
          arguments: { drone: 'child-1', chat: 'review' },
        });
        const execute = await client.callTool({
          name: 'send_message',
          arguments: { drone: 'child-1', chat: 'default', message: 'Continue' },
        });
        expect(read.isError).not.toBe(true);
        expect(write.isError).not.toBe(true);
        expect(execute.isError).not.toBe(true);
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('preserves every selected-scope grant across parallel drone creation', async () => {
    await withTempDroneDataDir('drone-managed-chat-parallel-children-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const childIds = ['child-1', 'child-2', 'child-3', 'child-4'];
      const createdIds = new Set<string>();
      let storedDroneIds = ['owner'];
      let releaseFirstGrant!: () => void;
      const firstGrantMerged = new Promise<void>((resolve) => {
        releaseFirstGrant = resolve;
      });
      globalThis.fetch = (async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input : input.url,
        );
        const method = String(init?.method ?? 'GET').toUpperCase();
        const body =
          method !== 'GET' && typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        if (url.pathname === '/api/drones/summary') {
          return Response.json({
            ok: true,
            drones: [
              { id: 'owner', name: 'Owner', runtime: 'container' },
              ...[...createdIds].map((id) => ({
                id,
                name: id,
                runtime: 'container',
              })),
            ],
          });
        }
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({ ok: false, error: 'not found' }, { status: 404 });
        }
        if (url.pathname === '/api/drones' && method === 'POST') {
          const id = `child-${Number(String(body.name).split(' ').at(-1))}`;
          createdIds.add(id);
          return Response.json(
            { ok: true, id, name: body.name, runtime: 'container', draft: true },
            { status: 201 },
          );
        }
        if (url.pathname === '/api/drones/owner/chats/default/mcp-access' && method === 'PUT') {
          const addedId = String(body?.addDroneIds?.[0] ?? '');
          if (addedId === 'child-1') {
            storedDroneIds = [...new Set([...storedDroneIds, addedId])];
            const responseDroneIds = [...storedDroneIds];
            releaseFirstGrant();
            await new Promise((resolve) => setTimeout(resolve, 40));
            return Response.json({
              ok: true,
              accessScope: {
                readMode: 'all',
                writeMode: 'all',
                executeMode: 'all',
                droneIds: responseDroneIds,
                updatedAt: '2026-01-02T00:00:00.000Z',
              },
            });
          }
          await firstGrantMerged;
          storedDroneIds = [...new Set([...storedDroneIds, addedId])];
          return Response.json({
            ok: true,
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: [...storedDroneIds],
              updatedAt: '2026-01-03T00:00:00.000Z',
            },
          });
        }
        const promptMatch = url.pathname.match(
          /^\/api\/drones\/(child-[1-4])\/chats\/default\/prompt$/,
        );
        if (promptMatch && method === 'POST') {
          return Response.json({
            ok: true,
            id: promptMatch[1],
            promptId: `prompt-${promptMatch[1]}`,
            pendingState: 'queued',
          });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'managed-chat-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'managed-chat-parallel-children',
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
          principal: {
            kind: 'chat',
            tokenId: 'chat:owner:default',
            name: 'Owner / default',
            droneId: 'owner',
            chatName: 'default',
            chatId: 'owner-default',
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['owner'],
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            selectedDroneRefs: ['owner', 'Owner'],
          },
        });

        const creations = await Promise.all(
          childIds.map((_, index) =>
            client!.callTool({
              name: 'create_drone',
              arguments: { name: `Child ${index + 1}`, draft: true },
            }),
          ),
        );
        expect(creations.every((result) => result.isError !== true)).toBe(true);
        expect(storedDroneIds).toEqual(['owner', ...childIds]);

        const followUps = await Promise.all(
          childIds.map((drone) =>
            client!.callTool({
              name: 'send_message',
              arguments: { drone, chat: 'default', message: 'Continue' },
            }),
          ),
        );
        expect(followUps.every((result) => result.isError !== true)).toBe(true);
        const unauthorized = await client.callTool({
          name: 'send_message',
          arguments: { drone: 'not-selected', chat: 'default', message: 'Do not send' },
        });
        expect(unauthorized.isError).toBe(true);
        expect(JSON.stringify(unauthorized.content)).toContain(
          'execute scope does not include the requested drone',
        );
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('persists child access through the native assistant thread scope', async () => {
    await withTempDroneDataDir('drone-native-chat-child-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const requests: Array<{ pathname: string; method: string; body?: any }> = [];
      let nativeDroneIds = ['owner'];
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        const body = method !== 'GET' && typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, method, ...(body === undefined ? {} : { body }) });
        if (url.pathname === '/api/drones/summary') {
          return Response.json({
            ok: true,
            drones: [{ id: 'owner', name: 'Owner', runtime: 'container' }],
          });
        }
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({ ok: false, error: 'not found' }, { status: 404 });
        }
        if (url.pathname === '/api/drones' && method === 'POST') {
          return Response.json(
            { ok: true, id: 'native-child', name: 'Native child', runtime: 'container', draft: true },
            { status: 201 },
          );
        }
        if (url.pathname === '/api/assistant/scope' && method === 'POST') {
          nativeDroneIds = [...new Set([...nativeDroneIds, ...(body.addDroneIds ?? [])])];
          return Response.json({
            ok: true,
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: nativeDroneIds,
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'native-chat-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'native-thread',
          nativeThreadId: 'native-thread',
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
          principal: {
            kind: 'chat',
            tokenId: 'assistant:native-thread',
            name: 'Built-in chat',
            droneId: 'owner',
            chatName: 'default',
            chatId: 'native-thread',
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['owner'],
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            selectedDroneRefs: ['owner', 'Owner'],
          },
        });
        const result = await client.callTool({
          name: 'create_drone',
          arguments: { name: 'Native child', draft: true },
        });
        expect(result.structuredContent).toMatchObject({
          ok: true,
          accessScope: { droneIds: ['owner', 'native-child'] },
        });
        expect(
          requests.find(
            (request) => request.pathname === '/api/drones' && request.method === 'POST',
          )?.body,
        ).not.toHaveProperty('fleetParentId');
        expect(
          requests.find(
            (request) =>
              request.pathname === '/api/assistant/scope' && request.method === 'POST',
          )?.body,
        ).toMatchObject({
          threadId: 'native-thread',
          addDroneIds: ['native-child'],
        });
        expect(
          requests.some((request) => request.pathname.endsWith('/mcp-access')),
        ).toBe(false);
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('does not report a created drone as failed when its automatic access grant cannot be confirmed', async () => {
    await withTempDroneDataDir('drone-managed-chat-grant-failure-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const requests: Array<{ pathname: string; method: string }> = [];
      let accessGrantAttempts = 0;
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        requests.push({ pathname: url.pathname, method });
        if (url.pathname === '/api/drones/summary') {
          return Response.json({
            ok: true,
            drones: [{ id: 'owner', name: 'Owner', runtime: 'container' }],
          });
        }
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({ ok: false, error: 'not found' }, { status: 404 });
        }
        if (url.pathname === '/api/drones' && method === 'POST') {
          return Response.json(
            { ok: true, id: 'created-once', name: 'Created once', runtime: 'container', draft: true },
            { status: 201 },
          );
        }
        if (url.pathname === '/api/drones/owner/chats/default/mcp-access') {
          accessGrantAttempts += 1;
          if (accessGrantAttempts === 1) {
            return Response.json({ ok: false, error: 'scope store unavailable' }, { status: 503 });
          }
          return Response.json({
            ok: true,
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['owner'],
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'managed-chat-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'managed-chat-grant-failure',
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
          principal: {
            kind: 'chat',
            tokenId: 'chat:owner:default',
            name: 'Owner / default',
            droneId: 'owner',
            chatName: 'default',
            chatId: 'owner-default',
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['owner'],
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            selectedDroneRefs: ['owner', 'Owner'],
          },
        });
        const result = await client.callTool({
          name: 'create_drone',
          arguments: { name: 'Created once', draft: true },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          ok: true,
          drone: { id: 'created-once' },
        });
        expect(String((result.structuredContent as any)?.accessGrantError)).toContain(
          'did not persist created drone created-once',
        );
        expect(
          requests.filter(
            (request) => request.pathname === '/api/drones' && request.method === 'POST',
          ),
        ).toHaveLength(1);
        expect(
          requests.filter((request) => request.pathname.endsWith('/mcp-access')),
        ).toHaveLength(2);
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });

  test('allows host-owned managed chats to create independent drones but not host chats', async () => {
    await withTempDroneDataDir('drone-managed-host-chat-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      let createBody: any = null;
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        if (url.pathname === '/api/drones/summary') {
          return Response.json({
            ok: true,
            drones: [{ id: 'host-owner', name: 'Host owner', runtime: 'host' }],
          });
        }
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({ ok: false, error: 'not found' }, { status: 404 });
        }
        if (url.pathname === '/api/drones' && method === 'POST') {
          createBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          return Response.json(
            { ok: true, id: 'independent', name: 'Independent', runtime: 'container', draft: true },
            { status: 201 },
          );
        }
        if (
          url.pathname === '/api/drones/host-owner/chats/default/mcp-access' &&
          method === 'PUT'
        ) {
          return Response.json({
            ok: true,
            available: true,
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['host-owner', 'independent'],
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          });
        }
        return Response.json({ ok: false, error: 'unexpected request' }, { status: 500 });
      }) as typeof fetch;
      process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
      process.env.DRONE_TOKEN = 'managed-host-chat-test-token';
      let client: Awaited<ReturnType<typeof createInProcessDroneHubMcpClient>> | null = null;
      try {
        client = await createInProcessDroneHubMcpClient({
          correlationId: 'managed-host-chat',
          allowedDroneRefs: [],
          allowedWriteDroneRefs: [],
          allowedDroneIds: [],
          principal: {
            kind: 'chat',
            tokenId: 'chat:host-owner:default',
            name: 'Host owner / default',
            droneId: 'host-owner',
            chatName: 'default',
            chatId: 'host-owner-default',
            accessScope: {
              readMode: 'selected',
              writeMode: 'selected',
              executeMode: 'selected',
              droneIds: ['host-owner'],
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            selectedDroneRefs: ['host-owner', 'Host owner'],
          },
        });
        const createResult = await client.callTool({
          name: 'create_drone',
          arguments: { name: 'Independent', draft: true },
        });
        expect(createResult.isError).not.toBe(true);
        expect(createBody).toMatchObject({ name: 'Independent', runtime: 'container' });
        expect(createBody).not.toHaveProperty('fleetParentId');

        const chatResult = await client.callTool({
          name: 'create_chat',
          arguments: { drone: 'host-owner', chat: 'blocked' },
        });
        expect(chatResult.isError).toBe(true);
        expect(JSON.stringify(chatResult.content)).toContain(
          'cannot create chats on host-runtime drone Host owner',
        );
      } finally {
        await client?.close();
        globalThis.fetch = previousFetch;
        if (previousBaseUrl == null) delete process.env.DRONE_HUB_BASE_URL;
        else process.env.DRONE_HUB_BASE_URL = previousBaseUrl;
        if (previousToken == null) delete process.env.DRONE_TOKEN;
        else process.env.DRONE_TOKEN = previousToken;
      }
    });
  });
});
