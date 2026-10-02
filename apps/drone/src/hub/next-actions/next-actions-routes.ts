import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';
import {
  createNextActionsService,
  NextActionsError,
  nextActionsSettingsResponse,
  normalizeNextActionsTurns,
  writeNextActionsSettings,
} from './next-actions';

type HubLog = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;

export function registerNextActionsRoutes(router: HubRouter, deps: { hubLog: HubLog }): void {
  const nextActionsForTurn = createNextActionsService();

  router.get('/api/settings/next-actions', async ({ json }) => {
    json(200, await nextActionsSettingsResponse());
  });

  router.put('/api/settings/next-actions', async ({ readJson, json, fail }) => {
    try {
      await writeNextActionsSettings(await readJson<unknown>());
      json(200, await nextActionsSettingsResponse());
    } catch (error) {
      fail(400, errorMessage(error));
    }
  });

  router.post('/api/next-actions/suggest', async ({ readJson, json, fail }) => {
    const body = await readJson<any>();
    const droneId = String(body?.droneId ?? '').trim();
    const chatName = String(body?.chatName ?? '').trim();
    const turnId = String(body?.turnId ?? '').trim();
    const turns = normalizeNextActionsTurns(body?.turns);
    if (!droneId || !chatName || !turnId) return fail(400, 'droneId, chatName, and turnId are required');
    if (turns.length === 0) return fail(400, 'turns must include the latest exchange');
    try {
      json(200, { ok: true, ...await nextActionsForTurn({ droneId, chatName, turnId, turns }) });
    } catch (error) {
      const status = error instanceof NextActionsError ? error.status : 500;
      if (status === 500) deps.hubLog('warn', 'next actions suggestion failed', { droneId, chatName, turnId, error: errorMessage(error) });
      json(status, { ok: false, error: errorMessage(error) });
    }
  });
}
