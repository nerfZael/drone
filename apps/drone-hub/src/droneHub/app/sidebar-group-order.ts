import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
  sidebarGroupParentPath,
} from './sidebar-group-paths';

export type SidebarGroupOrderKind = 'group' | 'repo';

export type SidebarGroupOrderRef = {
  group: string;
  kind: SidebarGroupOrderKind;
};

export type SidebarGroupDropPlacement = 'before' | 'after';
export type SidebarGroupCreatePlacement = 'start' | 'end';

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

export function mergeVisibleSidebarGroupOrder<T extends SidebarGroupOrderRef>(order: string[], groups: T[]): string[] {
  const visibleTokens = groups.map((group) => sidebarGroupOrderToken(group));
  if (visibleTokens.length === 0) return normalizeSidebarGroupOrder(order);
  const visibleTokenSet = new Set(visibleTokens);
  const hiddenTokens = normalizeSidebarGroupOrder(order).filter((token) => !visibleTokenSet.has(token));
  return normalizeSidebarGroupOrder([...visibleTokens, ...hiddenTokens]);
}

export function insertSidebarGroupOrderToken<T extends SidebarGroupOrderRef>(
  order: string[],
  groups: T[],
  group: SidebarGroupOrderRef,
  placement: SidebarGroupCreatePlacement = 'end',
): string[] {
  const nextToken = sidebarGroupOrderToken(group);
  if (!nextToken) return normalizeSidebarGroupOrder(order);

  const stabilizedOrder = mergeVisibleSidebarGroupOrder(order, groups);
  if (stabilizedOrder.includes(nextToken)) return stabilizedOrder;

  const visibleTokens = groups.map((entry) => sidebarGroupOrderToken(entry));
  const visibleTokenSet = new Set(visibleTokens);
  const hiddenTokens = stabilizedOrder.filter((token) => !visibleTokenSet.has(token));
  const visibleOrder = stabilizedOrder.filter((token) => visibleTokenSet.has(token));

  const siblingTokens = groups
    .filter((entry) => entry.kind === group.kind)
    .filter((entry) => {
      if (entry.kind !== 'group' || group.kind !== 'group') return true;
      return sidebarGroupParentPath(entry.group) === sidebarGroupParentPath(group.group);
    })
    .map((entry) => sidebarGroupOrderToken(entry));

  if (siblingTokens.length === 0) {
    return normalizeSidebarGroupOrder([...visibleOrder, nextToken, ...hiddenTokens]);
  }

  const siblingTokenSet = new Set(siblingTokens);
  let anchorIndex = -1;
  if (placement === 'start') {
    anchorIndex = visibleOrder.findIndex((token) => siblingTokenSet.has(token));
  } else {
    for (let index = visibleOrder.length - 1; index >= 0; index -= 1) {
      if (!siblingTokenSet.has(visibleOrder[index] ?? '')) continue;
      anchorIndex = index;
      break;
    }
  }

  if (anchorIndex < 0) {
    return normalizeSidebarGroupOrder([...visibleOrder, nextToken, ...hiddenTokens]);
  }

  const nextVisibleOrder = visibleOrder.slice();
  nextVisibleOrder.splice(placement === 'start' ? anchorIndex : anchorIndex + 1, 0, nextToken);
  return normalizeSidebarGroupOrder([...nextVisibleOrder, ...hiddenTokens]);
}

export function removeSidebarGroupOrderToken(order: string[], group: SidebarGroupOrderRef): string[] {
  const token = sidebarGroupOrderToken(group);
  if (!token) return normalizeSidebarGroupOrder(order);
  return normalizeSidebarGroupOrder(order).filter((entry) => entry !== token);
}

export function orderSidebarEntries<T>(
  entries: T[],
  order: string[],
  getKey: (entry: T) => string,
  options?: {
    unorderedPlacement?: 'start' | 'end';
  },
): T[] {
  if (entries.length < 2) return entries.slice();
  const unorderedPlacement = options?.unorderedPlacement === 'start' ? 'start' : 'end';
  const orderIndex = new Map<string, number>();
  for (const token of order) {
    if (orderIndex.has(token)) continue;
    orderIndex.set(token, orderIndex.size);
  }
  return entries
    .map((entry, index) => ({
      entry,
      index,
      orderIndex:
        orderIndex.get(String(getKey(entry) ?? '').trim()) ??
        (unorderedPlacement === 'start' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY),
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

  const visibleEntries = normalizeSidebarGroupOrder(entries);
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

export function renameSidebarGroupTokenListByPrefix(
  tokens: string[],
  current: SidebarGroupOrderRef,
  next: SidebarGroupOrderRef,
): string[] {
  if (current.kind !== next.kind) return normalizeSidebarGroupOrder(tokens);
  const kindPrefix = `${current.kind}:`;
  const currentGroup = String(current.group ?? '').trim();
  const nextGroup = String(next.group ?? '').trim();
  if (!currentGroup || !nextGroup || currentGroup === nextGroup) return normalizeSidebarGroupOrder(tokens);
  return normalizeSidebarGroupOrder(tokens).map((token) => {
    if (!token.startsWith(kindPrefix)) return token;
    const groupPath = token.slice(kindPrefix.length);
    if (!isSameOrDescendantSidebarGroupPath(groupPath, currentGroup)) return token;
    return `${kindPrefix}${rewriteSidebarGroupPathPrefix(groupPath, currentGroup, nextGroup)}`;
  });
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

export function renameSidebarEntryOrderMapKeysByPrefix(
  entriesByKey: Record<string, string[]>,
  current: SidebarGroupOrderRef,
  next: SidebarGroupOrderRef,
): Record<string, string[]> {
  if (current.kind !== next.kind) return entriesByKey;
  const currentGroup = String(current.group ?? '').trim();
  const nextGroup = String(next.group ?? '').trim();
  if (!currentGroup || !nextGroup || currentGroup === nextGroup) return entriesByKey;

  const out: Record<string, string[]> = {};
  for (const [key, entries] of Object.entries(entriesByKey)) {
    const prefix = `${current.kind}:`;
    if (!key.startsWith(prefix)) {
      out[key] = normalizeSidebarGroupOrder(entries);
      continue;
    }
    const groupPath = key.slice(prefix.length);
    const nextKey = isSameOrDescendantSidebarGroupPath(groupPath, currentGroup)
      ? `${prefix}${rewriteSidebarGroupPathPrefix(groupPath, currentGroup, nextGroup)}`
      : key;
    out[nextKey] = normalizeSidebarGroupOrder([...(out[nextKey] ?? []), ...entries]);
  }
  return out;
}

export const renameSidebarGroupOrderToken = renameSidebarGroupTokenList;
