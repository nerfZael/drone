/** Normalize a workspace path without guessing whether it names a file or folder. */
export function normalizeWorkspaceLinkPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${normalized.startsWith('/') ? '/' : ''}${parts.join('/')}`;
}

export function workspaceLinkParent(path: string): string {
  const normalized = normalizeWorkspaceLinkPath(path);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash) || '/';
}

export async function workspaceLinkIsDirectory(
  path: string,
  list: (parent: string) => Promise<{ entries?: readonly { path: string; kind: string }[] }>,
): Promise<boolean> {
  const normalized = normalizeWorkspaceLinkPath(path);
  const parent = workspaceLinkParent(normalized);
  const result = await list(parent);
  if (normalized === parent) return true;
  return (
    result.entries?.some(
      (entry) =>
        normalizeWorkspaceLinkPath(entry.path) === normalized && entry.kind === 'directory',
    ) ?? false
  );
}

export function resolveWorkspacePreviewLink(baseFile: string, target: string): string {
  if (target.startsWith('/')) return normalizeWorkspaceLinkPath(target);
  const parent = workspaceLinkParent(baseFile);
  return normalizeWorkspaceLinkPath(`${parent ? `${parent}/` : ''}${target}`);
}

/** Choose an explorer root that contains the target, preserving the workspace when possible. */
export function workspaceExplorerLocation(workspace: string, target: string): { root: string; outside: boolean } {
  const root = normalizeWorkspaceLinkPath(workspace);
  const path = normalizeWorkspaceLinkPath(target);
  const inside = !root || path === root || (root === '/' ? path.startsWith('/') : path.startsWith(`${root}/`));
  return { root: inside && path !== root ? root : workspaceLinkParent(path), outside: !inside };
}

/** Directories to load and expand, excluding the file itself and the already loaded root. */
export function workspaceExplorerRevealDirectories(root: string, path: string, kind: 'file' | 'directory'): string[] {
  const normalizedRoot = normalizeWorkspaceLinkPath(root);
  const directories: string[] = [];
  let current = kind === 'file' ? workspaceLinkParent(path) : normalizeWorkspaceLinkPath(path);
  while (current !== normalizedRoot) {
    if (normalizedRoot && workspaceExplorerLocation(normalizedRoot, current).outside) break;
    directories.push(current);
    const parent = workspaceLinkParent(current);
    if (parent === current) break;
    current = parent;
  }
  return directories.reverse();
}
