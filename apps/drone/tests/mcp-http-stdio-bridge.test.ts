import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import {
  managedMcpConnectionFromEnvironment,
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
