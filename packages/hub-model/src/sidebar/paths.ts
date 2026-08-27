import type { SidebarFolderNode } from './types';

export function normalizeSidebarGroupPath(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '');
}

export function splitSidebarGroupPath(raw: string | null | undefined): string[] {
  const path = normalizeSidebarGroupPath(raw);
  return path ? path.split('/').map((part) => part.trim()).filter(Boolean) : [];
}

export function sidebarGroupParentPath(raw: string | null | undefined): string | null {
  const parts = splitSidebarGroupPath(raw);
  return parts.length < 2 ? null : parts.slice(0, -1).join('/');
}

export function sidebarGroupBaseName(raw: string | null | undefined): string {
  const parts = splitSidebarGroupPath(raw);
  return parts[parts.length - 1] ?? normalizeSidebarGroupPath(raw);
}

export function joinSidebarGroupPath(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => normalizeSidebarGroupPath(part))
    .filter(Boolean)
    .join('/');
}

export function reparentSidebarGroupPath(
  pathRaw: string | null | undefined,
  parentPathRaw: string | null | undefined,
): string {
  return joinSidebarGroupPath([
    parentPathRaw,
    sidebarGroupBaseName(pathRaw),
  ]);
}

export function replaceSidebarGroupPathSuffix(
  scopedPathRaw: string | null | undefined,
  currentGroupPathRaw: string | null | undefined,
  nextGroupPathRaw: string | null | undefined,
): string {
  const scopedPath = String(scopedPathRaw ?? '').trim();
  const currentGroupPath = normalizeSidebarGroupPath(currentGroupPathRaw);
  const nextGroupPath = normalizeSidebarGroupPath(nextGroupPathRaw);
  if (!scopedPath || !currentGroupPath || !nextGroupPath) return scopedPath;
  if (scopedPath === currentGroupPath) return nextGroupPath;
  if (!scopedPath.endsWith(currentGroupPath)) return scopedPath;
  const boundary = scopedPath[scopedPath.length - currentGroupPath.length - 1];
  if (boundary !== ':' && boundary !== '/') return scopedPath;
  return `${scopedPath.slice(0, -currentGroupPath.length)}${nextGroupPath}`;
}

export function isSameOrDescendantSidebarGroupPath(
  pathRaw: string | null | undefined,
  prefixRaw: string | null | undefined,
): boolean {
  const path = normalizeSidebarGroupPath(pathRaw);
  const prefix = normalizeSidebarGroupPath(prefixRaw);
  return Boolean(path && prefix && (path === prefix || path.startsWith(`${prefix}/`)));
}

export function rewriteSidebarGroupPathPrefix(
  pathRaw: string | null | undefined,
  fromPrefixRaw: string | null | undefined,
  toPrefixRaw: string | null | undefined,
): string {
  const path = normalizeSidebarGroupPath(pathRaw);
  const fromPrefix = normalizeSidebarGroupPath(fromPrefixRaw);
  const toPrefix = normalizeSidebarGroupPath(toPrefixRaw);
  if (
    !path ||
    !fromPrefix ||
    !toPrefix ||
    !isSameOrDescendantSidebarGroupPath(path, fromPrefix)
  ) {
    return path;
  }
  return path === fromPrefix ? toPrefix : `${toPrefix}/${path.slice(fromPrefix.length + 1)}`;
}

export function isUngroupedGroupName(raw: string | null | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'ungrouped';
}

export function sidebarFolderDisplayLabel(node: SidebarFolderNode): string {
  if (node.kind === 'repo' || isUngroupedGroupName(node.path)) return node.label;
  return node.name || sidebarGroupBaseName(node.path) || node.label || node.path;
}

export function sidebarFolderParentPath(node: SidebarFolderNode): string | null {
  if (node.kind === 'repo' || isUngroupedGroupName(node.path)) return null;
  return sidebarGroupParentPath(node.path);
}
