import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { McpIdleSubscriptionStore } from '../src/hub/assistant/mcp-idle-subscription-store';
import { ASSISTANT_TOOL_SUMMARIES } from '../src/hub/assistant/assistant-config';
import { createInProcessDroneHubMcpClient } from '../src/hub/assistant/in-process-drone-hub-mcp';
import { normalizeMcpChatAccessScope } from '../src/hub/mcp-chat-access';
import { authorizeDroneHubMcpTool, imageToolResult } from '../src/hub/mcp-server';
import { droneStatusSummary } from '../src/hub/mcp-summaries';
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
    const cloneScoped = {
      principal: {
        ...chatPrincipal,
        accessScope: { ...chatPrincipal.accessScope, readMode: 'selected' as const },
      },
    };
    expect(() => authorizeDroneHubMcpTool(cloneScoped, 'clone_drone', { source: 'drone-b', name: 'Child' })).toThrow('read scope');
    expect(() => authorizeDroneHubMcpTool(cloneScoped, 'clone_drone', { source: 'drone-a', name: 'Child' })).not.toThrow();
  });

  test('uses native defaults and includes the owner whenever a scope is selected', () => {
    expect(normalizeMcpChatAccessScope({}, 'drone-a')).toMatchObject({
      readMode: 'all',
      writeMode: 'selected',
      executeMode: 'selected',
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

describe('Drone Hub MCP idle subscription persistence', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('persists subscriptions in SQLite across store instances', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-mcp-idle-'));
    tempDirs.push(dir);
    const databasePath = path.join(dir, 'assistant.sqlite');
    const first = new McpIdleSubscriptionStore(databasePath);
    first.save({
      id: 'idle-1',
      status: 'active',
      expiresAtMs: 1234,
      subscription: { mode: 'any', targets: [{ drone: 'drone-a', chat: 'default' }] },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    first.close();

    const second = new McpIdleSubscriptionStore(databasePath);
    expect(second.list()).toEqual([{
      id: 'idle-1',
      status: 'active',
      expiresAtMs: 1234,
      subscription: { mode: 'any', targets: [{ drone: 'drone-a', chat: 'default' }] },
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
    second.close();
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

  test('returns draft drone creation immediately without polling for readiness', async () => {
    await withTempDroneDataDir('drone-assistant-mcp-draft-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const requests: Array<{ pathname: string; method: string; body?: any }> = [];
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        const body = method === 'POST' && typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, method, ...(body === undefined ? {} : { body }) });
        if (url.pathname === '/api/settings/ui-preferences') {
          return Response.json({ ok: false, error: 'not found' }, { status: 404 });
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
        const result = await client.callTool({ name: 'create_drone', arguments: { name: 'New draft', draft: true } });
        expect(result.structuredContent).toMatchObject({
          ok: true,
          phase: 'draft',
          drone: { id: 'draft-1', name: 'New draft', status: 'draft' },
          raw: { draft: true, phase: 'draft' },
        });
        expect(requests.map((request) => `${request.method} ${request.pathname}`)).toEqual([
          'GET /api/settings/ui-preferences',
          'POST /api/drones',
        ]);
        expect(requests[1]?.body).toMatchObject({ name: 'New draft', runtime: 'container', draft: true });
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

  test('parents managed-chat creations and immediately grants all selected access kinds', async () => {
    await withTempDroneDataDir('drone-managed-chat-child-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const requests: Array<{ pathname: string; method: string; body?: any }> = [];
      let childCreated = false;
      let cloneCreated = false;
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
          return Response.json({ ok: true, available: true, accessScope: body.accessScope });
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
          arguments: { name: 'Child', draft: true },
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
        expect(scopeRequest?.body?.accessScope?.droneIds).toEqual(['owner', 'child-1']);

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
          fleetParentId: 'owner',
        });

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

  test('persists child access through the native assistant thread scope', async () => {
    await withTempDroneDataDir('drone-native-chat-child-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const requests: Array<{ pathname: string; method: string; body?: any }> = [];
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
          return Response.json({
            ok: true,
            accessScope: {
              readMode: body.readMode,
              writeMode: body.writeMode,
              executeMode: body.executeMode,
              droneIds: body.droneIds,
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
        ).toMatchObject({ fleetParentId: 'owner' });
        expect(
          requests.find(
            (request) =>
              request.pathname === '/api/assistant/scope' && request.method === 'POST',
          )?.body,
        ).toMatchObject({
          threadId: 'native-thread',
          readMode: 'selected',
          writeMode: 'selected',
          executeMode: 'selected',
          droneIds: ['owner', 'native-child'],
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

  test('does not report a created drone as failed when its automatic access grant fails', async () => {
    await withTempDroneDataDir('drone-managed-chat-grant-failure-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      const requests: Array<{ pathname: string; method: string }> = [];
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
          return Response.json({ ok: false, error: 'scope store unavailable' }, { status: 503 });
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
          'scope store unavailable',
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

  test('prevents managed chats on host-runtime drones from creating children or chats', async () => {
    await withTempDroneDataDir('drone-managed-host-chat-', async () => {
      const previousBaseUrl = process.env.DRONE_HUB_BASE_URL;
      const previousToken = process.env.DRONE_TOKEN;
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
        if (url.pathname === '/api/drones/summary') {
          return Response.json({
            ok: true,
            drones: [{ id: 'host-owner', name: 'Host owner', runtime: 'host' }],
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
        const childResult = await client.callTool({
          name: 'create_drone',
          arguments: { name: 'Blocked child', draft: true },
        });
        expect(childResult.isError).toBe(true);
        expect(JSON.stringify(childResult.content)).toContain(
          'cannot create child drones on host-runtime drone Host owner',
        );

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
