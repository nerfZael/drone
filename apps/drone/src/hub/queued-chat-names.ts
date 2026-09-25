import { pendingPromptIsWaiting, isSendInNewChatQueueAction } from '@drone/assistant-chat';

/** Waiting work is separate from the set of chats whose agents are running. */
export function queuedChatNames(chats: Record<string, any> | undefined): string[] {
  return Object.entries(chats ?? {}).flatMap(([name, chat]) => {
    const completed = new Set((chat?.turns ?? []).map((turn: any) => turn.id));
    const waiting = (chat?.pendingPrompts ?? []).some((prompt: any) =>
      !completed.has(prompt.id) && !isSendInNewChatQueueAction(prompt.action) && pendingPromptIsWaiting(prompt));
    return waiting ? [name] : [];
  });
}
