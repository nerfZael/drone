import { buildRepoSidebarGroups as buildSharedRepoSidebarGroups } from '@drone/hub-model/sidebar';
import type { DroneSummary } from '../types';
import type { SidebarGroup } from './use-sidebar-view-model';

export function buildRepoSidebarGroups(args: {
  drones: DroneSummary[];
  activeRepoPath: string;
  registeredRepoPaths: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarGroupOrder: string[];
  includeEmptyRegisteredRepoGroups?: boolean;
}): SidebarGroup[] {
  return buildSharedRepoSidebarGroups(args);
}
