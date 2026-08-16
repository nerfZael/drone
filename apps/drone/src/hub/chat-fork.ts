import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';
import { readBuiltinTranscriptSessionId } from './builtin-transcript-session-metadata';

export type ChatForkOrigin = {
  version: 1;
  agentId: BuiltinTranscriptAgentId;
  sourceChatName: string;
  sourceSessionId: string;
  state: 'pending';
};

export function createChatForkOrigin(
  sourceChat: any,
  sourceChatNameRaw: string,
  agentId: BuiltinTranscriptAgentId,
): ChatForkOrigin | null {
  if (agentId === 'cursor') return null;
  const sourceSessionId = readBuiltinTranscriptSessionId(sourceChat, agentId);
  if (!sourceSessionId) return null;
  return {
    version: 1,
    agentId,
    sourceChatName: String(sourceChatNameRaw ?? '').trim() || 'default',
    sourceSessionId,
    state: 'pending',
  };
}

export function cloneTranscriptTurnsForChatFork(turnsRaw: unknown): any[] {
  if (!Array.isArray(turnsRaw)) return [];
  return turnsRaw.map((turn) => {
    const cloned = turn && typeof turn === 'object' ? structuredClone(turn) : turn;
    if (!cloned || typeof cloned !== 'object') return cloned;
    const inherited = { ...cloned, inheritedFromClone: true };
    delete inherited.agentMessageAutoContinue;
    delete inherited.agentSuggestion;
    delete inherited.automation;
    return inherited;
  });
}

export function pendingChatForkSourceSessionId(
  chat: any,
  agentId: BuiltinTranscriptAgentId,
): string {
  const origin = chat?.chatForkOrigin;
  if (
    !origin ||
    typeof origin !== 'object' ||
    origin.version !== 1 ||
    origin.state !== 'pending' ||
    origin.agentId !== agentId
  ) {
    return '';
  }
  return String(origin.sourceSessionId ?? '').trim();
}

export function completePendingChatFork(entry: any, agentId: BuiltinTranscriptAgentId): boolean {
  const origin = entry?.chatForkOrigin;
  if (
    !origin ||
    typeof origin !== 'object' ||
    origin.version !== 1 ||
    origin.state !== 'pending' ||
    origin.agentId !== agentId
  ) {
    return false;
  }
  delete entry.chatForkOrigin;
  return true;
}
