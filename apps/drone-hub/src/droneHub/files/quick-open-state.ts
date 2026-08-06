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

export type QuickOpenParsedQuery = {
  searchTerm: string;
  line: number | null;
  column: number | null;
};

const MAX_RECENT_FILES = 24;
export const QUICK_OPEN_SEARCH_MIN_QUERY_LENGTH = 1;

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

export function parseQuickOpenQuery(raw: string): QuickOpenParsedQuery {
  const query = String(raw ?? '').trim();
  const locationMatch = query.match(/^(.*?):(\d*)(?::(\d*))?$/);
  if (!locationMatch) return { searchTerm: query, line: null, column: null };
  if (!locationMatch[2] && locationMatch[3]) {
    return { searchTerm: query, line: null, column: null };
  }
  const line = locationMatch[2] ? Math.max(1, Math.floor(Number(locationMatch[2]))) : null;
  const column = locationMatch[3] ? Math.max(1, Math.floor(Number(locationMatch[3]))) : null;
  return {
    searchTerm: String(locationMatch[1] ?? '').trim(),
    line,
    column,
  };
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

function isWordBoundary(value: string, index: number): boolean {
  if (index <= 0) return true;
  const previous = value[index - 1] ?? '';
  const current = value[index] ?? '';
  return /[\/\\._\-\s]/.test(previous) || (/[a-z0-9]/.test(previous) && /[A-Z]/.test(current));
}

function fuzzySubsequenceScore(candidateRaw: string, queryRaw: string): number | null {
  const candidate = candidateRaw.toLowerCase();
  const query = queryRaw.toLowerCase();
  if (!query) return 0;
  let candidateIndex = 0;
  let previousMatch = -2;
  let score = 0;
  for (let queryIndex = 0; queryIndex < query.length; queryIndex += 1) {
    const queryChar = query[queryIndex];
    const matchIndex = candidate.indexOf(queryChar, candidateIndex);
    if (matchIndex < 0) return null;
    score += 10;
    if (matchIndex === previousMatch + 1) score += 14;
    if (isWordBoundary(candidateRaw, matchIndex)) score += 18;
    score -= Math.min(12, Math.max(0, matchIndex - candidateIndex));
    previousMatch = matchIndex;
    candidateIndex = matchIndex + 1;
  }
  return score - Math.max(0, candidate.length - query.length) * 0.05;
}

function quickOpenMatchScore(file: QuickOpenFile, query: string): number | null {
  if (!query) return 0;
  const name = String(file.name || quickOpenNameForPath(file.path));
  const relativePath = String(file.relativePath || file.path);
  const lowerName = name.toLowerCase();
  const lowerPath = relativePath.toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  let total = 0;

  for (const token of tokens) {
    const nameFuzzy = fuzzySubsequenceScore(name, token);
    const pathFuzzy = fuzzySubsequenceScore(relativePath, token);
    if (nameFuzzy == null && pathFuzzy == null) return null;

    let tokenScore = Math.max(
      nameFuzzy == null ? Number.NEGATIVE_INFINITY : 500 + nameFuzzy,
      pathFuzzy == null ? Number.NEGATIVE_INFINITY : 200 + pathFuzzy,
    );
    if (lowerName === token) tokenScore = Math.max(tokenScore, 1_200);
    else if (lowerName.startsWith(token)) tokenScore = Math.max(tokenScore, 1_000 - (lowerName.length - token.length));
    else if (lowerName.includes(token)) tokenScore = Math.max(tokenScore, 800 - lowerName.indexOf(token));
    if (lowerPath === token) tokenScore = Math.max(tokenScore, 700);
    else if (lowerPath.startsWith(token)) tokenScore = Math.max(tokenScore, 650);
    else if (lowerPath.includes(token)) tokenScore = Math.max(tokenScore, 600 - lowerPath.indexOf(token) * 0.1);
    total += tokenScore;
  }

  return total - (relativePath.match(/[\/\\]/g)?.length ?? 0) * 0.5;
}

export function buildQuickOpenItems(opts: {
  query: string;
  recentFiles: QuickOpenRecentFile[];
  searchFiles: QuickOpenFile[];
  limit?: number;
}): QuickOpenItem[] {
  const query = normalizeQuery(parseQuickOpenQuery(opts.query).searchTerm);
  const limit = Math.max(1, Math.floor(Number(opts.limit ?? 80)));
  const itemByPath = new Map<string, QuickOpenItem>();

  for (const recent of opts.recentFiles) {
    const path = normalizeFilePath(recent.path);
    if (!path || itemByPath.has(path)) continue;
    itemByPath.set(path, { ...recent, path, source: 'recent' });
  }

  for (const file of opts.searchFiles) {
    const path = normalizeFilePath(file.path);
    if (!path) continue;
    const existing = itemByPath.get(path);
    if (existing) {
      itemByPath.set(path, {
        ...existing,
        name: existing.name || String(file.name ?? '').trim() || quickOpenNameForPath(path),
        relativePath: existing.relativePath ?? file.relativePath ?? null,
        size: existing.size ?? file.size ?? null,
        mtimeMs: existing.mtimeMs ?? file.mtimeMs ?? null,
      });
      continue;
    }
    itemByPath.set(path, {
      path,
      name: String(file.name ?? '').trim() || quickOpenNameForPath(path),
      relativePath: file.relativePath ?? null,
      size: Number.isFinite(Number(file.size)) ? Math.max(0, Math.floor(Number(file.size))) : null,
      mtimeMs: Number.isFinite(Number(file.mtimeMs)) ? Math.max(0, Math.floor(Number(file.mtimeMs))) : null,
      source: 'search',
    });
  }

  return Array.from(itemByPath.values())
    .map((item, inputIndex) => ({
      item,
      inputIndex,
      score: quickOpenMatchScore(item, query),
      openedAt: item.source === 'recent' && 'openedAt' in item ? Number(item.openedAt ?? 0) : 0,
    }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score != null)
    .sort((a, b) => {
      if (!query) return b.openedAt - a.openedAt || a.inputIndex - b.inputIndex;
      return (
        b.score - a.score ||
        Number(b.item.source === 'recent') - Number(a.item.source === 'recent') ||
        b.openedAt - a.openedAt ||
        a.item.name.localeCompare(b.item.name)
      );
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function quickOpenSelectionToOpenTarget(
  item: QuickOpenItem,
  query: string = '',
): { path: string; name: string; line: number | null; column: number | null } {
  const path = normalizeFilePath(item.path);
  const parsedQuery = parseQuickOpenQuery(query);
  return {
    path,
    name: String(item.name ?? '').trim() || quickOpenNameForPath(path),
    line: parsedQuery.line,
    column: parsedQuery.column,
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
