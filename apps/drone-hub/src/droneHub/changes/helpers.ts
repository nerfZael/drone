import type {
  RepoChangeEntry,
  RepoChangesPayload,
  RepoPullChangeEntry,
  RepoPullChangesPayload,
  RepoPullRequestChangeEntry,
  RepoPullRequestChangesPayload,
  RepoPullRequestMergeMethod,
} from '../types';
import type { DiffExpansionRange, DiffNoTextReason } from './types';
import { readChangesStorage } from './storage';

export type DiffKind = 'staged' | 'unstaged';
export type ChangesDataMode = 'working-tree' | 'pull-preview' | 'pull-request';

export type ExplorerNode = {
  kind: 'dir' | 'file';
  name: string;
  path: string;
  count: number;
  entry?: RepoChangeEntry;
  children?: ExplorerNode[];
};

export type ExplorerVisibleRow = {
  kind: 'dir' | 'file';
  depth: number;
  name: string;
  count: number;
};

export type ExplorerSidebarWidthOptions = {
  minWidthPx?: number;
  maxWidthPx?: number;
  maxWidthRatio?: number;
  minDiffWidthPx?: number;
  avgCharWidthPx?: number;
  fallbackWidthPx?: number;
};

const PR_MERGE_METHOD_STORAGE_KEY = 'droneHub.prMergeMethod';

export function shortSha(sha: string | null | undefined): string {
  const s = String(sha ?? '').trim();
  if (!s) return '-';
  return s.length > 10 ? s.slice(0, 10) : s;
}

export function normalizeRef(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim();
  return text || null;
}

export function shortRefName(raw: string | null | undefined, maxLen: number = 32): string {
  const text = normalizeRef(raw);
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function changesPrMergeMethod(): RepoPullRequestMergeMethod {
  const raw = String(readChangesStorage(PR_MERGE_METHOD_STORAGE_KEY) ?? '').trim().toLowerCase();
  if (raw === 'squash' || raw === 'rebase' || raw === 'merge') return raw;
  return 'merge';
}

export function pullRequestStateBadge(
  raw: string | null | undefined,
): { label: string; title: string; className: string } | null {
  const state = String(raw ?? '').trim().toLowerCase();
  if (!state) return null;
  if (state === 'open') {
    return {
      label: 'Open',
      title: 'Pull request is open.',
      className: 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]',
    };
  }
  if (state === 'merged') {
    return {
      label: 'Merged',
      title: 'Pull request has been merged.',
      className: 'border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)]',
    };
  }
  if (state === 'closed') {
    return {
      label: 'Closed',
      title: 'Pull request was closed without merging.',
      className: 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]',
    };
  }
  return {
    label: state,
    title: `Pull request state: ${state}`,
    className: 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)]',
  };
}

export function hasStaged(entry: RepoChangeEntry | null): boolean {
  if (!entry) return false;
  return entry.stagedType !== null;
}

export function hasUnstaged(entry: RepoChangeEntry | null): boolean {
  if (!entry) return false;
  return entry.unstagedType !== null || entry.isUntracked;
}

export function defaultKindForEntry(entry: RepoChangeEntry | null): DiffKind {
  if (!entry) return 'unstaged';
  return hasUnstaged(entry) ? 'unstaged' : 'staged';
}

export function effectiveKindForEntry(entry: RepoChangeEntry | null, preferred: DiffKind): DiffKind | null {
  if (!entry) return null;
  if (preferred === 'unstaged') {
    if (hasUnstaged(entry)) return 'unstaged';
    if (hasStaged(entry)) return 'staged';
    return null;
  }
  if (hasStaged(entry)) return 'staged';
  if (hasUnstaged(entry)) return 'unstaged';
  return null;
}

export function appendDiffExpansionRange(
  ranges: DiffExpansionRange[],
  incoming: DiffExpansionRange,
): DiffExpansionRange[] {
  const start = Math.max(1, Math.floor(Number(incoming.start ?? 0)));
  const end = Math.max(start, Math.floor(Number(incoming.end ?? 0)));
  if (end <= start) return ranges;

  const sorted = [...ranges, { start, end }].sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));
  const merged: DiffExpansionRange[] = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({ ...current });
      continue;
    }
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

export function entryPathExistsInCurrentTree(entry: RepoChangeEntry | null, mode: ChangesDataMode): boolean {
  if (!entry) return false;
  if (mode !== 'working-tree') {
    return entry.stagedType !== 'deleted';
  }
  if (entry.isUntracked) return true;
  if (entry.unstagedType === 'deleted') return false;
  if (entry.unstagedType !== null) return true;
  return entry.stagedType !== 'deleted';
}

export function statusCharLabel(ch: string): string {
  if (!ch || ch === '.') return '-';
  return ch;
}

function statusCharMeaning(chRaw: string): string {
  const ch = String(chRaw ?? '.').charAt(0) || '.';
  switch (ch) {
    case '.':
      return 'no change';
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type changed';
    case 'U':
      return 'unmerged';
    case '?':
      return 'untracked';
    case '!':
      return 'ignored';
    default:
      return 'unknown';
  }
}

export function statusBadgeTitle(entry: RepoChangeEntry, mode: ChangesDataMode): string {
  if (mode !== 'working-tree') {
    return `Change status: ${statusCharLabel(entry.stagedChar)} (${statusCharMeaning(entry.stagedChar)})`;
  }
  return [
    'Git status badge S/U (staged/unstaged)',
    `staged: ${statusCharLabel(entry.stagedChar)} (${statusCharMeaning(entry.stagedChar)})`,
    `unstaged: ${statusCharLabel(entry.unstagedChar)} (${statusCharMeaning(entry.unstagedChar)})`,
  ].join(' | ');
}

export function badgeTone(entry: RepoChangeEntry): string {
  if (entry.isConflicted) return 'text-[var(--red)] bg-[var(--red-subtle)] border-[rgba(255,90,90,.35)]';
  if (entry.isUntracked) return 'text-[var(--green)] bg-[var(--green-subtle)] border-[rgba(74,222,128,.35)]';
  if (entry.stagedType === 'deleted' || entry.unstagedType === 'deleted') {
    return 'text-[var(--red)] bg-[var(--red-subtle)] border-[rgba(255,90,90,.35)]';
  }
  if (entry.stagedType === 'modified' || entry.unstagedType === 'modified') {
    return 'text-[var(--yellow)] bg-[var(--yellow-subtle)] border-[rgba(255,178,36,.3)]';
  }
  return 'text-[var(--accent)] bg-[var(--accent-subtle)] border-[var(--accent-muted)]';
}

export function diffKey(path: string, kind: DiffKind): string {
  return `${kind}\u0000${path}`;
}

function compareRepoChangeEntries(a: RepoChangeEntry, b: RepoChangeEntry): number {
  const pathCmp = String(a.path ?? '').localeCompare(String(b.path ?? ''));
  if (pathCmp !== 0) return pathCmp;
  const originalPathCmp = String(a.originalPath ?? '').localeCompare(String(b.originalPath ?? ''));
  if (originalPathCmp !== 0) return originalPathCmp;
  const codeCmp = String(a.code ?? '').localeCompare(String(b.code ?? ''));
  if (codeCmp !== 0) return codeCmp;
  const stagedCmp = String(a.stagedChar ?? '').localeCompare(String(b.stagedChar ?? ''));
  if (stagedCmp !== 0) return stagedCmp;
  const unstagedCmp = String(a.unstagedChar ?? '').localeCompare(String(b.unstagedChar ?? ''));
  if (unstagedCmp !== 0) return unstagedCmp;
  if (a.isUntracked !== b.isUntracked) return a.isUntracked ? -1 : 1;
  if (a.isConflicted !== b.isConflicted) return a.isConflicted ? -1 : 1;
  return 0;
}

export function sortRepoChangeEntries(entries: RepoChangeEntry[]): RepoChangeEntry[] {
  return entries.slice().sort(compareRepoChangeEntries);
}

export function parentDirPaths(filePath: string): string[] {
  const segs = String(filePath ?? '').split('/').filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < segs.length - 1; i += 1) {
    cur = cur ? `${cur}/${segs[i]}` : segs[i];
    out.push(cur);
  }
  return out;
}

function lastPathSegment(filePath: string): string {
  const segs = String(filePath ?? '').split('/').filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1] : String(filePath ?? '');
}

export function buildExplorerTree(entries: RepoChangeEntry[]): ExplorerNode[] {
  type DirBuilder = {
    name: string;
    path: string;
    dirs: Map<string, DirBuilder>;
    files: RepoChangeEntry[];
  };

  const root: DirBuilder = { name: '', path: '', dirs: new Map(), files: [] };

  for (const entry of entries) {
    const pathText = String(entry.path ?? '').trim();
    if (!pathText) continue;
    const segs = pathText.split('/').filter(Boolean);
    if (segs.length === 0) continue;
    let cur = root;
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i];
      const nextPath = cur.path ? `${cur.path}/${seg}` : seg;
      let child = cur.dirs.get(seg);
      if (!child) {
        child = { name: seg, path: nextPath, dirs: new Map(), files: [] };
        cur.dirs.set(seg, child);
      }
      cur = child;
    }
    cur.files.push(entry);
  }

  function collapseDirChain(start: DirBuilder): { dir: DirBuilder; name: string } {
    const names: string[] = [start.name];
    let cur = start;
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const first = cur.dirs.values().next();
      if (first.done) break;
      cur = first.value;
      names.push(cur.name);
    }
    return { dir: cur, name: names.join('/') };
  }

  function toNodes(dir: DirBuilder): ExplorerNode[] {
    const dirNodes = Array.from(dir.dirs.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => {
        const collapsed = collapseDirChain(child);
        const children = toNodes(collapsed.dir);
        const count = children.reduce((sum, c) => sum + c.count, 0);
        return {
          kind: 'dir' as const,
          name: collapsed.name,
          path: collapsed.dir.path,
          count,
          children,
        };
      });

    const fileNodes = dir.files
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry) => ({
        kind: 'file' as const,
        name: lastPathSegment(entry.path),
        path: entry.path,
        count: 1,
        entry,
      }));

    return [...dirNodes, ...fileNodes];
  }

  return toNodes(root);
}

export function flattenVisibleExplorerRows(
  nodes: ExplorerNode[],
  expandedDirs: Record<string, boolean>,
  depth: number = 0,
): ExplorerVisibleRow[] {
  const rows: ExplorerVisibleRow[] = [];
  for (const node of nodes) {
    rows.push({
      kind: node.kind,
      depth,
      name: node.name,
      count: node.count,
    });
    if (node.kind === 'dir' && expandedDirs[node.path] !== false && node.children && node.children.length > 0) {
      rows.push(...flattenVisibleExplorerRows(node.children, expandedDirs, depth + 1));
    }
  }
  return rows;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateExplorerSidebarWidth(
  rows: ExplorerVisibleRow[],
  panelWidthPx: number,
  opts: ExplorerSidebarWidthOptions = {},
): number {
  const bounds = resolveExplorerSidebarWidthBounds(panelWidthPx, opts);
  const minWidthPx = Math.max(120, Math.floor(opts.minWidthPx ?? 180));
  const avgCharWidthPx = clampNumber(Number(opts.avgCharWidthPx ?? 6.7), 4, 12);
  const fallbackWidthPx = Math.floor(opts.fallbackWidthPx ?? 240);

  const desiredWidth = Math.max(
    fallbackWidthPx,
    rows.reduce((max, row) => {
      const leftPadding = 6 + row.depth * 9;
      const textWidth = Math.ceil(row.name.length * avgCharWidthPx);
      const dirCountWidth = Math.max(10, String(Math.max(0, row.count)).length * 6);
      // Account for icon/gaps and right-side metadata chip/counter.
      const staticWidth =
        row.kind === 'dir'
          ? 12 + 2 + 2 + 4 + dirCountWidth
          : 12 + 2 + 2 + 4 + 22;
      return Math.max(max, leftPadding + staticWidth + textWidth);
    }, 0),
  );

  return clampNumber(desiredWidth, bounds.minWidthPx, bounds.maxWidthPx);
}

export function resolveExplorerSidebarWidthBounds(
  panelWidthPx: number,
  opts: ExplorerSidebarWidthOptions = {},
): { minWidthPx: number; maxWidthPx: number } {
  const minWidthPx = Math.max(120, Math.floor(opts.minWidthPx ?? 180));
  const maxWidthPx = Math.max(minWidthPx, Math.floor(opts.maxWidthPx ?? 360));
  const maxWidthRatio = clampNumber(Number(opts.maxWidthRatio ?? 0.36), 0.1, 0.9);
  const minDiffWidthPx = Math.max(240, Math.floor(opts.minDiffWidthPx ?? 420));
  const panelWidth = Math.max(0, Math.floor(panelWidthPx));

  if (panelWidth <= 0) {
    return { minWidthPx, maxWidthPx };
  }

  const maxByRatio = Math.floor(panelWidth * maxWidthRatio);
  const maxByDiff = panelWidth - minDiffWidthPx;
  const hardMax = Math.min(maxWidthPx, maxByRatio, maxByDiff);
  if (hardMax <= 0) {
    const forced = Math.max(120, Math.min(minWidthPx, panelWidth));
    return { minWidthPx: forced, maxWidthPx: forced };
  }
  if (hardMax < minWidthPx) {
    const forced = Math.max(120, hardMax);
    return { minWidthPx: forced, maxWidthPx: forced };
  }
  return { minWidthPx, maxWidthPx: hardMax };
}

export function pullRequestNoTextReason(entry: RepoPullRequestChangeEntry): DiffNoTextReason | null {
  const patchText = typeof entry.patch === 'string' ? entry.patch : '';
  if (patchText.length > 0) return null;
  if (entry.isBinary) return 'binary';
  if (entry.truncated) return 'truncated';
  const changes = Math.max(0, Number(entry.changes) || 0);
  const additions = Math.max(0, Number(entry.additions) || 0);
  const deletions = Math.max(0, Number(entry.deletions) || 0);
  if (changes === 0 && additions === 0 && deletions === 0) return 'empty';
  return 'unavailable';
}

export function toWorkingEntriesFromPull(entries: Array<RepoPullChangeEntry | RepoPullRequestChangeEntry>): RepoChangeEntry[] {
  return entries.map((entry) => ({
    path: entry.path,
    originalPath: entry.originalPath,
    code: `${String(entry.statusChar ?? '?').charAt(0)}.`,
    stagedChar: String(entry.statusChar ?? '?').charAt(0),
    unstagedChar: '.',
    stagedType: entry.statusType ?? 'unknown',
    unstagedType: null,
    isUntracked: false,
    isIgnored: false,
    isConflicted: entry.statusType === 'unmerged',
  }));
}

function repoChangeEntrySignature(entry: RepoChangeEntry): string {
  return [
    entry.path,
    entry.originalPath ?? '',
    entry.code,
    entry.stagedChar,
    entry.unstagedChar,
    entry.stagedType ?? '',
    entry.unstagedType ?? '',
    entry.isUntracked ? '1' : '0',
    entry.isIgnored ? '1' : '0',
    entry.isConflicted ? '1' : '0',
  ].join('\u0000');
}

function repoPullChangeEntrySignature(entry: RepoPullChangeEntry): string {
  return [entry.path, entry.originalPath ?? '', entry.statusChar, entry.statusType ?? ''].join('\u0000');
}

function repoPullRequestChangeEntrySignature(entry: RepoPullRequestChangeEntry): string {
  return [
    entry.path,
    entry.originalPath ?? '',
    entry.statusChar,
    entry.statusType ?? '',
    String(entry.additions),
    String(entry.deletions),
    String(entry.changes),
    entry.patch ?? '',
    entry.truncated ? '1' : '0',
    entry.isBinary ? '1' : '0',
  ].join('\u0000');
}

function sameUnorderedArray<T>(a: T[], b: T[], toSignature: (value: T) => string): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const aSignatures = a.map(toSignature).sort();
  const bSignatures = b.map(toSignature).sort();
  for (let i = 0; i < a.length; i += 1) {
    if (aSignatures[i] !== bSignatures[i]) return false;
  }
  return true;
}

export function sameRepoChangesPayload(
  a: Extract<RepoChangesPayload, { ok: true }> | null,
  b: Extract<RepoChangesPayload, { ok: true }> | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoRoot === b.repoRoot &&
    a.branch.head === b.branch.head &&
    a.branch.upstream === b.branch.upstream &&
    a.branch.ahead === b.branch.ahead &&
    a.branch.behind === b.branch.behind &&
    a.counts.changed === b.counts.changed &&
    a.counts.staged === b.counts.staged &&
    a.counts.unstaged === b.counts.unstaged &&
    a.counts.untracked === b.counts.untracked &&
    a.counts.conflicted === b.counts.conflicted &&
    sameUnorderedArray(a.entries, b.entries, repoChangeEntrySignature)
  );
}

export function sameRepoPullChangesPayload(
  a: Extract<RepoPullChangesPayload, { ok: true }> | null,
  b: Extract<RepoPullChangesPayload, { ok: true }> | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoRoot === b.repoRoot &&
    a.baseSha === b.baseSha &&
    a.headSha === b.headSha &&
    a.branchContext.hostCurrent === b.branchContext.hostCurrent &&
    a.branchContext.droneCurrent === b.branchContext.droneCurrent &&
    a.branchContext.droneConfigured === b.branchContext.droneConfigured &&
    a.branchContext.droneFromRef === b.branchContext.droneFromRef &&
    a.counts.changed === b.counts.changed &&
    sameUnorderedArray(a.entries, b.entries, repoPullChangeEntrySignature)
  );
}

export function sameRepoPullRequestChangesPayload(
  a: Extract<RepoPullRequestChangesPayload, { ok: true }> | null,
  b: Extract<RepoPullRequestChangesPayload, { ok: true }> | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoRoot === b.repoRoot &&
    a.github.owner === b.github.owner &&
    a.github.repo === b.github.repo &&
    a.pullRequest.number === b.pullRequest.number &&
    a.pullRequest.title === b.pullRequest.title &&
    a.pullRequest.state === b.pullRequest.state &&
    a.pullRequest.htmlUrl === b.pullRequest.htmlUrl &&
    a.pullRequest.baseRefName === b.pullRequest.baseRefName &&
    a.pullRequest.headRefName === b.pullRequest.headRefName &&
    a.pullRequest.baseSha === b.pullRequest.baseSha &&
    a.pullRequest.headSha === b.pullRequest.headSha &&
    a.counts.changed === b.counts.changed &&
    a.counts.additions === b.counts.additions &&
    a.counts.deletions === b.counts.deletions &&
    sameUnorderedArray(a.entries, b.entries, repoPullRequestChangeEntrySignature)
  );
}

export function refreshTimeLabel(epochMs: number | null): { text: string; title: string | undefined } {
  if (!Number.isFinite(Number(epochMs)) || !epochMs || epochMs <= 0) {
    return { text: 'Not loaded', title: undefined };
  }
  const d = new Date(epochMs);
  return {
    text: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    title: d.toLocaleString(),
  };
}
