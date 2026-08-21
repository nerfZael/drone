import type { SidebarMoveIntent } from '@drone/hub-model/sidebar';
import type { DroneHubDragData } from './drone-hub-dnd';
import { canReorderSidebarDroneSelectionAtParent } from './sidebar-drone-drop';
import {
  orderSidebarEntries,
  type SidebarGroupDropPlacement,
} from './sidebar-group-order';
import { SIDEBAR_ROOT_PARENT_ID, sidebarDroneNodeId } from './sidebar-node-order';
import type {
  SidebarNodeTreeModel,
  SidebarTreeFolderNode,
  SidebarTreeNode,
} from './sidebar-node-tree';
import { normalizeSidebarReorderTarget } from './sidebar-reorder-ui';
import type { DroneSummary } from '../types';

export type SidebarTreeDropPlacement = SidebarGroupDropPlacement | 'into';

export type SidebarTreeDropTarget = {
  nodeId: string;
  placement: SidebarTreeDropPlacement;
};

export type SidebarChatDropTarget = {
  key: string;
  placement: SidebarGroupDropPlacement;
};

export type SidebarDropTarget =
  | {
      kind: 'tree-node';
      nodeId: string;
      placement: SidebarTreeDropPlacement;
    }
  | {
      kind: 'folder-body';
      folderNodeId: string;
      insertionTarget: SidebarTreeDropTarget | null;
    }
  | {
      kind: 'chat';
      droneId: string;
      chatName: string;
      placement: SidebarGroupDropPlacement;
    }
  | {
      kind: 'drone-tail';
      nodeId: string;
    };

export type SidebarDropPlan = {
  treeTarget: SidebarTreeDropTarget | null;
  folderBodyId: string | null;
  chatTarget: SidebarChatDropTarget | null;
  intent: SidebarMoveIntent | null;
};

export function planSidebarDrop({
  active,
  target,
  nodeTree,
  droneById,
  sidebarChatOrderByDrone,
  preferredTreeTarget,
  preferredChatTarget,
}: {
  active: DroneHubDragData | null;
  target: SidebarDropTarget | null;
  nodeTree: SidebarNodeTreeModel;
  droneById: Record<string, DroneSummary>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  preferredTreeTarget?: SidebarTreeDropTarget | null;
  preferredChatTarget?: SidebarChatDropTarget | null;
}): SidebarDropPlan | null {
  if (!active || !target) return null;

  const activeFolderNode =
    active.type === 'sidebar-folder' ? nodeTree.nodesById[active.folderNodeId] : null;
  if (isVirtualRepoRootNode(activeFolderNode)) {
    return planRepoRootReorder(activeFolderNode, target, nodeTree, preferredTreeTarget);
  }
  if (active.type === 'sidebar-chat') {
    return planChatReorder(
      active,
      target,
      droneById,
      sidebarChatOrderByDrone,
      preferredChatTarget,
    );
  }
  if (active.type !== 'sidebar-drone' && active.type !== 'sidebar-folder') return null;

  const resolvedTarget = resolveTreeTarget(target, nodeTree, preferredTreeTarget);
  if (!resolvedTarget) return null;

  const targetNode = nodeTree.nodesById[resolvedTarget.nodeId];
  const sourceNodeId =
    active.type === 'sidebar-drone' ? sidebarDroneNodeId(active.droneId) : active.folderNodeId;
  const sourceNode = nodeTree.nodesById[sourceNodeId];
  const preview = treePreview(target, resolvedTarget);
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
    return { ...preview, intent: null };
  }
  const sourceRepoGroupPath = sidebarTreeNodeRepoGroupPath(sourceNode);
  const targetRepoGroupPath = sidebarTreeNodeRepoGroupPath(targetNode);
  if (
    sourceRepoGroupPath &&
    targetRepoGroupPath &&
    sourceRepoGroupPath !== targetRepoGroupPath
  ) {
    return null;
  }

  const targetParentId =
    resolvedTarget.placement === 'into' && targetNode.kind === 'folder'
      ? targetNode.id
      : targetNode.parentId;
  const targetParentNode =
    targetParentId === SIDEBAR_ROOT_PARENT_ID ? null : nodeTree.nodesById[targetParentId];
  const sourceParentId = sourceNode.parentId;
  const sourceSiblingNodeIds = nodeTree.childIdsByParent[sourceParentId] ?? [];
  const targetSiblingNodeIds = nodeTree.childIdsByParent[targetParentId] ?? [];

  if (active.type === 'sidebar-drone') {
    const movingDroneIds = uniqueStrings(active.droneIds);
    const targetParentDroneId =
      targetParentNode?.kind === 'drone' ? targetParentNode.droneId : null;
    if (
      !canReorderSidebarDroneSelectionAtParent(
        droneById,
        movingDroneIds,
        targetParentDroneId,
      )
    ) {
      return null;
    }
    if (
      movingDroneIds.length === 1 &&
      sourceParentId === targetParentId &&
      resolvedTarget.placement !== 'into'
    ) {
      return {
        ...preview,
        intent: {
          kind: 'tree-entry',
          parentId: sourceParentId,
          siblingNodeIds: sourceSiblingNodeIds,
          activeNodeId: sourceNode.id,
          overNodeId: targetNode.id,
          placement: resolvedTarget.placement,
        },
      };
    }

    const primaryDroneId = movingDroneIds[0];
    if (!primaryDroneId) return null;
    const targetGroupRaw = targetParentDroneId
      ? droneById[targetParentDroneId]?.group
      : folderTargetGroupPath(targetParentNode);
    return {
      ...preview,
      intent: {
        kind: 'move-into-folder',
        itemKind: 'drone',
        repoPath: String(droneById[primaryDroneId]?.repoPath ?? '').trim(),
        droneId: primaryDroneId,
        droneIds: movingDroneIds,
        targetParentDroneId,
        sourceParentId,
        sourceSiblingNodeIds,
        targetGroup: normalizeTargetGroup(targetGroupRaw),
        targetParentId,
        targetSiblingNodeIds,
        ...(resolvedTarget.placement === 'into'
          ? {}
          : { targetOverNodeId: targetNode.id }),
        placement: commandPlacement(resolvedTarget.placement),
      },
    };
  }

  if (sourceNode.kind !== 'folder') return { ...preview, intent: null };
  if (sourceParentId === targetParentId && resolvedTarget.placement !== 'into') {
    return {
      ...preview,
      intent: {
        kind: 'tree-entry',
        parentId: sourceParentId,
        siblingNodeIds: sourceSiblingNodeIds,
        activeNodeId: sourceNode.id,
        overNodeId: targetNode.id,
        placement: resolvedTarget.placement,
      },
    };
  }
  return {
    ...preview,
    intent: {
      kind: 'move-into-folder',
      itemKind: 'folder',
      repoPath: repoPathFromGroupPath(sourceNode.repoGroupPath),
      sourceGroupId: active.groupId ?? sourceNode.groupId ?? null,
      sourceGroup: active.folderPath,
      sourceNodeId: sourceNode.id,
      sourceParentId,
      sourceSiblingNodeIds,
      targetGroup: folderTargetGroupPath(targetParentNode),
      targetParentId,
      targetSiblingNodeIds,
      ...(resolvedTarget.placement === 'into'
        ? {}
        : { targetOverNodeId: targetNode.id }),
      placement: commandPlacement(resolvedTarget.placement),
    },
  };
}

function repoPathFromGroupPath(repoGroupPathRaw: string | null | undefined): string {
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  if (!repoGroupPath || repoGroupPath === 'repo:ungrouped') return '';
  return repoGroupPath.replace(/^repo:/, '');
}

function sidebarTreeNodeRepoGroupPath(node: SidebarTreeNode): string | null {
  if (isVirtualRepoRootNode(node)) return node.path;
  return String(node.repoGroupPath ?? '').trim() || null;
}

export function sidebarNodeAllowsDropInside(
  node: SidebarTreeNode | null | undefined,
): boolean {
  return Boolean(node?.kind === 'folder' && !isVirtualRepoRootNode(node));
}

function planRepoRootReorder(
  sourceNode: SidebarTreeFolderNode,
  target: SidebarDropTarget,
  nodeTree: SidebarNodeTreeModel,
  preferredTarget: SidebarTreeDropTarget | null | undefined,
): SidebarDropPlan | null {
  if (target.kind !== 'tree-node') return null;
  const hoveredNode = nodeTree.nodesById[target.nodeId];
  if (!isVirtualRepoRootNode(hoveredNode) || hoveredNode.id === sourceNode.id) return null;
  const resolvedTarget = preferredTarget ?? normalizeTreeTarget(nodeTree, target);
  const targetNode = resolvedTarget && nodeTree.nodesById[resolvedTarget.nodeId];
  if (
    !resolvedTarget ||
    !isVirtualRepoRootNode(targetNode) ||
    resolvedTarget.placement === 'into'
  ) {
    return null;
  }
  return {
    treeTarget: resolvedTarget,
    folderBodyId: null,
    chatTarget: null,
    intent: {
      kind: 'tree-entry',
      parentId: sourceNode.parentId,
      siblingNodeIds: nodeTree.childIdsByParent[sourceNode.parentId] ?? [],
      activeNodeId: sourceNode.id,
      overNodeId: targetNode.id,
      placement: resolvedTarget.placement,
    },
  };
}

function planChatReorder(
  active: Extract<DroneHubDragData, { type: 'sidebar-chat' }>,
  target: SidebarDropTarget,
  droneById: Record<string, DroneSummary>,
  sidebarChatOrderByDrone: Record<string, string[]>,
  preferredTarget: SidebarChatDropTarget | null | undefined,
): SidebarDropPlan | null {
  if (
    target.kind !== 'chat' ||
    target.droneId !== active.droneId ||
    target.chatName === active.chatName
  ) {
    return null;
  }
  const chatNames = orderSidebarEntries(
    uniqueStrings(droneById[active.droneId]?.chats ?? []),
    sidebarChatOrderByDrone[active.droneId] ?? [],
    (chat) => chat,
  );
  const preferredPrefix = `${active.droneId}:`;
  const preferredChatName = preferredTarget?.key.startsWith(preferredPrefix)
    ? preferredTarget.key.slice(preferredPrefix.length) || target.chatName
    : null;
  const normalized = normalizeSidebarReorderTarget(
    chatNames,
    preferredChatName ?? target.chatName,
    preferredChatName ? preferredTarget!.placement : target.placement,
  );
  const chatTarget = {
    key: `${active.droneId}:${normalized.overId || target.chatName}`,
    placement: normalized.placement,
  };
  return {
    treeTarget: null,
    folderBodyId: null,
    chatTarget,
    intent: {
      kind: 'chat',
      droneId: active.droneId,
      chatNames,
      activeChatName: active.chatName,
      overChatName: normalized.overId || target.chatName,
      placement: normalized.placement,
    },
  };
}

function resolveTreeTarget(
  target: SidebarDropTarget,
  nodeTree: SidebarNodeTreeModel,
  preferredTarget: SidebarTreeDropTarget | null | undefined,
): SidebarTreeDropTarget | null {
  if (target.kind === 'folder-body') {
    const folderNode = nodeTree.nodesById[target.folderNodeId];
    if (!folderNode || folderNode.kind !== 'folder') return null;
    const insertionNode = target.insertionTarget
      ? nodeTree.nodesById[target.insertionTarget.nodeId]
      : null;
    return insertionNode?.parentId === folderNode.id
      ? target.insertionTarget
      : { nodeId: folderNode.id, placement: 'into' };
  }
  const fallbackTarget =
    target.kind === 'chat'
      ? normalizeTreeTarget(nodeTree, {
          nodeId: sidebarDroneNodeId(target.droneId),
          placement: 'after',
        })
      : target.kind === 'drone-tail'
        ? normalizeTreeTarget(nodeTree, { nodeId: target.nodeId, placement: 'after' })
        : normalizeTreeTarget(nodeTree, target);
  return fallbackTarget ? preferredTarget ?? fallbackTarget : null;
}

function normalizeTreeTarget(
  nodeTree: SidebarNodeTreeModel,
  target: SidebarTreeDropTarget,
): SidebarTreeDropTarget | null {
  const nodeId = String(target.nodeId ?? '').trim();
  const node = nodeTree.nodesById[nodeId];
  if (!node) return null;
  if (target.placement === 'into') return { nodeId, placement: target.placement };
  const normalized = normalizeSidebarReorderTarget(
    nodeTree.childIdsByParent[node.parentId] ?? [],
    nodeId,
    target.placement,
  );
  return {
    nodeId: normalized.overId || nodeId,
    placement: normalized.placement,
  };
}

function treePreview(
  target: SidebarDropTarget,
  resolvedTarget: SidebarTreeDropTarget,
): Omit<SidebarDropPlan, 'intent'> {
  const highlightFolderBody = target.kind === 'folder-body' && resolvedTarget.placement === 'into';
  return {
    treeTarget: highlightFolderBody ? null : resolvedTarget,
    folderBodyId: highlightFolderBody ? target.folderNodeId : null,
    chatTarget: null,
  };
}

function folderTargetGroupPath(node: SidebarTreeNode | null | undefined): string | null {
  if (!node || node.kind !== 'folder') return null;
  if (node.groupKind === 'repo' && !node.groupPath) return null;
  return String(node.groupPath ?? node.path ?? '').trim() || null;
}

function isVirtualRepoRootNode(
  node: SidebarTreeNode | null | undefined,
): node is SidebarTreeFolderNode {
  return Boolean(node?.kind === 'folder' && node.groupKind === 'repo' && !node.groupPath);
}

function normalizeTargetGroup(value: string | null | undefined): string | null {
  const group = String(value ?? '').trim();
  return !group || group.toLowerCase() === 'ungrouped' ? null : group;
}

function commandPlacement(placement: SidebarTreeDropPlacement): 'before' | 'inside' | 'after' {
  return placement === 'into' ? 'inside' : placement;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}
