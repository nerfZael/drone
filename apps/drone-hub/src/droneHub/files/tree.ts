import type { DroneFsEntry } from '../types';

export type FileExplorerNode = {
  kind: DroneFsEntry['kind'];
  name: string;
  path: string;
  entry: DroneFsEntry;
  count: number | null;
  children?: FileExplorerNode[];
};

export type FileExplorerVisibleRow = {
  kind: DroneFsEntry['kind'];
  depth: number;
  name: string;
  count: number | null;
};

function normalizeExplorerPath(pathRaw: string): string {
  const normalized = String(pathRaw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  if (!normalized) return '/';
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return absolute === '/' ? absolute : absolute.replace(/\/+$/g, '');
}

export function fileAncestorDirectoryPaths(rootPathRaw: string, filePathRaw: string): string[] {
  const rootPath = normalizeExplorerPath(rootPathRaw);
  const filePath = normalizeExplorerPath(filePathRaw);
  const insideRoot =
    rootPath === '/' ? filePath.startsWith('/') : filePath.startsWith(`${rootPath}/`);
  if (!insideRoot || filePath === rootPath) return [];

  const relativePath =
    rootPath === '/' ? filePath.slice(1) : filePath.slice(rootPath.length + 1);
  const directorySegments = relativePath.split('/').filter(Boolean).slice(0, -1);
  let currentPath = rootPath === '/' ? '' : rootPath;
  return directorySegments.map((segment) => {
    currentPath = `${currentPath}/${segment}`;
    return currentPath;
  });
}

export function buildFileExplorerTree(opts: {
  rootEntries: DroneFsEntry[];
  childEntriesByPath?: Record<string, DroneFsEntry[]>;
}): FileExplorerNode[] {
  const childEntriesByPath = opts.childEntriesByPath ?? {};

  function visit(entries: DroneFsEntry[]): FileExplorerNode[] {
    return entries
      .filter((entry) => !(entry.kind === 'directory' && entry.name === '.git'))
      .map((entry) => {
        if (entry.kind !== 'directory') {
          return {
            kind: entry.kind,
            name: entry.name,
            path: entry.path,
            entry,
            count: entry.kind === 'file' ? 1 : null,
          };
        }

        const childEntries = childEntriesByPath[entry.path];
        const children = Array.isArray(childEntries) ? visit(childEntries) : undefined;
        return {
          kind: entry.kind,
          name: entry.name,
          path: entry.path,
          entry,
          count: children?.length ?? null,
          children,
        };
      });
  }

  return visit(opts.rootEntries ?? []);
}

export function flattenVisibleFileExplorerRows(
  nodes: FileExplorerNode[],
  expandedDirs: Record<string, boolean>,
  depth: number = 0,
): FileExplorerVisibleRow[] {
  const rows: FileExplorerVisibleRow[] = [];
  for (const node of nodes) {
    rows.push({
      kind: node.kind,
      depth,
      name: node.name,
      count: node.count,
    });
    if (node.kind === 'directory' && expandedDirs[node.path] === true && node.children && node.children.length > 0) {
      rows.push(...flattenVisibleFileExplorerRows(node.children, expandedDirs, depth + 1));
    }
  }
  return rows;
}

export function summarizeRootEntries(entries: DroneFsEntry[]): {
  directories: number;
  files: number;
  others: number;
} {
  let directories = 0;
  let files = 0;
  let others = 0;
  for (const entry of entries) {
    if (entry.kind === 'directory') directories += 1;
    else if (entry.kind === 'file') files += 1;
    else others += 1;
  }
  return { directories, files, others };
}
