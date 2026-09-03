export type MobileChatRefreshPlan = {
  refreshChat: boolean;
  refreshDrones: boolean;
};

const CHAT_ONLY_REASONS = new Set([
  'runtime_tool_call_started',
  'runtime_tool_call_progress',
  'runtime_tool_call_completed',
  'runtime_tool_call_failed',
  'workspace_policy_changed',
]);

const SIDEBAR_REASONS = new Set([
  'runtime_started',
  'approval_pending',
  'approval_recovery_required',
  'approval_resolved',
  'question_input_pending',
  'question_input_resolved',
  'runtime_finished',
  'runtime_error',
]);

export function mobileChatRefreshPlan(input: {
  reason: string;
  eventDroneId: string;
  eventChatName: string;
  activeDroneId: string;
  activeChatName: string;
}): MobileChatRefreshPlan {
  const matchingActiveChat = Boolean(
    input.activeDroneId &&
    (!input.eventDroneId || input.eventDroneId === input.activeDroneId) &&
    (!input.eventChatName || input.eventChatName === input.activeChatName),
  );
  if (CHAT_ONLY_REASONS.has(input.reason)) {
    return { refreshChat: matchingActiveChat, refreshDrones: false };
  }
  if (input.reason === 'canonical_history_changed' || input.reason === 'chat_write') {
    return {
      refreshChat: matchingActiveChat,
      refreshDrones: !matchingActiveChat,
    };
  }
  if (SIDEBAR_REASONS.has(input.reason)) {
    return { refreshChat: matchingActiveChat, refreshDrones: true };
  }
  return { refreshChat: matchingActiveChat, refreshDrones: true };
}

export async function loadMobileChatWithListRecovery(options: {
  initialChat: string;
  knownChats: readonly string[];
  requestedChat?: string;
  listChats: () => Promise<unknown>;
  readChat: (chatName: string) => Promise<void>;
  isCurrent: () => boolean;
  applyListedSelection: (chats: string[], chatName: string) => void;
}): Promise<void> {
  const initialRead = options.initialChat
    ? options.readChat(options.initialChat).then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      )
    : null;
  const rawListedChats = await options.listChats();
  if (!options.isCurrent()) return;
  const listedChats = Array.isArray(rawListedChats)
    ? rawListedChats.map((chat) => String(chat ?? '').trim()).filter(Boolean)
    : [];
  const chats = listedChats.length > 0 ? [...new Set(listedChats)] : [...options.knownChats];
  const chatName =
    options.requestedChat && chats.includes(options.requestedChat)
      ? options.requestedChat
      : (chats[0] ?? '');
  options.applyListedSelection(chats, chatName);
  if (!options.isCurrent()) return;
  if (initialRead && chatName === options.initialChat) {
    const outcome = await initialRead;
    if (outcome.error) throw outcome.error;
    return;
  }
  if (chatName) await options.readChat(chatName);
}
