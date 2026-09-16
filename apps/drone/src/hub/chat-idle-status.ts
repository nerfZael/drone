import type { AssistantChatIdleTarget } from './assistant/assistant-contracts';
import { chatReadSnapshotFromRegistry, summarizeChatActivity } from './chat-read/helpers/chat-read-model';

/** Shared by subscription polling and the general chat idle-status API. */
export async function readChatIdleStatus(
  registry: any,
  target: AssistantChatIdleTarget,
  nativeChatIsBusy: (chatId: string) => Promise<boolean>,
) {
  const snapshot = chatReadSnapshotFromRegistry(registry, target);
  const busy =
    snapshot.agent?.kind === 'native' && snapshot.chatId
      ? await nativeChatIsBusy(snapshot.chatId)
      : false;
  return summarizeChatActivity(snapshot, busy);
}
