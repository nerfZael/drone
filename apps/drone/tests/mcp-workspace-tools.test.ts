import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { normalizeMcpChatAccessScope } from '../src/hub/mcp-chat-access';
import { createDroneHubMcpServer } from '../src/hub/mcp-server';
import { loadAgentChatWorkspaceToolDefinitions } from '../src/hub/mcp-workspace-tools';
import type { McpTokenIdentity } from '../src/hub/mcp-tokens';

const chatPrincipal: McpTokenIdentity = {
  kind: 'chat',
  tokenId: 'chat:drone-a:default',
  name: 'drone-a/default',
  droneId: 'drone-a',
  chatName: 'main chat',
  chatId: 'chat-1',
  accessScope: normalizeMcpChatAccessScope({}, 'drone-a'),
  selectedDroneRefs: [],
} as any;

async function connect(input: Parameters<typeof createDroneHubMcpServer>[0]) {
  const server = createDroneHubMcpServer(input);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function withHub<T>(
  respond: (path: string, body: any) => unknown,
  run: (requests: Array<{ path: string; body: any }>) => Promise<T>,
): Promise<T> {
  const previous = {
    fetch: globalThis.fetch,
    url: process.env.DRONE_HUB_BASE_URL,
    token: process.env.DRONE_TOKEN,
  };
  const requests: Array<{ path: string; body: any }> = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path: url.pathname, body });
    return Response.json(respond(url.pathname, body));
  }) as typeof fetch;
  process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
  process.env.DRONE_TOKEN = 'workspace-tools-test-token';
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url == null) delete process.env.DRONE_HUB_BASE_URL;
    else process.env.DRONE_HUB_BASE_URL = previous.url;
    if (previous.token == null) delete process.env.DRONE_TOKEN;
    else process.env.DRONE_TOKEN = previous.token;
  }
}

describe('DroneHub MCP workspace tools', () => {
  test('agent chats get the workspace tools with workspace parameters', async () => {
    const definitions = await loadAgentChatWorkspaceToolDefinitions();
    const client = await connect({ principal: chatPrincipal, workspaceToolDefinitions: definitions });
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of ['list_workspaces', 'read_file', 'write_file', 'apply_patch', 'bash', 'transfer_files'])
      expect(byName.has(name)).toBe(true);
    expect(byName.has('list_targets')).toBe(false);
    const read = byName.get('read_file')!.inputSchema as any;
    expect(read.properties.workspace).toBeDefined();
    expect(read.properties.target).toBeUndefined();
    expect(byName.get('read_file')!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('delete_file')!.annotations?.destructiveHint).toBe(true);
    const transfer = byName.get('transfer_files')!.inputSchema as any;
    expect(transfer.required).toEqual(
      expect.arrayContaining(['sourceWorkspace', 'destinationWorkspace', 'sourcePath', 'destinationPath']),
    );
    await client.close();
  });

  test('other principals and built-in chats do not get them', async () => {
    const definitions = await loadAgentChatWorkspaceToolDefinitions();
    for (const input of [
      { principal: { kind: 'host', tokenId: 'host', name: 'Host' } as McpTokenIdentity, workspaceToolDefinitions: definitions },
      { principal: chatPrincipal, nativeThreadId: 'thread-1', workspaceToolDefinitions: definitions },
      { principal: chatPrincipal },
    ]) {
      const client = await connect(input);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).not.toContain('read_file');
      expect(names).not.toContain('list_workspaces');
      await client.close();
    }
  });

  test('calls run in the Hub for the chat, with blip parameter names', async () => {
    const definitions = await loadAgentChatWorkspaceToolDefinitions();
    await withHub(
      (path, body) =>
        path.endsWith('/list_workspaces')
          ? { ok: true, result: { defaultWorkspaceId: 'drone:drone-a', workspaces: [] } }
          : body?.args?.target === 'drone:missing'
            ? { ok: true, error: 'workspace target drone:missing lacks capability files.read' }
            : { ok: true, result: { content: [{ type: 'text', text: 'hello' }], details: { big: true } } },
      async (requests) => {
        const client = await connect({ principal: chatPrincipal, workspaceToolDefinitions: definitions });
        const listed = await client.callTool({ name: 'list_workspaces', arguments: {} });
        expect(listed.structuredContent).toEqual({ defaultWorkspaceId: 'drone:drone-a', workspaces: [] });

        const read = await client.callTool({
          name: 'read_file',
          arguments: { path: 'README.md', workspace: 'drone:drone-b' },
        });
        expect(read.isError).not.toBe(true);
        expect(read.content).toEqual([{ type: 'text', text: 'hello' }]);

        const transfer = await client.callTool({
          name: 'transfer_files',
          arguments: {
            sourceWorkspace: 'drone:drone-b',
            sourcePath: 'docs',
            destinationWorkspace: 'drone:drone-a',
            destinationPath: 'docs',
          },
        });
        expect(transfer.isError).not.toBe(true);

        const denied = await client.callTool({
          name: 'read_file',
          arguments: { path: 'a', workspace: 'drone:missing' },
        });
        expect(denied.isError).toBe(true);
        expect(denied.content).toEqual([
          { type: 'text', text: 'workspace target drone:missing lacks capability files.read' },
        ]);

        const base = '/api/drones/drone-a/chats/main%20chat/workspaces/tools';
        expect(requests).toEqual([
          { path: `${base}/list_workspaces`, body: { args: {} } },
          { path: `${base}/read_file`, body: { args: { path: 'README.md', target: 'drone:drone-b' } } },
          {
            path: `${base}/transfer_files`,
            body: {
              args: {
                sourceTarget: 'drone:drone-b',
                sourcePath: 'docs',
                destinationTarget: 'drone:drone-a',
                destinationPath: 'docs',
              },
            },
          },
          { path: `${base}/read_file`, body: { args: { path: 'a', target: 'drone:missing' } } },
        ]);
        await client.close();
      },
    );
  });

  test('cancelling a call cancels its Hub request', async () => {
    const definitions = await loadAgentChatWorkspaceToolDefinitions();
    const previous = { fetch: globalThis.fetch, url: process.env.DRONE_HUB_BASE_URL, token: process.env.DRONE_TOKEN };
    let hubAborted = false;
    let started!: () => void;
    const requested = new Promise<void>((resolve) => { started = resolve; });
    globalThis.fetch = ((_input: any, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        started();
        init?.signal?.addEventListener('abort', () => {
          hubAborted = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      })) as typeof fetch;
    process.env.DRONE_HUB_BASE_URL = 'http://drone-hub.test';
    process.env.DRONE_TOKEN = 'workspace-tools-test-token';
    try {
      const client = await connect({ principal: chatPrincipal, workspaceToolDefinitions: definitions });
      const controller = new AbortController();
      const call = client.callTool({ name: 'bash', arguments: { command: 'sleep 100' } }, undefined, {
        signal: controller.signal,
      });
      await requested;
      controller.abort();
      await expect(call).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(hubAborted).toBe(true);
      await client.close();
    } finally {
      globalThis.fetch = previous.fetch;
      if (previous.url == null) delete process.env.DRONE_HUB_BASE_URL;
      else process.env.DRONE_HUB_BASE_URL = previous.url;
      if (previous.token == null) delete process.env.DRONE_TOKEN;
      else process.env.DRONE_TOKEN = previous.token;
    }
  });
});
