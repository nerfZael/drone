import type { BuiltinTranscriptAgentId } from './pendingPromptEnqueue';

export const BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT = {
  cursor: 'chatId',
  codex: 'codexThreadId',
  claude: 'claudeSessionId',
  opencode: 'openCodeSessionId',
  pi: 'piSessionId',
  blip: 'blipSessionId',
} as const satisfies Record<BuiltinTranscriptAgentId, string>;

export function readBuiltinTranscriptSessionId(
  chatEntry: any,
  agentId: BuiltinTranscriptAgentId,
): string {
  return String(chatEntry?.[BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT[agentId]] ?? '').trim();
}

export function writeBuiltinTranscriptSessionId(
  chatEntry: any,
  agentId: BuiltinTranscriptAgentId,
  sessionIdRaw: unknown,
): boolean {
  if (!chatEntry || typeof chatEntry !== 'object') return false;
  const sessionId = String(sessionIdRaw ?? '').trim();
  if (!sessionId || readBuiltinTranscriptSessionId(chatEntry, agentId) === sessionId) return false;
  chatEntry[BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT[agentId]] = sessionId;
  return true;
}
