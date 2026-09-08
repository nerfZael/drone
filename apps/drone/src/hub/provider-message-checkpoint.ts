export type ProviderMessageCheckpoint = {
  agentId: 'claude' | 'opencode';
  sessionId: string;
  messageId: string;
};

/** Session ownership stays with inherited turns: providers can remap IDs on fork. */
export function normalizeProviderMessageCheckpoint(
  raw: unknown,
): ProviderMessageCheckpoint | undefined {
  const value = raw as Partial<ProviderMessageCheckpoint> | null;
  if (value?.agentId !== 'claude' && value?.agentId !== 'opencode') return undefined;
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : '';
  const messageId = typeof value.messageId === 'string' ? value.messageId.trim() : '';
  if (!sessionId || !messageId) return undefined;
  return { agentId: value.agentId, sessionId, messageId };
}
