import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { McpServerRecord } from './mcp-servers';

const MCP_TOOL_DISCOVERY_TIMEOUT_MS = 10_000;
const MCP_TOOL_DISCOVERY_MAX_PAGES = 100;

export type McpServerToolSummary = {
  name: string;
  title?: string;
  description?: string;
};

type ToolListingClient = Pick<Client, 'listTools'>;
type ToolDiscoveryRequestOptions = {
  timeout: number;
  maxTotalTimeout: number;
};

function envPlaceholderName(value: string): string | null {
  const match = String(value ?? '')
    .trim()
    .match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return match?.[1] ?? null;
}

function resolveConfiguredValue(value: string, serverName: string): string {
  const envName = envPlaceholderName(value);
  if (!envName) return value;
  const resolved = process.env[envName];
  if (resolved == null) {
    throw new Error(
      `MCP server ${serverName} requires environment variable ${envName} for tool discovery`,
    );
  }
  return resolved;
}

function resolveConfiguredMap(
  values: Record<string, string> | undefined,
  serverName: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      resolveConfiguredValue(value, serverName),
    ]),
  );
}

function transportForServer(server: McpServerRecord): Transport {
  if (server.transport === 'http') {
    if (!server.url) throw new Error(`MCP server ${server.name} has no HTTP URL`);
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: resolveConfiguredMap(server.headers, server.name),
      },
    });
  }

  if (!server.command) throw new Error(`MCP server ${server.name} has no stdio command`);
  const env = {
    ...getDefaultEnvironment(),
    ...Object.fromEntries(
      (server.envPassthrough ?? []).flatMap((name) =>
        process.env[name] == null ? [] : [[name, process.env[name] as string]],
      ),
    ),
    ...resolveConfiguredMap(server.env, server.name),
  };
  return new StdioClientTransport({
    command: server.command,
    ...(server.args ? { args: server.args } : {}),
    env,
    stderr: 'ignore',
  });
}

export async function listMcpServerTools(server: McpServerRecord): Promise<McpServerToolSummary[]> {
  const transport = transportForServer(server);
  const client = new Client({ name: 'Drone Hub MCP tool inspector', version: '0.1.0' });
  const requestOptions = {
    timeout: MCP_TOOL_DISCOVERY_TIMEOUT_MS,
    maxTotalTimeout: MCP_TOOL_DISCOVERY_TIMEOUT_MS,
  };
  try {
    await client.connect(transport, requestOptions);
    return await listMcpServerToolsFromClient(client, server.name, requestOptions);
  } finally {
    await Promise.resolve(client.close()).catch(() => undefined);
    await Promise.resolve(transport.close()).catch(() => undefined);
  }
}

export async function listMcpServerToolsFromClient(
  client: ToolListingClient,
  serverName: string,
  requestOptions: ToolDiscoveryRequestOptions = {
    timeout: MCP_TOOL_DISCOVERY_TIMEOUT_MS,
    maxTotalTimeout: MCP_TOOL_DISCOVERY_TIMEOUT_MS,
  },
): Promise<McpServerToolSummary[]> {
  const tools = new Map<string, McpServerToolSummary>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MCP_TOOL_DISCOVERY_MAX_PAGES; page += 1) {
    const result = await client.listTools(cursor ? { cursor } : undefined, requestOptions);
    for (const tool of result.tools) {
      const name = String(tool.name ?? '').trim();
      if (!name || tools.has(name)) continue;
      const title = String(tool.title ?? '').trim();
      const description = String(tool.description ?? '').trim();
      tools.set(name, {
        name,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      });
    }

    const nextCursor = String(result.nextCursor ?? '').trim();
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`MCP server ${serverName} repeated a tools/list cursor`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
    if (page === MCP_TOOL_DISCOVERY_MAX_PAGES - 1) {
      throw new Error(`MCP server ${serverName} returned too many tools/list pages`);
    }
  }

  return [...tools.values()].sort((left, right) => left.name.localeCompare(right.name));
}
