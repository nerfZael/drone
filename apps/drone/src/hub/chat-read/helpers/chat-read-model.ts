import { completedTurnIds, normalizePendingPromptState } from '@drone/assistant-chat';
import type {
  AssistantChatIdleStatus,
  AssistantChatIdleTarget,
} from '../../assistant/assistant-contracts';
import { readNativeChatMessages } from '../../native-chat-messages';

export type ChatVisibleMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  status: 'completed' | 'failed';
  at: string;
  text: string;
  textOriginalLength: number;
  textTruncated: boolean;
  turnId?: string;
};

type ChatReadTurn = {
  id?: string;
  at?: string;
  promptAt?: string;
  completedAt?: string;
  prompt?: string;
  output?: string;
  error?: string;
  ok?: boolean;
};

type ChatReadPrompt = {
  id: string;
  at?: string;
  prompt?: string;
  state?: string;
};

export type ChatReadSnapshot = {
  id: string;
  chat: string;
  chatId?: string | null;
  agent?: { kind: string };
  draft?: boolean;
  transcripts: ChatReadTurn[];
  pending: ChatReadPrompt[];
  turnCount?: number;
};

/** The only source-specific history selection used by visible reads and activity. */
export function readVisibleChatHistory(
  snapshot: ChatReadSnapshot,
  limit = 40,
  maxChars = 8000,
): { messages: ChatVisibleMessage[]; hasOlder: boolean } {
  if (snapshot.agent?.kind === 'native') {
    if (!snapshot.chatId) throw new Error('native chat has no stable identity');
    return readNativeChatMessages(snapshot.chatId, limit, maxChars);
  }
  const messages = snapshot.transcripts.flatMap((turn, index) => {
    const turnId = String(turn.id || `turn-${index + 1}`);
    const rows: ChatVisibleMessage[] = [];
    const add = (role: ChatVisibleMessage['role'], text: unknown, at: unknown) => {
      const content = String(text ?? '');
      if (!content.trim()) return;
      rows.push({
        id: `${role}:${turnId}`,
        turnId,
        role,
        status:
          role === 'error' || (role === 'assistant' && turn.ok === false) ? 'failed' : 'completed',
        at: String(at ?? ''),
        text: content.slice(0, maxChars),
        textOriginalLength: content.length,
        textTruncated: content.length > maxChars,
      });
    };
    add('user', turn.prompt, turn.promptAt ?? turn.at);
    add('assistant', turn.output, turn.completedAt ?? turn.at);
    add('error', turn.error, turn.completedAt ?? turn.at);
    return rows;
  });
  return {
    messages: messages.slice(-limit),
    hasOlder: messages.length > limit || (snapshot.turnCount ?? 0) > snapshot.transcripts.length,
  };
}

/** Delivery records already represented in history do not represent pending execution. */
export function pendingChatMessages(snapshot: ChatReadSnapshot): ChatReadPrompt[] {
  const completed = completedTurnIds(snapshot.transcripts);
  return snapshot.pending.filter((prompt) =>
    snapshot.agent?.kind === 'native'
      ? prompt.state !== 'sent' && prompt.state !== 'cancelled'
      : !completed.has(String(prompt.id ?? '')),
  );
}

export function summarizeChatActivity(
  snapshot: ChatReadSnapshot,
  runtimeBusy = false,
): AssistantChatIdleStatus {
  const pending = pendingChatMessages(snapshot);
  const active = pending.filter((prompt) =>
    ['queued', 'sending', 'sent'].includes(normalizePendingPromptState(prompt.state, 'queued')),
  );
  const activeUserMessages = Math.max(active.length, runtimeBusy ? 1 : 0);
  const queuedUserMessages = pending.filter(
    (prompt) => normalizePendingPromptState(prompt.state, 'queued') === 'queued',
  ).length;
  const history = readVisibleChatHistory(snapshot).messages;
  const candidates: NonNullable<AssistantChatIdleStatus['latest']>[] = history.map((message) => ({
    id: message.turnId && message.role !== 'user' ? `agent:${message.turnId}` : message.id,
    role: message.role === 'user' ? 'user' : 'agent',
    status: message.status,
    at: message.at,
    text: message.text,
    ...(message.turnId ? { turnId: message.turnId } : {}),
  }));
  // A silent CLI completion is still a completed turn; its empty output is not a visible message.
  for (const turn of snapshot.agent?.kind === 'native' ? [] : snapshot.transcripts) {
    if (!String(turn.output ?? '').trim() && !String(turn.error ?? '').trim()) {
      candidates.push({
        id: `agent:${turn.id}`,
        role: 'agent',
        status: turn.ok === false ? 'failed' : 'completed',
        at: String(turn.completedAt ?? turn.at ?? ''),
        text: '',
        turnId: turn.id,
      });
    }
  }
  for (const prompt of pending) {
    candidates.push({
      id: `user:${prompt.id}`,
      role: 'user',
      status: normalizePendingPromptState(prompt.state, 'queued'),
      at: String(prompt.at ?? ''),
      text: String(prompt.prompt ?? ''),
      turnId: prompt.id,
    });
  }
  // Stable sorting preserves source message order when timestamps are identical.
  candidates.sort((a, b) => timestamp(a.at) - timestamp(b.at));
  const latest = candidates[candidates.length - 1] ?? null;
  const reason = activeUserMessages
    ? 'active_user_messages'
    : !latest
      ? 'no_messages'
      : latest.status === 'failed'
        ? 'latest_user_failed'
        : latest.role === 'agent'
          ? 'latest_agent_message'
          : 'latest_user_message';
  return {
    droneId: snapshot.id,
    chatName: snapshot.chat,
    idle:
      activeUserMessages === 0 &&
      (snapshot.agent?.kind === 'native' || reason !== 'latest_user_message'),
    reason,
    activeUserMessages,
    queuedUserMessages,
    failedUserMessages: Math.max(
      pending.filter((prompt) => prompt.state === 'failed').length,
      latest?.status === 'failed' ? 1 : 0,
    ),
    latest,
  };
}

/** Resolve the same identity for history and status, including pending startup drones. */
export function chatReadSnapshotFromRegistry(
  registry: any,
  target: AssistantChatIdleTarget,
  requireChat = true,
): ChatReadSnapshot {
  const ref = String(target.droneId ?? '').trim();
  const chatName = String(target.chatName ?? '').trim() || 'default';
  for (const collection of [registry?.drones, registry?.pending]) {
    const entry = collection?.[ref]
      ? [ref, collection[ref]]
      : Object.entries(collection ?? {}).find(
          ([, value]: [string, any]) => value?.id === ref || value?.name === ref,
        );
    if (!entry) continue;
    const [key, raw] = entry;
    const drone = raw as any;
    const chat = drone.chats?.[chatName];
    const seed = chatName === 'default' ? String(drone.seed?.prompt ?? '').trim() : '';
    if (!chat && requireChat && !seed) throw new Error(`unknown chat: ${ref}/${chatName}`);
    return {
      id: String(drone.id ?? key),
      chat: chatName,
      chatId: chat?.id,
      agent: chat?.agent ?? drone.agent,
      draft: chat?.draft === true,
      transcripts: Array.isArray(chat?.turns) ? chat.turns : [],
      pending: Array.isArray(chat?.pendingPrompts)
        ? chat.pendingPrompts
        : seed
          ? [
              {
                id: 'startup-seed',
                state: 'queued',
                prompt: seed,
                at: drone.updatedAt ?? drone.createdAt,
              },
            ]
          : [],
    };
  }
  throw new Error(`unknown drone: ${ref}`);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
