import type { HubRouter } from '../hub-router';

type ClaudeBackgroundTasksForChat = (opts: {
  droneId: string;
  chatName: string;
  stop?: boolean;
}) => Promise<{
  tasks: Array<{ id: string; type: string; description: string; startedAt: string }>;
  stopped?: number;
}>;

export function registerClaudeBackgroundTaskRoutes(
  router: HubRouter,
  claudeBackgroundTasksForChat: ClaudeBackgroundTasksForChat,
): void {
  const chatTarget = (input: { droneId?: unknown; chatName?: unknown }) => ({
    droneId: String(input.droneId ?? '').trim(),
    chatName: String(input.chatName ?? '').trim() || 'default',
  });

  router.get('/api/claude-background-tasks', async ({ url, json: respond }) => {
    const target = chatTarget({
      droneId: url.searchParams.get('droneId'),
      chatName: url.searchParams.get('chatName'),
    });
    if (!target.droneId) return respond(400, { ok: false, error: 'missing droneId' });
    try {
      respond(200, { ok: true, ...(await claudeBackgroundTasksForChat(target)) });
    } catch (error) {
      respond(502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/claude-background-tasks/stop', async ({ readJson, json: respond }) => {
    const target = chatTarget((await readJson()) ?? {});
    if (!target.droneId) return respond(400, { ok: false, error: 'missing droneId' });
    try {
      respond(200, {
        ok: true,
        ...(await claudeBackgroundTasksForChat({ ...target, stop: true })),
      });
    } catch (error) {
      respond(502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
