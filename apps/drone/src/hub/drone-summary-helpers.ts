function parseIsoOrZero(raw: unknown): number {
  const ms = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(ms) ? ms : 0;
}

export function summarizeDroneActivity(entry: any): {
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
