import type { HubRouter } from '../hub-router';
import { resolveChatStepsSettings, updateChatStepsSettings } from '../hub-settings';
import { getChatStepTracker, invalidateChatStepsSettings } from '../chat-steps/chat-step-service';
import { readChatMetadataFromStore } from '../transcript-store';

/** Step tracking for agent chats: its settings, and each chat's latest steps for the canvas. */
export function registerChatStepsRoutes(router: HubRouter): void {
  router.get('/api/chats/steps', ({ url, json }) => {
    const tracker = getChatStepTracker();
    const steps = tracker?.steps({ droneId: url.searchParams.get('droneId') || undefined }) ?? [];
    // Steps of a chat that was deleted or renamed away are dropped, so a new chat by that name starts clean.
    const live = steps.filter((item) => {
      if (readChatMetadataFromStore({ droneId: item.droneId, chatName: item.chatName }).chat) return true;
      tracker?.forget(item.droneId, item.chatName);
      return false;
    });
    json(200, { ok: true, steps: live });
  });
  router.get('/api/settings/chat-steps', async ({ json }) => {
    json(200, { ok: true, settings: await resolveChatStepsSettings() });
  });
  router.post('/api/settings/chat-steps', async ({ readJson, json, fail }) => {
    try {
      const settings = await updateChatStepsSettings(await readJson<unknown>());
      invalidateChatStepsSettings();
      json(200, { ok: true, settings });
    } catch (error) {
      fail(400, error instanceof Error ? error.message : String(error));
    }
  });
}
