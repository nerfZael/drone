import type {
  RepoChangeEntry,
  RepoPullChangeEntry,
  RepoPullRequestChangeEntry,
  RepoPullRequestMergeMethod,
} from '../types';
import type { DiffNoTextReason } from './DiffBlock';

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
  try {
    const raw = String(localStorage.getItem(PR_MERGE_METHOD_STORAGE_KEY) ?? '')
      .trim()
      .toLowerCase();
    if (raw === 'squash' || raw === 'rebase' || raw === 'merge') return raw;
  } catch {
    // ignore
  }
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

  function toNodes(dir: DirBuilder): ExplorerNode[] {
    const dirNodes = Array.from(dir.dirs.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => {
        const children = toNodes(child);
        const count = children.reduce((sum, c) => sum + c.count, 0);
        return {
          kind: 'dir' as const,
          name: child.name,
          path: child.path,
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
