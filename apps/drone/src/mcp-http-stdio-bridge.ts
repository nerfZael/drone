#!/usr/bin/env node
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const MCP_URL_ENV = 'DRONE_HUB_MCP_URL';
const MCP_TOKEN_ENV = 'DRONE_HUB_MCP_TOKEN';

function requiredEnvironment(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is available only in Drone Hub managed chats`);
  return value;
}

export async function startMcpHttpStdioBridge(): Promise<{
  close: () => Promise<void>;
}> {
  const url = new URL(requiredEnvironment(MCP_URL_ENV));
  const token = requiredEnvironment(MCP_TOKEN_ENV);
  const remote = new Client({ name: 'Drone Hub managed chat bridge', version: '0.1.0' });
  await remote.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );

  const local = new Server(
    { name: 'Drone Hub managed chat bridge', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  local.setRequestHandler(ListToolsRequestSchema, async () => await remote.listTools());
  local.setRequestHandler(
    CallToolRequestSchema,
    async (request) => await remote.callTool(request.params),
  );
  await local.connect(new StdioServerTransport());

  return {
    async close() {
      await Promise.all([
        Promise.resolve(local.close()).catch(() => undefined),
        Promise.resolve(remote.close()).catch(() => undefined),
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
