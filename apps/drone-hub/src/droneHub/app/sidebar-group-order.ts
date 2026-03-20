export type SidebarGroupOrderKind = 'group' | 'repo';

export type SidebarGroupOrderRef = {
  group: string;
  kind: SidebarGroupOrderKind;
};

export type SidebarGroupDropPlacement = 'before' | 'after';

export function sidebarGroupOrderToken({ group, kind }: SidebarGroupOrderRef): string {
  return `${kind}:${String(group ?? '').trim()}`;
}

export function normalizeSidebarGroupOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const token = String(item ?? '').trim();
    if (!token || out.includes(token)) continue;
    out.push(token);
  }
  return out;
}

export function orderSidebarGroups<T extends SidebarGroupOrderRef>(groups: T[], order: string[]): T[] {
  if (groups.length < 2) return groups.slice();
  const orderIndex = new Map<string, number>();
  for (const token of order) {
    if (orderIndex.has(token)) continue;
    orderIndex.set(token, orderIndex.size);
  }
  return groups
    .map((group, index) => ({
      group,
      index,
      orderIndex: orderIndex.get(sidebarGroupOrderToken(group)) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.index - b.index)
    .map((entry) => entry.group);
}

export function orderSidebarEntries<T>(
  entries: T[],
  order: string[],
  getKey: (entry: T) => string,
): T[] {
  if (entries.length < 2) return entries.slice();
  const orderIndex = new Map<string, number>();
  for (const token of order) {
    if (orderIndex.has(token)) continue;
    orderIndex.set(token, orderIndex.size);
  }
  return entries
    .map((entry, index) => ({
      entry,
      index,
      orderIndex: orderIndex.get(String(getKey(entry) ?? '').trim()) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.index - b.index)
    .map((item) => item.entry);
}

export function reorderSidebarEntryOrder(
  order: string[],
  entries: string[],
  active: string,
  over: string,
  placement: SidebarGroupDropPlacement,
): string[] {
  const activeKey = String(active ?? '').trim();
  const overKey = String(over ?? '').trim();
  if (!activeKey || !overKey || activeKey === overKey) return normalizeSidebarGroupOrder(order);

  const visibleEntries = orderSidebarEntries(entries, order, (entry) => entry);
  if (!visibleEntries.includes(activeKey) || !visibleEntries.includes(overKey)) {
    return normalizeSidebarGroupOrder(order);
  }

  const withoutActive = visibleEntries.filter((entry) => entry !== activeKey);
  const overIndex = withoutActive.indexOf(overKey);
  if (overIndex < 0) return normalizeSidebarGroupOrder(order);

  const insertIndex = placement === 'before' ? overIndex : overIndex + 1;
  withoutActive.splice(insertIndex, 0, activeKey);

  const visibleEntrySet = new Set(visibleEntries);
  const hiddenEntries = normalizeSidebarGroupOrder(order).filter((entry) => !visibleEntrySet.has(entry));
  return [...withoutActive, ...hiddenEntries];
}

export function reorderSidebarGroupOrder(
  order: string[],
  groups: SidebarGroupOrderRef[],
  active: SidebarGroupOrderRef,
  over: SidebarGroupOrderRef,
  placement: SidebarGroupDropPlacement,
): string[] {
  const activeToken = sidebarGroupOrderToken(active);
  const overToken = sidebarGroupOrderToken(over);
  if (!activeToken || !overToken || activeToken === overToken) return normalizeSidebarGroupOrder(order);

  const visibleTokens = orderSidebarGroups(groups, order).map((group) => sidebarGroupOrderToken(group));
  if (!visibleTokens.includes(activeToken) || !visibleTokens.includes(overToken)) {
    return normalizeSidebarGroupOrder(order);
  }

  const withoutActive = visibleTokens.filter((token) => token !== activeToken);
  const overIndex = withoutActive.indexOf(overToken);
  if (overIndex < 0) return normalizeSidebarGroupOrder(order);

  const insertIndex = placement === 'before' ? overIndex : overIndex + 1;
  withoutActive.splice(insertIndex, 0, activeToken);

  const visibleTokenSet = new Set(visibleTokens);
  const hiddenTokens = normalizeSidebarGroupOrder(order).filter((token) => !visibleTokenSet.has(token));
  return [...withoutActive, ...hiddenTokens];
}

export function renameSidebarGroupTokenList(
  tokens: string[],
  current: SidebarGroupOrderRef,
  next: SidebarGroupOrderRef,
): string[] {
  const currentToken = sidebarGroupOrderToken(current);
  const nextToken = sidebarGroupOrderToken(next);
  if (!currentToken || !nextToken || currentToken === nextToken) return normalizeSidebarGroupOrder(tokens);
  return normalizeSidebarGroupOrder(tokens).map((token) => (token === currentToken ? nextToken : token));
}

export function renameSidebarEntryOrderMapKey(
  entriesByKey: Record<string, string[]>,
  current: SidebarGroupOrderRef,
  next: SidebarGroupOrderRef,
): Record<string, string[]> {
  const currentToken = sidebarGroupOrderToken(current);
  const nextToken = sidebarGroupOrderToken(next);
  if (!currentToken || !nextToken || currentToken === nextToken) return entriesByKey;
  if (!(currentToken in entriesByKey)) return entriesByKey;

  const nextMap = { ...entriesByKey };
  const currentEntries = normalizeSidebarGroupOrder(nextMap[currentToken]);
  delete nextMap[currentToken];
  const mergedEntries = normalizeSidebarGroupOrder([...(nextMap[nextToken] ?? []), ...currentEntries]);
  if (mergedEntries.length > 0) nextMap[nextToken] = mergedEntries;
  return nextMap;
}

export const renameSidebarGroupOrderToken = renameSidebarGroupTokenList;
