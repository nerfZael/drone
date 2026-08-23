import { isSameOrDescendantSidebarGroupPath, rewriteSidebarGroupPathPrefix } from './paths';
import type { SidebarTreeDrone } from './types';
import {
  isSameOrDescendantSidebarChatGroupPath,
  normalizeSidebarChatGroupPath,
  rewriteSidebarChatGroupPathPrefix,
  sidebarChatGroupNodeId,
  sidebarChatGroupParentPath,
  sidebarChatNodeId,
  sidebarChatRootNodeId,
} from './chat-groups';

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
      kind: 'chat-tree-entry';
      parentId: string;
      siblingNodeIds: string[];
      activeNodeId: string;
      overNodeId: string;
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
      sourceGroupId?: string | null;
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

export type SidebarMuteTargetKind = 'group' | 'drone' | 'chat';

export type SidebarSetMutedIntent = {
  kind: 'set-muted';
  targetKind: SidebarMuteTargetKind;
  targetId: string;
  muted: boolean;
};

export type SidebarChatTreeIntent =
  | {
      kind: 'chat-tree-move';
      droneId: string;
      itemKind: 'chat' | 'folder';
      activeNodeId: string;
      activeNodeIds?: string[];
      sourcePath: string | null;
      sourceSiblingNodeIds: string[];
      targetPath: string | null;
      targetSiblingNodeIds: string[];
      overNodeId?: string;
      placement: SidebarDropPlacement;
    }
  | {
      kind: 'chat-group-create';
      droneId: string;
      path: string;
    }
  | {
      kind: 'chat-group-rename';
      droneId: string;
      path: string;
      newPath: string;
    }
  | {
      kind: 'chat-group-delete';
      droneId: string;
      path: string;
    }
  | {
      kind: 'chat-tree-remove';
      droneId: string;
      nodeIds: string[];
    };

export type SidebarMoveIntent =
  | SidebarReorderIntent
  | SidebarMoveIntoFolderIntent
  | SidebarSetPinnedIntent
  | SidebarSetMutedIntent
  | SidebarChatTreeIntent;

export type SidebarLayoutState = {
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  sidebarChatGroupPathsByDrone: Record<string, string[]>;
  sidebarChatGroupByChat: Record<string, string>;
  sidebarChatNodeOrderByParent: Record<string, string[]>;
  pinnedDroneIds: string[];
  mutedSidebarGroupIds: string[];
  mutedDroneIds: string[];
  mutedChatIds: string[];
};

export type SidebarLayoutPatch = Partial<SidebarLayoutState>;

export function normalizeSidebarLayout(value: unknown): SidebarLayoutState {
  const source = object(value);
  return {
    sidebarNodeOrderByParent: cleanStringMap(source.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: cleanStringMap(source.sidebarChatOrderByDrone),
    sidebarChatGroupPathsByDrone: cleanStringMap(source.sidebarChatGroupPathsByDrone),
    sidebarChatGroupByChat: cleanStringRecord(source.sidebarChatGroupByChat),
    sidebarChatNodeOrderByParent: cleanStringMap(source.sidebarChatNodeOrderByParent),
    pinnedDroneIds: cleanStrings(source.pinnedDroneIds),
    mutedSidebarGroupIds: cleanStrings(source.mutedSidebarGroupIds),
    mutedDroneIds: cleanStrings(source.mutedDroneIds),
    mutedChatIds: cleanStrings(source.mutedChatIds),
  };
}

export function sidebarLayoutPatch(
  layout: SidebarLayoutState,
  intent: SidebarMoveIntent,
): SidebarLayoutPatch {
  if (intent.kind === 'chat') return { sidebarChatOrderByDrone: layout.sidebarChatOrderByDrone };
  if (
    intent.kind === 'chat-tree-entry' ||
    intent.kind === 'chat-tree-move' ||
    intent.kind === 'chat-group-create' ||
    intent.kind === 'chat-group-rename' ||
    intent.kind === 'chat-group-delete' ||
    intent.kind === 'chat-tree-remove'
  ) {
    const patch: SidebarLayoutPatch = {
      sidebarChatGroupPathsByDrone: layout.sidebarChatGroupPathsByDrone,
      sidebarChatGroupByChat: layout.sidebarChatGroupByChat,
      sidebarChatNodeOrderByParent: layout.sidebarChatNodeOrderByParent,
    };
    const rewritesChatGroupMuteIds =
      intent.kind === 'chat-group-rename' ||
      intent.kind === 'chat-group-delete' ||
      (intent.kind === 'chat-tree-move' &&
        intent.itemKind === 'folder' &&
        normalizeSidebarChatGroupPath(intent.sourcePath) !==
          normalizeSidebarChatGroupPath(intent.targetPath));
    return rewritesChatGroupMuteIds
      ? { ...patch, mutedChatIds: layout.mutedChatIds }
      : patch;
  }
  if (intent.kind === 'pinned-drone' || intent.kind === 'set-pinned') {
    return { pinnedDroneIds: layout.pinnedDroneIds };
  }
  if (intent.kind === 'set-muted') {
    if (intent.targetKind === 'group') {
      return { mutedSidebarGroupIds: layout.mutedSidebarGroupIds };
    }
    if (intent.targetKind === 'drone') return { mutedDroneIds: layout.mutedDroneIds };
    return { mutedChatIds: layout.mutedChatIds };
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
  if (intent.kind === 'chat-tree-entry') {
    return {
      ...layout,
      sidebarChatNodeOrderByParent: {
        ...layout.sidebarChatNodeOrderByParent,
        [intent.parentId]: reorderSidebarEntries(
          layout.sidebarChatNodeOrderByParent[intent.parentId] ?? [],
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

function toggleSidebarMuteTarget(
  current: readonly string[],
  targetIdRaw: string,
  muted: boolean,
): string[] {
  const targetId = String(targetIdRaw ?? '').trim();
  const normalized = cleanStrings(current);
  if (!targetId) return normalized;
  if (muted) return normalized.includes(targetId) ? normalized : [...normalized, targetId];
  return normalized.filter((entry) => entry !== targetId);
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
  if (
    intent.kind === 'chat-tree-move' ||
    intent.kind === 'chat-group-create' ||
    intent.kind === 'chat-group-rename' ||
    intent.kind === 'chat-group-delete' ||
    intent.kind === 'chat-tree-remove'
  ) {
    return applySidebarChatTreeIntent(layout, intent);
  }
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
  if (intent.kind === 'set-muted') {
    const key = intent.targetKind === 'group'
      ? 'mutedSidebarGroupIds'
      : intent.targetKind === 'drone'
        ? 'mutedDroneIds'
        : 'mutedChatIds';
    return {
      ...layout,
      [key]: toggleSidebarMuteTarget(layout[key], intent.targetId, intent.muted),
    };
  }
  return applySidebarReorder(layout, intent);
}

export function applySidebarChatTreeIntent<T extends SidebarLayoutState>(
  layout: T,
  intent: SidebarChatTreeIntent,
): T {
  const droneId = String(intent.droneId ?? '').trim();
  if (!droneId) return layout;
  const chatNodePrefix = `chat:${droneId}:`;
  const paths = completeSidebarChatGroupPaths([
    ...(layout.sidebarChatGroupPathsByDrone[droneId] ?? []),
    ...Object.entries(layout.sidebarChatGroupByChat)
      .filter(([chatId]) => chatId.startsWith(chatNodePrefix))
      .map(([, path]) => path),
  ]);
  if (intent.kind === 'chat-tree-remove') {
    const nodeIds = cleanStrings(intent.nodeIds).filter((nodeId) =>
      nodeId.startsWith(chatNodePrefix));
    if (!nodeIds.length) return layout;
    const nextAssignments = { ...layout.sidebarChatGroupByChat };
    for (const nodeId of nodeIds) delete nextAssignments[nodeId];
    return {
      ...layout,
      sidebarChatGroupByChat: nextAssignments,
      sidebarChatNodeOrderByParent: removeChatTreeNodeIds(
        layout.sidebarChatNodeOrderByParent,
        nodeIds,
      ),
    };
  }
  if (intent.kind === 'chat-group-create') {
    const path = normalizeSidebarChatGroupPath(intent.path);
    if (!path || paths.includes(path)) return layout;
    return {
      ...layout,
      sidebarChatGroupPathsByDrone: {
        ...layout.sidebarChatGroupPathsByDrone,
        [droneId]: completeSidebarChatGroupPaths([...paths, path]),
      },
    };
  }
  if (intent.kind === 'chat-group-rename') {
    const path = normalizeSidebarChatGroupPath(intent.path);
    const newPath = normalizeSidebarChatGroupPath(intent.newPath);
    if (
      !path ||
      !newPath ||
      path === newPath ||
      !paths.includes(path) ||
      paths.includes(newPath) ||
      isSameOrDescendantSidebarChatGroupPath(newPath, path)
    ) return layout;
    const rewriteNodeId = (nodeId: string): string => {
      const prefix = `${sidebarChatGroupNodeId(droneId, path)}`;
      const nextPrefix = `${sidebarChatGroupNodeId(droneId, newPath)}`;
      return nodeId === prefix || nodeId.startsWith(`${prefix}/`)
        ? `${nextPrefix}${nodeId.slice(prefix.length)}`
        : nodeId;
    };
    const nextOrder: Record<string, string[]> = {};
    for (const [parentId, entries] of Object.entries(layout.sidebarChatNodeOrderByParent)) {
      const nextParentId = rewriteNodeId(parentId);
      nextOrder[nextParentId] = cleanStrings([
        ...(nextOrder[nextParentId] ?? []),
        ...entries.map(rewriteNodeId),
      ]);
    }
    return {
      ...layout,
      sidebarChatGroupPathsByDrone: {
        ...layout.sidebarChatGroupPathsByDrone,
        [droneId]: completeSidebarChatGroupPaths(paths.map((entry) =>
          rewriteSidebarChatGroupPathPrefix(entry, path, newPath))),
      },
      sidebarChatGroupByChat: Object.fromEntries(
        Object.entries(layout.sidebarChatGroupByChat).map(([chatId, groupPath]) => [
          chatId,
          chatId.startsWith(`chat:${droneId}:`) &&
          isSameOrDescendantSidebarChatGroupPath(groupPath, path)
            ? rewriteSidebarChatGroupPathPrefix(groupPath, path, newPath)
            : groupPath,
        ]),
      ),
      sidebarChatNodeOrderByParent: nextOrder,
      mutedChatIds: cleanStrings(layout.mutedChatIds).map(rewriteNodeId),
    };
  }
  if (intent.kind === 'chat-group-delete') {
    const path = normalizeSidebarChatGroupPath(intent.path);
    if (!path || !paths.includes(path)) return layout;
    const parentPath = sidebarChatGroupParentPath(path);
    const deletedNodeId = sidebarChatGroupNodeId(droneId, path);
    const parentId = parentPath
      ? sidebarChatGroupNodeId(droneId, parentPath)
      : sidebarChatRootNodeId(droneId);
    const deletedPaths = paths.filter((entry) =>
      isSameOrDescendantSidebarChatGroupPath(entry, path));
    const deletedPathSet = new Set(deletedPaths);
    const promotedChatIds = Object.entries(layout.sidebarChatGroupByChat)
      .filter(([chatId, groupPath]) =>
        chatId.startsWith(chatNodePrefix) && deletedPathSet.has(normalizeSidebarChatGroupPath(groupPath)))
      .map(([chatId]) => chatId);
    const orderedPromotedChatIds = orderPromotedChatIds({
      droneId,
      deletedPath: path,
      paths,
      groupByChat: layout.sidebarChatGroupByChat,
      nodeOrderByParent: layout.sidebarChatNodeOrderByParent,
      promotedChatIds,
    });
    const nextAssignments = { ...layout.sidebarChatGroupByChat };
    for (const chatId of promotedChatIds) {
      if (parentPath) nextAssignments[chatId] = parentPath;
      else delete nextAssignments[chatId];
    }
    const nextOrder: Record<string, string[]> = {};
    const parentEntries = cleanStrings(layout.sidebarChatNodeOrderByParent[parentId])
      .filter((id) => !promotedChatIds.includes(id));
    const deletedIndex = parentEntries.indexOf(deletedNodeId);
    const promotedOrder = parentEntries.filter((id) => id !== deletedNodeId);
    promotedOrder.splice(
      deletedIndex >= 0 ? deletedIndex : promotedOrder.length,
      0,
      ...orderedPromotedChatIds,
    );
    for (const [key, entries] of Object.entries(layout.sidebarChatNodeOrderByParent)) {
      if (key === deletedNodeId || key.startsWith(`${deletedNodeId}/`)) continue;
      nextOrder[key] = entries.filter(
        (id) =>
          id !== deletedNodeId &&
          !id.startsWith(`${deletedNodeId}/`) &&
          !promotedChatIds.includes(id),
      );
    }
    if (promotedOrder.length) nextOrder[parentId] = promotedOrder;
    return {
      ...layout,
      sidebarChatGroupPathsByDrone: {
        ...layout.sidebarChatGroupPathsByDrone,
        [droneId]: paths.filter((entry) => !deletedPathSet.has(entry)),
      },
      sidebarChatGroupByChat: nextAssignments,
      sidebarChatNodeOrderByParent: cleanStringMap(nextOrder),
      mutedChatIds: cleanStrings(layout.mutedChatIds).filter(
        (id) => id !== deletedNodeId && !id.startsWith(`${deletedNodeId}/`),
      ),
    };
  }

  const sourcePath = normalizeSidebarChatGroupPath(intent.sourcePath);
  const targetPath = normalizeSidebarChatGroupPath(intent.targetPath);
  const currentFolderPath = intent.itemKind === 'folder'
    ? normalizeSidebarChatGroupPath(
        intent.activeNodeId.slice(`chat-folder:${droneId}:`.length),
      )
    : '';
  if (targetPath && !paths.includes(targetPath)) return layout;
  if (
    intent.itemKind === 'folder' &&
    targetPath &&
    isSameOrDescendantSidebarChatGroupPath(targetPath, currentFolderPath)
  ) return layout;
  const sourceParentId = sourcePath
    ? sidebarChatGroupNodeId(droneId, sourcePath)
    : sidebarChatRootNodeId(droneId);
  const targetParentId = targetPath
    ? sidebarChatGroupNodeId(droneId, targetPath)
    : sidebarChatRootNodeId(droneId);
  const activeNodeIds = intent.itemKind === 'chat'
    ? cleanStrings([...(intent.activeNodeIds ?? []), intent.activeNodeId])
    : [intent.activeNodeId];
  if (
    intent.itemKind === 'chat' &&
    activeNodeIds.some((nodeId) => !nodeId.startsWith(chatNodePrefix))
  ) return layout;
  if (
    intent.itemKind === 'chat' &&
    normalizeSidebarChatGroupPath(layout.sidebarChatGroupByChat[intent.activeNodeId]) !== sourcePath
  ) return layout;
  if (
    intent.itemKind === 'folder' &&
    (
      !currentFolderPath ||
      !paths.includes(currentFolderPath) ||
      intent.activeNodeId !== sidebarChatGroupNodeId(droneId, currentFolderPath) ||
      sourcePath !== normalizeSidebarChatGroupPath(
        sidebarChatGroupParentPath(currentFolderPath),
      )
    )
  ) return layout;
  if (intent.overNodeId && activeNodeIds.includes(intent.overNodeId)) return layout;
  if (
    activeNodeIds.length === 1 &&
    sourceParentId === targetParentId &&
    intent.overNodeId &&
    intent.placement !== 'inside'
  ) {
    return applySidebarReorder(layout, {
      kind: 'chat-tree-entry',
      parentId: sourceParentId,
      siblingNodeIds: intent.sourceSiblingNodeIds,
      activeNodeId: intent.activeNodeId,
      overNodeId: intent.overNodeId,
      placement: intent.placement,
    });
  }
  const nextOrder = moveChatTreeNodeOrder(
    layout.sidebarChatNodeOrderByParent,
    sourceParentId,
    targetParentId,
    intent.sourceSiblingNodeIds,
    intent.targetSiblingNodeIds,
    activeNodeIds,
    intent.overNodeId,
    intent.placement,
  );
  if (intent.itemKind === 'chat') {
    const nextAssignments = { ...layout.sidebarChatGroupByChat };
    for (const nodeId of activeNodeIds) {
      if (targetPath) nextAssignments[nodeId] = targetPath;
      else delete nextAssignments[nodeId];
    }
    return {
      ...layout,
      sidebarChatGroupPathsByDrone: {
        ...layout.sidebarChatGroupPathsByDrone,
        [droneId]: paths,
      },
      sidebarChatGroupByChat: nextAssignments,
      sidebarChatNodeOrderByParent: nextOrder,
    };
  }
  const currentFolderParts = currentFolderPath.split('/');
  const nextFolderPath = [targetPath, currentFolderParts[currentFolderParts.length - 1]].filter(Boolean).join('/');
  if (!currentFolderPath || !nextFolderPath || currentFolderPath === nextFolderPath) {
    return { ...layout, sidebarChatNodeOrderByParent: nextOrder };
  }
  if (paths.includes(nextFolderPath)) return layout;
  const oldNodeId = sidebarChatGroupNodeId(droneId, currentFolderPath);
  const newNodeId = sidebarChatGroupNodeId(droneId, nextFolderPath);
  const rewriteNodeId = (id: string) => id === oldNodeId || id.startsWith(`${oldNodeId}/`)
    ? `${newNodeId}${id.slice(oldNodeId.length)}`
    : id;
  const rewrittenOrder: Record<string, string[]> = {};
  for (const [key, entries] of Object.entries(nextOrder)) {
    const nextKey = rewriteNodeId(key);
    rewrittenOrder[nextKey] = cleanStrings([...(rewrittenOrder[nextKey] ?? []), ...entries.map(rewriteNodeId)]);
  }
  return {
    ...layout,
    sidebarChatGroupPathsByDrone: {
      ...layout.sidebarChatGroupPathsByDrone,
      [droneId]: completeSidebarChatGroupPaths(paths.map((entry) =>
        rewriteSidebarChatGroupPathPrefix(entry, currentFolderPath, nextFolderPath))),
    },
    sidebarChatGroupByChat: Object.fromEntries(
      Object.entries(layout.sidebarChatGroupByChat).map(([chatId, groupPath]) => [
        chatId,
        chatId.startsWith(`chat:${droneId}:`) &&
        isSameOrDescendantSidebarChatGroupPath(groupPath, currentFolderPath)
          ? rewriteSidebarChatGroupPathPrefix(groupPath, currentFolderPath, nextFolderPath)
          : groupPath,
      ]),
    ),
    sidebarChatNodeOrderByParent: rewrittenOrder,
    mutedChatIds: cleanStrings(layout.mutedChatIds).map(rewriteNodeId),
  };
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

function cleanStringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(value)).flatMap(([keyRaw, valueRaw]) => {
      const key = keyRaw.trim();
      const text = String(valueRaw ?? '').trim();
      return key && text ? [[key, text] as const] : [];
    }),
  );
}

function completeSidebarChatGroupPaths(values: unknown): string[] {
  const complete = new Set<string>();
  for (const value of cleanStrings(values)) {
    let path = normalizeSidebarChatGroupPath(value);
    while (path) {
      complete.add(path);
      path = sidebarChatGroupParentPath(path) ?? '';
    }
  }
  return [...complete];
}

function moveChatTreeNodeOrder(
  map: Record<string, string[]>,
  sourceParentId: string,
  targetParentId: string,
  sourceSiblingNodeIds: string[],
  targetSiblingNodeIds: string[],
  activeNodeIds: string[],
  overNodeId: string | undefined,
  placement: SidebarDropPlacement,
): Record<string, string[]> {
  const next = { ...map };
  for (const [parentId, entries] of Object.entries(next)) {
    const filtered = entries.filter((nodeId) => !activeNodeIds.includes(nodeId));
    if (filtered.length) next[parentId] = filtered;
    else delete next[parentId];
  }
  const nextSource = completeSidebarOrder(
    map[sourceParentId] ?? [],
    sourceSiblingNodeIds,
  ).filter((nodeId) => !activeNodeIds.includes(nodeId));
  if (nextSource.length) next[sourceParentId] = nextSource;
  else delete next[sourceParentId];
  const nextTarget = completeSidebarOrder(
    map[targetParentId] ?? [],
    sourceParentId === targetParentId ? nextSource : targetSiblingNodeIds,
  ).filter((nodeId) => !activeNodeIds.includes(nodeId));
  const overIndex = overNodeId ? nextTarget.indexOf(overNodeId) : -1;
  const insertIndex = placement === 'inside' || overIndex < 0
    ? nextTarget.length
    : overIndex + (placement === 'after' ? 1 : 0);
  nextTarget.splice(insertIndex, 0, ...activeNodeIds);
  next[targetParentId] = nextTarget;
  return cleanStringMap(next);
}

function removeChatTreeNodeIds(
  map: Record<string, string[]>,
  nodeIds: readonly string[],
): Record<string, string[]> {
  const removed = new Set(cleanStrings(nodeIds));
  return cleanStringMap(Object.fromEntries(
    Object.entries(map)
      .filter(([parentId]) => !removed.has(parentId))
      .map(([parentId, entries]) => [
        parentId,
        entries.filter((nodeId) => !removed.has(nodeId)),
      ]),
  ));
}

function orderPromotedChatIds(args: {
  droneId: string;
  deletedPath: string;
  paths: readonly string[];
  groupByChat: Readonly<Record<string, string>>;
  nodeOrderByParent: Readonly<Record<string, readonly string[]>>;
  promotedChatIds: readonly string[];
}): string[] {
  const promotedSet = new Set(args.promotedChatIds);
  const seenChats = new Set<string>();
  const seenPaths = new Set<string>();
  const ordered: string[] = [];
  const pathByNodeId = new Map(
    args.paths.map((path) => [sidebarChatGroupNodeId(args.droneId, path), path]),
  );
  const directChatsByPath = new Map<string, string[]>();
  for (const chatId of args.promotedChatIds) {
    const groupPath = normalizeSidebarChatGroupPath(args.groupByChat[chatId]);
    const chats = directChatsByPath.get(groupPath) ?? [];
    chats.push(chatId);
    directChatsByPath.set(groupPath, chats);
  }
  const childPathsByParent = new Map<string, string[]>();
  for (const path of args.paths) {
    if (!isSameOrDescendantSidebarChatGroupPath(path, args.deletedPath) || path === args.deletedPath) {
      continue;
    }
    const parentPath = sidebarChatGroupParentPath(path) ?? '';
    const children = childPathsByParent.get(parentPath) ?? [];
    children.push(path);
    childPathsByParent.set(parentPath, children);
  }
  const appendChat = (chatId: string) => {
    if (!promotedSet.has(chatId) || seenChats.has(chatId)) return;
    seenChats.add(chatId);
    ordered.push(chatId);
  };
  const visitPath = (path: string) => {
    if (seenPaths.has(path)) return;
    seenPaths.add(path);
    const parentId = sidebarChatGroupNodeId(args.droneId, path);
    for (const nodeId of cleanStrings(args.nodeOrderByParent[parentId])) {
      const childPath = pathByNodeId.get(nodeId);
      if (childPath && sidebarChatGroupParentPath(childPath) === path) visitPath(childPath);
      else appendChat(nodeId);
    }
    for (const chatId of directChatsByPath.get(path) ?? []) appendChat(chatId);
    for (const childPath of childPathsByParent.get(path) ?? []) visitPath(childPath);
  };
  visitPath(args.deletedPath);
  for (const chatId of args.promotedChatIds) appendChat(chatId);
  return ordered;
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
