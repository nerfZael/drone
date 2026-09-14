import { summarizeAssistantChatIdle } from './assistant';
import type { AssistantChatIdleTarget } from './assistant/assistant-contracts';
import { readNativeChatSubscriptionStatus } from './native-chat-messages';

/** Shared by subscription polling and the general chat idle-status API. */
export async function readChatIdleStatus(
  registry: any,
  target: AssistantChatIdleTarget,
  nativeChatIsBusy: (chatId: string) => Promise<boolean>,
) {
  const status = summarizeAssistantChatIdle(registry, target, { requireChat: true });
  const chat = registry.drones[target.droneId]?.chats?.[status.chatName];
  if (chat?.agent?.kind !== 'native') return status;

  const chatId = String(chat.id ?? '').trim();
  if (!chatId) throw new Error('native chat has no stable identity');
  const pending = Array.isArray(chat.pendingPrompts) ? chat.pendingPrompts : [];
  const queued = pending.filter((prompt: any) => prompt.state === 'queued').length;
  const active = pending.filter(
    (prompt: any) => prompt.state === 'queued' || prompt.state === 'sending',
  ).length;
  const busy = active > 0 || (await nativeChatIsBusy(chatId));
  const native = readNativeChatSubscriptionStatus(chatId, busy, status);
  return {
    ...status,
    ...native,
    // Native sent records describe completed delivery, not active work.
    activeUserMessages: busy ? Math.max(1, active) : 0,
    queuedUserMessages: queued,
    failedUserMessages: Math.max(
      status.failedUserMessages,
      native.reason === 'latest_user_failed' ? 1 : 0,
    ),
  };
}
