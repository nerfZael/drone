import { isWorkflowChatEntry } from './workflows/workflow-chat-metadata';
import { isSideChatEntry } from './side-chat-checkpoint';

function parseIsoOrZero(raw: unknown): number {
  const ms = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(ms) ? ms : 0;
}

/** Chat name -> when it was created, for chats that recorded it. Lets clients list chats in creation order. */
export function resolveChatCreatedAt(chats: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!chats || typeof chats !== 'object') return out;
  for (const [chatName, entry] of Object.entries(chats as Record<string, any>)) {
    const createdAt = String(entry?.createdAt ?? '').trim();
    if (createdAt && parseIsoOrZero(createdAt) > 0) out[chatName] = createdAt;
  }
  return out;
}

/**
 * Chat name -> the chat it was cloned from. The stored source ID wins over the
 * stored name so a renamed source keeps its clones; a deleted source drops out.
 */
export function resolveChatCloneSources(chats: unknown): Record<string, string> {
  const entries = chats && typeof chats === 'object' ? (Object.entries(chats) as Array<[string, any]>) : [];
  const nameById = new Map<string, string>();
  for (const [chatName, entry] of entries) {
    const id = String(entry?.id ?? '').trim();
    if (id) nameById.set(id, chatName);
  }
  const known = new Set(entries.map(([chatName]) => chatName));
  const out: Record<string, string> = {};
  for (const [chatName, entry] of entries) {
    // A side chat kept before clones recorded their origin only has sideChatOrigin.
    const origin = entry?.cloneOrigin ?? entry?.sideChatOrigin;
    const byId = nameById.get(String(origin?.sourceChatId ?? '').trim());
    const byName = String(origin?.sourceChatName ?? '').trim();
    const source = byId ?? (known.has(byName) ? byName : '');
    if (source && source !== chatName) out[chatName] = source;
  }
  return out;
}

export function summarizeDroneActivity(
  entry: any,
  canonicalMessageAtByChatId?: ReadonlyMap<string, string>,
): {
  lastActivityAt: string | null;
  lastMessageAt: string | null;
  lastActivityChat: string | null;
} {
  let lastActivityMs = Math.max(
    parseIsoOrZero(entry?.createdAt),
    parseIsoOrZero(entry?.updatedAt),
    parseIsoOrZero(entry?.hub?.updatedAt),
  );
  let lastMessageMs = 0;
  let lastActivityChat: string | null = null;
  let lastMessageChat: string | null = null;

  const chats = entry?.chats && typeof entry.chats === 'object' ? entry.chats : {};
  for (const [chatName, chatEntry] of Object.entries(chats) as Array<[string, any]>) {
    if (isWorkflowChatEntry(chatEntry) || isSideChatEntry(chatEntry)) continue;
    const chatId = String(chatEntry?.id ?? '').trim();
    const canonicalMessageMs = parseIsoOrZero(
      chatId ? canonicalMessageAtByChatId?.get(chatId) : null,
    );
    if (canonicalMessageMs > lastMessageMs) {
      lastMessageMs = canonicalMessageMs;
      lastMessageChat = chatName;
    }
    if (canonicalMessageMs > lastActivityMs) {
      lastActivityMs = canonicalMessageMs;
      lastActivityChat = chatName;
    }

    for (const turn of Array.isArray(chatEntry?.turns) ? chatEntry.turns : []) {
      const turnMs = Math.max(
        parseIsoOrZero(turn?.completedAt),
        parseIsoOrZero(turn?.promptAt),
        parseIsoOrZero(turn?.at),
      );
      if (turnMs > lastMessageMs) {
        lastMessageMs = turnMs;
        lastMessageChat = chatName;
      }
      if (turnMs > lastActivityMs) {
        lastActivityMs = turnMs;
        lastActivityChat = chatName;
      }
    }

    for (const prompt of Array.isArray(chatEntry?.pendingPrompts) ? chatEntry.pendingPrompts : []) {
      const promptMs = Math.max(
        parseIsoOrZero(prompt?.updatedAt),
        parseIsoOrZero(prompt?.at),
        parseIsoOrZero(prompt?.createdAt),
      );
      if (promptMs > lastActivityMs) {
        lastActivityMs = promptMs;
        lastActivityChat = chatName;
      }
    }
  }

  return {
    lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
    lastMessageAt: lastMessageMs > 0 ? new Date(lastMessageMs).toISOString() : null,
    lastActivityChat:
      lastActivityChat ?? (lastActivityMs === lastMessageMs ? lastMessageChat : null),
  };
}

export function isDraftDroneEntry(entry: any): boolean {
  return entry?.draft === true || String(entry?.phase ?? '').trim().toLowerCase() === 'draft';
}

export function isDraftChatEntry(entry: any): boolean {
  return entry?.draft === true;
}
