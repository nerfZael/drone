import { buildRepoSidebarModel, sidebarFolderNodeId } from '@drone/hub-model';

type SidebarGroup = {
  id: string;
  repoPath: string;
  name: string;
  parentId: string | null;
  createdAt: string | null;
};

type SidebarDrone = {
  id?: string | null;
  name?: string | null;
  group?: string | null;
  groupId?: string | null;
  repoPath?: string | null;
  fleetParentId?: string | null;
  createdAt?: string | null;
};

export function placeMcpRepoScopedGroupNodeAtTop(args: {
  nodeOrderByParent: Record<string, string[]>;
  groupOrder: string[];
  droneOrderByGroup: Record<string, string[]>;
  groups: SidebarGroup[];
  drones: SidebarDrone[];
  group: SidebarGroup;
}): Record<string, string[]> {
  const repoGroup = repoGroupPath(args.group.repoPath);
  const repoGroups = args.groups.filter((candidate) => candidate.repoPath === args.group.repoPath);
  const groupPaths = repoGroups.map((group) => group.name);
  const groupIdByPath = Object.fromEntries(repoGroups.map((group) => [group.name, group.id]));
  const groupCreatedAtByPath = Object.fromEntries(
    repoGroups.map((group) => [group.name, group.createdAt]),
  );
  const drones = args.drones.flatMap((drone) => {
    const id = text(drone.id);
    if (!id) return [];
    return [{ ...drone, id, name: text(drone.name) || id }];
  });
  const model = buildRepoSidebarModel({
    drones,
    activeRepoPath: args.group.repoPath || undefined,
    registeredRepoPaths: args.group.repoPath ? [args.group.repoPath] : [],
    sidebarGroupOrder: args.groupOrder,
    sidebarDroneOrderByGroup: args.droneOrderByGroup,
    sidebarNodeOrderByParent: args.nodeOrderByParent,
    repoScopedGroupPathsByRepoGroup: { [repoGroup]: groupPaths },
    repoScopedGroupIdByPathByRepoGroup: { [repoGroup]: groupIdByPath },
    repoScopedGroupCreatedAtByPathByRepoGroup: {
      [repoGroup]: groupCreatedAtByPath,
    },
  });
  const parentGroup = args.group.parentId
    ? (repoGroups.find((candidate) => candidate.id === args.group.parentId) ?? null)
    : null;
  const parentId = parentGroup
    ? repoScopedFolderNodeId(args.group.repoPath, parentGroup.name)
    : sidebarFolderNodeId(repoGroup);
  const nodeId = repoScopedFolderNodeId(args.group.repoPath, args.group.name);
  const visibleIds = model.nodeTree.childIdsByParent[parentId] ?? [];
  const visibleIdSet = new Set(visibleIds);
  const hiddenIds = uniqueStrings(args.nodeOrderByParent[parentId] ?? []).filter(
    (candidate) => !visibleIdSet.has(candidate),
  );
  return {
    ...args.nodeOrderByParent,
    [parentId]: uniqueStrings([
      nodeId,
      ...visibleIds.filter((candidate) => candidate !== nodeId),
      ...hiddenIds,
    ]),
  };
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.map(text).filter(Boolean))];
}

function repoGroupPath(repoPath: string): string {
  return repoPath ? `repo:${repoPath}` : 'repo:ungrouped';
}

function repoScopedFolderNodeId(repoPath: string, groupPath: string): string {
  return sidebarFolderNodeId(`repo-scope:${repoGroupPath(repoPath)}:${groupPath}`);
}
