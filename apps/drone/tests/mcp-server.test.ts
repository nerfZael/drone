import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { McpIdleSubscriptionStore } from '../src/hub/assistant/mcp-idle-subscription-store';
import { ASSISTANT_TOOL_SUMMARIES } from '../src/hub/assistant/assistant-config';
import { createInProcessDroneHubMcpClient } from '../src/hub/assistant/in-process-drone-hub-mcp';
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
  });

  test('rejects cross-drone and host-wide operations', () => {
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'send_message', { drone: 'drone-b' })).toThrow('scoped to drone drone-a');
    expect(() => authorizeDroneHubMcpTool(dronePrincipal, 'create_drone', {})).toThrow('not authorized');
  });

  test('allows host principals to use all domain tools', () => {
    const host = { principal: { kind: 'host' as const, tokenId: 'host', name: 'Host token' } };
    expect(() => authorizeDroneHubMcpTool(host, 'create_drone', {})).not.toThrow();
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
});
