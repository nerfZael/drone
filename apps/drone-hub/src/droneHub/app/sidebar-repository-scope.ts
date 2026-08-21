export function sidebarRepoGroupPathFromRepoPath(repoPathRaw: string | null | undefined): string {
  const repoPath = String(repoPathRaw ?? '').trim();
  return repoPath ? `repo:${repoPath}` : 'repo:ungrouped';
}

export function sidebarRepoPathFromGroupPath(repoGroupPathRaw: string | null | undefined): string | null {
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  if (!repoGroupPath) return null;
  if (repoGroupPath === 'repo:ungrouped') return '';
  return repoGroupPath.startsWith('repo:') ? repoGroupPath.slice('repo:'.length) : null;
}

export function hasSidebarRepoPathScope(
  scope: { repoPath?: string | null } | undefined,
): boolean {
  return Boolean(scope) && Object.prototype.hasOwnProperty.call(scope, 'repoPath');
}

export function sidebarRepoScopedGroupPath(
  repoGroupPathRaw: string,
  groupPathRaw: string,
): string {
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  const groupPath = String(groupPathRaw ?? '').trim();
  return repoGroupPath && groupPath
    ? `repo-scope:${repoGroupPath}:${groupPath}`
    : groupPath;
}

export function sidebarGroupMutationKey(
  groupPathRaw: string,
  repoGroupPathRaw?: string | null,
): string {
  const groupPath = String(groupPathRaw ?? '').trim();
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  return repoGroupPath
    ? sidebarRepoScopedGroupPath(repoGroupPath, groupPath)
    : groupPath;
}
