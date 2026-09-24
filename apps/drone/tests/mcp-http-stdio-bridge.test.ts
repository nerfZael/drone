import { describe, expect, spyOn, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import {
  managedMcpConnectionFromEnvironment,
  mcpBridgeCallOptions,
  startMcpHttpStdioBridge,
} from '../src/mcp-http-stdio-bridge';

class MemoryTransport implements Transport {
  peer: MemoryTransport | null = null;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    queueMicrotask(() => this.peer?.onmessage?.(message));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

function memoryTransportPair(): [MemoryTransport, MemoryTransport] {
  const client = new MemoryTransport();
  const server = new MemoryTransport();
  client.peer = server;
  server.peer = client;
  return [client, server];
}

describe('managed chat MCP bridge', () => {
  test('opted-in diagnostics separate HTTP and tool-list timing without credentials', async () => {
    const lines: string[] = [];
    const log = spyOn(console, 'error').mockImplementation((...args) => { lines.push(args.join(' ')); });
    const requests: RequestInit[] = [];
    const request = spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      requests.push(init ?? {});
      if (init?.method !== 'POST') return new Response(null, { status: 405 });
      const body = JSON.parse(String(init.body));
      if (body.id == null) return new Response(null, { status: 202 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result:
        body.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }
          : { tools: [] },
      }), { headers: { 'content-type': 'application/json', 'server-timing': 'auth;dur=15.0' } });
    });
    const client = new Client({ name: 'bridge-test', version: '1' });
    const [clientTransport, serverTransport] = memoryTransportPair();
    let bridge: Awaited<ReturnType<typeof startMcpHttpStdioBridge>> | undefined;
    try {
      bridge = await startMcpHttpStdioBridge({
        env: { DRONE_MCP_DIAGNOSTICS: '1', DRONE_HUB_MCP_URL: 'http://private-host/mcp', DRONE_HUB_MCP_TOKEN: 'private-token' },
        localTransport: serverTransport,
      });
      await client.connect(clientTransport);
      await client.listTools();
      expect(requests.some((init) => new Headers(init.headers).get('x-drone-mcp-diagnostics') === '1')).toBe(true);
      const timings = lines.map((line) => JSON.parse(line.slice('[DroneMcpTiming] '.length)));
      expect(timings.find((entry) => entry.phase === 'tools-list').durationMs).toBeGreaterThanOrEqual(15);
      expect(timings.some((entry) => entry.phase === 'remote-initialize')).toBe(true);
      expect(timings.some((entry) => entry.serverTiming === 'auth;dur=15.0')).toBe(true);
      expect(lines.join('')).not.toContain('private-token');
      expect(lines.join('')).not.toContain('private-host');
    } finally {
      await client.close();
      await bridge?.close();
      request.mockRestore();
      log.mockRestore();
    }
  });

  test('uses the normal MCP timeout for asynchronous questions', () => {
    const controller = new AbortController();
    expect(mcpBridgeCallOptions('ask_questions', controller.signal)).toEqual({
      signal: controller.signal,
    });
    expect(mcpBridgeCallOptions('list_drones', controller.signal)).toEqual({
      signal: controller.signal,
    });
  });

  test('treats a complete managed-chat environment as an authenticated connection', () => {
    const connection = managedMcpConnectionFromEnvironment({
      DRONE_HUB_MCP_URL: 'http://127.0.0.1:8787/mcp',
      DRONE_HUB_MCP_TOKEN: 'test-token',
    });

    expect(connection?.url.href).toBe('http://127.0.0.1:8787/mcp');
    expect(connection?.token).toBe('test-token');
  });

  test('rejects partial managed credentials instead of silently dropping access', () => {
    expect(() =>
      managedMcpConnectionFromEnvironment({
        DRONE_HUB_MCP_URL: 'http://127.0.0.1:8787/mcp',
      }),
    ).toThrow('DRONE_HUB_MCP_URL and DRONE_HUB_MCP_TOKEN must be provided together');
  });

  test('initializes with an empty tool catalog outside managed chats', async () => {
    const client = new Client({ name: 'bridge-test', version: '0.1.0' });
    const [clientTransport, serverTransport] = memoryTransportPair();
    const bridgePromise = startMcpHttpStdioBridge({
      env: {},
      localTransport: serverTransport,
    });

    const bridge = await bridgePromise;
    try {
      await client.connect(clientTransport);
      expect(bridge.mode).toBe('inactive');
      expect(await client.listTools()).toEqual({ tools: [] });
    } finally {
      await client.close();
      await bridge.close();
    }
  });
});
