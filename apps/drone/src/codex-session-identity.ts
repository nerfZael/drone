// Each run manager belongs to one drone. Chat UUIDs, unlike display names,
// remain stable across renames. Keep legacy durable jobs and old hubs compatible.
export function codexSessionIdentity(sessionKey: string): string {
  const legacyOrCurrent = sessionKey.match(/:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return legacyOrCurrent ? `chat:${legacyOrCurrent[1].toLowerCase()}` : sessionKey;
}

export function codexChatSessionKey(droneId: string, chatId: string): string {
  if (!droneId.trim() || !chatId.trim()) throw new Error('Codex requires a stable drone and chat ID');
  return `codex-chat:${droneId}:${chatId}`;
}
