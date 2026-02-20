import React from 'react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { requestJson } from '../http';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import type {
  RepoChangeEntry,
  RepoChangesPayload,
  RepoDiffPayload,
  RepoPullChangesPayload,
  RepoPullDiffPayload,
  RepoPullRequestChangeEntry,
  RepoPullRequestChangesPayload,
} from '../types';
import {
  CHANGES_DATA_MODE_STORAGE_KEY,
  CHANGES_OPEN_PULL_REQUEST_EVENT,
  type ChangesOpenPullRequestDetail,
  selectedPullRequestForDrone,
} from './navigation';

type ChangesViewMode = 'stacked' | 'split';
type DiffKind = 'staged' | 'unstaged';
type ChangesDataMode = 'working-tree' | 'pull-preview' | 'pull-request';
type DiffNoTextReason = 'binary' | 'truncated' | 'empty' | 'unavailable';
type LastRefreshedByMode = Record<ChangesDataMode, number | null>;

type DiffState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'loaded'; text: string; truncated: boolean; fromUntracked: boolean; isBinary: boolean; noTextReason: DiffNoTextReason | null };

type ExplorerNode = {
  kind: 'dir' | 'file';
  name: string;
  path: string;
  count: number;
  entry?: RepoChangeEntry;
  children?: ExplorerNode[];
};

const CHANGES_VIEW_STORAGE_KEY = 'droneHub.changesViewMode';

function shortSha(sha: string | null | undefined): string {
  const s = String(sha ?? '').trim();
  if (!s) return '-';
  return s.length > 10 ? s.slice(0, 10) : s;
}

function normalizeRef(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim();
  return text || null;
}

function shortRefName(raw: string | null | undefined, maxLen: number = 32): string {
  const text = normalizeRef(raw);
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function hasStaged(entry: RepoChangeEntry | null): boolean {
  if (!entry) return false;
  return entry.stagedType !== null;
}

function hasUnstaged(entry: RepoChangeEntry | null): boolean {
  if (!entry) return false;
  return entry.unstagedType !== null || entry.isUntracked;
}

function defaultKindForEntry(entry: RepoChangeEntry | null): DiffKind {
  if (!entry) return 'unstaged';
  return hasUnstaged(entry) ? 'unstaged' : 'staged';
}

function effectiveKindForEntry(entry: RepoChangeEntry | null, preferred: DiffKind): DiffKind | null {
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

function statusCharLabel(ch: string): string {
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

function statusBadgeTitle(entry: RepoChangeEntry, mode: ChangesDataMode): string {
  if (mode !== 'working-tree') {
    return `Change status: ${statusCharLabel(entry.stagedChar)} (${statusCharMeaning(entry.stagedChar)})`;
  }
  return [
    'Git status badge S/U (staged/unstaged)',
    `staged: ${statusCharLabel(entry.stagedChar)} (${statusCharMeaning(entry.stagedChar)})`,
    `unstaged: ${statusCharLabel(entry.unstagedChar)} (${statusCharMeaning(entry.unstagedChar)})`,
  ].join(' | ');
}

function badgeTone(entry: RepoChangeEntry): string {
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

function diffKey(path: string, kind: DiffKind): string {
  return `${kind}\u0000${path}`;
}

function parentDirPaths(filePath: string): string[] {
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

function buildExplorerTree(entries: RepoChangeEntry[]): ExplorerNode[] {
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

function pullRequestNoTextReason(entry: RepoPullRequestChangeEntry): DiffNoTextReason | null {
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

function refreshTimeLabel(epochMs: number | null): { text: string; title: string | undefined } {
  if (!Number.isFinite(Number(epochMs)) || !epochMs || epochMs <= 0) {
    return { text: 'Not loaded', title: undefined };
  }
  const d = new Date(epochMs);
  return {
    text: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    title: d.toLocaleString(),
  };
}

function DiffBlock({ state }: { state: DiffState | undefined }) {
  if (!state || state.status === 'loading') {
    return <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Loading diff...</div>;
  }
  if (state.status === 'error') {
    return <div className="px-3 py-3 text-[11px] text-[var(--red)]">{state.error}</div>;
  }

  if (!state.text) {
    const emptyMessage =
      state.noTextReason === 'binary'
        ? 'No textual diff: this file is binary.'
        : state.noTextReason === 'truncated'
          ? 'No textual diff: GitHub truncated this file patch.'
          : state.noTextReason === 'empty'
            ? 'No textual diff: this file has no line-level changes.'
            : state.noTextReason === 'unavailable'
              ? 'No textual diff: GitHub did not provide a patch for this file.'
              : 'No diff output for this selection. The file may be empty, non-text, or no longer present.';
    return (
      <div className="px-3 py-3 text-[11px] text-[var(--muted)]">
        {emptyMessage}
      </div>
    );
  }

  const rawText = state.text;
  const binaryDiffPattern = /(^|\n)(Binary files .* differ|GIT binary patch)(\n|$)/;
  if (state.isBinary || binaryDiffPattern.test(rawText)) {
    return (
      <div>
        <div className="px-3 py-2 text-[10px] text-[var(--muted)] border-b border-[var(--border-subtle)]">
          Binary file diff.
        </div>
        <pre className="m-0 p-3 text-[11px] leading-5 text-[var(--fg-secondary)] whitespace-pre-wrap break-words">{rawText}</pre>
      </div>
    );
  }

  const parsed = (() => {
    try {
      return parseDiff(rawText);
    } catch {
      return [];
    }
  })();
  const hasRenderableHunks = parsed.some((file) => Array.isArray(file.hunks) && file.hunks.length > 0);

  if (parsed.length === 0 || !hasRenderableHunks) {
    return <pre className="m-0 p-3 text-[11px] leading-5 text-[var(--fg-secondary)] whitespace-pre-wrap break-words">{rawText}</pre>;
  }

  return (
    <div className="rdv-wrapper px-2 py-2">
      {parsed.map((file, fileIndex) => (
        <Diff key={`${file.oldPath}-${file.newPath}-${fileIndex}`} viewType="unified" diffType={file.type} hunks={file.hunks}>
          {(hunks) => hunks.map((hunk, hunkIndex) => <Hunk key={`${fileIndex}-${hunkIndex}`} hunk={hunk} />)}
        </Diff>
      ))}
      {state.truncated && (
        <div className="mt-2 px-2 py-1 rounded border border-[var(--yellow)]/30 bg-[var(--yellow-subtle)] text-[10px] text-[var(--yellow)]">
          Diff output is truncated.
        </div>
      )}
    </div>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.2 3.5l4.5 4.5-4.5 4.5" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7h-3.25z" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4z" />
    </svg>
  );
}

function MetaChip({
  label,
  value,
  title,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1.5 py-[1px] text-[10px] ${
        mono ? 'font-mono' : ''
      }`}
      title={title}
    >
      <span className="uppercase tracking-[0.08em] text-[var(--muted-dim)]">{label}</span>
      <span className="text-[var(--fg-secondary)]">{value}</span>
    </span>
  );
}

export function DroneChangesDock({
  droneId,
  droneName,
  repoAttached,
  repoPath,
  disabled,
  hubPhase,
  hubMessage,
}: {
  droneId: string;
  droneName: string;
  repoAttached: boolean;
  repoPath: string;
  disabled: boolean;
  hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
}) {
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [changes, setChanges] = React.useState<Extract<RepoChangesPayload, { ok: true }> | null>(null);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [changesError, setChangesError] = React.useState<string | null>(null);

  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000changes`,
    timeoutMs: 18_000,
  });

  const [pullChanges, setPullChanges] = React.useState<Extract<RepoPullChangesPayload, { ok: true }> | null>(null);
  const [pullLoading, setPullLoading] = React.useState(false);
  const [pullError, setPullError] = React.useState<string | null>(null);
  const [pullRequestNumber, setPullRequestNumber] = React.useState<number | null>(() => selectedPullRequestForDrone(droneId));
  const [pullRequestChanges, setPullRequestChanges] = React.useState<Extract<RepoPullRequestChangesPayload, { ok: true }> | null>(null);
  const [pullRequestLoading, setPullRequestLoading] = React.useState(false);
  const [pullRequestError, setPullRequestError] = React.useState<string | null>(null);
  const [lastRefreshedByMode, setLastRefreshedByMode] = React.useState<LastRefreshedByMode>({
    'working-tree': null,
    'pull-preview': null,
    'pull-request': null,
  });

  const [dataMode, setDataMode] = React.useState<ChangesDataMode>(() => {
    try {
      const raw = localStorage.getItem(CHANGES_DATA_MODE_STORAGE_KEY);
      return raw === 'pull-preview' || raw === 'pull-request' ? raw : 'working-tree';
    } catch {
      return 'working-tree';
    }
  });

  const [viewMode, setViewMode] = React.useState<ChangesViewMode>(() => {
    try {
      const raw = localStorage.getItem(CHANGES_VIEW_STORAGE_KEY);
      return raw === 'split' ? 'split' : 'stacked';
    } catch {
      return 'stacked';
    }
  });

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [splitKind, setSplitKind] = React.useState<DiffKind>('unstaged');
  const [stackedPreferredKind, setStackedPreferredKind] = React.useState<DiffKind>('unstaged');
  const [expandedDirs, setExpandedDirs] = React.useState<Record<string, boolean>>({});
  const [expandedPullFiles, setExpandedPullFiles] = React.useState<Record<string, boolean>>({});

  const [diffByKey, setDiffByKey] = React.useState<Record<string, DiffState>>({});
  const diffByKeyRef = React.useRef<Record<string, DiffState>>({});
  const inflightRef = React.useRef<Set<string>>(new Set());
  const mountedRef = React.useRef(true);
  const markModeRefreshed = React.useCallback((mode: ChangesDataMode) => {
    const now = Date.now();
    setLastRefreshedByMode((prev) => ({ ...prev, [mode]: now }));
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(CHANGES_VIEW_STORAGE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  React.useEffect(() => {
    try {
      localStorage.setItem(CHANGES_DATA_MODE_STORAGE_KEY, dataMode);
    } catch {
      // ignore
    }
  }, [dataMode]);

  React.useEffect(() => {
    const onOpenPullRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChangesOpenPullRequestDetail>).detail;
      if (!detail || String(detail.droneId ?? '').trim() !== String(droneId ?? '').trim()) return;
      const pullNumber = Number(detail.pullNumber);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      setPullRequestNumber(Math.floor(pullNumber));
      setDataMode('pull-request');
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequest as EventListener);
    return () => window.removeEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequest as EventListener);
  }, [droneId]);

  React.useEffect(() => {
    setPullRequestNumber(selectedPullRequestForDrone(droneId));
  }, [droneId]);

  React.useEffect(() => {
    if (dataMode !== 'pull-request') return;
    if (pullRequestNumber && pullRequestNumber > 0) return;
    setDataMode('pull-preview');
  }, [dataMode, pullRequestNumber]);

  React.useEffect(() => {
    if (!repoAttached || disabled || dataMode !== 'working-tree') {
      setChanges(null);
      setChangesError(null);
      setChangesLoading(false);
      return;
    }

    let mounted = true;
    let timer: any = null;

    const load = async (silent: boolean) => {
      if (!mounted) return;
      if (!silent) setChangesLoading(true);
      try {
        const data = await requestJson<Extract<RepoChangesPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/changes`,
        );
        if (!mounted) return;
        setChanges(data);
        setChangesError(null);
        markModeRefreshed('working-tree');
        startup.markReady();
      } catch (e: any) {
        if (!mounted) return;
        setChangesError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setChangesLoading(false);
      }
    };

    void load(false);
    timer = setInterval(() => {
      void load(true);
    }, 5000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [dataMode, disabled, droneId, markModeRefreshed, refreshNonce, repoAttached, startup.markReady]);

  React.useEffect(() => {
    if (!repoAttached || disabled || dataMode !== 'pull-preview') {
      setPullChanges(null);
      setPullError(null);
      setPullLoading(false);
      return;
    }

    let mounted = true;
    let timer: any = null;

    const load = async (silent: boolean) => {
      if (!mounted) return;
      if (!silent) setPullLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullChangesPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull/changes`,
        );
        if (!mounted) return;
        setPullChanges(data);
        setPullError(null);
        markModeRefreshed('pull-preview');
      } catch (e: any) {
        if (!mounted) return;
        setPullError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setPullLoading(false);
      }
    };

    void load(false);
    timer = setInterval(() => {
      void load(true);
    }, 10000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [dataMode, disabled, droneId, markModeRefreshed, refreshNonce, repoAttached]);

  React.useEffect(() => {
    if (!repoAttached || disabled || dataMode !== 'pull-request' || !pullRequestNumber) {
      setPullRequestChanges(null);
      setPullRequestError(null);
      setPullRequestLoading(false);
      return;
    }
    setPullRequestChanges((prev) => (prev && prev.pullRequest.number === pullRequestNumber ? prev : null));

    let mounted = true;
    const activePullNumber = pullRequestNumber;

    const load = async (silent: boolean) => {
      if (!mounted) return;
      if (!silent) setPullRequestLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestChangesPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${activePullNumber}/changes`,
        );
        if (!mounted) return;
        setPullRequestChanges(data);
        setPullRequestError(null);
        markModeRefreshed('pull-request');
      } catch (e: any) {
        if (!mounted) return;
        const status = Number(e?.status ?? 0);
        if (status === 404) {
          setPullRequestChanges(null);
          setPullRequestError(`PR #${activePullNumber} was not found on GitHub (it may have been deleted or is inaccessible).`);
          return;
        }
        setPullRequestError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setPullRequestLoading(false);
      }
    };

    void load(false);

    return () => {
      mounted = false;
    };
  }, [dataMode, disabled, droneId, markModeRefreshed, pullRequestNumber, refreshNonce, repoAttached]);

  const pullEntriesAsWorkingEntries: RepoChangeEntry[] = React.useMemo(() => {
    const list = pullChanges?.entries ?? [];
    return list.map((e) => ({
      path: e.path,
      originalPath: e.originalPath,
      code: `${String(e.statusChar ?? '?').charAt(0)}.`,
      stagedChar: String(e.statusChar ?? '?').charAt(0),
      unstagedChar: '.',
      stagedType: e.statusType ?? 'unknown',
      unstagedType: null,
      isUntracked: false,
      isIgnored: false,
      isConflicted: e.statusType === 'unmerged',
    }));
  }, [pullChanges?.entries]);

  const pullRequestEntriesAsWorkingEntries: RepoChangeEntry[] = React.useMemo(() => {
    const list = pullRequestChanges?.entries ?? [];
    return list.map((e) => ({
      path: e.path,
      originalPath: e.originalPath,
      code: `${String(e.statusChar ?? '?').charAt(0)}.`,
      stagedChar: String(e.statusChar ?? '?').charAt(0),
      unstagedChar: '.',
      stagedType: e.statusType ?? 'unknown',
      unstagedType: null,
      isUntracked: false,
      isIgnored: false,
      isConflicted: e.statusType === 'unmerged',
    }));
  }, [pullRequestChanges?.entries]);

  const entries =
    dataMode === 'working-tree'
      ? (changes?.entries ?? [])
      : dataMode === 'pull-request'
        ? pullRequestEntriesAsWorkingEntries
        : pullEntriesAsWorkingEntries;
  const listLoading =
    dataMode === 'working-tree' ? changesLoading : dataMode === 'pull-request' ? pullRequestLoading : pullLoading;
  const listError =
    dataMode === 'working-tree' ? changesError : dataMode === 'pull-request' ? pullRequestError : pullError;

  const entriesSignature = React.useMemo(
    () =>
      dataMode === 'working-tree'
        ? entries.map((e) => `${e.path}\u0000${e.code}\u0000${e.originalPath ?? ''}`).join('\n')
        : dataMode === 'pull-request'
          ? [
              'pull-request',
              String(pullRequestChanges?.pullRequest.number ?? ''),
              pullRequestChanges?.pullRequest.baseSha ?? '',
              pullRequestChanges?.pullRequest.headSha ?? '',
              entries.map((e) => `${e.path}\u0000${e.code}\u0000${e.originalPath ?? ''}`).join('\n'),
            ].join('\n')
          : [
              'pull-preview',
              pullChanges?.baseSha ?? '',
              pullChanges?.headSha ?? '',
              entries.map((e) => `${e.path}\u0000${e.code}\u0000${e.originalPath ?? ''}`).join('\n'),
            ].join('\n'),
    [dataMode, entries, pullChanges?.baseSha, pullChanges?.headSha, pullRequestChanges?.pullRequest.baseSha, pullRequestChanges?.pullRequest.headSha, pullRequestChanges?.pullRequest.number],
  );

  React.useEffect(() => {
    setSelectedPath((prev) => {
      if (entries.length === 0) return null;
      if (prev && entries.some((e) => e.path === prev)) return prev;
      return entries[0].path;
    });
  }, [entriesSignature]);

  React.useEffect(() => {
    diffByKeyRef.current = diffByKey;
  }, [diffByKey]);

  React.useEffect(() => {
    setDiffByKey({});
    diffByKeyRef.current = {};
    inflightRef.current.clear();
    setExpandedPullFiles({});
  }, [dataMode, entriesSignature, refreshNonce]);

  const selectedEntry = React.useMemo(
    () => (selectedPath ? entries.find((e) => e.path === selectedPath) ?? null : null),
    [entries, selectedPath],
  );

  React.useEffect(() => {
    if (dataMode !== 'working-tree') return;
    setSplitKind((prev) => {
      const next = effectiveKindForEntry(selectedEntry, prev);
      return next ?? defaultKindForEntry(selectedEntry);
    });
  }, [dataMode, selectedEntry]);

  const explorerTree = React.useMemo(() => buildExplorerTree(entries), [entries]);

  React.useEffect(() => {
    setExpandedDirs((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const node of explorerTree) {
        if (node.kind !== 'dir') continue;
        if (!(node.path in next)) {
          next[node.path] = true;
          changed = true;
        }
      }
      if (selectedPath) {
        for (const p of parentDirPaths(selectedPath)) {
          if (!next[p]) {
            next[p] = true;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [explorerTree, selectedPath]);

  const loadDiff = React.useCallback(
    async (path: string, kind: DiffKind, retryEmptyUntracked = false) => {
      const key = `wt\u0000${diffKey(path, kind)}`;
      if (inflightRef.current.has(key)) return;
      const cur = diffByKeyRef.current[key];
      if (cur?.status === 'loading') return;
      if (cur?.status === 'loaded') {
        const shouldRetryEmptyUntracked =
          retryEmptyUntracked && kind === 'unstaged' && cur.fromUntracked && !String(cur.text ?? '').trim();
        if (!shouldRetryEmptyUntracked) return;
      }

      inflightRef.current.add(key);
      setDiffByKey((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      try {
        const data = await requestJson<Extract<RepoDiffPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/diff?path=${encodeURIComponent(path)}&kind=${kind}`,
        );
        if (!mountedRef.current) return;
        setDiffByKey((prev) => ({
          ...prev,
          [key]: {
            status: 'loaded',
            text: typeof data.diff === 'string' ? data.diff : '',
            truncated: Boolean(data.truncated),
            fromUntracked: Boolean(data.fromUntracked),
            isBinary: false,
            noTextReason: null,
          },
        }));
      } catch (e: any) {
        if (!mountedRef.current) return;
        setDiffByKey((prev) => ({
          ...prev,
          [key]: { status: 'error', error: e?.message ?? String(e) },
        }));
      } finally {
        inflightRef.current.delete(key);
      }
    },
    [droneId],
  );

  const loadPullDiff = React.useCallback(
    async (filePath: string) => {
      const baseSha = String(pullChanges?.baseSha ?? '').trim().toLowerCase();
      const headSha = String(pullChanges?.headSha ?? '').trim().toLowerCase();
      const key = `pull\u0000${baseSha}\u0000${headSha}\u0000${filePath}`;
      if (inflightRef.current.has(key)) return;
      const cur = diffByKeyRef.current[key];
      if (cur && (cur.status === 'loading' || cur.status === 'loaded')) return;

      inflightRef.current.add(key);
      setDiffByKey((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      try {
        const data = await requestJson<Extract<RepoPullDiffPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull/diff?path=${encodeURIComponent(filePath)}&base=${encodeURIComponent(
            baseSha,
          )}&head=${encodeURIComponent(headSha)}`,
        );
        if (!mountedRef.current) return;
        setDiffByKey((prev) => ({
          ...prev,
          [key]: {
            status: 'loaded',
            text: typeof data.diff === 'string' ? data.diff : '',
            truncated: Boolean(data.truncated),
            fromUntracked: false,
            isBinary: false,
            noTextReason: null,
          },
        }));
      } catch (e: any) {
        if (!mountedRef.current) return;
        setDiffByKey((prev) => ({
          ...prev,
          [key]: { status: 'error', error: e?.message ?? String(e) },
        }));
      } finally {
        inflightRef.current.delete(key);
      }
    },
    [droneId, pullChanges?.baseSha, pullChanges?.headSha],
  );

  React.useEffect(() => {
    if (dataMode !== 'pull-request') return;
    const prNumber = Number(pullRequestChanges?.pullRequest.number);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return;
    const list = pullRequestChanges?.entries ?? [];
    setDiffByKey((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const entry of list) {
        const key = `pr\u0000${Math.floor(prNumber)}\u0000${entry.path}`;
        const text = typeof entry.patch === 'string' ? entry.patch : '';
        const value: DiffState = {
          status: 'loaded',
          text,
          truncated: Boolean(entry.truncated),
          fromUntracked: false,
          isBinary: Boolean(entry.isBinary),
          noTextReason: pullRequestNoTextReason(entry),
        };
        const cur = next[key];
        if (
          cur &&
          cur.status === 'loaded' &&
          cur.text === value.text &&
          cur.truncated === value.truncated &&
          cur.isBinary === value.isBinary &&
          cur.noTextReason === value.noTextReason
        ) {
          continue;
        }
        next[key] = value;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [dataMode, pullRequestChanges?.entries, pullRequestChanges?.pullRequest.number]);

  const splitShownKind = effectiveKindForEntry(selectedEntry, splitKind);

  React.useEffect(() => {
    if (dataMode !== 'working-tree') return;
    if (!repoAttached || disabled) return;
    if (!selectedEntry || !splitShownKind) return;
    void loadDiff(selectedEntry.path, splitShownKind, true);
  }, [dataMode, disabled, loadDiff, repoAttached, selectedEntry, splitShownKind]);

  React.useEffect(() => {
    if (dataMode !== 'working-tree') return;
    if (!repoAttached || disabled || viewMode !== 'stacked') return;
    for (const entry of entries) {
      const k = effectiveKindForEntry(entry, stackedPreferredKind);
      if (!k) continue;
      void loadDiff(entry.path, k, true);
    }
  }, [dataMode, disabled, entries, loadDiff, repoAttached, stackedPreferredKind, viewMode]);

  React.useEffect(() => {
    if (dataMode !== 'pull-preview') return;
    if (!repoAttached || disabled) return;
    if (!selectedEntry) return;
    void loadPullDiff(selectedEntry.path);
  }, [dataMode, disabled, loadPullDiff, repoAttached, selectedEntry]);

  const counts = changes?.counts;
  const pullBase = dataMode === 'pull-request' ? (pullRequestChanges?.pullRequest.baseSha ?? null) : (pullChanges?.baseSha ?? null);
  const pullHead = dataMode === 'pull-request' ? (pullRequestChanges?.pullRequest.headSha ?? null) : (pullChanges?.headSha ?? null);
  const pullHostBranch = normalizeRef(pullChanges?.branchContext?.hostCurrent);
  const pullDroneCurrentBranch = normalizeRef(pullChanges?.branchContext?.droneCurrent);
  const pullDroneConfiguredBranch = normalizeRef(pullChanges?.branchContext?.droneConfigured);
  const pullDroneFromRef = normalizeRef(pullChanges?.branchContext?.droneFromRef);
  const pullDroneBranch = pullDroneCurrentBranch ?? pullDroneConfiguredBranch;
  const pullDroneBranchTitle =
    pullDroneCurrentBranch && pullDroneConfiguredBranch && pullDroneCurrentBranch !== pullDroneConfiguredBranch
      ? `Current: ${pullDroneCurrentBranch} | configured: ${pullDroneConfiguredBranch}`
      : pullDroneCurrentBranch ?? pullDroneConfiguredBranch ?? undefined;
  const refreshed = refreshTimeLabel(lastRefreshedByMode[dataMode] ?? null);

  function renderExplorer(nodes: ExplorerNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      if (node.kind === 'dir') {
        const open = expandedDirs[node.path] !== false;
        return (
          <React.Fragment key={`dir:${node.path}`}>
            <button
              type="button"
              onClick={() => {
                setExpandedDirs((prev) => ({ ...prev, [node.path]: !open }));
              }}
              className="w-full text-left h-7 px-2 rounded border border-transparent hover:bg-[var(--hover)] flex items-center gap-1.5"
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              title={node.path}
            >
              <span className="text-[var(--muted-dim)]"><IconChevron open={open} /></span>
              <span className="text-[var(--muted)]"><IconFolder /></span>
              <span className="text-[11px] text-[var(--fg-secondary)] truncate flex-1">{node.name}</span>
              <span className="text-[9px] text-[var(--muted-dim)] tabular-nums">{node.count}</span>
            </button>
            {open && node.children && node.children.length > 0 ? renderExplorer(node.children, depth + 1) : null}
          </React.Fragment>
        );
      }

      const entry = node.entry ?? null;
      if (!entry) return null;
      const active = entry.path === selectedPath;
      return (
        <button
          key={`file:${entry.path}`}
          type="button"
          onClick={() => {
            setSelectedPath(entry.path);
            if (dataMode === 'working-tree') setSplitKind(defaultKindForEntry(entry));
          }}
          className={`w-full text-left h-7 px-2 rounded border transition-colors flex items-center gap-1.5 ${
            active
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
              : 'border-transparent hover:bg-[var(--hover)]'
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          title={entry.path}
        >
          <span className="text-[var(--muted-dim)]"><IconFile /></span>
          <span className="text-[11px] text-[var(--fg-secondary)] truncate flex-1">{node.name}</span>
          <span
            className={`inline-flex items-center justify-center min-w-[30px] h-4 rounded border text-[9px] font-mono ${badgeTone(entry)}`}
            title={statusBadgeTitle(entry, dataMode)}
          >
            {statusCharLabel(entry.stagedChar)}
            {statusCharLabel(entry.unstagedChar)}
          </span>
        </button>
      );
    });
  }

  const statusLegendTitle = "Status badge uses S/U (staged/unstaged). '-' means no change and '?' means untracked.";

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex flex-col relative dh-changes-dock">
      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase" style={{ fontFamily: 'var(--display)' }}>
          Changes
        </div>
        <div data-onboarding-id="changes.viewMode" className="inline-flex items-center gap-1">
          {repoAttached && !disabled ? (
            <>
              <span className="text-[9px] uppercase tracking-wide text-[var(--muted-dim)] mr-1" style={{ fontFamily: 'var(--display)' }}>
                Mode
              </span>
              <button
                type="button"
                onClick={() => setDataMode('working-tree')}
                className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
                  dataMode === 'working-tree'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Working tree changes inside the drone (staged/unstaged)"
              >
                Working
              </button>
              <button
                type="button"
                onClick={() => setDataMode('pull-preview')}
                className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
                  dataMode === 'pull-preview'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Apply preview: committed diff from base to drone HEAD (what applying changes would merge)"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!pullRequestNumber) return;
                  setDataMode('pull-request');
                }}
                disabled={!pullRequestNumber}
                className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
                  dataMode === 'pull-request'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title={pullRequestNumber ? `Exact GitHub PR #${pullRequestNumber} diff` : 'Click a PR title in the PRs tab to set PR mode'}
              >
                PR
              </button>
              <span className="mx-1 text-[var(--border-subtle)]">|</span>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setViewMode('stacked')}
            className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
              viewMode === 'stacked'
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="PR-style stacked view"
          >
            Stacked
          </button>
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
              viewMode === 'split'
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Explorer + focused diff view"
          >
            Explorer
          </button>
          <span className="ml-1 text-[9px] text-[var(--muted-dim)] font-mono tabular-nums" title={refreshed.title}>
            Updated {refreshed.text}
          </span>
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
            title="Refresh changes"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] text-[10px] text-[var(--muted)] flex items-center gap-1.5 min-h-[30px] overflow-x-auto whitespace-nowrap">
        {!repoAttached ? (
          <span>No repo attached.</span>
        ) : disabled ? (
          <span title={String(hubMessage ?? '').trim() || undefined}>
            {startup.timedOut ? 'Still provisioning… repo not ready yet.' : 'Provisioning… waiting for repo.'}
          </span>
        ) : listLoading &&
          ((dataMode === 'working-tree' && !changes) || (dataMode === 'pull-preview' && !pullChanges) || (dataMode === 'pull-request' && !pullRequestChanges)) ? (
          <span>{dataMode === 'pull-request' ? 'Loading pull request…' : dataMode === 'pull-preview' ? 'Loading apply preview…' : 'Loading changes...'}</span>
        ) : listError ? (
          <span className="text-[var(--red)]">{listError}</span>
        ) : (
          <>
            {dataMode === 'pull-preview' ? (
              <>
                <span className="truncate max-w-[44ch]" title={pullChanges?.repoRoot || repoPath || '-'}>
                  {pullChanges?.repoRoot || repoPath || '-'}
                </span>
                <MetaChip label="files" value={pullChanges?.counts.changed ?? 0} />
                <MetaChip label="host" value={shortRefName(pullHostBranch)} title={pullHostBranch ?? ''} mono />
                <MetaChip label="drone" value={shortRefName(pullDroneBranch)} title={pullDroneBranchTitle} mono />
                {pullDroneFromRef ? <MetaChip label="from" value={shortRefName(pullDroneFromRef)} title={pullDroneFromRef} mono /> : null}
                <MetaChip label="base" value={shortSha(pullBase)} title={pullBase ?? ''} mono />
                <MetaChip label="head" value={shortSha(pullHead)} title={pullHead ?? ''} mono />
              </>
            ) : dataMode === 'pull-request' ? (
              <>
                <span className="truncate max-w-[38ch]" title={pullRequestChanges?.repoRoot || repoPath || '-'}>
                  {pullRequestChanges?.repoRoot || repoPath || '-'}
                </span>
                <MetaChip
                  label="pr"
                  value={`#${pullRequestChanges?.pullRequest.number ?? pullRequestNumber ?? '-'}`}
                  title={pullRequestChanges?.pullRequest.title || undefined}
                  mono
                />
                <MetaChip label="files" value={pullRequestChanges?.counts.changed ?? 0} />
                <MetaChip label="+" value={pullRequestChanges?.counts.additions ?? 0} mono />
                <MetaChip label="-" value={pullRequestChanges?.counts.deletions ?? 0} mono />
                <MetaChip label="base" value={shortSha(pullBase)} title={pullBase ?? ''} mono />
                <MetaChip label="head" value={shortSha(pullHead)} title={pullHead ?? ''} mono />
              </>
            ) : (
              <>
                <span className="truncate max-w-[44ch]" title={changes?.repoRoot || repoPath || '-'}>
                  {changes?.repoRoot || repoPath || '-'}
                </span>
                <MetaChip label="changed" value={counts?.changed ?? 0} />
                <MetaChip label="staged" value={counts?.staged ?? 0} />
                <MetaChip label="unstaged" value={counts?.unstaged ?? 0} />
                <MetaChip label="status" value="S/U" title={statusLegendTitle} mono />
                {changes?.branch.head && (
                  <span
                    className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1.5 py-[1px] text-[10px]"
                    title={changes.branch.head}
                  >
                    <span className="uppercase tracking-[0.08em] text-[var(--muted-dim)]">branch</span>
                    <span className="font-mono text-[var(--fg-secondary)] truncate max-w-[28ch]">
                      {changes.branch.head}
                    </span>
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>

      {!repoAttached ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">Attach a repo to see source-control changes.</div>
      ) : disabled ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
            <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {provisioningLabel(hubPhase)}
            </div>
            <div className="mt-1">
              {startup.timedOut
                ? 'Still waiting for the repository to become available.'
                : 'Waiting for repository…'}
            </div>
            {String(hubMessage ?? '').trim() ? (
              <div className="mt-1 text-[10px] text-[var(--muted-dim)]">{String(hubMessage ?? '').trim()}</div>
            ) : null}
            {startup.timedOut ? (
              <div className="mt-2 text-[10px] text-[var(--muted-dim)]">
                If this persists, check the drone status/error details in the sidebar.
              </div>
            ) : null}
          </div>
        </div>
      ) : listError ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--red)]">{listError}</div>
      ) : entries.length === 0 && !listLoading ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">
          {dataMode === 'pull-request'
            ? pullRequestNumber
              ? `No file changes found for PR #${pullRequestNumber}.`
              : 'No pull request selected.'
            : dataMode === 'pull-preview'
              ? 'No apply changes to preview.'
              : 'Working tree is clean.'}
        </div>
      ) : viewMode === 'stacked' ? (
        <div className="flex-1 min-h-0 overflow-auto">
          {dataMode === 'working-tree' ? (
            <>
              <div className="sticky top-0 z-10 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur flex items-center gap-1">
                <span className="text-[10px] text-[var(--muted)] mr-1">Prefer:</span>
                <button
                  type="button"
                  onClick={() => setStackedPreferredKind('unstaged')}
                  className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
                    stackedPreferredKind === 'unstaged'
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Unstaged
                </button>
                <button
                  type="button"
                  onClick={() => setStackedPreferredKind('staged')}
                  className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
                    stackedPreferredKind === 'staged'
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Staged
                </button>
              </div>

              <div className="px-2 py-2 flex flex-col gap-2">
                {entries.map((entry) => {
                  const k = effectiveKindForEntry(entry, stackedPreferredKind);
                  if (!k) return null;
                  const state = diffByKey[`wt\u0000${diffKey(entry.path, k)}`];
                  const fallback = k !== stackedPreferredKind;
                  return (
                    <section key={`stacked:${entry.path}`} className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden">
                      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/70 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center min-w-[32px] h-5 rounded border text-[10px] font-mono ${badgeTone(entry)}`}
                          title={statusBadgeTitle(entry, dataMode)}
                        >
                          {statusCharLabel(entry.stagedChar)}
                          {statusCharLabel(entry.unstagedChar)}
                        </span>
                        <span className="text-[11px] text-[var(--fg-secondary)] font-mono truncate flex-1" title={entry.path}>
                          {entry.path}
                        </span>
                        <span className="text-[9px] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                          {k}{fallback ? ' (fallback)' : ''}
                        </span>
                      </div>
                      <DiffBlock state={state} />
                    </section>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="px-2 py-2 flex flex-col gap-2">
              {entries.map((entry) => {
                const open = expandedPullFiles[entry.path] === true;
                const key =
                  dataMode === 'pull-request'
                    ? `pr\u0000${Math.max(1, Math.floor(Number(pullRequestChanges?.pullRequest.number ?? pullRequestNumber ?? 0)))}\u0000${entry.path}`
                    : `pull\u0000${String(pullChanges?.baseSha ?? '').trim().toLowerCase()}\u0000${String(
                        pullChanges?.headSha ?? '',
                      )
                        .trim()
                        .toLowerCase()}\u0000${entry.path}`;
                const state = diffByKey[key];
                return (
                  <section key={`${dataMode === 'pull-request' ? 'pr' : 'apply'}:${entry.path}`} className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden">
                    <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/70 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center justify-center min-w-[32px] h-5 rounded border text-[10px] font-mono ${badgeTone(entry)}`}
                        title={statusBadgeTitle(entry, dataMode)}
                      >
                        {statusCharLabel(entry.stagedChar)}
                        {statusCharLabel(entry.unstagedChar)}
                      </span>
                      <span className="text-[11px] text-[var(--fg-secondary)] font-mono truncate flex-1" title={entry.path}>
                        {entry.path}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedPullFiles((prev) => {
                            const next = { ...prev, [entry.path]: !open };
                            return next;
                          });
                          if (!open && dataMode === 'pull-preview') void loadPullDiff(entry.path);
                        }}
                        className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                        title={open ? 'Hide diff' : 'Show diff'}
                      >
                        {open ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {open ? <DiffBlock state={state} /> : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden flex">
          <div className="w-[clamp(160px,24%,260px)] shrink-0 border-r border-[var(--border-subtle)] overflow-auto px-1.5 py-1">
            {renderExplorer(explorerTree, 0)}
          </div>

          <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-[rgba(0,0,0,.12)]">
            <div className="sticky top-0 z-10 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur flex items-center justify-between gap-2">
              <div className="min-w-0 text-[10px] text-[var(--muted)] font-mono truncate">
                {selectedEntry ? selectedEntry.path : 'No file selected'}
              </div>
              {dataMode === 'working-tree' ? (
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSplitKind('unstaged')}
                    disabled={!hasUnstaged(selectedEntry)}
                    className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
                      splitShownKind === 'unstaged'
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Unstaged diff"
                  >
                    Unstaged
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitKind('staged')}
                    disabled={!hasStaged(selectedEntry)}
                    className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
                      splitShownKind === 'staged'
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Staged diff"
                  >
                    Staged
                  </button>
                </div>
              ) : (
                <div className="text-[9px] text-[var(--muted-dim)] font-mono whitespace-nowrap">
                  {dataMode === 'pull-request'
                    ? `PR #${pullRequestChanges?.pullRequest.number ?? pullRequestNumber ?? '-'} ${shortSha(pullBase)}..${shortSha(pullHead)}`
                    : `${shortSha(pullBase)}..${shortSha(pullHead)}`}
                </div>
              )}
            </div>

            {dataMode === 'working-tree' ? (
              !selectedEntry || !splitShownKind ? (
                <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Select a changed file to inspect its diff.</div>
              ) : (
                <DiffBlock state={diffByKey[`wt\u0000${diffKey(selectedEntry.path, splitShownKind)}`]} />
              )
            ) : !selectedEntry ? (
              <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Select a changed file to inspect its diff.</div>
            ) : (
              <DiffBlock
                state={
                  dataMode === 'pull-request'
                    ? diffByKey[
                        `pr\u0000${Math.max(1, Math.floor(Number(pullRequestChanges?.pullRequest.number ?? pullRequestNumber ?? 0)))}\u0000${selectedEntry.path}`
                      ]
                    : diffByKey[
                        `pull\u0000${String(pullChanges?.baseSha ?? '').trim().toLowerCase()}\u0000${String(pullChanges?.headSha ?? '')
                          .trim()
                          .toLowerCase()}\u0000${selectedEntry.path}`
                      ]
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
