import {
  buildSidebarFolderTree as buildSharedSidebarFolderTree,
  flattenSidebarFolderTree as flattenSharedSidebarFolderTree,
  sidebarFolderDisplayLabel as sharedSidebarFolderDisplayLabel,
  sidebarFolderParentPath as sharedSidebarFolderParentPath,
  type SidebarFolderNode as SharedSidebarFolderNode,
} from '@drone/hub-model/sidebar';
import type { DroneSummary } from '../types';
import type { SidebarGroup } from './use-sidebar-view-model';

export type SidebarFolderNode = SharedSidebarFolderNode<DroneSummary>;

export function buildSidebarFolderTree(
  sidebarGroups: SidebarGroup[],
  sidebarGroupOrder: string[],
  groupCreatedAtByName: Record<string, string | null> = {},
): SidebarFolderNode[] {
  return buildSharedSidebarFolderTree(sidebarGroups, sidebarGroupOrder, groupCreatedAtByName);
}

export function flattenSidebarFolderTree(nodes: SidebarFolderNode[]): SidebarFolderNode[] {
  return flattenSharedSidebarFolderTree(nodes);
}

export function sidebarFolderDisplayLabel(node: SidebarFolderNode): string {
  return sharedSidebarFolderDisplayLabel(node);
}

export function sidebarFolderParentPath(node: SidebarFolderNode): string | null {
  return sharedSidebarFolderParentPath(node);
}
