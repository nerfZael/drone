import {
  normalizeProviderMessageCheckpoint,
  type ProviderMessageCheckpoint,
} from './provider-message-checkpoint';

export type SideChatOrigin = {
  sourceChatName: string;
  /** Survives a rename of the source; older side chats only have the name. */
  sourceChatId?: string;
  /** The fork point. A new side chat starts empty and has none. */
  checkpointId?: string;
  /** `new` starts an empty chat with the source's agent, model, and reasoning. */
  kind?: 'fork' | 'new';
  /** `composer` side chats show as chips beside their source's composer, not as floating windows. */
  presentation?: 'composer';
};

export function isSideChatEntry(entry: unknown): boolean {
  return (entry as any)?.visibility === 'side-chat';
}

export function isComposerSideChatEntry(entry: unknown): boolean {
  return isSideChatEntry(entry) && (entry as any)?.sideChatOrigin?.presentation === 'composer';
}

/** The name the Hub gives a side chat before its first message names it. */
export function isGeneratedSideChatName(raw: unknown): boolean {
  return /^side-[0-9a-f]{8}$/.test(String(raw ?? '').trim());
}

/**
 * Every side chat that descends from `sourceChatName`, nearest first: its side
 * chats, theirs, and so on. A source is matched by its stored ID before its name,
 * so a renamed source keeps its side chats. Kept side chats are ordinary chats and
 * end the chain.
 */
export function sideChatDescendantNames(chats: unknown, sourceChatName: string): string[] {
  const entries = chats && typeof chats === 'object' ? (Object.entries(chats) as Array<[string, any]>) : [];
  const nameById = new Map<string, string>();
  for (const [chatName, entry] of entries) {
    const id = String(entry?.id ?? '').trim();
    if (id) nameById.set(id, chatName);
  }
  const known = new Set(entries.map(([chatName]) => chatName));
  const childrenBySource = new Map<string, string[]>();
  for (const [chatName, entry] of entries) {
    if (!isSideChatEntry(entry)) continue;
    const origin = entry?.cloneOrigin ?? entry?.sideChatOrigin;
    const byId = nameById.get(String(origin?.sourceChatId ?? entry?.sideChatOrigin?.sourceChatId ?? '').trim());
    const byName = String(origin?.sourceChatName ?? '').trim();
    const source = byId ?? (known.has(byName) ? byName : '');
    if (!source || source === chatName) continue;
    childrenBySource.set(source, [...(childrenBySource.get(source) ?? []), chatName]);
  }
  const out: string[] = [];
  const seen = new Set<string>([sourceChatName]);
  const queue = [sourceChatName];
  while (queue.length) {
    for (const child of childrenBySource.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** Capture a stable, inclusive boundary, never the live tail of a conversation. */
export function completedChatCheckpoint(
  source: any,
  requestedId?: string,
): {
  turns: any[];
  checkpointId: string;
  codexTurnId?: string;
  providerCheckpoint?: ProviderMessageCheckpoint;
} {
  const turns: any[] = Array.isArray(source?.turns) ? source.turns : [];
  if (requestedId) {
    const index = turns.findIndex((turn) => turn.id === requestedId);
    const turn = turns[index];
    if (!turn?.ok || turn.userOnly || turn.silentCompletion || !String(turn.output ?? '').trim()) {
      throw new Error('The requested completed assistant checkpoint is no longer available');
    }
    return {
      turns: structuredClone(turns.slice(0, index + 1)),
      checkpointId: requestedId,
      ...(turn.codexTurnId ? { codexTurnId: turn.codexTurnId } : {}),
      ...(normalizeProviderMessageCheckpoint(turn.providerCheckpoint)
        ? { providerCheckpoint: normalizeProviderMessageCheckpoint(turn.providerCheckpoint) }
        : {}),
    };
  }
  let index = turns.length - 1;
  while (index >= 0) {
    const turn = turns[index];
    if (
      turn?.id &&
      turn.ok &&
      !turn.userOnly &&
      !turn.silentCompletion &&
      String(turn.output ?? '').trim()
    )
      break;
    index -= 1;
  }
  if (index < 0) throw new Error('No completed assistant answer to branch from yet');
  const turn = turns[index];
  return {
    turns: structuredClone(turns.slice(0, index + 1)),
    checkpointId: turn.id,
    ...(turn.codexTurnId ? { codexTurnId: turn.codexTurnId } : {}),
    ...(normalizeProviderMessageCheckpoint(turn.providerCheckpoint)
      ? { providerCheckpoint: normalizeProviderMessageCheckpoint(turn.providerCheckpoint) }
      : {}),
  };
}
