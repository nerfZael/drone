import type { HubRouter } from '../hub-router';
import type { AgentChat, AgentChatWorkspaces } from '../assistant/chat-agent-workspaces';
import { resolveCanonicalDroneOrPendingForReadRef } from '../drone-lifecycle-service';
import { readChatMetadataFromStore } from '../transcript-store';

/** Lists the chat's workspaces; every other tool name is one of blip's workspace tools. */
export const AGENT_CHAT_WORKSPACE_LIST_TOOL = 'list_workspaces';

/**
 * An agent chat's workspaces: the picker reads and saves the selection, and the DroneHub MCP server runs the chat's
 * workspace tools here, so every call is checked against the selection as it is now.
 */
export function registerChatWorkspaceRoutes(router: HubRouter, workspaces: AgentChatWorkspaces) {
  const resolveChat = async (params: Readonly<Record<string, string>>): Promise<AgentChat> => {
    const resolved = await resolveCanonicalDroneOrPendingForReadRef(params.drone);
    if (!resolved) throw Object.assign(new Error(`unknown drone: ${params.drone}`), { status: 404 });
    if (resolved.kind === 'pending')
      throw Object.assign(new Error(`drone "${params.drone}" is still starting`), { status: 409 });
    const chatName = params.chat || 'default';
    if (!readChatMetadataFromStore({ droneId: resolved.id, chatName }).chat)
      throw Object.assign(new Error(`unknown chat: ${chatName}`), { status: 404 });
    return { droneId: resolved.id, chatName };
  };
  const statusOf = (error: any) => (typeof error?.status === 'number' ? error.status : 400);

  router.get('/api/drones/:drone/chats/:chat/workspaces', async ({ params, url, json, fail }) => {
    try {
      const chat = await resolveChat(params);
      json(200, await workspaces.catalog(chat, url.searchParams.get('deviceId') || undefined));
    } catch (error: any) {
      fail(statusOf(error), error?.message ?? String(error));
    }
  });

  router.post('/api/drones/:drone/chats/:chat/workspaces', async ({ params, readJson, json, fail }) => {
    try {
      const chat = await resolveChat(params);
      const body = await readJson<{ access?: unknown; revision?: unknown }>();
      json(200, await workspaces.save(chat, body?.access, String(body?.revision ?? '')));
    } catch (error: any) {
      fail(statusOf(error), error?.message ?? String(error));
    }
  });

  // A tool that fails answers 200 with its error, so the agent sees the reason rather than an HTTP failure.
  router.post(
    '/api/drones/:drone/chats/:chat/workspaces/tools/:tool',
    async ({ params, req, res, readJson, json, fail }) => {
      let chat: AgentChat;
      try {
        chat = await resolveChat(params);
      } catch (error: any) {
        return fail(statusOf(error), error?.message ?? String(error));
      }
      const body = await readJson<{ args?: Record<string, unknown> }>();
      const args = body?.args && typeof body.args === 'object' ? body.args : {};
      const aborted = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) aborted.abort();
      });
      try {
        const result =
          params.tool === AGENT_CHAT_WORKSPACE_LIST_TOOL
            ? await workspaces.list(chat)
            : await workspaces.run(chat, params.tool, args, aborted.signal);
        json(200, { ok: true, result });
      } catch (error: any) {
        if (aborted.signal.aborted || req.destroyed) return;
        json(200, { ok: true, error: error?.message ?? String(error) });
      }
    },
  );
}
