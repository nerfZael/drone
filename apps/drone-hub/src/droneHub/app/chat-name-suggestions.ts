const CHAT_NAME_MAX_LEN = 64;

export function isGeneratedChatName(raw: unknown): boolean {
  return /^(?:chat-\d+|Untitled\s+\d+)$/.test(String(raw ?? '').trim());
}

export function buildSuggestedChatNameCandidate(baseRaw: string, attempt: number): string {
  const base = String(baseRaw ?? '').trim();
  const suffix = attempt <= 1 ? '' : ` (${attempt})`;
  const raw = `${base}${suffix}`.trim();
  if (!raw) return '';
  if (raw.length <= CHAT_NAME_MAX_LEN) return raw;
  const maxBaseLen = Math.max(1, CHAT_NAME_MAX_LEN - suffix.length);
  return `${base.slice(0, maxBaseLen).trim()}${suffix}`.trim();
}

export function isSuggestedChatRenameConflict(messageRaw: string): boolean {
  const message = String(messageRaw ?? '').trim().toLowerCase();
  return message.includes('already exists') || message.includes('cannot rename');
}

export function isSuggestedChatRenameRetriable(messageRaw: string): boolean {
  const message = String(messageRaw ?? '').trim().toLowerCase();
  return (
    message.includes('unknown chat') ||
    message.includes('chat is unavailable') ||
    message.includes('still starting') ||
    message.includes('unknown drone')
  );
}
