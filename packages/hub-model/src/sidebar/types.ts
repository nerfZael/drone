export type SidebarTreeGroupKind = 'group' | 'repo';

export type SidebarTreeDrone = {
  id: string;
  name: string;
  group?: string | null;
  repoPath?: string | null;
  fleetParentId?: string | null;
  createdAt?: string | null;
};

export type SidebarTreeGroup<TDrone extends SidebarTreeDrone = SidebarTreeDrone> = {
  group: string;
  label: string;
  kind: SidebarTreeGroupKind;
  items: TDrone[];
};

export type SidebarFolderNode<TDrone extends SidebarTreeDrone = SidebarTreeDrone> = {
  path: string;
  label: string;
  name: string;
  kind: SidebarTreeGroupKind;
  depth: number;
  ownItems: TDrone[];
  directDroneCount: number;
  totalDroneCount: number;
  hasExplicitGroup: boolean;
  isVirtualGroup: boolean;
  children: SidebarFolderNode<TDrone>[];
};

export type SidebarDroneTree = {
  rootDroneIds: string[];
  childDroneIdsByParentId: Record<string, string[]>;
};

export type SidebarTreeFolderNode = {
  id: string;
  kind: 'folder';
  path: string;
  groupPath: string | null;
  repoGroupPath: string | null;
  label: string;
  groupKind: SidebarTreeGroupKind;
  parentId: string;
  depth: number;
  totalDroneCount: number;
  directDroneCount: number;
};

export type SidebarTreeDroneNode = {
  id: string;
  kind: 'drone';
  droneId: string;
  parentId: string;
  groupPath: string | null;
  repoGroupPath: string | null;
  depth: number;
};

export type SidebarTreeNode = SidebarTreeFolderNode | SidebarTreeDroneNode;

export type SidebarNodeTreeModel = {
  nodesById: Record<string, SidebarTreeNode>;
  childIdsByParent: Record<string, string[]>;
  rootChildIds: string[];
  folderNodeByPath: Record<string, SidebarTreeFolderNode>;
};

export type BuildSidebarNodeTreeArgs<TDrone extends SidebarTreeDrone> = {
  sidebarFolderTree?: SidebarFolderNode<TDrone>[];
  sidebarGroups: SidebarTreeGroup<TDrone>[];
  sidebarGroupOrder: string[];
  repoScopedGroupPathsByRepoGroup?: Record<string, string[]>;
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarGroupCreatedAtByName?: Record<string, string | null>;
};

export type BuildRepoSidebarGroupsArgs<TDrone extends SidebarTreeDrone> = {
  drones: TDrone[];
  activeRepoPath?: string;
  registeredRepoPaths: string[];
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  includeEmptyRegisteredRepoGroups?: boolean;
};

export type BuildRepoSidebarModelArgs<TDrone extends SidebarTreeDrone> =
  BuildRepoSidebarGroupsArgs<TDrone> & {
    sidebarNodeOrderByParent: Record<string, string[]>;
    sidebarGroupCreatedAtByName?: Record<string, string | null>;
    repoScopedGroupPathsByRepoGroup?: Record<string, string[]>;
  };

export type RepoSidebarModel<TDrone extends SidebarTreeDrone = SidebarTreeDrone> = {
  groups: SidebarTreeGroup<TDrone>[];
  nodeTree: SidebarNodeTreeModel;
};
