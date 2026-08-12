import { sidebarGroupOrderToken } from './sidebar-group-order';
import type { SidebarNodeTreeModel, SidebarTreeFolderNode } from './sidebar-node-tree';

export function sidebarFolderMuteId(node: SidebarTreeFolderNode): string {
  return sidebarGroupOrderToken({
    groupId: node.groupId,
    group: node.groupPath ?? node.path,
    kind: node.groupKind,
  });
}

export function resolveEffectiveSidebarMuteSets(
  nodeTree: SidebarNodeTreeModel,
  mutedSidebarGroupIds: ReadonlySet<string>,
  mutedDroneIds: ReadonlySet<string>,
): {
  effectiveMutedSidebarGroupIdSet: Set<string>;
  effectiveMutedDroneIdSet: Set<string>;
} {
  const effectiveGroups = new Set<string>();
  const effectiveDrones = new Set(mutedDroneIds);
  const visit = (nodeId: string, inheritedMuted: boolean) => {
    const node = nodeTree.nodesById[nodeId];
    if (!node) return;
    if (node.kind === 'drone') {
      const muted = inheritedMuted || effectiveDrones.has(node.droneId);
      if (muted) effectiveDrones.add(node.droneId);
      for (const childId of nodeTree.childIdsByParent[node.id] ?? []) visit(childId, muted);
      return;
    }
    const muted = inheritedMuted || mutedSidebarGroupIds.has(sidebarFolderMuteId(node));
    if (muted) effectiveGroups.add(node.id);
    for (const childId of nodeTree.childIdsByParent[node.id] ?? []) visit(childId, muted);
  };
  for (const rootId of nodeTree.rootChildIds) visit(rootId, false);
  return {
    effectiveMutedSidebarGroupIdSet: effectiveGroups,
    effectiveMutedDroneIdSet: effectiveDrones,
  };
}
