const CHAT_NAME_MAX_LEN = 64;

export function isGeneratedChatName(raw: unknown): boolean {
  return /^(?:chat-\d+|Untitled\s+\d+)$/.test(String(raw ?? '').trim());
}

export function buildAutoRenamedChatCandidate(baseRaw: unknown, attempt: number): string {
  const base = String(baseRaw ?? '').trim();
  const suffix = attempt <= 1 ? '' : ` (${attempt})`;
  if (!base) return '';
  const maxBaseLength = Math.max(1, CHAT_NAME_MAX_LEN - suffix.length);
  return `${base.slice(0, maxBaseLength).trim()}${suffix}`.trim();
}
