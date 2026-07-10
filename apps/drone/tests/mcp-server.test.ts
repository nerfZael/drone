import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { McpIdleSubscriptionStore } from '../src/hub/assistant/mcp-idle-subscription-store';
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
      const client = await createInProcessDroneHubMcpClient('thread-one');
      const catalog = await client.listTools();
      expect(catalog.tools.map((tool) => tool.name)).toContain('send_message');
      expect(catalog.tools.map((tool) => tool.name)).toContain('list_chat_idle_subscriptions');
      await client.close();
    });
  });
});
