import { isUngroupedGroupName } from '../../domain';
import { isSameOrDescendantSidebarGroupPath } from './sidebar-group-paths';

export function isSidebarGroupDeleting(
  group: { group: string; kind: 'group' | 'repo' },
  deletingGroups: Record<string, boolean>,
): boolean {
  if (group.kind === 'repo') return deletingGroups[group.group] === true;
  return Object.keys(deletingGroups).some((deletingGroup) => {
    if (!deletingGroups[deletingGroup]) return false;
    if (deletingGroup.startsWith('repo:')) return false;
    if (isUngroupedGroupName(deletingGroup)) return isUngroupedGroupName(group.group);
    return isSameOrDescendantSidebarGroupPath(group.group, deletingGroup);
  });
}
