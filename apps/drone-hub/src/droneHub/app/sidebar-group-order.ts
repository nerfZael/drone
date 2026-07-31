import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
  sidebarGroupParentPath,
} from './sidebar-group-paths';
import {
  orderSidebarEntries,
  sidebarGroupLegacyOrderToken,
  sidebarGroupOrderToken,
} from '@drone/hub-model/sidebar';

export { orderSidebarEntries, sidebarGroupLegacyOrderToken, sidebarGroupOrderToken };

export type SidebarGroupOrderKind = 'group' | 'repo';

export type SidebarGroupOrderRef = {
  groupId?: string | null;
  group: string;
  kind: SidebarGroupOrderKind;
};

export type SidebarGroupDropPlacement = 'before' | 'after';
export type SidebarGroupCreatePlacement = 'start' | 'end';

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

function migrateSidebarGroupIdentityToken(token: string, groupIdByName: Readonly<Record<string, string>>): string {
  if (!token.startsWith('group:')) return token;
  const name = token.slice('group:'.length);
  const id = String(groupIdByName[name] ?? '').trim();
  return id ? `group-id:${id}` : token;
}

export function migrateSidebarGroupOrderToIds(
  order: string[],
  groupIdByName: Readonly<Record<string, string>>,
): string[] {
  const normalized = normalizeSidebarGroupOrder(order);
  const migrated = normalizeSidebarGroupOrder(
    normalized.map((token) => migrateSidebarGroupIdentityToken(token, groupIdByName)),
  );
  return migrated.length === normalized.length && migrated.every((token, index) => token === normalized[index])
    ? order
    : migrated;
}

export function migrateSidebarGroupEntryOrderMapToIds(
  entriesByKey: Record<string, string[]>,
  groupIdByName: Readonly<Record<string, string>>,
): Record<string, string[]> {
  let changed = false;
  const out: Record<string, string[]> = {};
  for (const [key, entries] of Object.entries(entriesByKey)) {
    const nextKey = migrateSidebarGroupIdentityToken(key, groupIdByName);
    if (nextKey !== key) changed = true;
    out[nextKey] = normalizeSidebarGroupOrder([...(out[nextKey] ?? []), ...entries]);
  }
  return changed ? out : entriesByKey;
}

export function orderSidebarGroups<T extends SidebarGroupOrderRef>(groups: T[], order: string[]): T[] {
  const orderedTokens = new Set(order);
  return orderSidebarEntries(groups, order, (group) => {
    const stableToken = sidebarGroupOrderToken(group);
    return orderedTokens.has(stableToken) ? stableToken : sidebarGroupLegacyOrderToken(group);
  });
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
  placement: SidebarGroupCreatePlacement = 'start',
): string[] {
  const nextToken = sidebarGroupOrderToken(group);
  if (!nextToken) return normalizeSidebarGroupOrder(order);

  const stabilizedOrder = mergeVisibleSidebarGroupOrder(order, groups);
  if (stabilizedOrder.includes(nextToken)) return stabilizedOrder;
  const missingAncestorTokens =
    group.kind === 'group'
      ? String(group.group ?? '')
          .trim()
          .split('/')
          .map((_, index, parts) => parts.slice(0, index + 1).join('/'))
          .slice(0, -1)
          .map((ancestor) => {
            const visibleAncestor = groups.find(
              (entry) => entry.kind === group.kind && String(entry.group ?? '').trim() === ancestor,
            );
            return sidebarGroupOrderToken(visibleAncestor ?? { group: ancestor, kind: group.kind });
          })
          .filter((token) => token && !stabilizedOrder.includes(token))
      : [];
  const tokensToInsert = normalizeSidebarGroupOrder([...missingAncestorTokens, nextToken]);

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
    if (group.kind === 'group') {
      const parentPath = sidebarGroupParentPath(group.group);
      if (parentPath) {
        const visibleParent = groups.find(
          (entry) => entry.kind === group.kind && String(entry.group ?? '').trim() === parentPath,
        );
        const parentToken = sidebarGroupOrderToken(visibleParent ?? { group: parentPath, kind: group.kind });
        const parentIndex = visibleOrder.indexOf(parentToken);
        if (parentIndex >= 0) {
          const nextVisibleOrder = visibleOrder.slice();
          nextVisibleOrder.splice(parentIndex + 1, 0, ...tokensToInsert);
          return normalizeSidebarGroupOrder([...nextVisibleOrder, ...hiddenTokens]);
        }
      }
    }
    return normalizeSidebarGroupOrder([...tokensToInsert, ...visibleOrder, ...hiddenTokens]);
  }

  const nextVisibleOrder = visibleOrder.slice();
  nextVisibleOrder.splice(placement === 'start' ? anchorIndex : anchorIndex + 1, 0, ...tokensToInsert);
  return normalizeSidebarGroupOrder([...nextVisibleOrder, ...hiddenTokens]);
}

export function removeSidebarGroupOrderToken(order: string[], group: SidebarGroupOrderRef): string[] {
  const token = sidebarGroupOrderToken(group);
  if (!token) return normalizeSidebarGroupOrder(order);
  return normalizeSidebarGroupOrder(order).filter((entry) => entry !== token);
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
  const currentStableToken = sidebarGroupOrderToken(current);
  const nextStableToken = sidebarGroupOrderToken(next);
  const kindPrefix = `${current.kind}:`;
  const currentGroup = String(current.group ?? '').trim();
  const nextGroup = String(next.group ?? '').trim();
  if (!currentGroup || !nextGroup || currentGroup === nextGroup) return normalizeSidebarGroupOrder(tokens);
  return normalizeSidebarGroupOrder(tokens).map((token) => {
    if (token === currentStableToken) return nextStableToken;
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
