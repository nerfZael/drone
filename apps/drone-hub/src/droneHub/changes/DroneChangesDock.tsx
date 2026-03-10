import React from 'react';
import { requestJson } from '../http';
import { IconChevron, IconFolder, iconForFilePath } from '../icons';
import { IconPencil } from '../app/icons';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import type {
  RepoChangeEntry,
  RepoChangesPayload,
  RepoDiffPayload,
  RepoPullChangesPayload,
  RepoPullDiffPayload,
  RepoPullRequestClosePayload,
  RepoPullRequestChangesPayload,
  RepoPullRequestMergePayload,
  RepoSourcePayload,
} from '../types';
import {
  CHANGES_OPEN_PULL_REQUEST_EVENT,
  type ChangesOpenPullRequestDetail,
  consumeRequestedPullRequestForDrone,
  requestedPullRequestForDrone,
  selectedPullRequestForDrone,
} from './navigation';
import { DiffBlock } from './DiffBlock';
import type { DiffExpansionRange, DiffState, DiffViewType } from './types';
import {
  CHANGES_DIFF_VIEW_STORAGE_KEY,
  CHANGES_EXPLORER_ZOOM_STORAGE_KEY,
  CHANGES_EXPLORER_WIDTH_STORAGE_KEY,
  CHANGES_VIEW_STORAGE_KEY,
  readChangesStorage,
  removeChangesStorage,
  writeChangesStorage,
} from './storage';
import {
  badgeTone,
  appendDiffExpansionRange,
  buildExplorerTree,
  changesPrMergeMethod,
  defaultKindForEntry,
  entryPathExistsInCurrentTree,
  estimateExplorerSidebarWidth,
  diffKey,
  effectiveKindForEntry,
  flattenVisibleExplorerRows,
  hasStaged,
  hasUnstaged,
  normalizeRef,
  parentDirPaths,
  pullRequestNoTextReason,
  pullRequestStateBadge,
  refreshTimeLabel,
  resolveExplorerSidebarWidthBounds,
  sortRepoChangeEntries,
  shortRefName,
  shortSha,
  statusBadgeTitle,
  statusCharLabel,
  toWorkingEntriesFromPull,
  type ChangesDataMode,
  type DiffKind,
  type ExplorerNode,
} from './helpers';

type ChangesViewMode = 'stacked' | 'split';
type LastRefreshedByMode = Record<ChangesDataMode, number | null>;
const EXPLORER_SIDEBAR_MIN_WIDTH_PX = 180;
const EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX = 240;
const EXPLORER_SIDEBAR_MAX_WIDTH_PX = 360;
const EXPLORER_SIDEBAR_MAX_RATIO = 0.36;
const CHANGES_DIFF_MIN_WIDTH_PX = 420;
const EXPLORER_WIDTH_UPDATE_THRESHOLD_PX = 8;
const EXPLORER_ZOOM_MIN = 0.9;
const EXPLORER_ZOOM_DEFAULT = 1;
const EXPLORER_ZOOM_MAX = 1.4;
const EXPLORER_ZOOM_STEP = 0.1;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampExplorerZoom(value: number): number {
  return Math.round(clampNumber(value, EXPLORER_ZOOM_MIN, EXPLORER_ZOOM_MAX) * 100) / 100;
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
  repoAttached,
  repoPath,
  repoUnavailableReason,
  disabled,
  hubPhase,
  hubMessage,
  onRevealFileInFiles,
  onOpenFileInEditor,
}: {
  droneId: string;
  repoAttached: boolean;
  repoPath: string;
  repoUnavailableReason?: string | null;
  disabled: boolean;
  hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
  onRevealFileInFiles: (repoRelativePath: string) => void;
  onOpenFileInEditor: (repoRelativePath: string) => void;
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
  const initialRequestedPullNumberRef = React.useRef<number | null>(requestedPullRequestForDrone(droneId));
  const [pullRequestNumber, setPullRequestNumber] = React.useState<number | null>(
    () => initialRequestedPullNumberRef.current ?? selectedPullRequestForDrone(droneId),
  );
  const [pullRequestChanges, setPullRequestChanges] = React.useState<Extract<RepoPullRequestChangesPayload, { ok: true }> | null>(null);
  const [pullRequestLoading, setPullRequestLoading] = React.useState(false);
  const [pullRequestError, setPullRequestError] = React.useState<string | null>(null);
  const [pullRequestActionBusy, setPullRequestActionBusy] = React.useState<'merge' | 'close' | null>(null);
  const [pullRequestActionError, setPullRequestActionError] = React.useState<string | null>(null);
  const [pullRequestActionNotice, setPullRequestActionNotice] = React.useState<string | null>(null);
  const [lastRefreshedByMode, setLastRefreshedByMode] = React.useState<LastRefreshedByMode>({
    'working-tree': null,
    'pull-preview': null,
    'pull-request': null,
  });

  const [dataMode, setDataMode] = React.useState<ChangesDataMode>(() =>
    initialRequestedPullNumberRef.current && initialRequestedPullNumberRef.current > 0 ? 'pull-request' : 'working-tree',
  );

  const [viewMode, setViewMode] = React.useState<ChangesViewMode>(() => {
    const raw = readChangesStorage(CHANGES_VIEW_STORAGE_KEY);
    return raw === 'split' ? 'split' : 'stacked';
  });
  const [diffViewType, setDiffViewType] = React.useState<DiffViewType>(() => {
    const raw = readChangesStorage(CHANGES_DIFF_VIEW_STORAGE_KEY);
    return raw === 'split' ? 'split' : 'unified';
  });

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [splitKind, setSplitKind] = React.useState<DiffKind>('unstaged');
  const [stackedPreferredKind, setStackedPreferredKind] = React.useState<DiffKind>('unstaged');
  const [expandedDirs, setExpandedDirs] = React.useState<Record<string, boolean>>({});
  const [expandedPullFiles, setExpandedPullFiles] = React.useState<Record<string, boolean>>({});
  const splitLayoutRef = React.useRef<HTMLDivElement | null>(null);
  const [explorerManualWidthPx, setExplorerManualWidthPx] = React.useState<number | null>(() => {
    const raw = Number(readChangesStorage(CHANGES_EXPLORER_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(raw) || raw < 120) return null;
    return Math.floor(raw);
  });
  const [explorerZoom, setExplorerZoom] = React.useState<number>(() => {
    const raw = Number(readChangesStorage(CHANGES_EXPLORER_ZOOM_STORAGE_KEY));
    if (!Number.isFinite(raw)) return EXPLORER_ZOOM_DEFAULT;
    return clampExplorerZoom(raw);
  });
  const [explorerWidthPx, setExplorerWidthPx] = React.useState(EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX);
  const [explorerResizing, setExplorerResizing] = React.useState(false);
  const explorerDragRef = React.useRef<{ pointerId: number; startX: number; startWidth: number; liveWidth: number } | null>(
    null,
  );
  const explorerResizeBodyStyleRef = React.useRef<{ cursor: string; userSelect: string } | null>(null);
  const explorerWidthOptions = React.useMemo(
    () => ({
      minWidthPx: EXPLORER_SIDEBAR_MIN_WIDTH_PX,
      maxWidthPx: EXPLORER_SIDEBAR_MAX_WIDTH_PX,
      maxWidthRatio: EXPLORER_SIDEBAR_MAX_RATIO,
      minDiffWidthPx: CHANGES_DIFF_MIN_WIDTH_PX,
      fallbackWidthPx: EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX,
    }),
    [],
  );

  const [diffByKey, setDiffByKey] = React.useState<Record<string, DiffState>>({});
  const [expandedRangesByDiffKey, setExpandedRangesByDiffKey] = React.useState<Record<string, DiffExpansionRange[]>>({});
  const diffByKeyRef = React.useRef<Record<string, DiffState>>({});
  const diffSourceByKeyRef = React.useRef<Record<string, string | null>>({});
  const diffSourceInflightByKeyRef = React.useRef<Record<string, Promise<string | null>>>({});
  const inflightRef = React.useRef<Set<string>>(new Set());
  const mountedRef = React.useRef(true);
  const dockRootRef = React.useRef<HTMLDivElement | null>(null);
  const [dockHovered, setDockHovered] = React.useState(false);
  const [hoveredFilePath, setHoveredFilePath] = React.useState<string | null>(null);
  const explorerZoomPercent = Math.round(explorerZoom * 100);
  const explorerRowHeightPx = Math.max(28, Math.round(28 * explorerZoom));
  const explorerIconSizePx = Math.max(12, Math.round(12 * explorerZoom));
  const explorerLeadingSlotPx = Math.max(explorerIconSizePx, Math.round(12 * explorerZoom));
  const explorerTextSizePx = Math.max(11, Math.round(11 * explorerZoom * 10) / 10);
  const explorerMetaTextSizePx = Math.max(9, Math.round(9 * explorerZoom * 10) / 10);
  const explorerIndentBasePx = Math.max(6, Math.round(6 * explorerZoom));
  const explorerIndentStepPx = Math.max(9, Math.round(9 * explorerZoom));
  const explorerBadgeMinWidthPx = Math.max(22, Math.round(22 * explorerZoom));
  const explorerBadgeHeightPx = Math.max(16, Math.round(16 * explorerZoom));
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
    writeChangesStorage(CHANGES_VIEW_STORAGE_KEY, viewMode);
  }, [viewMode]);
  React.useEffect(() => {
    writeChangesStorage(CHANGES_DIFF_VIEW_STORAGE_KEY, diffViewType);
  }, [diffViewType]);

  React.useEffect(() => {
    if (explorerManualWidthPx === null) {
      removeChangesStorage(CHANGES_EXPLORER_WIDTH_STORAGE_KEY);
      return;
    }
    writeChangesStorage(CHANGES_EXPLORER_WIDTH_STORAGE_KEY, String(Math.floor(explorerManualWidthPx)));
  }, [explorerManualWidthPx]);
  React.useEffect(() => {
    writeChangesStorage(CHANGES_EXPLORER_ZOOM_STORAGE_KEY, String(explorerZoom));
  }, [explorerZoom]);

  React.useEffect(() => {
    const onOpenPullRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChangesOpenPullRequestDetail>).detail;
      if (!detail || String(detail.droneId ?? '').trim() !== String(droneId ?? '').trim()) return;
      const pullNumber = Number(detail.pullNumber);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      const normalizedPullNumber = Math.floor(pullNumber);
      consumeRequestedPullRequestForDrone(droneId);
      setPullRequestNumber(normalizedPullNumber);
      setDataMode('pull-request');
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequest as EventListener);
    return () => window.removeEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequest as EventListener);
  }, [droneId]);

  React.useEffect(() => {
    const requestedPullNumber = consumeRequestedPullRequestForDrone(droneId);
    if (requestedPullNumber && requestedPullNumber > 0) {
      setPullRequestNumber(requestedPullNumber);
      setDataMode('pull-request');
      setRefreshNonce((n) => n + 1);
      return;
    }
    setPullRequestNumber(selectedPullRequestForDrone(droneId));
    setDataMode('working-tree');
  }, [droneId]);

  React.useEffect(() => {
    if (dataMode !== 'pull-request') return;
    if (pullRequestNumber && pullRequestNumber > 0) return;
    setDataMode('working-tree');
  }, [dataMode, pullRequestNumber]);

  React.useEffect(() => {
    setPullRequestActionError(null);
    setPullRequestActionNotice(null);
  }, [dataMode, pullRequestNumber]);

  React.useEffect(() => {
    if (!pullRequestActionNotice) return;
    const timer = setTimeout(() => setPullRequestActionNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [pullRequestActionNotice]);

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

  const workingTreeEntries = React.useMemo(() => sortRepoChangeEntries(changes?.entries ?? []), [changes?.entries]);

  const pullEntriesAsWorkingEntries: RepoChangeEntry[] = React.useMemo(() => {
    return sortRepoChangeEntries(toWorkingEntriesFromPull(pullChanges?.entries ?? []));
  }, [pullChanges?.entries]);

  const pullRequestEntriesAsWorkingEntries: RepoChangeEntry[] = React.useMemo(() => {
    return sortRepoChangeEntries(toWorkingEntriesFromPull(pullRequestChanges?.entries ?? []));
  }, [pullRequestChanges?.entries]);

  const entries =
    dataMode === 'working-tree'
      ? workingTreeEntries
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
    setExpandedRangesByDiffKey({});
    diffByKeyRef.current = {};
    diffSourceByKeyRef.current = {};
    diffSourceInflightByKeyRef.current = {};
    inflightRef.current.clear();
    setExpandedPullFiles({});
    setHoveredFilePath(null);
  }, [dataMode, entriesSignature, refreshNonce]);

  React.useEffect(() => {
    if (!hoveredFilePath) return;
    if (entries.some((entry) => entry.path === hoveredFilePath)) return;
    setHoveredFilePath(null);
  }, [entries, hoveredFilePath]);

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

  const recomputeExplorerWidth = React.useCallback(() => {
    if (viewMode !== 'split') return;
    if (explorerDragRef.current) return;
    const splitWidth = splitLayoutRef.current?.clientWidth ?? 0;
    if (splitWidth <= 0) return;
    const bounds = resolveExplorerSidebarWidthBounds(splitWidth, explorerWidthOptions);
    const rows = flattenVisibleExplorerRows(explorerTree, expandedDirs);
    const autoWidth = clampNumber(
      Math.floor(estimateExplorerSidebarWidth(rows, splitWidth, explorerWidthOptions) * explorerZoom),
      bounds.minWidthPx,
      bounds.maxWidthPx,
    );
    const nextWidth =
      explorerManualWidthPx === null
        ? autoWidth
        : clampNumber(explorerManualWidthPx, bounds.minWidthPx, bounds.maxWidthPx);
    setExplorerWidthPx((prev) => {
      const outOfBounds = prev < bounds.minWidthPx || prev > bounds.maxWidthPx;
      if (outOfBounds || Math.abs(prev - nextWidth) >= EXPLORER_WIDTH_UPDATE_THRESHOLD_PX) return nextWidth;
      return prev;
    });
  }, [expandedDirs, explorerManualWidthPx, explorerTree, explorerWidthOptions, explorerZoom, viewMode]);

  const restoreResizeBodyStyles = React.useCallback(() => {
    const styles = explorerResizeBodyStyleRef.current;
    if (!styles) return;
    document.body.style.cursor = styles.cursor;
    document.body.style.userSelect = styles.userSelect;
    explorerResizeBodyStyleRef.current = null;
  }, []);

  const finishExplorerResize = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = explorerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const finalWidth = Math.floor(drag.liveWidth);
      explorerDragRef.current = null;
      setExplorerResizing(false);
      setExplorerWidthPx(finalWidth);
      setExplorerManualWidthPx(finalWidth);
      restoreResizeBodyStyles();
    },
    [restoreResizeBodyStyles],
  );

  const startExplorerResize = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (viewMode !== 'split') return;
      const splitWidth = splitLayoutRef.current?.clientWidth ?? 0;
      if (splitWidth <= 0) return;
      const bounds = resolveExplorerSidebarWidthBounds(splitWidth, explorerWidthOptions);
      const startWidth = clampNumber(explorerWidthPx, bounds.minWidthPx, bounds.maxWidthPx);
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      explorerDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
        liveWidth: startWidth,
      };
      explorerResizeBodyStyleRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      setExplorerResizing(true);
    },
    [explorerWidthOptions, explorerWidthPx, viewMode],
  );

  const moveExplorerResize = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = explorerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const splitWidth = splitLayoutRef.current?.clientWidth ?? 0;
      if (splitWidth <= 0) return;
      const bounds = resolveExplorerSidebarWidthBounds(splitWidth, explorerWidthOptions);
      const delta = drag.startX - event.clientX;
      const nextWidth = clampNumber(drag.startWidth + delta, bounds.minWidthPx, bounds.maxWidthPx);
      drag.liveWidth = nextWidth;
      setExplorerWidthPx(nextWidth);
    },
    [explorerWidthOptions],
  );

  const resetExplorerWidthPreference = React.useCallback(() => {
    setExplorerManualWidthPx(null);
  }, []);

  const decreaseExplorerZoom = React.useCallback(() => {
    setExplorerZoom((prev) => clampExplorerZoom(prev - EXPLORER_ZOOM_STEP));
  }, []);

  const increaseExplorerZoom = React.useCallback(() => {
    setExplorerZoom((prev) => clampExplorerZoom(prev + EXPLORER_ZOOM_STEP));
  }, []);

  const resetExplorerZoom = React.useCallback(() => {
    setExplorerZoom(EXPLORER_ZOOM_DEFAULT);
  }, []);

  React.useEffect(() => {
    recomputeExplorerWidth();
  }, [recomputeExplorerWidth]);

  React.useEffect(() => {
    if (viewMode !== 'split') return;
    const splitEl = splitLayoutRef.current;
    if (!splitEl) return;

    let raf = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        recomputeExplorerWidth();
      });
    };

    schedule();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', schedule);
      return () => {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('resize', schedule);
      };
    }

    const observer = new ResizeObserver(() => {
      schedule();
    });
    observer.observe(splitEl);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [recomputeExplorerWidth, viewMode]);

  React.useEffect(() => {
    if (viewMode === 'split') return;
    explorerDragRef.current = null;
    setExplorerResizing(false);
    restoreResizeBodyStyles();
  }, [restoreResizeBodyStyles, viewMode]);

  React.useEffect(() => {
    return () => {
      restoreResizeBodyStyles();
    };
  }, [restoreResizeBodyStyles]);

  const workingDiffStateKey = React.useCallback((path: string, kind: DiffKind) => `wt\u0000${diffKey(path, kind)}`, []);
  const pullPreviewDiffStateKey = React.useCallback(
    (path: string, baseSha: string | null | undefined, headSha: string | null | undefined) =>
      `pull\u0000${String(baseSha ?? '').trim().toLowerCase()}\u0000${String(headSha ?? '').trim().toLowerCase()}\u0000${path}`,
    [],
  );
  const pullRequestDiffStateKey = React.useCallback(
    (path: string, prNumber: number | null | undefined) => `pr\u0000${Math.max(1, Math.floor(Number(prNumber ?? 0)))}\u0000${path}`,
    [],
  );
  const clearDiffExpansionSource = React.useCallback((key: string) => {
    delete diffSourceByKeyRef.current[key];
    delete diffSourceInflightByKeyRef.current[key];
  }, []);

  const clearExpandedRangesForDiff = React.useCallback((key: string) => {
    setExpandedRangesByDiffKey((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const addExpandedRangeForDiff = React.useCallback((key: string, range: DiffExpansionRange) => {
    setExpandedRangesByDiffKey((prev) => {
      const current = prev[key] ?? [];
      const nextRanges = appendDiffExpansionRange(current, range);
      if (nextRanges === current) return prev;
      return { ...prev, [key]: nextRanges };
    });
  }, []);

  const loadDiffExpansionSource = React.useCallback(
    async ({
      stateKey,
      filePath,
      source,
      sha,
    }: {
      stateKey: string;
      filePath: string;
      source: 'index' | 'head' | 'sha';
      sha?: string | null;
    }): Promise<string | null> => {
      if (stateKey in diffSourceByKeyRef.current) {
        return diffSourceByKeyRef.current[stateKey] ?? null;
      }
      const existing = diffSourceInflightByKeyRef.current[stateKey];
      if (existing) return existing;

      const request = requestJson<Extract<RepoSourcePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/source?path=${encodeURIComponent(filePath)}&source=${source}${
          source === 'sha' && typeof sha === 'string' && sha.trim() ? `&sha=${encodeURIComponent(sha.trim().toLowerCase())}` : ''
        }`,
      )
        .then((data) => {
          const next = data.exists ? String(data.source ?? '') : '';
          diffSourceByKeyRef.current[stateKey] = next;
          return next;
        })
        .finally(() => {
          delete diffSourceInflightByKeyRef.current[stateKey];
        });

      diffSourceInflightByKeyRef.current[stateKey] = request;
      return request;
    },
    [droneId],
  );

  const loadDiff = React.useCallback(
    async (path: string, kind: DiffKind, retryEmptyUntracked = false, force = false) => {
      const key = workingDiffStateKey(path, kind);
      if (inflightRef.current.has(key)) return;
      const cur = diffByKeyRef.current[key];
      if (cur?.status === 'loading') return;
      if (cur?.status === 'loaded') {
        const shouldRetryEmptyUntracked =
          retryEmptyUntracked && kind === 'unstaged' && cur.fromUntracked && !String(cur.text ?? '').trim();
        if (!force && !shouldRetryEmptyUntracked) return;
      }

      inflightRef.current.add(key);
      clearDiffExpansionSource(key);
      clearExpandedRangesForDiff(key);
      setDiffByKey((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      try {
        const data = await requestJson<Extract<RepoDiffPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/diff?path=${encodeURIComponent(path)}&kind=${kind}&contextLines=3`,
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
            contextLines: 3,
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
    [clearDiffExpansionSource, clearExpandedRangesForDiff, droneId, workingDiffStateKey],
  );

  const loadRangeDiff = React.useCallback(
    async ({
      filePath,
      baseSha,
      headSha,
      stateKey,
      force = false,
    }: {
      filePath: string;
      baseSha: string | null | undefined;
      headSha: string | null | undefined;
      stateKey: string;
      force?: boolean;
    }) => {
      const key = stateKey;
      if (inflightRef.current.has(key)) return;
      const cur = diffByKeyRef.current[key];
      if (cur?.status === 'loading') return;
      if (!force && cur?.status === 'loaded') return;

      inflightRef.current.add(key);
      clearDiffExpansionSource(key);
      clearExpandedRangesForDiff(key);
      setDiffByKey((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      try {
        const data = await requestJson<Extract<RepoPullDiffPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull/diff?path=${encodeURIComponent(filePath)}&base=${encodeURIComponent(
            String(baseSha ?? '').trim().toLowerCase(),
          )}&head=${encodeURIComponent(String(headSha ?? '').trim().toLowerCase())}&contextLines=3`,
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
            contextLines: 3,
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
    [clearDiffExpansionSource, clearExpandedRangesForDiff, droneId],
  );

  React.useEffect(() => {
    if (dataMode !== 'pull-request') return;
    const prNumber = Number(pullRequestChanges?.pullRequest.number);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return;
    const list = pullRequestChanges?.entries ?? [];
    for (const entry of list) {
      const key = `pr\u0000${Math.floor(prNumber)}\u0000${entry.path}`;
      clearDiffExpansionSource(key);
      clearExpandedRangesForDiff(key);
    }
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
          contextLines: 3,
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
  }, [clearDiffExpansionSource, clearExpandedRangesForDiff, dataMode, pullRequestChanges?.entries, pullRequestChanges?.pullRequest.number]);

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
    const key = pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha);
    void loadRangeDiff({
      filePath: selectedEntry.path,
      baseSha: pullChanges?.baseSha,
      headSha: pullChanges?.headSha,
      stateKey: key,
    });
  }, [dataMode, disabled, loadRangeDiff, pullChanges?.baseSha, pullChanges?.headSha, pullPreviewDiffStateKey, repoAttached, selectedEntry]);

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
  const selectedPullRequestNumber =
    dataMode === 'pull-request' ? Math.max(1, Math.floor(Number(pullRequestNumber ?? 0))) || null : null;
  const loadedPullRequestNumber =
    dataMode === 'pull-request' ? Math.max(1, Math.floor(Number(pullRequestChanges?.pullRequest.number ?? 0))) || null : null;
  const hasLoadedActivePullRequest =
    dataMode === 'pull-request' &&
    Boolean(selectedPullRequestNumber) &&
    Boolean(loadedPullRequestNumber) &&
    selectedPullRequestNumber === loadedPullRequestNumber;
  const activePullRequestNumber = hasLoadedActivePullRequest ? loadedPullRequestNumber : null;
  const awaitingPullRequestDetails =
    dataMode === 'pull-request' && Boolean(selectedPullRequestNumber) && !hasLoadedActivePullRequest && !pullRequestError;
  const activePullRequestTitleRaw = dataMode === 'pull-request' ? String(pullRequestChanges?.pullRequest.title ?? '').trim() : '';
  const activePullRequestHtmlUrl = dataMode === 'pull-request' ? String(pullRequestChanges?.pullRequest.htmlUrl ?? '').trim() : '';
  const activePullRequestState = dataMode === 'pull-request' ? String(pullRequestChanges?.pullRequest.state ?? '').trim().toLowerCase() : '';
  const activePullRequestStatus = dataMode === 'pull-request' ? pullRequestStateBadge(pullRequestChanges?.pullRequest.state) : null;
  const activePullRequestIsFinalState = activePullRequestState === 'merged' || activePullRequestState === 'closed';
  const activePullRequestActionBlockedReason = !activePullRequestNumber
    ? 'No pull request selected.'
    : activePullRequestIsFinalState
      ? `PR is already ${activePullRequestState}.`
      : null;
  const refreshed = refreshTimeLabel(lastRefreshedByMode[dataMode] ?? null);

  const mergeActivePullRequest = React.useCallback(async () => {
    if (!activePullRequestNumber || pullRequestActionBusy || activePullRequestIsFinalState) return;
    const mergeMethod = changesPrMergeMethod();
    if (!window.confirm(`Merge PR #${activePullRequestNumber} using "${mergeMethod}"?`)) return;
    setPullRequestActionError(null);
    setPullRequestActionNotice(null);
    setPullRequestActionBusy('merge');
    try {
      const merged = await requestJson<Extract<RepoPullRequestMergePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${activePullRequestNumber}/merge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: mergeMethod }),
        },
      );
      if (!mountedRef.current) return;
      if (merged.merged) {
        setPullRequestChanges((prev) =>
          prev && prev.pullRequest.number === activePullRequestNumber
            ? { ...prev, pullRequest: { ...prev.pullRequest, state: 'merged' } }
            : prev,
        );
      }
      setPullRequestActionNotice(merged.message || `Merged PR #${activePullRequestNumber}.`);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setPullRequestActionError(e?.message ?? String(e));
    } finally {
      if (mountedRef.current) setPullRequestActionBusy(null);
    }
  }, [activePullRequestIsFinalState, activePullRequestNumber, droneId, pullRequestActionBusy]);

  const closeActivePullRequest = React.useCallback(async () => {
    if (!activePullRequestNumber || pullRequestActionBusy || activePullRequestIsFinalState) return;
    if (!window.confirm(`Close PR #${activePullRequestNumber} without merging?`)) return;
    setPullRequestActionError(null);
    setPullRequestActionNotice(null);
    setPullRequestActionBusy('close');
    try {
      const closed = await requestJson<Extract<RepoPullRequestClosePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${activePullRequestNumber}/close`,
        { method: 'POST' },
      );
      if (!mountedRef.current) return;
      const state = String(closed.state ?? 'closed').trim().toLowerCase() || 'closed';
      setPullRequestChanges((prev) =>
        prev && prev.pullRequest.number === activePullRequestNumber
          ? {
              ...prev,
              pullRequest: {
                ...prev.pullRequest,
                state,
                title: String(closed.title ?? prev.pullRequest.title).trim() || prev.pullRequest.title,
                htmlUrl: closed.htmlUrl ?? prev.pullRequest.htmlUrl,
              },
            }
          : prev,
      );
      setPullRequestActionNotice(`Closed PR #${closed.number}.`);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setPullRequestActionError(e?.message ?? String(e));
    } finally {
      if (mountedRef.current) setPullRequestActionBusy(null);
    }
  }, [activePullRequestIsFinalState, activePullRequestNumber, droneId, pullRequestActionBusy]);

  const openEntryInEditor = React.useCallback(
    (entry: RepoChangeEntry | null) => {
      if (!entry || !entryPathExistsInCurrentTree(entry, dataMode)) return;
      onOpenFileInEditor(entry.path);
    },
    [dataMode, onOpenFileInEditor],
  );

  const revealEntryInFiles = React.useCallback(
    (entry: RepoChangeEntry | null) => {
      if (!entry) return;
      onRevealFileInFiles(entry.path);
    },
    [onRevealFileInFiles],
  );

  const workingTreeExpansionSourceLoader = React.useCallback(
    (entry: RepoChangeEntry | null, kind: DiffKind | null | undefined) => {
      if (!entry || !kind) return null;
      if (kind === 'unstaged' && entry.isUntracked) return null;
      const sourcePath = entry.originalPath ?? entry.path;
      const stateKey = workingDiffStateKey(entry.path, kind);
      return () =>
        loadDiffExpansionSource({
          stateKey,
          filePath: sourcePath,
          source: kind === 'staged' ? 'head' : 'index',
        });
    },
    [loadDiffExpansionSource, workingDiffStateKey],
  );

  const pullExpansionSourceLoader = React.useCallback(
    (entry: RepoChangeEntry | null) => {
      if (!entry) return null;
      const baseSha = dataMode === 'pull-request' ? pullRequestChanges?.pullRequest.baseSha : pullChanges?.baseSha;
      const headSha = dataMode === 'pull-request' ? pullRequestChanges?.pullRequest.headSha : pullChanges?.headSha;
      if (!/^[0-9a-f]{40}$/.test(String(baseSha ?? '').trim().toLowerCase())) return null;
      const stateKey =
        dataMode === 'pull-request'
          ? pullRequestDiffStateKey(entry.path, pullRequestChanges?.pullRequest.number ?? pullRequestNumber)
          : pullPreviewDiffStateKey(entry.path, baseSha, headSha);
      const sourcePath = entry.originalPath ?? entry.path;
      return () =>
        loadDiffExpansionSource({
          stateKey,
          filePath: sourcePath,
          source: 'sha',
          sha: baseSha,
        });
    },
    [
      dataMode,
      loadDiffExpansionSource,
      pullChanges?.baseSha,
      pullChanges?.headSha,
      pullPreviewDiffStateKey,
      pullRequestChanges?.pullRequest.baseSha,
      pullRequestChanges?.pullRequest.headSha,
      pullRequestChanges?.pullRequest.number,
      pullRequestDiffStateKey,
      pullRequestNumber,
    ],
  );

  const hoveredEntry = React.useMemo(
    () => (hoveredFilePath ? entries.find((entry) => entry.path === hoveredFilePath) ?? null : null),
    [entries, hoveredFilePath],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      const targetEntry = hoveredEntry ?? (dockHovered ? selectedEntry : null);
      if (!targetEntry) return;
      const key = event.key.toLowerCase();
      if (key === 'e') {
        if (!entryPathExistsInCurrentTree(targetEntry, dataMode)) return;
        openEntryInEditor(targetEntry);
        event.preventDefault();
        return;
      }
      if (key === 'g') {
        revealEntryInFiles(targetEntry);
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dataMode, dockHovered, hoveredEntry, openEntryInEditor, revealEntryInFiles, selectedEntry]);

  function renderFileQuickActions(entry: RepoChangeEntry, alwaysVisible: boolean = false): React.ReactNode {
    const canOpenInEditor = entryPathExistsInCurrentTree(entry, dataMode);
    const buttonClassName = `inline-flex items-center justify-center w-6 h-6 rounded border transition-all ${
      alwaysVisible
        ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
        : 'opacity-0 pointer-events-none group-hover/file:opacity-100 group-hover/file:pointer-events-auto border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
    }`;
    return (
      <div className="shrink-0 inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => revealEntryInFiles(entry)}
          className={buttonClassName}
          title="Reveal in Files tab (G)"
        >
          <IconFolder size={12} />
        </button>
        <button
          type="button"
          onClick={() => openEntryInEditor(entry)}
          disabled={!canOpenInEditor}
          className={`${buttonClassName} disabled:opacity-35 disabled:cursor-not-allowed`}
          title={canOpenInEditor ? 'Open in editor (E)' : 'This path no longer exists in the current tree.'}
        >
          <IconPencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  function renderExplorer(nodes: ExplorerNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = explorerIndentBasePx + depth * explorerIndentStepPx;
      if (node.kind === 'dir') {
        const open = expandedDirs[node.path] !== false;
        return (
          <React.Fragment key={`dir:${node.path}`}>
            <div className="w-full relative" style={{ paddingLeft: `${indentPx}px` }}>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inline-flex items-center justify-center text-[var(--muted-dim)]"
                style={{
                  left: `${Math.max(0, indentPx - explorerLeadingSlotPx)}px`,
                  top: '50%',
                  width: `${explorerLeadingSlotPx}px`,
                  height: `${explorerLeadingSlotPx}px`,
                  transform: 'translateY(-50%)',
                }}
              >
                <IconChevron down={open} size={explorerIconSizePx} />
              </span>
              <button
                type="button"
                onClick={() => {
                  setExpandedDirs((prev) => ({ ...prev, [node.path]: !open }));
                }}
                className="w-full text-left px-1 rounded border border-transparent hover:bg-[var(--hover)] flex items-center gap-0.5"
                style={{
                  height: `${explorerRowHeightPx}px`,
                  minHeight: `${explorerRowHeightPx}px`,
                }}
                title={node.path}
              >
                <span
                  className="inline-flex items-center justify-center flex-shrink-0 text-[var(--muted)]"
                  style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
                >
                  <IconFolder size={explorerIconSizePx} />
                </span>
                <span className="text-[var(--fg-secondary)] truncate flex-1" style={{ fontSize: `${explorerTextSizePx}px` }}>
                  {node.name}
                </span>
                <span className="text-[var(--muted-dim)] tabular-nums" style={{ fontSize: `${explorerMetaTextSizePx}px` }}>
                  {node.count}
                </span>
              </button>
            </div>
            {open && node.children && node.children.length > 0 ? renderExplorer(node.children, depth + 1) : null}
          </React.Fragment>
        );
      }

      const entry = node.entry ?? null;
      if (!entry) return null;
      const active = entry.path === selectedPath;
      const FileIcon = iconForFilePath(entry.path);
      return (
        <div
          key={`file:${entry.path}`}
          className="w-full group/file"
          style={{ paddingLeft: `${indentPx}px` }}
          onMouseEnter={() => setHoveredFilePath(entry.path)}
          onMouseLeave={() => {
            setHoveredFilePath((prev) => (prev === entry.path ? null : prev));
          }}
        >
          <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setSelectedPath(entry.path);
              if (dataMode === 'working-tree') setSplitKind(defaultKindForEntry(entry));
            }}
            className={`flex-1 min-w-0 text-left px-1 rounded border transition-colors flex items-center gap-0.5 ${
              active
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                : 'border-transparent hover:bg-[var(--hover)]'
            }`}
            style={{
              height: `${explorerRowHeightPx}px`,
              minHeight: `${explorerRowHeightPx}px`,
            }}
            title={entry.path}
          >
            <span
              className="inline-flex items-center justify-center flex-shrink-0 text-[var(--muted-dim)]"
              style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
            >
              <FileIcon size={explorerIconSizePx} />
            </span>
            <span className="text-[var(--fg-secondary)] truncate flex-1" style={{ fontSize: `${explorerTextSizePx}px` }}>
              {node.name}
            </span>
            <span
              className={`inline-flex items-center justify-center rounded border font-mono ${badgeTone(entry)}`}
              style={{
                minWidth: `${explorerBadgeMinWidthPx}px`,
                height: `${explorerBadgeHeightPx}px`,
                fontSize: `${explorerMetaTextSizePx}px`,
              }}
              title={statusBadgeTitle(entry, dataMode)}
            >
              {statusCharLabel(entry.stagedChar)}
              {statusCharLabel(entry.unstagedChar)}
            </span>
          </button>
            {renderFileQuickActions(entry, active || hoveredFilePath === entry.path)}
          </div>
        </div>
      );
    });
  }

  const statusLegendTitle = "Status badge uses S/U (staged/unstaged). '-' means no change and '?' means untracked.";
  const unavailableReason = String(repoUnavailableReason ?? '').trim();

  return (
    <div
      ref={dockRootRef}
      className="w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex flex-col relative dh-changes-dock"
      onMouseEnter={() => setDockHovered(true)}
      onMouseLeave={() => {
        setDockHovered(false);
        setHoveredFilePath(null);
      }}
    >
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
          <span className="mx-1 text-[var(--border-subtle)]">|</span>
          <span className="text-[9px] uppercase tracking-wide text-[var(--muted-dim)] mr-1" style={{ fontFamily: 'var(--display)' }}>
            Diff
          </span>
          <button
            type="button"
            onClick={() => setDiffViewType('unified')}
            className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
              diffViewType === 'unified'
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Unified diff view"
          >
            Unified
          </button>
          <button
            type="button"
            onClick={() => setDiffViewType('split')}
            className={`h-6 px-2 rounded-md border text-[9px] font-semibold tracking-wide uppercase transition-colors ${
              diffViewType === 'split'
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Side-by-side diff view"
          >
            Side-by-side
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
          <span title={unavailableReason || 'No repo attached'}>
            {unavailableReason || 'No repo attached.'}
          </span>
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
                {activePullRequestStatus ? (
                  <span
                    className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${activePullRequestStatus.className}`}
                    title={activePullRequestStatus.title}
                  >
                    {activePullRequestStatus.label}
                  </span>
                ) : null}
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
      {dataMode === 'pull-request' && awaitingPullRequestDetails ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] text-[var(--muted)]">
          Loading PR #{selectedPullRequestNumber} details...
        </div>
      ) : null}
      {dataMode === 'pull-request' && hasLoadedActivePullRequest && activePullRequestNumber ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[rgba(167,139,250,.06)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Pull Request
            </div>
            <div className="mt-1 text-[13px] leading-snug font-semibold text-[var(--fg-secondary)] truncate" title={activePullRequestTitleRaw || undefined}>
              <span className="font-mono text-[var(--accent)] mr-1.5">#{activePullRequestNumber}</span>
              <span>{activePullRequestTitleRaw || 'Untitled pull request'}</span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void mergeActivePullRequest();
              }}
              disabled={Boolean(pullRequestActionBusy) || Boolean(activePullRequestActionBlockedReason)}
              className="inline-flex items-center h-6 px-2 rounded border text-[9px] font-semibold uppercase tracking-wide border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
              title={activePullRequestActionBlockedReason ?? 'Merge pull request'}
              style={{ fontFamily: 'var(--display)' }}
            >
              {pullRequestActionBusy === 'merge' ? 'Merging...' : 'Merge'}
            </button>
            <button
              type="button"
              onClick={() => {
                void closeActivePullRequest();
              }}
              disabled={Boolean(pullRequestActionBusy) || Boolean(activePullRequestActionBlockedReason)}
              className="inline-flex items-center h-6 px-2 rounded border text-[9px] font-semibold uppercase tracking-wide border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
              title={activePullRequestActionBlockedReason ?? 'Close pull request without merging'}
              style={{ fontFamily: 'var(--display)' }}
            >
              {pullRequestActionBusy === 'close' ? 'Closing...' : 'Close'}
            </button>
            {activePullRequestStatus ? (
              <span
                className={`inline-flex items-center h-6 px-2 rounded border text-[9px] font-semibold uppercase tracking-wide ${activePullRequestStatus.className}`}
                title={activePullRequestStatus.title}
                style={{ fontFamily: 'var(--display)' }}
              >
                {activePullRequestStatus.label}
              </span>
            ) : null}
            {activePullRequestHtmlUrl ? (
              <a
                className="inline-flex items-center h-6 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                href={activePullRequestHtmlUrl}
                target="_blank"
                rel="noreferrer"
                title="Open PR on GitHub"
                style={{ fontFamily: 'var(--display)' }}
              >
                Open
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {dataMode === 'pull-request' && pullRequestActionNotice ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] text-[10px] text-[var(--green)] bg-[var(--green-subtle)]">{pullRequestActionNotice}</div>
      ) : null}
      {dataMode === 'pull-request' && pullRequestActionError ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] text-[10px] text-[var(--red)] bg-[var(--red-subtle)]">{pullRequestActionError}</div>
      ) : null}

      {!repoAttached ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">
          {unavailableReason || 'Attach a repo to see source-control changes.'}
        </div>
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
                  const key = workingDiffStateKey(entry.path, k);
                  const state = diffByKey[key];
                  const fallback = k !== stackedPreferredKind;
                  return (
                    <section
                      key={`stacked:${entry.path}`}
                      className="group/file rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden"
                      onMouseEnter={() => setHoveredFilePath(entry.path)}
                      onMouseLeave={() => {
                        setHoveredFilePath((prev) => (prev === entry.path ? null : prev));
                      }}
                    >
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
                        {renderFileQuickActions(entry)}
                        <span className="text-[9px] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                          {k}{fallback ? ' (fallback)' : ''}
                        </span>
                      </div>
                      <DiffBlock
                        state={state}
                        filePath={entry.path}
                        viewType={diffViewType}
                        loadExpansionSource={workingTreeExpansionSourceLoader(entry, k)}
                        expansionRanges={expandedRangesByDiffKey[key] ?? []}
                        onAddExpansionRange={(range) => addExpandedRangeForDiff(key, range)}
                      />
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
                    ? pullRequestDiffStateKey(entry.path, pullRequestChanges?.pullRequest.number ?? pullRequestNumber)
                    : pullPreviewDiffStateKey(entry.path, pullChanges?.baseSha, pullChanges?.headSha);
                const state = diffByKey[key];
                return (
                  <section
                    key={`${dataMode === 'pull-request' ? 'pr' : 'apply'}:${entry.path}`}
                    className="group/file rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden"
                    onMouseEnter={() => setHoveredFilePath(entry.path)}
                    onMouseLeave={() => {
                      setHoveredFilePath((prev) => (prev === entry.path ? null : prev));
                    }}
                  >
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
                      {renderFileQuickActions(entry)}
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedPullFiles((prev) => {
                            const next = { ...prev, [entry.path]: !open };
                            return next;
                          });
                          if (!open && dataMode === 'pull-preview') {
                            void loadRangeDiff({
                              filePath: entry.path,
                              baseSha: pullChanges?.baseSha,
                              headSha: pullChanges?.headSha,
                              stateKey: key,
                            });
                          }
                        }}
                        className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                        title={open ? 'Hide diff' : 'Show diff'}
                      >
                        {open ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {open ? (
                      <DiffBlock
                        state={state}
                        filePath={entry.path}
                        viewType={diffViewType}
                        loadExpansionSource={pullExpansionSourceLoader(entry)}
                        expansionRanges={expandedRangesByDiffKey[key] ?? []}
                        onAddExpansionRange={(range) => addExpandedRangeForDiff(key, range)}
                      />
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div ref={splitLayoutRef} className="flex-1 min-h-0 overflow-hidden flex">
          <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-[rgba(0,0,0,.12)]">
            <div className="sticky top-0 z-10 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur flex items-center justify-between gap-2">
              <div className="min-w-0 text-[10px] text-[var(--muted)] font-mono truncate">
                {selectedEntry ? selectedEntry.path : 'No file selected'}
              </div>
              <div className="inline-flex items-center gap-1">
                {selectedEntry ? renderFileQuickActions(selectedEntry, true) : null}
                {dataMode === 'working-tree' ? (
                  <>
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
                  </>
                ) : (
                  <div className="text-[9px] text-[var(--muted-dim)] font-mono whitespace-nowrap">
                    {dataMode === 'pull-request'
                      ? `PR #${pullRequestChanges?.pullRequest.number ?? pullRequestNumber ?? '-'} ${shortSha(pullBase)}..${shortSha(pullHead)}`
                      : `${shortSha(pullBase)}..${shortSha(pullHead)}`}
                  </div>
                )}
              </div>
            </div>

            {dataMode === 'working-tree' ? (
              !selectedEntry || !splitShownKind ? (
                <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Select a changed file to inspect its diff.</div>
              ) : (
                <DiffBlock
                  state={diffByKey[workingDiffStateKey(selectedEntry.path, splitShownKind)]}
                  filePath={selectedEntry.path}
                  viewType={diffViewType}
                  loadExpansionSource={workingTreeExpansionSourceLoader(selectedEntry, splitShownKind)}
                  expansionRanges={expandedRangesByDiffKey[workingDiffStateKey(selectedEntry.path, splitShownKind)] ?? []}
                  onAddExpansionRange={(range) => addExpandedRangeForDiff(workingDiffStateKey(selectedEntry.path, splitShownKind), range)}
                />
              )
            ) : !selectedEntry ? (
              <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Select a changed file to inspect its diff.</div>
            ) : (
              <DiffBlock
                state={
                  dataMode === 'pull-request'
                    ? diffByKey[pullRequestDiffStateKey(selectedEntry.path, pullRequestChanges?.pullRequest.number ?? pullRequestNumber)]
                    : diffByKey[pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha)]
                }
                filePath={selectedEntry.path}
                viewType={diffViewType}
                loadExpansionSource={pullExpansionSourceLoader(selectedEntry)}
                expansionRanges={
                  expandedRangesByDiffKey[
                    dataMode === 'pull-request'
                      ? pullRequestDiffStateKey(selectedEntry.path, pullRequestChanges?.pullRequest.number ?? pullRequestNumber)
                      : pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha)
                  ] ?? []
                }
                onAddExpansionRange={(range) =>
                  addExpandedRangeForDiff(
                    dataMode === 'pull-request'
                      ? pullRequestDiffStateKey(selectedEntry.path, pullRequestChanges?.pullRequest.number ?? pullRequestNumber)
                      : pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha),
                    range,
                  )
                }
              />
            )}
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            className={`group relative w-2 shrink-0 cursor-col-resize touch-none ${
              explorerResizing ? 'bg-[var(--accent-subtle)]' : 'bg-transparent hover:bg-[var(--hover)]'
            }`}
            title="Drag to resize explorer. Double-click to reset to auto width."
            onPointerDown={startExplorerResize}
            onPointerMove={moveExplorerResize}
            onPointerUp={finishExplorerResize}
            onPointerCancel={finishExplorerResize}
            onLostPointerCapture={finishExplorerResize}
            onDoubleClick={resetExplorerWidthPreference}
          >
            <span
              className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px ${
                explorerResizing ? 'bg-[var(--accent)]' : 'bg-[var(--border-subtle)] group-hover:bg-[var(--accent-muted)]'
              }`}
            />
          </div>

          <div
            className={`shrink-0 border-l border-[var(--border-subtle)] overflow-hidden flex flex-col ${
              explorerResizing ? '' : 'transition-[width] duration-150 ease-out'
            }`}
            style={{
              width: `${explorerWidthPx}px`,
              minWidth: `${explorerWidthPx}px`,
              maxWidth: `${explorerWidthPx}px`,
            }}
          >
            <div className="shrink-0 px-1.5 py-1 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/80 flex items-center justify-between gap-1">
              <span className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Zoom {explorerZoomPercent}%
              </span>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={decreaseExplorerZoom}
                  disabled={explorerZoom <= EXPLORER_ZOOM_MIN}
                  className="w-6 h-6 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] font-bold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Decrease explorer zoom"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={increaseExplorerZoom}
                  disabled={explorerZoom >= EXPLORER_ZOOM_MAX}
                  className="w-6 h-6 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] font-bold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Increase explorer zoom"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={resetExplorerZoom}
                  disabled={Math.abs(explorerZoom - EXPLORER_ZOOM_DEFAULT) < 0.001}
                  className="h-6 px-1.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Reset explorer zoom"
                >
                  100%
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-1.5 py-1">
              {renderExplorer(explorerTree, 0)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
