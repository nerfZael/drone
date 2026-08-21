import { isSameOrDescendantSidebarGroupPath } from './sidebar-group-paths';

export function isSidebarFolderHidden(
  hiddenTokens: ReadonlySet<string>,
  path: string,
  kind: 'group' | 'repo',
  groupIdByName: Readonly<Record<string, string>>,
): boolean {
  if (kind === 'repo') return hiddenTokens.has(`repo:${path}`);
  return Array.from(hiddenTokens).some((token) => {
    if (token.startsWith('group:')) {
      return isSameOrDescendantSidebarGroupPath(path, token.slice('group:'.length));
    }
    if (!token.startsWith('group-id:')) return false;
    const hiddenGroupId = token.slice('group-id:'.length);
    const hiddenGroupName = Object.entries(groupIdByName).find(
      ([, groupId]) => groupId === hiddenGroupId,
    )?.[0];
    return Boolean(
      hiddenGroupName && isSameOrDescendantSidebarGroupPath(path, hiddenGroupName),
    );
  });
}
