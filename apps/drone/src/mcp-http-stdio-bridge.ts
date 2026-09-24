#!/usr/bin/env node
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const MCP_URL_ENV = 'DRONE_HUB_MCP_URL';
const MCP_TOKEN_ENV = 'DRONE_HUB_MCP_TOKEN';

type ManagedMcpConnection = {
  url: URL;
  token: string;
};

export function mcpBridgeCallOptions(_name: string, signal?: AbortSignal): RequestOptions {
  // Question tools return subscriptions and use the same timeout as other tools.
  return { signal };
}

export function managedMcpConnectionFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ManagedMcpConnection | null {
  const urlRaw = String(env[MCP_URL_ENV] ?? '').trim();
  const token = String(env[MCP_TOKEN_ENV] ?? '').trim();
  if (!urlRaw && !token) return null;
  if (!urlRaw || !token) {
    throw new Error(
      `${MCP_URL_ENV} and ${MCP_TOKEN_ENV} must be provided together for Drone Hub managed chats`,
    );
  }
  return { url: new URL(urlRaw), token };
}

export async function startMcpHttpStdioBridge(options?: {
  env?: NodeJS.ProcessEnv;
  localTransport?: Transport;
}): Promise<{
  mode: 'managed' | 'inactive';
  close: () => Promise<void>;
}> {
  const connection = managedMcpConnectionFromEnvironment(options?.env);
  const diagnostics = (options?.env ?? process.env).DRONE_MCP_DIAGNOSTICS === '1';
  const timing = (phase: string, startedAt: number, details: Record<string, unknown> = {}) => {
    if (!diagnostics) return;
    console.error('[DroneMcpTiming]', JSON.stringify({
      at: new Date().toISOString(), pid: process.pid, phase,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10, ...details,
    }));
  };
  const remote = connection
    ? new Client({ name: 'Drone Hub managed chat bridge', version: '0.1.0' })
    : null;
  if (remote && connection) {
    const startedAt = performance.now();
    await remote.connect(
      new StreamableHTTPClientTransport(connection.url, {
        requestInit: { headers: {
          Authorization: `Bearer ${connection.token}`,
          ...(diagnostics ? { 'x-drone-mcp-diagnostics': '1' } : {}),
        } },
        ...(diagnostics ? { fetch: async (url: string | URL | Request, init?: RequestInit) => {
          const startedAt = performance.now();
          try {
            const response = await fetch(url, init);
            timing('http-headers', startedAt, {
              method: init?.method ?? 'GET', status: response.status,
              serverTiming: response.headers.get('server-timing'),
            });
            return response;
          } catch (error) {
            timing('http-headers', startedAt, { outcome: 'failed' });
            throw error;
          }
        } } : {}),
      }),
    );
    timing('remote-initialize', startedAt);
  }

  const local = new Server(
    { name: 'Drone Hub managed chat bridge', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  local.setRequestHandler(ListToolsRequestSchema, async () => {
    const startedAt = performance.now();
    try {
      const result = remote ? await remote.listTools() : { tools: [] };
      timing('tools-list', startedAt, { toolCount: result.tools.length });
      return result;
    } catch (error) {
      timing('tools-list', startedAt, { outcome: 'failed' });
      throw error;
    }
  });
  if (remote) {
    local.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra) =>
        await remote.callTool(
          request.params,
          undefined,
          mcpBridgeCallOptions(request.params.name, extra.signal),
        ),
    );
  }
  try {
    await local.connect(options?.localTransport ?? new StdioServerTransport());
  } catch (error) {
    await Promise.resolve(remote?.close()).catch(() => undefined);
    throw error;
  }

  return {
    mode: remote ? 'managed' : 'inactive',
    async close() {
      await Promise.all([
        Promise.resolve(local.close()).catch(() => undefined),
        Promise.resolve(remote?.close()).catch(() => undefined),
      ]);
    },
  };
}

if (require.main === module) {
  startMcpHttpStdioBridge().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
