import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';
import { helperLlmCredentials } from '../helper-llm';
import { HUB_AGENT_MODEL_OPTIONS } from '../llm-model-catalog';
import { getChatAskTracker, readChatAsksSettings, writeChatAsksSettings } from './chat-ask-service';
import { ASK_PROMPT_MAX_CHARS, BACKFILL_MAX_MESSAGES, DEFAULT_CHAT_ASKS_SETTINGS } from './chat-asks-model';

async function settingsResponse() {
  const settings = await readChatAsksSettings();
  const credentials = await helperLlmCredentials();
  return {
    ok: true as const,
    settings,
    defaults: { prompts: DEFAULT_CHAT_ASKS_SETTINGS.prompts },
    limits: { maxPromptChars: ASK_PROMPT_MAX_CHARS, backfillMessages: BACKFILL_MAX_MESSAGES },
    models: HUB_AGENT_MODEL_OPTIONS,
    credentials,
    totalCost: getChatAskTracker()?.totalCost() ?? { cost: 0, calls: 0, unpriced: 0 },
  };
}

function chatFrom(source: { droneId?: unknown; chatName?: unknown }) {
  const droneId = String(source?.droneId ?? '').trim();
  const chatName = String(source?.chatName ?? '').trim();
  if (!droneId || !chatName) throw new Error('droneId and chatName are required');
  return { droneId, chatName };
}

/** Asks: the settings, each chat's list and tracking switch, and the user's own status changes. */
export function registerChatAsksRoutes(router: HubRouter): void {
  router.get('/api/settings/chat-asks', async ({ json }) => {
    json(200, await settingsResponse());
  });

  router.put('/api/settings/chat-asks', async ({ readJson, json, fail }) => {
    try {
      await writeChatAsksSettings(await readJson<unknown>());
      json(200, await settingsResponse());
    } catch (error) {
      fail(400, errorMessage(error));
    }
  });

  router.get('/api/chat-asks', async ({ url, json, fail }) => {
    const tracker = getChatAskTracker();
    if (!tracker) return fail(503, 'Ask tracking is unavailable.');
    try {
      const { droneId, chatName } = chatFrom({ droneId: url.searchParams.get('droneId'), chatName: url.searchParams.get('chatName') });
      const settings = await readChatAsksSettings();
      json(200, { ok: true, enabled: settings.enabled, ...tracker.view(droneId, chatName) });
    } catch (error) {
      fail(400, errorMessage(error));
    }
  });

  router.post('/api/chat-asks/tracking', async ({ readJson, json, fail }) => {
    const tracker = getChatAskTracker();
    if (!tracker) return fail(503, 'Ask tracking is unavailable.');
    try {
      const body = await readJson<any>();
      const { droneId, chatName } = chatFrom(body);
      if (typeof body?.enabled !== 'boolean') throw new Error('enabled must be a boolean');
      tracker.setTracking(droneId, chatName, body.enabled);
      void tracker.tick();
      json(200, { ok: true, enabled: (await readChatAsksSettings()).enabled, ...tracker.view(droneId, chatName) });
    } catch (error) {
      fail(400, errorMessage(error));
    }
  });

  router.post('/api/chat-asks/status', async ({ readJson, json, fail }) => {
    const tracker = getChatAskTracker();
    if (!tracker) return fail(503, 'Ask tracking is unavailable.');
    try {
      const body = await readJson<any>();
      const { droneId, chatName } = chatFrom(body);
      if (body?.status !== 'open' && body?.status !== 'done' && body?.status !== 'dismissed') {
        throw new Error('status must be open, done, or dismissed');
      }
      tracker.override(droneId, chatName, String(body?.askId ?? ''), body.status);
      json(200, { ok: true, enabled: (await readChatAsksSettings()).enabled, ...tracker.view(droneId, chatName) });
    } catch (error) {
      fail(400, errorMessage(error));
    }
  });
}
