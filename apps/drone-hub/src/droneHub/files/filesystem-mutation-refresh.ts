import { parentFsPath } from './explorer-state';

export type FilesystemMutationRefreshPlan = {
  listingPaths: string[];
  staleSubtrees: string[];
};

export function filesystemMutationRefreshPlan(input: {
  sourcePaths?: readonly string[];
  destinationPaths?: readonly string[];
  changedDirectories?: readonly string[];
}): FilesystemMutationRefreshPlan {
  const sourcePaths = uniquePaths(input.sourcePaths ?? []);
  const destinationPaths = uniquePaths(input.destinationPaths ?? []);
  const directlyChanged = uniquePaths([
    ...(input.changedDirectories ?? []),
    ...sourcePaths.map(parentFsPath),
    ...destinationPaths.map(parentFsPath),
  ]);
  const listingPaths = uniquePaths([
    ...directlyChanged,
    ...directlyChanged.map(parentFsPath),
  ]);
  return {
    listingPaths,
    staleSubtrees: uniquePaths([...sourcePaths, ...destinationPaths]),
  };
}

export function joinFsPath(directoryRaw: string, nameRaw: string): string {
  const directory = normalizePath(directoryRaw);
  const name = String(nameRaw ?? '').trim().replace(/^\/+/, '');
  return directory === '/' ? `/${name}` : `${directory.replace(/\/+$/, '')}/${name}`;
}

export function pathMatchesRefreshScope(
  pathRaw: string,
  plan: FilesystemMutationRefreshPlan,
): boolean {
  const candidate = normalizePath(pathRaw);
  if (plan.listingPaths.includes(candidate)) return true;
  return plan.staleSubtrees.some(
    (subtree) => candidate === subtree || candidate.startsWith(`${subtree.replace(/\/+$/, '')}/`),
  );
}

function uniquePaths(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(normalizePath).filter(Boolean)));
}

function normalizePath(value: string): string {
  const normalized = String(value ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!normalized) return '/';
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}
