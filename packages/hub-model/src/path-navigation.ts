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
