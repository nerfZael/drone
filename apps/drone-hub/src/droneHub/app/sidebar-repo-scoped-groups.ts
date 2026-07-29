import { isSameOrDescendantSidebarGroupPath, rewriteSidebarGroupPathPrefix } from './sidebar-group-paths';

export function normalizeSidebarRepoScopedGroupMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [groupPathRaw, repoGroupPathRaw] of Object.entries(value as Record<string, unknown>)) {
    const groupPath = String(groupPathRaw ?? '').trim();
    const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
    if (!groupPath || !repoGroupPath) continue;
    out[groupPath] = repoGroupPath;
  }
  return out;
}

export function rewriteSidebarRepoScopedGroupMapKeysByPrefix(
  map: Record<string, string>,
  currentGroupRaw: string,
  nextGroupRaw: string,
): Record<string, string> {
  const currentGroup = String(currentGroupRaw ?? '').trim();
  const nextGroup = String(nextGroupRaw ?? '').trim();
  if (!currentGroup || !nextGroup || currentGroup === nextGroup) return map;

  let changed = false;
  const out: Record<string, string> = {};
  for (const [groupPath, repoGroupPath] of Object.entries(map)) {
    const nextPath = isSameOrDescendantSidebarGroupPath(groupPath, currentGroup)
      ? rewriteSidebarGroupPathPrefix(groupPath, currentGroup, nextGroup)
      : groupPath;
    if (nextPath !== groupPath) changed = true;
    out[nextPath] = repoGroupPath;
  }
  return changed ? out : map;
}

export function removeSidebarRepoScopedGroupMapKeysByPrefix(
  map: Record<string, string>,
  groupRaw: string,
  repoGroupPathRaw?: string | null,
): Record<string, string> {
  const group = String(groupRaw ?? '').trim();
  const repoGroupPath = String(repoGroupPathRaw ?? '').trim();
  if (!group) return map;

  let changed = false;
  const out: Record<string, string> = {};
  for (const [groupPath, currentRepoGroupPath] of Object.entries(map)) {
    if (
      (!repoGroupPath || currentRepoGroupPath === repoGroupPath) &&
      isSameOrDescendantSidebarGroupPath(groupPath, group)
    ) {
      changed = true;
      continue;
    }
    out[groupPath] = currentRepoGroupPath;
  }
  return changed ? out : map;
}

export function groupSidebarRepoScopedGroupsByRepoGroup(map: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [groupPath, repoGroupPath] of Object.entries(map)) {
    const current = out[repoGroupPath] ?? [];
    if (!current.includes(groupPath)) current.push(groupPath);
    out[repoGroupPath] = current;
  }
  return out;
}
