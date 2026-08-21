import { isUngroupedGroupName } from '../../domain';
import {
  sidebarGroupBaseName,
  sidebarGroupParentPath,
} from './sidebar-group-paths';
import type { SidebarNodeTreeModel } from './sidebar-node-tree';
import { sidebarDroneNodeId } from './sidebar-node-order';

export type SidebarGroupDraftLocation = {
  parentPath: string | null;
  beforeNodeId: string | null;
  siblingNames: string[];
};

export function resolveSidebarGroupDraftLocation(args: {
  selectedSidebarNodeId?: string | null;
  selectedDroneId?: string | null;
  nodeTree?: SidebarNodeTreeModel | null;
  visibleFolderPaths: Iterable<string>;
}): SidebarGroupDraftLocation {
  const paths = Array.from(args.visibleFolderPaths, (path) => String(path ?? '').trim()).filter(Boolean);
  const selectedSidebarNodeId = String(args.selectedSidebarNodeId ?? '').trim();
  const selectedDroneId = String(args.selectedDroneId ?? '').trim();
  const nodeTree = args.nodeTree ?? null;
  let anchorNode = selectedSidebarNodeId ? nodeTree?.nodesById[selectedSidebarNodeId] : null;
  if (!anchorNode && selectedSidebarNodeId.startsWith('chat:') && selectedDroneId) {
    anchorNode = nodeTree?.nodesById[sidebarDroneNodeId(selectedDroneId)] ?? null;
  }

  while (anchorNode?.kind === 'drone') {
    const parent = nodeTree?.nodesById[anchorNode.parentId];
    if (!parent || parent.kind !== 'drone') break;
    anchorNode = parent;
  }

  const parentNode = anchorNode ? nodeTree?.nodesById[anchorNode.parentId] : null;
  const parentPath =
    parentNode?.kind === 'folder' ? String(parentNode.groupPath ?? '').trim() || null : null;
  const beforeNodeId = anchorNode?.id ?? null;

  return {
    parentPath,
    beforeNodeId,
    siblingNames: paths
      .filter((path) => sidebarGroupParentPath(path) === parentPath)
      .map(sidebarGroupBaseName),
  };
}

export type SidebarDroneDraftLocation = {
  group: string;
  repoPath?: string;
};

function repoPathFromSidebarGroupPath(repoGroupPathRaw: string): string | null {
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  if (!repoGroupPath) return null;
  if (repoGroupPath === 'repo:ungrouped') return '';
  return repoGroupPath.startsWith('repo:') ? repoGroupPath.slice('repo:'.length) : null;
}

export function resolveSidebarDroneDraftLocation(args: {
  selectedSidebarNodeId?: string | null;
  nodeTree?: SidebarNodeTreeModel | null;
  selectedFolderPath: string | null;
  visibleFolderPaths: Iterable<string>;
  selectedDrone?: {
    group?: string | null;
    repoAttached?: boolean;
    repoPath?: string | null;
  } | null;
  fallbackRepoPath?: string | null;
}): SidebarDroneDraftLocation {
  const visibleFolderPathSet = new Set(
    Array.from(args.visibleFolderPaths, (path) => String(path ?? '').trim()).filter(Boolean),
  );
  const selectedFolderPath = String(args.selectedFolderPath ?? '').trim();
  const selectedSidebarNodeId = String(args.selectedSidebarNodeId ?? '').trim();
  const selectedNode = selectedSidebarNodeId
    ? args.nodeTree?.nodesById[selectedSidebarNodeId]
    : null;
  const selectedNodeRepoPath = repoPathFromSidebarGroupPath(
    selectedNode?.repoGroupPath ?? '',
  );
  if (selectedNode && selectedNodeRepoPath != null) {
    const rawNodeGroup = String(selectedNode.groupPath ?? '').trim();
    return {
      group: !rawNodeGroup || isUngroupedGroupName(rawNodeGroup) ? '' : rawNodeGroup,
      repoPath: selectedNodeRepoPath,
    };
  }
  const selectedDroneGroupRaw = String(args.selectedDrone?.group ?? '').trim();
  const selectedDroneGroup = isUngroupedGroupName(selectedDroneGroupRaw)
    ? ''
    : selectedDroneGroupRaw;
  const group =
    selectedFolderPath && visibleFolderPathSet.has(selectedFolderPath)
      ? selectedFolderPath
      : selectedDroneGroup && visibleFolderPathSet.has(selectedDroneGroup)
        ? selectedDroneGroup
        : '';
  const selectedDroneRepoPath = String(args.selectedDrone?.repoPath ?? '').trim();
  const selectedDroneRepoAttached =
    args.selectedDrone?.repoAttached ?? Boolean(selectedDroneRepoPath);
  const repoPath = args.selectedDrone
    ? selectedDroneRepoAttached
      ? selectedDroneRepoPath
      : ''
    : String(args.fallbackRepoPath ?? '').trim();

  return {
    group,
    ...(repoPath ? { repoPath } : {}),
  };
}
