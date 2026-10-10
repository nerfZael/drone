import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { readJsonBody, sendJson } from '../src/hub/hub-http';
import { HubRouter } from '../src/hub/hub-router';
import { registerChatWorkspaceRoutes } from '../src/hub/routes/chat-workspace-routes';

// A real HTTP server: a request whose body was read reports destroyed, which a fake request does not reproduce.
describe('agent chat workspace routes', () => {
  const runs: Array<{ chat: unknown; tool: string; args: unknown }> = [];
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    const router = new HubRouter(sendJson, readJsonBody);
    registerChatWorkspaceRoutes(
      router,
      {
        catalog: async () => ({ revision: 'r1' }) as any,
        save: async (_chat, access, revision) => ({ access, revision }) as any,
        list: async () => ({ defaultWorkspaceId: 'drone:a', workspaces: [] }),
        run: async (chat, tool, args) => {
          runs.push({ chat, tool, args });
          if (tool === 'read_file') return { content: [{ type: 'text', text: 'hello' }], details: {} };
          throw new Error(`${tool} is not available in this chat's workspaces.`);
        },
      },
      async (params) => {
        if (params.drone !== 'a') throw Object.assign(new Error('unknown drone: b'), { status: 404 });
        return { droneId: 'a', chatName: params.chat };
      },
    );
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!(await router.handle(req, res, url))) sendJson(res, 404, { ok: false });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/drones`;
  });
  afterAll(() => {
    server.close();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });

  test('runs a tool and answers with its result', async () => {
    const response = await post('/a/chats/main%20chat/workspaces/tools/read_file', { args: { path: 'x' } });
    expect(await response.json()).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'hello' }], details: {} },
    });
    expect(runs.at(-1)).toEqual({ chat: { droneId: 'a', chatName: 'main chat' }, tool: 'read_file', args: { path: 'x' } });
  });

  test('answers a failing tool with its error instead of hanging', async () => {
    const response = await post('/a/chats/main/workspaces/tools/nope', { args: {} });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      error: "nope is not available in this chat's workspaces.",
    });
  });

  test('lists workspaces, saves the selection, and rejects unknown chats', async () => {
    expect(await (await post('/a/chats/main/workspaces/tools/list_workspaces', {})).json()).toEqual({
      ok: true,
      result: { defaultWorkspaceId: 'drone:a', workspaces: [] },
    });
    const saved = await post('/a/chats/main/workspaces', { access: { targets: [] }, revision: 'r1' });
    expect(await saved.json()).toEqual({ access: { targets: [] }, revision: 'r1' });
    const unknown = await post('/b/chats/main/workspaces/tools/read_file', { args: {} });
    expect(unknown.status).toBe(404);
  });
});
