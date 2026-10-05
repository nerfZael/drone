import { loadRegistry } from '../../host/registry';
import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';
import { readChatMetadataFromStore } from '../transcript-store';
import { getUsageStore } from '../usage/UsageStore';
import {
  createNextActionsService,
  NEXT_ACTIONS_USAGE_PURPOSE,
  NextActionsError,
  nextActionsSettingsResponse,
  normalizeNextActionsTurns,
  writeNextActionsSettings,
} from './next-actions';

const COST_BY_CHAT_LIMIT = 20;

function chatIdFor(droneId: string, chatName: string): string | undefined {
  const chat = readChatMetadataFromStore({ droneId, chatName }).chat as { id?: unknown } | null;
  return String(chat?.id ?? '').trim() || undefined;
}

/** The settings plus what Next actions has cost: in total, and per chat with drone names for display. */
async function settingsWithCosts() {
  const usage = getUsageStore();
  const drones = (await loadRegistry().catch(() => null))?.drones ?? {};
  return {
    ...await nextActionsSettingsResponse(),
    totalCost: usage.purposeCost(NEXT_ACTIONS_USAGE_PURPOSE),
    costByChat: usage.purposeCostByChat(NEXT_ACTIONS_USAGE_PURPOSE, COST_BY_CHAT_LIMIT).map((row) => ({
      ...row,
      droneName: String((drones[row.droneId] as { name?: unknown } | undefined)?.name ?? '').trim() || null,
    })),
  };
}

type HubLog = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;

export function registerNextActionsRoutes(router: HubRouter, deps: { hubLog: HubLog }): void {
  const nextActionsForTurn = createNextActionsService({
    cost: (chatId) => getUsageStore().purposeCost(NEXT_ACTIONS_USAGE_PURPOSE, chatId ? { chatId } : {}),
  });

  router.get('/api/settings/next-actions', async ({ json }) => {
    json(200, await settingsWithCosts());
  });

  router.put('/api/settings/next-actions', async ({ readJson, json, fail }) => {
    try {
      await writeNextActionsSettings(await readJson<unknown>());
      json(200, await settingsWithCosts());
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
      json(200, { ok: true, ...await nextActionsForTurn({ droneId, chatName, chatId: chatIdFor(droneId, chatName), turnId, turns }) });
    } catch (error) {
      const status = error instanceof NextActionsError ? error.status : 500;
      if (status === 500) deps.hubLog('warn', 'next actions suggestion failed', { droneId, chatName, turnId, error: errorMessage(error) });
      json(status, { ok: false, error: errorMessage(error) });
    }
  });
}
