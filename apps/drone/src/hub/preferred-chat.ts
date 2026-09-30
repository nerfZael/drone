/** Explicit chat names stay explicit; only omitted targets use a surviving chat. */
export function preferredChatName(chatNames: readonly string[], requested?: unknown): string {
  const explicit = String(requested ?? '').trim();
  if (explicit) return explicit;
  return chatNames.includes('default') ? 'default' : [...chatNames].sort()[0] ?? 'default';
}
