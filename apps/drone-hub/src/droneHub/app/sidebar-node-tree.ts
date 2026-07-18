import {
  buildSidebarNodeTree as buildSharedSidebarNodeTree,
  type BuildSidebarNodeTreeArgs as SharedBuildSidebarNodeTreeArgs,
  type SidebarNodeTreeModel,
  type SidebarTreeDroneNode,
  type SidebarTreeFolderNode,
  type SidebarTreeNode,
} from '@drone/hub-model/sidebar';
import type { DroneSummary } from '../types';

export type {
  SidebarNodeTreeModel,
  SidebarTreeDroneNode,
  SidebarTreeFolderNode,
  SidebarTreeNode,
};

export function buildSidebarNodeTree(
  args: SharedBuildSidebarNodeTreeArgs<DroneSummary>,
): SidebarNodeTreeModel {
  return buildSharedSidebarNodeTree(args);
}
