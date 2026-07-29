import { isUngroupedGroupName } from '../../domain';
import {
  sidebarGroupBaseName,
  sidebarGroupParentPath,
} from './sidebar-group-paths';

export type SidebarGroupDraftLocation = {
  parentPath: string | null;
  siblingNames: string[];
};

export function resolveSidebarGroupDraftLocation(
  selectedFolderPathRaw: string | null,
  visibleFolderPaths: Iterable<string>,
  selectedDroneGroupRaw?: string | null,
): SidebarGroupDraftLocation {
  const paths = Array.from(visibleFolderPaths, (path) => String(path ?? '').trim()).filter(Boolean);
  const visiblePathSet = new Set(paths);
  const selectedFolderPath = String(selectedFolderPathRaw ?? '').trim();
  const selectedDroneGroupRawValue = String(selectedDroneGroupRaw ?? '').trim();
  const selectedDroneGroup = isUngroupedGroupName(selectedDroneGroupRawValue)
    ? ''
    : selectedDroneGroupRawValue;
  const parentPath =
    selectedFolderPath && visiblePathSet.has(selectedFolderPath)
      ? selectedFolderPath
      : selectedDroneGroup && visiblePathSet.has(selectedDroneGroup)
        ? selectedDroneGroup
        : null;

  return {
    parentPath,
    siblingNames: paths
      .filter((path) => sidebarGroupParentPath(path) === parentPath)
      .map(sidebarGroupBaseName),
  };
}

export type SidebarDroneDraftLocation = {
  group: string;
  repoPath?: string;
};

export function resolveSidebarDroneDraftLocation(args: {
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
