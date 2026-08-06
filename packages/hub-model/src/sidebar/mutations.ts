import { isSameOrDescendantSidebarGroupPath, rewriteSidebarGroupPathPrefix } from './paths';
import type { SidebarTreeDrone } from './types';

export type SidebarDropPlacement = 'before' | 'inside' | 'after';

export type SidebarReorderIntent =
  | {
      kind: 'tree-entry';
      parentId: string;
      siblingNodeIds: string[];
      activeNodeId: string;
      overNodeId: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'drone';
      parentId: string;
      siblingDroneIds: string[];
      activeDroneId: string;
      overDroneId: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'chat';
      droneId: string;
      chatNames: string[];
      activeChatName: string;
      overChatName: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'pinned-drone';
      visibleDroneIds: string[];
      activeDroneId: string;
      overDroneId: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    };

export type SidebarMoveIntoFolderIntent =
  | {
      kind: 'move-into-folder';
      itemKind: 'drone';
      repoPath: string;
      droneId: string;
      droneIds?: string[];
      targetParentDroneId?: string | null;
      sourceParentId: string;
      sourceSiblingNodeIds: string[];
      targetGroup: string | null;
      targetParentId: string;
      targetSiblingNodeIds: string[];
      targetOverNodeId?: string;
      placement?: SidebarDropPlacement;
    }
  | {
      kind: 'move-into-folder';
      itemKind: 'folder';
      repoPath: string;
      sourceGroup: string;
      sourceNodeId: string;
      sourceParentId: string;
      sourceSiblingNodeIds: string[];
      targetGroup: string | null;
      targetParentId: string;
      targetSiblingNodeIds: string[];
      targetOverNodeId?: string;
      placement?: SidebarDropPlacement;
    };

export type SidebarSetPinnedIntent = {
  kind: 'set-pinned';
  droneIds: string[];
  pinned: boolean;
};

export type SidebarMoveIntent =
  | SidebarReorderIntent
  | SidebarMoveIntoFolderIntent
  | SidebarSetPinnedIntent;

export type SidebarLayoutState = {
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  pinnedDroneIds: string[];
};

export type SidebarLayoutPatch = Partial<SidebarLayoutState>;

export function normalizeSidebarLayout(value: unknown): SidebarLayoutState {
  const source = object(value);
  return {
    sidebarNodeOrderByParent: cleanStringMap(source.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: cleanStringMap(source.sidebarChatOrderByDrone),
    pinnedDroneIds: cleanStrings(source.pinnedDroneIds),
  };
}

export function sidebarLayoutPatch(
  layout: SidebarLayoutState,
  intent: SidebarMoveIntent,
): SidebarLayoutPatch {
  if (intent.kind === 'chat') return { sidebarChatOrderByDrone: layout.sidebarChatOrderByDrone };
  if (intent.kind === 'pinned-drone' || intent.kind === 'set-pinned') {
    return { pinnedDroneIds: layout.pinnedDroneIds };
  }
  return { sidebarNodeOrderByParent: layout.sidebarNodeOrderByParent };
}

export function firstSidebarInsertionTarget(
  childNodeIds: readonly string[] | undefined,
  activeNodeId: string,
): string | undefined {
  return childNodeIds?.find((nodeId) => nodeId !== activeNodeId);
}

/** Materialize the desktop tree order while retaining temporarily hidden entries. */
export function mergeVisibleSidebarNodeOrderByParent(
  current: Record<string, string[]>,
  visibleChildIdsByParent: Record<string, string[]>,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  const visibleParentByNodeId = new Map<string, string>();
  for (const [parentId, nodeIds] of Object.entries(visibleChildIdsByParent)) {
    for (const nodeId of cleanStrings(nodeIds)) visibleParentByNodeId.set(nodeId, parentId);
  }
  const parentIds = new Set([
    ...Object.keys(current),
    ...Object.keys(visibleChildIdsByParent),
  ]);
  for (const parentId of parentIds) {
    const visible = cleanStrings(visibleChildIdsByParent[parentId]);
    const existing = cleanStrings(current[parentId]).filter(
      (nodeId) =>
        !visibleParentByNodeId.has(nodeId) || visibleParentByNodeId.get(nodeId) === parentId,
    );
    if (visible.length === 0) {
      if (existing.length > 0) next[parentId] = existing;
      continue;
    }
    const visibleSet = new Set(visible);
    next[parentId] = [
      ...visible,
      ...existing.filter((entry) => !visibleSet.has(entry)),
    ];
  }
  return cleanStringMap(next);
}

export function reorderSidebarEntries(
  currentOrder: readonly string[],
  visibleEntries: readonly string[],
  activeEntry: string,
  overEntry: string,
  dropPlacement: Exclude<SidebarDropPlacement, 'inside'>,
): string[] {
  const active = String(activeEntry ?? '').trim();
  const over = String(overEntry ?? '').trim();
  const visible = cleanStrings(visibleEntries);
  const current = cleanStrings(currentOrder);
  if (!active || !over || active === over || !visible.includes(active) || !visible.includes(over)) {
    return current;
  }
  const visibleSet = new Set(visible);
  const complete = completeSidebarOrder(current, visible);
  const reorderedVisible = complete
    .filter((entry) => visibleSet.has(entry))
    .filter((entry) => entry !== active);
  const overIndex = reorderedVisible.indexOf(over);
  if (overIndex < 0) return current;
  reorderedVisible.splice(dropPlacement === 'before' ? overIndex : overIndex + 1, 0, active);
  let visibleIndex = 0;
  const merged = complete.map((entry) =>
    visibleSet.has(entry) ? (reorderedVisible[visibleIndex++] ?? entry) : entry,
  );
  return [...merged, ...reorderedVisible.slice(visibleIndex)];
}

export function applySidebarReorder<T extends SidebarLayoutState>(
  layout: T,
  intent: SidebarReorderIntent,
): T {
  if (intent.kind === 'tree-entry') {
    return {
      ...layout,
      sidebarNodeOrderByParent: {
        ...layout.sidebarNodeOrderByParent,
        [intent.parentId]: reorderSidebarEntries(
          layout.sidebarNodeOrderByParent[intent.parentId] ?? [],
          intent.siblingNodeIds,
          intent.activeNodeId,
          intent.overNodeId,
          intent.placement,
        ),
      },
    };
  }
  if (intent.kind === 'chat') {
    return {
      ...layout,
      sidebarChatOrderByDrone: {
        ...layout.sidebarChatOrderByDrone,
        [intent.droneId]: reorderSidebarEntries(
          layout.sidebarChatOrderByDrone[intent.droneId] ?? [],
          intent.chatNames,
          intent.activeChatName,
          intent.overChatName,
          intent.placement,
        ),
      },
    };
  }
  if (intent.kind === 'pinned-drone') {
    return {
      ...layout,
      pinnedDroneIds: reorderSidebarEntries(
        layout.pinnedDroneIds,
        intent.visibleDroneIds,
        intent.activeDroneId,
        intent.overDroneId,
        intent.placement,
      ),
    };
  }
  const visibleNodeIds = intent.siblingDroneIds.map(sidebarDroneNodeId);
  return {
    ...layout,
    sidebarNodeOrderByParent: {
      ...layout.sidebarNodeOrderByParent,
      [intent.parentId]: reorderSidebarEntries(
        layout.sidebarNodeOrderByParent[intent.parentId] ?? [],
        visibleNodeIds,
        sidebarDroneNodeId(intent.activeDroneId),
        sidebarDroneNodeId(intent.overDroneId),
        intent.placement,
      ),
    },
  };
}

export function sidebarMoveDestination(
  intent: SidebarMoveIntoFolderIntent,
): { targetGroup: string | null; nextGroup: string | null } | null {
  const targetGroup = normalizeGroupPath(intent.targetGroup) || null;
  if (intent.itemKind === 'drone') return { targetGroup, nextGroup: null };
  const sourceGroup = normalizeGroupPath(intent.sourceGroup);
  if (
    !sourceGroup ||
    (targetGroup != null && isSameOrDescendantSidebarGroupPath(targetGroup, sourceGroup))
  ) {
    return null;
  }
  const nextGroup = [targetGroup, groupBaseName(sourceGroup)].filter(Boolean).join('/');
  return nextGroup && nextGroup !== sourceGroup ? { targetGroup, nextGroup } : null;
}

export function sidebarMoveDroneIds(intent: SidebarMoveIntoFolderIntent): string[] {
  return intent.itemKind === 'drone'
    ? cleanStrings([...(intent.droneIds ?? []), intent.droneId])
    : [];
}

export function applySidebarMoveIntoFolder<T extends SidebarLayoutState>(
  layout: T,
  intent: SidebarMoveIntoFolderIntent,
): T {
  const destination = sidebarMoveDestination(intent);
  if (!destination) return layout;
  if (intent.itemKind === 'drone') {
    const nodeIds = sidebarMoveDroneIds(intent).map(sidebarDroneNodeId);
    return {
      ...layout,
      sidebarNodeOrderByParent: moveNodeOrderIntoFolder(
        layout.sidebarNodeOrderByParent,
        intent,
        nodeIds,
        nodeIds,
      ),
    };
  }
  const sourceGroup = normalizeGroupPath(intent.sourceGroup);
  const sourceNodePrefix = intent.sourceNodeId.endsWith(sourceGroup)
    ? intent.sourceNodeId.slice(0, -sourceGroup.length)
    : 'folder:';
  const targetNodeId = `${sourceNodePrefix}${destination.nextGroup!}`;
  return {
    ...layout,
    sidebarNodeOrderByParent: rewriteFolderNodeOrder(
      moveNodeOrderIntoFolder(
        layout.sidebarNodeOrderByParent,
        intent,
        [intent.sourceNodeId],
        [targetNodeId],
      ),
      intent.sourceNodeId,
      targetNodeId,
    ),
  };
}

export function applySidebarMove<T extends SidebarLayoutState>(
  layout: T,
  intent: SidebarMoveIntent,
): T {
  if (intent.kind === 'move-into-folder') return applySidebarMoveIntoFolder(layout, intent);
  if (intent.kind === 'set-pinned') {
    const requested = cleanStrings(intent.droneIds);
    const requestedSet = new Set(requested);
    const current = cleanStrings(layout.pinnedDroneIds);
    return {
      ...layout,
      pinnedDroneIds: intent.pinned
        ? [...current, ...requested.filter((droneId) => !current.includes(droneId))]
        : current.filter((droneId) => !requestedSet.has(droneId)),
    };
  }
  return applySidebarReorder(layout, intent);
}

export function applyOptimisticSidebarMove<T extends SidebarTreeDrone>(
  drones: T[],
  intent: SidebarMoveIntoFolderIntent,
): T[] {
  const destination = sidebarMoveDestination(intent);
  if (!destination) return drones;
  if (intent.itemKind === 'drone') {
    const movingDroneIds = new Set(sidebarMoveDroneIds(intent));
    return drones.map((drone) =>
      movingDroneIds.has(drone.id) ? { ...drone, group: destination.targetGroup } : drone,
    );
  }
  return drones.map((drone) => {
    if (
      String(drone.repoPath ?? '').trim() !== intent.repoPath ||
      !isSameOrDescendantSidebarGroupPath(drone.group, intent.sourceGroup)
    ) {
      return drone;
    }
    return {
      ...drone,
      group: rewriteSidebarGroupPathPrefix(drone.group, intent.sourceGroup, destination.nextGroup!),
    };
  });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    : [];
}

function cleanStringMap(value: unknown): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(object(value)).flatMap(([keyRaw, entries]) => {
      const key = keyRaw.trim();
      const list = cleanStrings(entries);
      return key && list.length ? [[key, list] as const] : [];
    }),
  );
}

function normalizeGroupPath(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function groupBaseName(value: string): string {
  const parts = normalizeGroupPath(value).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function sidebarDroneNodeId(droneId: string): string {
  return `drone:${String(droneId ?? '').trim()}`;
}

function completeSidebarOrder(
  currentValues: readonly string[],
  visibleValues: readonly string[],
): string[] {
  const current = cleanStrings(currentValues);
  const visible = cleanStrings(visibleValues);
  if (visible.length === 0) return current;
  const visibleSet = new Set(visible);
  const orderedVisible = current.filter((entry) => visibleSet.has(entry));
  if (orderedVisible.length === 0) return [...current, ...visible];

  const orderedSet = new Set(orderedVisible);
  const gaps = Array.from({ length: orderedVisible.length + 1 }, () => [] as string[]);
  let anchorsSeen = 0;
  for (const entry of visible) {
    if (orderedSet.has(entry)) anchorsSeen += 1;
    else gaps[Math.min(anchorsSeen, gaps.length - 1)]!.push(entry);
  }
  const authoritativeVisible: string[] = [];
  for (let index = 0; index < orderedVisible.length; index += 1) {
    authoritativeVisible.push(...gaps[index]!, orderedVisible[index]!);
  }
  authoritativeVisible.push(...gaps[orderedVisible.length]!);

  let visibleIndex = 0;
  const merged = current.map((entry) =>
    visibleSet.has(entry) ? (authoritativeVisible[visibleIndex++] ?? entry) : entry,
  );
  return [...merged, ...authoritativeVisible.slice(visibleIndex)];
}

function moveNodeOrderIntoFolder(
  map: Record<string, string[]>,
  intent: SidebarMoveIntoFolderIntent,
  sourceNodeIds: string[],
  targetNodeIds: string[],
): Record<string, string[]> {
  const next = { ...map };
  const movingNodeIdSet = new Set(sourceNodeIds);
  const nextSource = completeSidebarOrder(
    map[intent.sourceParentId] ?? [],
    intent.sourceSiblingNodeIds,
  ).filter((nodeId) => !movingNodeIdSet.has(nodeId));
  if (nextSource.length) next[intent.sourceParentId] = nextSource;
  else delete next[intent.sourceParentId];
  const targetNodeIdSet = new Set(targetNodeIds);
  const targetOrder = completeSidebarOrder(
    map[intent.targetParentId] ?? [],
    intent.targetSiblingNodeIds,
  ).filter((nodeId) => !movingNodeIdSet.has(nodeId) && !targetNodeIdSet.has(nodeId));
  const overIndex = intent.targetOverNodeId ? targetOrder.indexOf(intent.targetOverNodeId) : -1;
  const insertIndex =
    intent.placement === 'inside' || overIndex < 0
      ? targetOrder.length
      : overIndex + (intent.placement === 'after' ? 1 : 0);
  targetOrder.splice(insertIndex, 0, ...targetNodeIds);
  next[intent.targetParentId] = targetOrder;
  return next;
}

function rewriteFolderNodeOrder(
  map: Record<string, string[]>,
  sourceNodeId: string,
  targetNodeId: string,
): Record<string, string[]> {
  const rewrite = (nodeId: string) =>
    nodeId === sourceNodeId
      ? targetNodeId
      : nodeId.startsWith(`${sourceNodeId}/`)
        ? `${targetNodeId}/${nodeId.slice(sourceNodeId.length + 1)}`
        : nodeId;
  const result: Record<string, string[]> = {};
  for (const [parentId, entries] of Object.entries(map)) {
    const nextParentId = rewrite(parentId);
    result[nextParentId] = cleanStrings([...(result[nextParentId] ?? []), ...entries.map(rewrite)]);
  }
  return result;
}
