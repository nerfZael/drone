export type QuickOpenFile = {
  path: string;
  name: string;
  relativePath: string | null;
  size: number | null;
  mtimeMs: number | null;
};

export type QuickOpenRecentFile = QuickOpenFile & {
  openedAt: number;
};

export type QuickOpenItem = QuickOpenFile & {
  source: 'recent' | 'search';
};

const MAX_RECENT_FILES = 24;
export const QUICK_OPEN_SEARCH_MIN_QUERY_LENGTH = 2;

export function quickOpenNameForPath(pathRaw: string): string {
  const path = String(pathRaw ?? '').trim().replace(/\\/g, '/');
  return path.split('/').filter(Boolean).pop() || path || 'File';
}

function normalizeFilePath(raw: string): string {
  return String(raw ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '');
}

function normalizeQuery(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function trackRecentQuickOpenFile(
  recentFiles: QuickOpenRecentFile[],
  nextRaw: { path: string; name?: string | null; relativePath?: string | null; size?: number | null; mtimeMs?: number | null },
  now: number = Date.now(),
): QuickOpenRecentFile[] {
  const path = normalizeFilePath(nextRaw.path);
  if (!path) return recentFiles;
  const name = String(nextRaw.name ?? '').trim() || quickOpenNameForPath(path);
  const next: QuickOpenRecentFile = {
    path,
    name,
    relativePath: nextRaw.relativePath ?? null,
    size: Number.isFinite(Number(nextRaw.size)) ? Math.max(0, Math.floor(Number(nextRaw.size))) : null,
    mtimeMs: Number.isFinite(Number(nextRaw.mtimeMs)) ? Math.max(0, Math.floor(Number(nextRaw.mtimeMs))) : null,
    openedAt: Number.isFinite(now) ? Math.max(0, Math.floor(now)) : Date.now(),
  };
  return [next, ...recentFiles.filter((file) => normalizeFilePath(file.path) !== path)].slice(0, MAX_RECENT_FILES);
}

function matchesQuickOpenQuery(file: QuickOpenFile, query: string): boolean {
  if (!query) return true;
  const haystack = `${file.relativePath ?? ''}\n${file.path}\n${file.name}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}

export function buildQuickOpenItems(opts: {
  query: string;
  recentFiles: QuickOpenRecentFile[];
  searchFiles: QuickOpenFile[];
  limit?: number;
}): QuickOpenItem[] {
  const query = normalizeQuery(opts.query);
  const limit = Math.max(1, Math.floor(Number(opts.limit ?? 80)));
  const seen = new Set<string>();
  const items: QuickOpenItem[] = [];

  for (const recent of opts.recentFiles) {
    const path = normalizeFilePath(recent.path);
    if (!path || seen.has(path)) continue;
    if (!matchesQuickOpenQuery(recent, query)) continue;
    seen.add(path);
    items.push({ ...recent, path, source: 'recent' });
    if (items.length >= limit) return items;
  }

  for (const file of opts.searchFiles) {
    const path = normalizeFilePath(file.path);
    if (!path || seen.has(path)) continue;
    if (!matchesQuickOpenQuery(file, query)) continue;
    seen.add(path);
    items.push({
      path,
      name: String(file.name ?? '').trim() || quickOpenNameForPath(path),
      relativePath: file.relativePath ?? null,
      size: Number.isFinite(Number(file.size)) ? Math.max(0, Math.floor(Number(file.size))) : null,
      mtimeMs: Number.isFinite(Number(file.mtimeMs)) ? Math.max(0, Math.floor(Number(file.mtimeMs))) : null,
      source: 'search',
    });
    if (items.length >= limit) return items;
  }

  return items;
}

export function quickOpenSelectionToOpenTarget(item: QuickOpenItem): { path: string; name: string } {
  const path = normalizeFilePath(item.path);
  return {
    path,
    name: String(item.name ?? '').trim() || quickOpenNameForPath(path),
  };
}

function pathInsideOrEqual(parentRaw: string | null | undefined, childRaw: string | null | undefined): boolean {
  const parent = normalizeFilePath(String(parentRaw ?? ''));
  const child = normalizeFilePath(String(childRaw ?? ''));
  if (!parent || !child) return false;
  return parent === child || child.startsWith(`${parent}/`);
}

function remapPath(sourceRaw: string, targetRaw: string, pathRaw: string): string | null {
  const source = normalizeFilePath(sourceRaw);
  const target = normalizeFilePath(targetRaw);
  const current = normalizeFilePath(pathRaw);
  if (!source || !target || !current || !pathInsideOrEqual(source, current)) return null;
  if (current === source) return target;
  const suffix = current.slice(source.length).replace(/^\/+/, '');
  return suffix ? `${target}/${suffix}` : target;
}

export function remapRecentQuickOpenFilesForPathChange(
  recentFiles: QuickOpenRecentFile[],
  sourcePath: string,
  targetPath: string,
): QuickOpenRecentFile[] {
  const next: QuickOpenRecentFile[] = [];
  const seen = new Set<string>();
  for (const file of recentFiles) {
    const mappedPath = remapPath(sourcePath, targetPath, file.path);
    const path = mappedPath ?? normalizeFilePath(file.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    next.push({
      ...file,
      path,
      name: mappedPath ? quickOpenNameForPath(path) : file.name,
      relativePath: mappedPath ? null : file.relativePath,
    });
  }
  return next;
}

export function removeRecentQuickOpenFilesForPaths(
  recentFiles: QuickOpenRecentFile[],
  paths: string[],
): QuickOpenRecentFile[] {
  const normalizedPaths = paths.map((path) => normalizeFilePath(path)).filter(Boolean);
  if (normalizedPaths.length === 0) return recentFiles;
  return recentFiles.filter((file) => !normalizedPaths.some((path) => pathInsideOrEqual(path, file.path)));
}
