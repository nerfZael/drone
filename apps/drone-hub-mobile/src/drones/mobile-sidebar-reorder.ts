import {
  isSameOrDescendantSidebarGroupPath,
  joinSidebarGroupPath,
  normalizeSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
  sidebarDroneNodeId,
  sidebarGroupBaseName,
} from '@drone/hub-model/sidebar';
import type { MobileDroneSidebarOrder, MobileDroneSummary } from './drone-sidebar-model';

export type MobileSidebarDropPlacement = 'before' | 'inside' | 'after';

export type MobileSidebarReorderRequest =
  | {
      kind: 'tree-entry';
      parentId: string;
      siblingNodeIds: string[];
      activeNodeId: string;
      overNodeId: string;
      placement: Exclude<MobileSidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'drone';
      parentId: string;
      siblingDroneIds: string[];
      activeDroneId: string;
      overDroneId: string;
      placement: Exclude<MobileSidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'chat';
      droneId: string;
      chatNames: string[];
      activeChatName: string;
      overChatName: string;
      placement: Exclude<MobileSidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'pinned-drone';
      visibleDroneIds: string[];
      activeDroneId: string;
      overDroneId: string;
      placement: Exclude<MobileSidebarDropPlacement, 'inside'>;
    };

export type MobileSidebarMoveIntoFolderRequest =
  | {
      kind: 'move-into-folder';
      itemKind: 'drone';
      repoPath: string;
      droneId: string;
      sourceParentId: string;
      sourceSiblingNodeIds: string[];
      targetGroup: string | null;
      targetParentId: string;
      targetSiblingNodeIds: string[];
      targetOverNodeId?: string;
      placement?: MobileSidebarDropPlacement;
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
      placement?: MobileSidebarDropPlacement;
    };

export type MobileSidebarMutationRequest =
  | MobileSidebarReorderRequest
  | MobileSidebarMoveIntoFolderRequest;

export type MobileSidebarPreferencePatch = Partial<
  Pick<
    MobileDroneSidebarOrder,
    'sidebarNodeOrderByParent' | 'sidebarChatOrderByDrone' | 'pinnedDroneIds'
  >
>;

export function mobileSidebarPreferencePatch(
  order: MobileDroneSidebarOrder,
  request: MobileSidebarMutationRequest,
): MobileSidebarPreferencePatch {
  if (request.kind === 'chat') {
    return { sidebarChatOrderByDrone: order.sidebarChatOrderByDrone };
  }
  if (request.kind === 'pinned-drone') {
    return { pinnedDroneIds: order.pinnedDroneIds };
  }
  return { sidebarNodeOrderByParent: order.sidebarNodeOrderByParent };
}

export function firstMobileSidebarInsertionTarget(
  childNodeIds: readonly string[] | undefined,
  activeNodeId: string,
): string | undefined {
  return childNodeIds?.find((nodeId) => nodeId !== activeNodeId);
}

function normalizedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

export function reorderMobileSidebarEntries(
  currentOrder: readonly string[],
  visibleEntries: readonly string[],
  activeEntry: string,
  overEntry: string,
  placement: Exclude<MobileSidebarDropPlacement, 'inside'>,
): string[] {
  const active = String(activeEntry ?? '').trim();
  const over = String(overEntry ?? '').trim();
  const visible = normalizedStrings(visibleEntries);
  const current = normalizedStrings(currentOrder);
  if (!active || !over || active === over || !visible.includes(active) || !visible.includes(over)) {
    return current;
  }

  const reorderedVisible = visible.filter((entry) => entry !== active);
  const overIndex = reorderedVisible.indexOf(over);
  if (overIndex < 0) return current;
  reorderedVisible.splice(placement === 'before' ? overIndex : overIndex + 1, 0, active);

  const visibleSet = new Set(visible);
  let visibleIndex = 0;
  const merged = current.map((entry) =>
    visibleSet.has(entry) ? (reorderedVisible[visibleIndex++] ?? entry) : entry,
  );
  return [...merged, ...reorderedVisible.slice(visibleIndex)];
}

export function applyMobileSidebarReorder(
  order: MobileDroneSidebarOrder,
  request: MobileSidebarReorderRequest,
): MobileDroneSidebarOrder {
  if (request.kind === 'tree-entry') {
    return {
      ...order,
      sidebarNodeOrderByParent: {
        ...order.sidebarNodeOrderByParent,
        [request.parentId]: reorderMobileSidebarEntries(
          order.sidebarNodeOrderByParent[request.parentId] ?? [],
          request.siblingNodeIds,
          request.activeNodeId,
          request.overNodeId,
          request.placement,
        ),
      },
    };
  }
  if (request.kind === 'chat') {
    const nextChatOrder = reorderMobileSidebarEntries(
      order.sidebarChatOrderByDrone[request.droneId] ?? [],
      request.chatNames,
      request.activeChatName,
      request.overChatName,
      request.placement,
    );
    return {
      ...order,
      sidebarChatOrderByDrone: {
        ...order.sidebarChatOrderByDrone,
        [request.droneId]: nextChatOrder,
      },
    };
  }

  if (request.kind === 'pinned-drone') {
    return {
      ...order,
      pinnedDroneIds: reorderMobileSidebarEntries(
        order.pinnedDroneIds,
        request.visibleDroneIds,
        request.activeDroneId,
        request.overDroneId,
        request.placement,
      ),
    };
  }

  const visibleNodeIds = request.siblingDroneIds.map(sidebarDroneNodeId);
  const nextNodeOrder = reorderMobileSidebarEntries(
    order.sidebarNodeOrderByParent[request.parentId] ?? [],
    visibleNodeIds,
    sidebarDroneNodeId(request.activeDroneId),
    sidebarDroneNodeId(request.overDroneId),
    request.placement,
  );
  return {
    ...order,
    sidebarNodeOrderByParent: {
      ...order.sidebarNodeOrderByParent,
      [request.parentId]: nextNodeOrder,
    },
  };
}

function withoutNode(values: readonly string[], nodeId: string): string[] {
  return normalizedStrings(values).filter((value) => value !== nodeId);
}

function moveNodeOrderIntoFolder(
  map: Record<string, string[]>,
  sourceParentId: string,
  sourceVisibleNodeIds: readonly string[],
  targetParentId: string,
  targetVisibleNodeIds: readonly string[],
  sourceNodeId: string,
  targetNodeId: string,
  overNodeId?: string,
  placement: MobileSidebarDropPlacement = 'inside',
): Record<string, string[]> {
  const next = { ...map };
  const sourceVisible = withoutNode(sourceVisibleNodeIds, sourceNodeId);
  const sourceVisibleSet = new Set(normalizedStrings(sourceVisibleNodeIds));
  const hiddenSource = withoutNode(map[sourceParentId] ?? [], sourceNodeId).filter(
    (nodeId) => !sourceVisibleSet.has(nodeId),
  );
  const nextSource = [...sourceVisible, ...hiddenSource];
  if (nextSource.length > 0) next[sourceParentId] = nextSource;
  else delete next[sourceParentId];

  const targetVisible = withoutNode(targetVisibleNodeIds, sourceNodeId);
  const targetVisibleSet = new Set(normalizedStrings(targetVisibleNodeIds));
  const hiddenTarget = withoutNode(map[targetParentId] ?? [], sourceNodeId).filter(
    (nodeId) => !targetVisibleSet.has(nodeId),
  );
  const overIndex = overNodeId ? targetVisible.indexOf(overNodeId) : -1;
  const insertIndex =
    placement === 'inside' || overIndex < 0
      ? targetVisible.length
      : overIndex + (placement === 'after' ? 1 : 0);
  targetVisible.splice(insertIndex, 0, targetNodeId);
  next[targetParentId] = normalizedStrings([...targetVisible, ...hiddenTarget]);
  return next;
}

function rewriteFolderNodeOrder(
  map: Record<string, string[]>,
  sourceNodeId: string,
  targetNodeId: string,
): Record<string, string[]> {
  const rewriteNodeId = (nodeId: string) =>
    nodeId === sourceNodeId
      ? targetNodeId
      : nodeId.startsWith(`${sourceNodeId}/`)
        ? `${targetNodeId}/${nodeId.slice(sourceNodeId.length + 1)}`
        : nodeId;
  const rewritten: Record<string, string[]> = {};
  for (const [parentId, entries] of Object.entries(map)) {
    const nextParentId = rewriteNodeId(parentId);
    const nextEntries = entries.map(rewriteNodeId);
    rewritten[nextParentId] = normalizedStrings([
      ...(rewritten[nextParentId] ?? []),
      ...nextEntries,
    ]);
  }
  return rewritten;
}

export function mobileSidebarMoveDestination(
  request: MobileSidebarMoveIntoFolderRequest,
): { targetGroup: string | null; nextGroup: string | null } | null {
  const targetGroup = normalizeSidebarGroupPath(request.targetGroup) || null;
  if (request.itemKind === 'drone') return { targetGroup, nextGroup: null };
  const sourceGroup = normalizeSidebarGroupPath(request.sourceGroup);
  if (
    !sourceGroup ||
    (targetGroup != null &&
      (sourceGroup === targetGroup || isSameOrDescendantSidebarGroupPath(targetGroup, sourceGroup)))
  ) {
    return null;
  }
  const nextGroup = joinSidebarGroupPath([targetGroup, sidebarGroupBaseName(sourceGroup)]);
  return nextGroup && nextGroup !== sourceGroup ? { targetGroup, nextGroup } : null;
}

export function applyMobileSidebarMoveIntoFolder(
  order: MobileDroneSidebarOrder,
  request: MobileSidebarMoveIntoFolderRequest,
): MobileDroneSidebarOrder {
  const destination = mobileSidebarMoveDestination(request);
  if (!destination) return order;
  const targetParentId = request.targetParentId;
  if (request.itemKind === 'drone') {
    const nodeId = sidebarDroneNodeId(request.droneId);
    return {
      ...order,
      sidebarNodeOrderByParent: moveNodeOrderIntoFolder(
        order.sidebarNodeOrderByParent,
        request.sourceParentId,
        request.sourceSiblingNodeIds,
        targetParentId,
        request.targetSiblingNodeIds,
        nodeId,
        nodeId,
        request.targetOverNodeId,
        request.placement,
      ),
    };
  }

  const sourceNodeId = request.sourceNodeId;
  const sourceGroup = normalizeSidebarGroupPath(request.sourceGroup);
  const sourceNodePrefix = sourceNodeId.endsWith(sourceGroup)
    ? sourceNodeId.slice(0, -sourceGroup.length)
    : 'folder:';
  const targetNodeId = `${sourceNodePrefix}${destination.nextGroup!}`;
  const moved = moveNodeOrderIntoFolder(
    order.sidebarNodeOrderByParent,
    request.sourceParentId,
    request.sourceSiblingNodeIds,
    targetParentId,
    request.targetSiblingNodeIds,
    sourceNodeId,
    targetNodeId,
    request.targetOverNodeId,
    request.placement,
  );
  return {
    ...order,
    sidebarNodeOrderByParent: rewriteFolderNodeOrder(moved, sourceNodeId, targetNodeId),
  };
}

export function applyOptimisticMobileSidebarMove(
  drones: MobileDroneSummary[],
  request: MobileSidebarMoveIntoFolderRequest,
): MobileDroneSummary[] {
  const destination = mobileSidebarMoveDestination(request);
  if (!destination) return drones;
  if (request.itemKind === 'drone') {
    return drones.map((drone) =>
      drone.id === request.droneId ? { ...drone, group: destination.targetGroup } : drone,
    );
  }
  return drones.map((drone) => {
    if (
      drone.repoPath !== request.repoPath ||
      !isSameOrDescendantSidebarGroupPath(drone.group, request.sourceGroup)
    ) {
      return drone;
    }
    return {
      ...drone,
      group: rewriteSidebarGroupPathPrefix(
        drone.group,
        request.sourceGroup,
        destination.nextGroup!,
      ),
    };
  });
}
