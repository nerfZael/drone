import { buildSidebarFolderTree } from './folder-tree';
import { buildSidebarNodeTree } from './node-tree';
import { buildRepoSidebarGroups } from './repo-groups';
import type {
  BuildRepoSidebarModelArgs,
  RepoSidebarModel,
  SidebarTreeDrone,
} from './types';

export function buildRepoSidebarModel<TDrone extends SidebarTreeDrone>(
  args: BuildRepoSidebarModelArgs<TDrone>,
): RepoSidebarModel<TDrone> {
  const groups = buildRepoSidebarGroups(args);
  const folderTree = buildSidebarFolderTree(
    groups,
    args.sidebarGroupOrder,
    args.sidebarGroupCreatedAtByName,
  );
  const nodeTree = buildSidebarNodeTree({
    sidebarFolderTree: folderTree,
    sidebarGroups: groups,
    sidebarGroupOrder: args.sidebarGroupOrder,
    repoScopedGroupPathsByRepoGroup: args.repoScopedGroupPathsByRepoGroup,
    sidebarDroneOrderByGroup: args.sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent: args.sidebarNodeOrderByParent,
    sidebarGroupCreatedAtByName: args.sidebarGroupCreatedAtByName,
    sidebarGroupIdByName: args.sidebarGroupIdByName,
  });
  return { groups, nodeTree };
}
