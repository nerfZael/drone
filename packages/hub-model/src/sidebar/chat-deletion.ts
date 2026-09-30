/** Keep one existing chat when a bulk selection covers the entire drone. */
export function deletableChatNames(allChats: readonly string[], selected: readonly string[]): string[] {
  const names = [...new Set(selected)].filter((name) => allChats.includes(name));
  if (!allChats.length || !allChats.every((name) => names.includes(name))) return names;
  const keep = allChats.includes('default') ? 'default' : allChats[0];
  return names.filter((name) => name !== keep);
}
