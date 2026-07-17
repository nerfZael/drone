export function clonedChatTitle(
  sourceTitle: string,
  chats: Array<{ title?: string }>,
): string {
  const base = String(sourceTitle || 'Chat').trim().slice(0, 153) || 'Chat';
  const titles = new Set(chats.map((chat) => String(chat.title ?? '').trim()));
  const first = `${base} (copy)`;
  if (!titles.has(first)) return first;
  for (let copy = 2; copy < 10_000; copy += 1) {
    const suffix = ` (copy ${copy})`;
    const candidate = `${base.slice(0, 160 - suffix.length)}${suffix}`;
    if (!titles.has(candidate)) return candidate;
  }
  return `${base.slice(0, 145)} (${Date.now()})`;
}
