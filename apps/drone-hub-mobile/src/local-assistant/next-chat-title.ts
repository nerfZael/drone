export function nextChatTitle(chats: Array<{ title?: string }>): string {
  const used = new Set(
    chats
      .map((chat) => /^Chat (\d+)$/.exec(String(chat.title ?? '').trim())?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number),
  );
  let number = 1;
  while (used.has(number)) number += 1;
  return `Chat ${number}`;
}
