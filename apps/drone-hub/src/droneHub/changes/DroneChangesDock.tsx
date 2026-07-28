import React from 'react';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';
import {
  pullRequestCloseConfirmation,
  pullRequestMergeConfirmation,
} from '@drone/assistant-chat';
import { requestJson } from '../http';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { PaneLoadingState } from '../../ui/PaneLoadingState';
import { dropdownPanelBaseClass, useDropdownDismiss } from '../../ui/dropdown';
import { IconChevron, IconFolder, iconForFilePath } from '../icons';
import { IconEye, IconEyeOff } from '../app/icons';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import { readPullRequestMergeMethod } from '../pullRequests/pull-request-preferences';
import type {
  RepoChangeEntry,
  RepoCommitChangesPayload,
  RepoCommitDiffPayload,
  RepoCommitListPayload,
  RepoChangesPayload,
  RepoDiffPayload,
  RepoPullChangesPayload,
  RepoPullDiffPayload,
  RepoPullRequestCommitChangesPayload,
  RepoPullRequestCommitListPayload,
  RepoPullRequestClosePayload,
  RepoPullRequestChangesPayload,
  RepoPullRequestMergePayload,
  RepoSourcePayload,
} from '../types';
import {
  CHANGES_OPEN_AGENT_RUN_EVENT,
  CHANGES_OPEN_PULL_REQUEST_EVENT,
  consumeRequestedAgentRunChanges,
  type ChangesOpenAgentRunDetail,
  type ChangesOpenPullRequestDetail,
  consumeRequestedPullRequestForDrone,
  requestedPullRequestForDrone,
  selectedPullRequestForDrone,
} from './navigation';
import { AgentRunHistoricalChangesView } from './AgentRunHistoricalChangesView';
import { DiffBlock } from './DiffBlock';
import {
  clampDiffZoom,
  diffZoomStyle,
  DiffZoomControl,
  DIFF_ZOOM_DEFAULT,
} from './DiffZoomControl';
import { CommitInspectionView } from './CommitInspectionView';
import { createSingleFlightPoller, singleFlightByKey } from './singleFlight';
import { MetaChip } from './MetaChip';
import type { DiffExpansionRange, DiffState, DiffViewType } from './types';
import {
  CHANGES_BRANCH_MODE_STORAGE_KEY,
  CHANGES_COMMIT_LIST_WIDTH_STORAGE_KEY,
  CHANGES_CONTEXT_STORAGE_KEY,
  CHANGES_DIFF_VIEW_STORAGE_KEY,
  CHANGES_DIFF_ZOOM_STORAGE_KEY,
  CHANGES_EXPLORER_ZOOM_STORAGE_KEY,
  CHANGES_EXPLORER_WIDTH_STORAGE_KEY,
  CHANGES_HIDE_VIEWED_STORAGE_KEY,
  CHANGES_PRIMARY_VIEW_STORAGE_KEY,
  CHANGES_VIEW_STORAGE_KEY,
  readChangesStorage,
  removeChangesStorage,
  writeChangesStorage,
} from './storage';
import {
  badgeTone,
  appendDiffExpansionRange,
  buildExplorerTree,
  defaultKindForEntry,
  entryPathExistsInCurrentTree,
  estimateExplorerSidebarWidth,
  fileNameForChangesPath,
  diffKey,
  effectiveKindForEntry,
  flattenVisibleExplorerRows,
  hasStaged,
  hasUnstaged,
  parentDirPaths,
  pullRequestNoTextReason,
  pullRequestStateBadge,
  resolveExplorerSidebarWidthBounds,
  sameRepoCommitChangesPayload,
  sameRepoCommitListPayload,
  sameRepoChangesPayload,
  sameRepoPullChangesPayload,
  sameRepoPullRequestCommitChangesPayload,
  sameRepoPullRequestCommitListPayload,
  sameRepoPullRequestChangesPayload,
  sortRepoChangeEntries,
  scopedChangesStateKey,
  shortSha,
  statusBadgeTitle,
  toWorkingEntriesFromCommit,
  toWorkingEntriesFromPull,
  type ChangesDataMode,
  type DiffKind,
  type ExplorerNode,
} from './helpers';
import {
  readViewedChangesStore,
  setEntryViewed,
  viewedStateForEntry,
  writeViewedChangesStore,
  type ViewedEntryState,
} from './viewed';

type ChangesViewMode = 'stacked' | 'split';
type ChangesContextMode = 'branch' | 'pull-request';
type ChangesPrimaryView = 'changes' | 'commits';
type BranchChangesMode = Exclude<ChangesDataMode, 'pull-request'>;
type ChangesWorkspaceUiSnapshot = {
  pullRequestNumber: number | null;
  contextMode: ChangesContextMode;
  primaryView: ChangesPrimaryView;
  branchChangesMode: BranchChangesMode;
  selectedPath: string | null;
  selectedCommitSha: string | null;
  commitFileSelectedPath: string | null;
  splitKind: DiffKind;
  stackedPreferredKind: DiffKind;
  expandedDirs: Record<string, boolean>;
  expandedPullFiles: Record<string, boolean>;
  expandedCommitDirs: Record<string, boolean>;
  expandedCommitFiles: Record<string, boolean>;
};
const EXPLORER_SIDEBAR_MIN_WIDTH_PX = 180;
const EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX = 240;
const EXPLORER_SIDEBAR_MAX_WIDTH_PX = 360;
const EXPLORER_SIDEBAR_MAX_RATIO = 0.36;
const CHANGES_DIFF_MIN_WIDTH_PX = 420;
const EXPLORER_WIDTH_UPDATE_THRESHOLD_PX = 8;
const EXPLORER_ZOOM_MIN = 0.85;
const EXPLORER_ZOOM_DEFAULT = 1;
const EXPLORER_ZOOM_MAX = 1.2;
const EXPLORER_ZOOM_STEP = 0.1;
const COMMIT_LIST_MIN_WIDTH_PX = 220;
const COMMIT_LIST_DEFAULT_WIDTH_PX = 300;
const COMMIT_LIST_MAX_WIDTH_PX = 460;
const COMMIT_LIST_MAX_RATIO = 0.42;
const COMMIT_DETAIL_MIN_WIDTH_PX = 420;
const CHANGES_CACHE_TTL_MS = 12_000;
const WORKING_TREE_CHANGES_POLL_INTERVAL_MS = 5_000;
const PULL_PREVIEW_CHANGES_POLL_INTERVAL_MS = 10_000;

type ChangesCacheMap<T> = Map<string, { atMs: number; payload: T }>;

function changesSegmentButtonClass(active: boolean): string {
  return `dh-changes-segment-button ${active ? 'is-active' : ''}`;
}

function changesEntryStatusLabel(entry: RepoChangeEntry): string {
  if (entry.isConflicted) return 'Conflict';
  if (entry.isUntracked) return 'New';
  const status = entry.unstagedType ?? entry.stagedType;
  switch (status) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'type-changed':
      return 'Type';
    case 'unmerged':
      return 'Conflict';
    case 'modified':
      return 'Modified';
    case 'ignored':
      return 'Ignored';
    default:
      return 'Changed';
  }
}

function changesEntryStatusShortLabel(entry: RepoChangeEntry, kind?: DiffKind): string {
  if (entry.isConflicted) return 'U';
  if (entry.isUntracked && kind !== 'staged') return 'U';
  const status = kind === 'staged' ? entry.stagedType : kind === 'unstaged' ? entry.unstagedType : entry.unstagedType ?? entry.stagedType;
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'type-changed':
      return 'T';
    case 'unmerged':
      return 'U';
    case 'modified':
      return 'M';
    default:
      return '•';
  }
}

function changesEntryStatusTextClass(entry: RepoChangeEntry, kind?: DiffKind): string {
  const status = kind === 'staged' ? entry.stagedType : kind === 'unstaged' ? entry.unstagedType : entry.unstagedType ?? entry.stagedType;
  if (entry.isConflicted || status === 'deleted') {
    return 'text-[var(--red)]';
  }
  if ((entry.isUntracked && kind !== 'staged') || status === 'added') {
    return 'text-[var(--green)]';
  }
  if (status === 'modified') {
    return 'text-[var(--yellow)]';
  }
  return 'text-[var(--accent)]';
}

function OpenFileIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 2.25h4.25L13 5v8.25H6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M10.25 2.25V5H13M2.25 8h6M5.25 5l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StageIcon({ unstage = false }: { unstage?: boolean }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {!unstage ? <path d="M8 3.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : null}
    </svg>
  );
}

function DiscardChangesIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.25 4.5 2.5 7.25 5.25 10M3 7.25h5.25a4 4 0 0 1 4 4v.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChangesViewMenu({
  viewMode,
  diffViewType,
  showViewedControl,
  hideViewed,
  hideViewedLabel,
  onViewModeChange,
  onDiffViewTypeChange,
  onToggleHideViewed,
}: {
  viewMode: ChangesViewMode;
  diffViewType: DiffViewType;
  showViewedControl: boolean;
  hideViewed: boolean;
  hideViewedLabel: string;
  onViewModeChange: (mode: ChangesViewMode) => void;
  onDiffViewTypeChange: (viewType: DiffViewType) => void;
  onToggleHideViewed: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(menuRef, open, setOpen);

  const option = (
    label: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[var(--text-11)] transition-colors ${
        active
          ? 'bg-[var(--surface-soft)] text-[var(--fg)]'
          : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
      }`}
    >
      <span>{label}</span>
      <span className={`text-[var(--accent)] ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
        ✓
      </span>
    </button>
  );

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="dh-changes-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        View
        <IconChevron down={open} size={11} />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute right-0 top-full z-50 mt-1 w-48 ${dropdownPanelBaseClass}`}
        >
          <div className="px-3 pb-1 pt-2 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
            Layout
          </div>
          {option('Stacked', viewMode === 'stacked', () => onViewModeChange('stacked'))}
          {option('Explorer', viewMode === 'split', () => onViewModeChange('split'))}
          <div className="mx-2 my-1 border-t border-[var(--border-subtle)]" />
          <div className="px-3 pb-1 pt-1 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
            Diff
          </div>
          {option('Unified', diffViewType === 'unified', () => onDiffViewTypeChange('unified'))}
          {option('Side by side', diffViewType === 'split', () => onDiffViewTypeChange('split'))}
          {showViewedControl ? (
            <>
              <div className="mx-2 my-1 border-t border-[var(--border-subtle)]" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={hideViewed}
                onClick={() => {
                  onToggleHideViewed();
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[var(--text-11)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--hover)]"
              >
                <span>{hideViewedLabel}</span>
                <span className={`text-[var(--accent)] ${hideViewed ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
                  ✓
                </span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const workingTreeChangesCache: ChangesCacheMap<Extract<RepoChangesPayload, { ok: true }>> = new Map();
const workingTreeChangesInflight = new Map<string, Promise<Extract<RepoChangesPayload, { ok: true }>>>();
const pullPreviewChangesCache: ChangesCacheMap<Extract<RepoPullChangesPayload, { ok: true }>> = new Map();
const pullRequestChangesCache: ChangesCacheMap<Extract<RepoPullRequestChangesPayload, { ok: true }>> = new Map();
const branchCommitListCache: ChangesCacheMap<Extract<RepoCommitListPayload, { ok: true }>> = new Map();
const changesWorkspaceUiByDrone = new Map<string, ChangesWorkspaceUiSnapshot>();

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (droneId) changesWorkspaceUiByDrone.delete(droneId);
  });
}
const pullRequestCommitListCache: ChangesCacheMap<Extract<RepoPullRequestCommitListPayload, { ok: true }>> = new Map();
const branchCommitDetailsCache: ChangesCacheMap<Extract<RepoCommitChangesPayload, { ok: true }>> = new Map();
const pullRequestCommitDetailsCache: ChangesCacheMap<Extract<RepoPullRequestCommitChangesPayload, { ok: true }>> = new Map();

function changesCacheKey(...parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => String(part ?? '').trim()).join('\u0000');
}

function readFreshChangesCache<T>(cache: ChangesCacheMap<T>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached || Date.now() - cached.atMs >= CHANGES_CACHE_TTL_MS) return null;
  return cached.payload;
}

function writeChangesCache<T>(cache: ChangesCacheMap<T>, key: string, payload: T): void {
  if (!key) return;
  if (cache.size > 150) cache.clear();
  cache.set(key, { atMs: Date.now(), payload });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampExplorerZoom(value: number): number {
  return Math.round(clampNumber(value, EXPLORER_ZOOM_MIN, EXPLORER_ZOOM_MAX) * 100) / 100;
}

function pruneRecordKeys<T>(record: Record<string, T>, validKeys: Set<string>): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!validKeys.has(key)) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : record;
}

type ExplorerReviewSummary = {
  total: number;
  viewed: number;
  stale: number;
  unviewed: number;
};

function summarizeExplorerReviewState(
  nodes: ExplorerNode[],
  getViewedState: (entry: RepoChangeEntry) => ViewedEntryState,
): Record<string, ExplorerReviewSummary> {
  const summaries: Record<string, ExplorerReviewSummary> = {};

  function visit(node: ExplorerNode): ExplorerReviewSummary {
    if (node.kind === 'file') {
      const entry = node.entry;
      const viewedState = entry ? getViewedState(entry) : 'unviewed';
      return {
        total: 1,
        viewed: viewedState === 'viewed' ? 1 : 0,
        stale: viewedState === 'stale' ? 1 : 0,
        unviewed: viewedState === 'unviewed' ? 1 : 0,
      };
    }

    const summary = (node.children ?? []).reduce<ExplorerReviewSummary>(
      (acc, child) => {
        const childSummary = visit(child);
        acc.total += childSummary.total;
        acc.viewed += childSummary.viewed;
        acc.stale += childSummary.stale;
        acc.unviewed += childSummary.unviewed;
        return acc;
      },
      { total: 0, viewed: 0, stale: 0, unviewed: 0 },
    );
    summaries[node.path] = summary;
    return summary;
  }

  for (const node of nodes) visit(node);
  return summaries;
}

export type DroneChangesDockProps = {
  droneId: string;
  repoAttached: boolean;
  repoPath: string;
  repoUnavailableReason?: string | null;
  fixedContextMode?: ChangesContextMode | null;
  initialViewMode?: ChangesViewMode | null;
  initialDiffViewType?: DiffViewType | null;
  persistViewPreferences?: boolean;
  acceptHistoricalRunChanges?: boolean;
  disabled: boolean;
  hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
  onRevealFileInFiles: (repoRelativePath: string) => void;
  onOpenFileInEditor: (repoRelativePath: string) => void;
};

export function DroneChangesDock(props: DroneChangesDockProps) {
  const { acceptHistoricalRunChanges = false, droneId } = props;
  const [historicalRun, setHistoricalRun] = React.useState<ChangesOpenAgentRunDetail | null>(() =>
    acceptHistoricalRunChanges ? consumeRequestedAgentRunChanges(droneId) : null,
  );

  React.useEffect(() => {
    if (!acceptHistoricalRunChanges) return;
    const openHistoricalRun = () => {
      const requested = consumeRequestedAgentRunChanges(droneId);
      if (requested) setHistoricalRun(requested);
    };
    window.addEventListener(CHANGES_OPEN_AGENT_RUN_EVENT, openHistoricalRun);
    return () => window.removeEventListener(CHANGES_OPEN_AGENT_RUN_EVENT, openHistoricalRun);
  }, [acceptHistoricalRunChanges, droneId]);

  if (historicalRun) {
    return (
      <AgentRunHistoricalChangesView
        key={[
          historicalRun.fileChanges.capturedAt,
          historicalRun.initialSelection.workspaceTargetId,
          historicalRun.initialSelection.path ?? '',
        ].join(':')}
        fileChanges={historicalRun.fileChanges}
        initialSelection={historicalRun.initialSelection}
        onClose={() => setHistoricalRun(null)}
      />
    );
  }

  return <LiveDroneChangesDock {...props} />;
}

function LiveDroneChangesDock({
  droneId,
  repoAttached,
  repoPath,
  repoUnavailableReason,
  fixedContextMode = null,
  initialViewMode = null,
  initialDiffViewType = null,
  persistViewPreferences = true,
  disabled,
  hubPhase,
  hubMessage,
  onOpenFileInEditor,
}: DroneChangesDockProps) {
  const confirm = useAppConfirmDialog();
  const workspaceSnapshotRef = React.useRef<ChangesWorkspaceUiSnapshot | null>(
    changesWorkspaceUiByDrone.get(droneId) ?? null,
  );
  const workspaceSnapshot = workspaceSnapshotRef.current;
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [changes, setChanges] = React.useState<Extract<RepoChangesPayload, { ok: true }> | null>(null);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [changesError, setChangesError] = React.useState<string | null>(null);
  const changesRef = React.useRef<Extract<RepoChangesPayload, { ok: true }> | null>(null);

  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000changes`,
    timeoutMs: 18_000,
  });

  const [pullChanges, setPullChanges] = React.useState<Extract<RepoPullChangesPayload, { ok: true }> | null>(null);
  const [pullLoading, setPullLoading] = React.useState(false);
  const [pullError, setPullError] = React.useState<string | null>(null);
  const pullChangesRef = React.useRef<Extract<RepoPullChangesPayload, { ok: true }> | null>(null);
  const initialRequestedPullNumberRef = React.useRef<number | null>(requestedPullRequestForDrone(droneId));
  const [pullRequestNumber, setPullRequestNumber] = React.useState<number | null>(
    () => initialRequestedPullNumberRef.current ?? workspaceSnapshot?.pullRequestNumber ?? selectedPullRequestForDrone(droneId),
  );
  const [pullRequestChanges, setPullRequestChanges] = React.useState<Extract<RepoPullRequestChangesPayload, { ok: true }> | null>(null);
  const [pullRequestLoading, setPullRequestLoading] = React.useState(false);
  const [pullRequestError, setPullRequestError] = React.useState<string | null>(null);
  const pullRequestChangesRef = React.useRef<Extract<RepoPullRequestChangesPayload, { ok: true }> | null>(null);
  const [pullRequestActionBusy, setPullRequestActionBusy] = React.useState<'merge' | 'close' | null>(null);
  const [pullRequestActionError, setPullRequestActionError] = React.useState<string | null>(null);
  const [pullRequestActionNotice, setPullRequestActionNotice] = React.useState<string | null>(null);
  const workingTreeRefreshNonceRef = React.useRef(refreshNonce);
  const pullPreviewRefreshNonceRef = React.useRef(refreshNonce);
  const pullRequestRefreshNonceRef = React.useRef(refreshNonce);
  const branchCommitListRefreshNonceRef = React.useRef(refreshNonce);
  const pullRequestCommitListRefreshNonceRef = React.useRef(refreshNonce);
  const branchCommitDetailsRefreshNonceRef = React.useRef(refreshNonce);
  const pullRequestCommitDetailsRefreshNonceRef = React.useRef(refreshNonce);
  const workingTreeCacheKeyRef = React.useRef('');
  const pullPreviewCacheKeyRef = React.useRef('');
  const pullRequestCacheKeyRef = React.useRef('');
  const branchCommitListCacheKeyRef = React.useRef('');
  const pullRequestCommitListCacheKeyRef = React.useRef('');
  const branchCommitDetailsCacheKeyRef = React.useRef('');
  const pullRequestCommitDetailsCacheKeyRef = React.useRef('');
  const branchCommitDetailsErrorKeyRef = React.useRef<string | null>(null);
  const pullRequestCommitDetailsErrorKeyRef = React.useRef<string | null>(null);
  const [contextModeState, setContextModeState] = React.useState<ChangesContextMode>(() => {
    if (fixedContextMode) return fixedContextMode;
    return initialRequestedPullNumberRef.current && initialRequestedPullNumberRef.current > 0
      ? 'pull-request'
      : workspaceSnapshot?.contextMode
        ? workspaceSnapshot.contextMode
        : readChangesStorage(CHANGES_CONTEXT_STORAGE_KEY) === 'pull-request'
          ? 'pull-request'
          : 'branch';
  });
  const contextMode = fixedContextMode ?? contextModeState;
  const [primaryView, setPrimaryView] = React.useState<ChangesPrimaryView>(() =>
    workspaceSnapshot?.primaryView ?? (readChangesStorage(CHANGES_PRIMARY_VIEW_STORAGE_KEY) === 'commits' ? 'commits' : 'changes'),
  );
  const [branchChangesMode, setBranchChangesMode] = React.useState<BranchChangesMode>(() =>
    workspaceSnapshot?.branchChangesMode ?? (readChangesStorage(CHANGES_BRANCH_MODE_STORAGE_KEY) === 'pull-preview' ? 'pull-preview' : 'working-tree'),
  );
  const dataMode: ChangesDataMode = contextMode === 'pull-request' ? 'pull-request' : branchChangesMode;

  const [viewMode, setViewMode] = React.useState<ChangesViewMode>(() => {
    if (initialViewMode) return initialViewMode;
    const raw = readChangesStorage(CHANGES_VIEW_STORAGE_KEY);
    return raw === 'split' ? 'split' : 'stacked';
  });
  const [diffViewType, setDiffViewType] = React.useState<DiffViewType>(() => {
    if (initialDiffViewType) return initialDiffViewType;
    const raw = readChangesStorage(CHANGES_DIFF_VIEW_STORAGE_KEY);
    return raw === 'split' ? 'split' : 'unified';
  });
  const [hideViewed, setHideViewed] = React.useState<boolean>(() => readChangesStorage(CHANGES_HIDE_VIEWED_STORAGE_KEY) === '1');
  const [viewedStore, setViewedStore] = React.useState(() => readViewedChangesStore());

  const [selectedPath, setSelectedPath] = React.useState<string | null>(workspaceSnapshot?.selectedPath ?? null);
  const [selectedCommitSha, setSelectedCommitSha] = React.useState<string | null>(workspaceSnapshot?.selectedCommitSha ?? null);
  const [commitFileSelectedPath, setCommitFileSelectedPath] = React.useState<string | null>(workspaceSnapshot?.commitFileSelectedPath ?? null);
  const [splitKind, setSplitKind] = React.useState<DiffKind>(workspaceSnapshot?.splitKind ?? 'unstaged');
  const [stackedPreferredKind, setStackedPreferredKind] = React.useState<DiffKind>(workspaceSnapshot?.stackedPreferredKind ?? 'unstaged');
  const [expandedDirs, setExpandedDirs] = React.useState<Record<string, boolean>>(workspaceSnapshot?.expandedDirs ?? {});
  const [stagedSectionOpen, setStagedSectionOpen] = React.useState(true);
  const [unstagedSectionOpen, setUnstagedSectionOpen] = React.useState(true);
  const [workingTreeActionBusy, setWorkingTreeActionBusy] = React.useState<string | null>(null);
  const [workingTreeActionError, setWorkingTreeActionError] = React.useState<string | null>(null);
  const [expandedPullFiles, setExpandedPullFiles] = React.useState<Record<string, boolean>>(workspaceSnapshot?.expandedPullFiles ?? {});
  const [expandedCommitDirs, setExpandedCommitDirs] = React.useState<Record<string, boolean>>(workspaceSnapshot?.expandedCommitDirs ?? {});
  const [expandedCommitFiles, setExpandedCommitFiles] = React.useState<Record<string, boolean>>(workspaceSnapshot?.expandedCommitFiles ?? {});
  const [branchCommitList, setBranchCommitList] = React.useState<Extract<RepoCommitListPayload, { ok: true }> | null>(null);
  const [branchCommitListLoading, setBranchCommitListLoading] = React.useState(false);
  const [branchCommitListError, setBranchCommitListError] = React.useState<string | null>(null);
  const branchCommitListRef = React.useRef<Extract<RepoCommitListPayload, { ok: true }> | null>(null);
  const [pullRequestCommitList, setPullRequestCommitList] = React.useState<Extract<RepoPullRequestCommitListPayload, { ok: true }> | null>(null);
  const [pullRequestCommitListLoading, setPullRequestCommitListLoading] = React.useState(false);
  const [pullRequestCommitListError, setPullRequestCommitListError] = React.useState<string | null>(null);
  const pullRequestCommitListRef = React.useRef<Extract<RepoPullRequestCommitListPayload, { ok: true }> | null>(null);
  const [branchCommitDetails, setBranchCommitDetails] = React.useState<Extract<RepoCommitChangesPayload, { ok: true }> | null>(null);
  const [branchCommitDetailsLoading, setBranchCommitDetailsLoading] = React.useState(false);
  const [branchCommitDetailsError, setBranchCommitDetailsError] = React.useState<string | null>(null);
  const branchCommitDetailsRef = React.useRef<Extract<RepoCommitChangesPayload, { ok: true }> | null>(null);
  const [pullRequestCommitDetails, setPullRequestCommitDetails] = React.useState<Extract<RepoPullRequestCommitChangesPayload, { ok: true }> | null>(null);
  const [pullRequestCommitDetailsLoading, setPullRequestCommitDetailsLoading] = React.useState(false);
  const [pullRequestCommitDetailsError, setPullRequestCommitDetailsError] = React.useState<string | null>(null);
  const pullRequestCommitDetailsRef = React.useRef<Extract<RepoPullRequestCommitChangesPayload, { ok: true }> | null>(null);
  const commitLayoutRef = React.useRef<HTMLDivElement | null>(null);
  const [commitListWidthPx, setCommitListWidthPx] = React.useState<number>(() => {
    const raw = Number(readChangesStorage(CHANGES_COMMIT_LIST_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(raw) || raw < 160) return COMMIT_LIST_DEFAULT_WIDTH_PX;
    return Math.floor(raw);
  });
  const [commitListResizing, setCommitListResizing] = React.useState(false);
  const commitListDragRef = React.useRef<{ pointerId: number; startX: number; startWidth: number; liveWidth: number } | null>(null);
  const commitListResizeBodyStyleRef = React.useRef<{ cursor: string; userSelect: string } | null>(null);
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
  const [diffZoom, setDiffZoom] = React.useState<number>(() => {
    const stored = readChangesStorage(CHANGES_DIFF_ZOOM_STORAGE_KEY);
    if (stored === null) return DIFF_ZOOM_DEFAULT;
    const raw = Number(stored);
    if (!Number.isFinite(raw)) return DIFF_ZOOM_DEFAULT;
    return clampDiffZoom(raw);
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
  const [commitDiffByKey, setCommitDiffByKey] = React.useState<Record<string, DiffState>>({});
  const commitDiffByKeyRef = React.useRef<Record<string, DiffState>>({});
  const commitInflightRef = React.useRef<Set<string>>(new Set());
  const mountedRef = React.useRef(true);
  const dockRootRef = React.useRef<HTMLDivElement | null>(null);
  const explorerZoomPercent = Math.round(explorerZoom * 100);
  const explorerRowHeightPx = Math.max(21, Math.round(24 * explorerZoom));
  const explorerIconSizePx = Math.max(12, Math.round(13 * explorerZoom));
  const explorerLeadingSlotPx = Math.max(explorerIconSizePx, Math.round(14 * explorerZoom));
  const explorerTextSizePx = Math.max(11, Math.round(12 * explorerZoom * 10) / 10);
  const explorerMetaTextSizePx = Math.max(8.5, Math.round(9.5 * explorerZoom * 10) / 10);
  const explorerIndentBasePx = Math.max(4, Math.round(5 * explorerZoom));
  const explorerIndentStepPx = Math.max(10, Math.round(13 * explorerZoom));
  const explorerBadgeHeightPx = Math.max(14, Math.round(15 * explorerZoom));

  React.useEffect(() => {
    changesWorkspaceUiByDrone.set(droneId, {
      pullRequestNumber,
      contextMode,
      primaryView,
      branchChangesMode,
      selectedPath,
      selectedCommitSha,
      commitFileSelectedPath,
      splitKind,
      stackedPreferredKind,
      expandedDirs,
      expandedPullFiles,
      expandedCommitDirs,
      expandedCommitFiles,
    });
  }, [
    branchChangesMode,
    commitFileSelectedPath,
    contextMode,
    droneId,
    expandedCommitDirs,
    expandedCommitFiles,
    expandedDirs,
    expandedPullFiles,
    primaryView,
    pullRequestNumber,
    selectedCommitSha,
    selectedPath,
    splitKind,
    stackedPreferredKind,
  ]);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    changesRef.current = changes;
  }, [changes]);

  React.useEffect(() => {
    pullChangesRef.current = pullChanges;
  }, [pullChanges]);

  React.useEffect(() => {
    pullRequestChangesRef.current = pullRequestChanges;
  }, [pullRequestChanges]);
  React.useEffect(() => {
    branchCommitListRef.current = branchCommitList;
  }, [branchCommitList]);
  React.useEffect(() => {
    pullRequestCommitListRef.current = pullRequestCommitList;
  }, [pullRequestCommitList]);
  React.useEffect(() => {
    branchCommitDetailsRef.current = branchCommitDetails;
  }, [branchCommitDetails]);
  React.useEffect(() => {
    pullRequestCommitDetailsRef.current = pullRequestCommitDetails;
  }, [pullRequestCommitDetails]);

  React.useEffect(() => {
    if (!persistViewPreferences) return;
    writeChangesStorage(CHANGES_VIEW_STORAGE_KEY, viewMode);
  }, [persistViewPreferences, viewMode]);
  React.useEffect(() => {
    if (!persistViewPreferences) return;
    writeChangesStorage(CHANGES_DIFF_VIEW_STORAGE_KEY, diffViewType);
  }, [diffViewType, persistViewPreferences]);
  React.useEffect(() => {
    if (fixedContextMode) return;
    writeChangesStorage(CHANGES_CONTEXT_STORAGE_KEY, contextMode);
  }, [contextMode, fixedContextMode]);
  React.useEffect(() => {
    writeChangesStorage(CHANGES_PRIMARY_VIEW_STORAGE_KEY, primaryView);
  }, [primaryView]);
  React.useEffect(() => {
    writeChangesStorage(CHANGES_BRANCH_MODE_STORAGE_KEY, branchChangesMode);
  }, [branchChangesMode]);
  React.useEffect(() => {
    writeChangesStorage(CHANGES_HIDE_VIEWED_STORAGE_KEY, hideViewed ? '1' : '0');
  }, [hideViewed]);
  React.useEffect(() => {
    writeViewedChangesStore(viewedStore);
  }, [viewedStore]);

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
    writeChangesStorage(CHANGES_DIFF_ZOOM_STORAGE_KEY, String(diffZoom));
  }, [diffZoom]);
  React.useEffect(() => {
    writeChangesStorage(CHANGES_COMMIT_LIST_WIDTH_STORAGE_KEY, String(Math.floor(commitListWidthPx)));
  }, [commitListWidthPx]);

  React.useEffect(() => {
    const onOpenPullRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChangesOpenPullRequestDetail>).detail;
      if (!detail || String(detail.droneId ?? '').trim() !== String(droneId ?? '').trim()) return;
      if (fixedContextMode === 'branch') return;
      const pullNumber = Number(detail.pullNumber);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) return;
      const normalizedPullNumber = Math.floor(pullNumber);
      consumeRequestedPullRequestForDrone(droneId);
      setPullRequestNumber(normalizedPullNumber);
      if (!fixedContextMode) setContextModeState('pull-request');
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequest as EventListener);
    return () => window.removeEventListener(CHANGES_OPEN_PULL_REQUEST_EVENT, onOpenPullRequest as EventListener);
  }, [droneId, fixedContextMode]);

  React.useEffect(() => {
    if (fixedContextMode === 'branch') {
      setPullRequestNumber(selectedPullRequestForDrone(droneId));
      setContextModeState('branch');
      return;
    }
    const requestedPullNumber = consumeRequestedPullRequestForDrone(droneId);
    if (requestedPullNumber && requestedPullNumber > 0) {
      setPullRequestNumber(requestedPullNumber);
      if (!fixedContextMode) setContextModeState('pull-request');
      setRefreshNonce((n) => n + 1);
      return;
    }
    setPullRequestNumber(selectedPullRequestForDrone(droneId));
    if (!fixedContextMode) setContextModeState('branch');
  }, [droneId, fixedContextMode]);

  React.useEffect(() => {
    if (fixedContextMode) return;
    if (contextMode !== 'pull-request') return;
    if (pullRequestNumber && pullRequestNumber > 0) return;
    setContextModeState('branch');
  }, [contextMode, fixedContextMode, pullRequestNumber]);

  React.useEffect(() => {
    setSelectedPath(null);
    setSelectedCommitSha(null);
    setCommitFileSelectedPath(null);
  }, [droneId]);

  React.useEffect(() => {
    setPullRequestActionError(null);
    setPullRequestActionNotice(null);
  }, [contextMode, pullRequestNumber]);

  React.useEffect(() => {
    if (!pullRequestActionNotice) return;
    const timer = setTimeout(() => setPullRequestActionNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [pullRequestActionNotice]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      changesRef.current = null;
      setChanges(null);
      setChangesError(null);
      setChangesLoading(false);
      return;
    }
    if (primaryView !== 'changes' || dataMode !== 'working-tree') {
      setChangesLoading(false);
      return;
    }

    let mounted = true;
    const cacheKey = changesCacheKey('working-tree', droneId, repoPath);
    const forceInitialLoad = refreshNonce !== workingTreeRefreshNonceRef.current;
    workingTreeRefreshNonceRef.current = refreshNonce;
    const cacheKeyChanged = workingTreeCacheKeyRef.current !== cacheKey;
    workingTreeCacheKeyRef.current = cacheKey;
    const cached = forceInitialLoad ? null : readFreshChangesCache(workingTreeChangesCache, cacheKey);
    if (cached) {
      changesRef.current = cached;
      setChanges(cached);
      setChangesError(null);
      setChangesLoading(false);
      startup.markReady();
    } else if (cacheKeyChanged) {
      changesRef.current = null;
      setChanges(null);
      setChangesError(null);
    }

    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = readFreshChangesCache(workingTreeChangesCache, cacheKey);
        if (fresh) {
          changesRef.current = fresh;
          setChanges(fresh);
          setChangesError(null);
          setChangesLoading(false);
          startup.markReady();
          return;
        }
      }
      if (!silent) setChangesLoading(true);
      try {
        const data = await singleFlightByKey(
          workingTreeChangesInflight,
          cacheKey,
          () => requestJson<Extract<RepoChangesPayload, { ok: true }>>(
            `/api/drones/${encodeURIComponent(droneId)}/repo/changes`,
          ),
        );
        if (!mounted) return;
        writeChangesCache(workingTreeChangesCache, cacheKey, data);
        if (!sameRepoChangesPayload(changesRef.current, data)) {
          changesRef.current = data;
          setChanges(data);
        }
        setChangesError(null);
        startup.markReady();
      } catch (e: any) {
        if (!mounted) return;
        setChangesError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setChangesLoading(false);
      }
    };

    let initial = true;
    const poller = createSingleFlightPoller({
      intervalMs: WORKING_TREE_CHANGES_POLL_INTERVAL_MS,
      isActive: () => document.visibilityState !== 'hidden' && Boolean(dockRootRef.current?.isConnected),
      poll: async () => {
        const first = initial;
        initial = false;
        await load(first ? Boolean(cached) && !forceInitialLoad : true, first ? Boolean(cached) || forceInitialLoad : true);
      },
    });
    poller.start();

    return () => {
      mounted = false;
      poller.stop();
    };
  }, [dataMode, disabled, droneId, primaryView, refreshNonce, repoAttached, repoPath, startup.markReady]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      pullChangesRef.current = null;
      setPullChanges(null);
      setPullError(null);
      setPullLoading(false);
      return;
    }
    if (primaryView !== 'changes' || dataMode !== 'pull-preview') {
      setPullLoading(false);
      return;
    }

    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const cacheKey = changesCacheKey('pull-preview', droneId, repoPath);
    const forceInitialLoad = refreshNonce !== pullPreviewRefreshNonceRef.current;
    pullPreviewRefreshNonceRef.current = refreshNonce;
    const cacheKeyChanged = pullPreviewCacheKeyRef.current !== cacheKey;
    pullPreviewCacheKeyRef.current = cacheKey;
    const cached = forceInitialLoad ? null : readFreshChangesCache(pullPreviewChangesCache, cacheKey);
    if (cached) {
      pullChangesRef.current = cached;
      setPullChanges(cached);
      setPullError(null);
      setPullLoading(false);
    } else if (cacheKeyChanged) {
      pullChangesRef.current = null;
      setPullChanges(null);
      setPullError(null);
    }

    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = readFreshChangesCache(pullPreviewChangesCache, cacheKey);
        if (fresh) {
          pullChangesRef.current = fresh;
          setPullChanges(fresh);
          setPullError(null);
          setPullLoading(false);
          return;
        }
      }
      if (!silent) setPullLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullChangesPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull/changes`,
        );
        if (!mounted) return;
        writeChangesCache(pullPreviewChangesCache, cacheKey, data);
        if (!sameRepoPullChangesPayload(pullChangesRef.current, data)) {
          pullChangesRef.current = data;
          setPullChanges(data);
        }
        setPullError(null);
      } catch (e: any) {
        if (!mounted) return;
        setPullError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setPullLoading(false);
      }
    };

    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);
    timer = setInterval(() => {
      void load(true, true);
    }, PULL_PREVIEW_CHANGES_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [dataMode, disabled, droneId, primaryView, refreshNonce, repoAttached, repoPath]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      pullRequestChangesRef.current = null;
      setPullRequestChanges(null);
      setPullRequestError(null);
      setPullRequestLoading(false);
      return;
    }
    if (dataMode !== 'pull-request' || !pullRequestNumber) {
      setPullRequestLoading(false);
      return;
    }
    setPullRequestChanges((prev) => {
      const next = prev && prev.pullRequest.number === pullRequestNumber ? prev : null;
      pullRequestChangesRef.current = next;
      return next;
    });

    let mounted = true;
    const activePullNumber = pullRequestNumber;
    const cacheKey = changesCacheKey('pull-request', droneId, repoPath, activePullNumber);
    const forceInitialLoad = refreshNonce !== pullRequestRefreshNonceRef.current;
    pullRequestRefreshNonceRef.current = refreshNonce;
    const cacheKeyChanged = pullRequestCacheKeyRef.current !== cacheKey;
    pullRequestCacheKeyRef.current = cacheKey;
    const cached = forceInitialLoad ? null : readFreshChangesCache(pullRequestChangesCache, cacheKey);
    if (cached) {
      pullRequestChangesRef.current = cached;
      setPullRequestChanges(cached);
      setPullRequestError(null);
      setPullRequestLoading(false);
    } else if (cacheKeyChanged) {
      pullRequestChangesRef.current = null;
      setPullRequestChanges(null);
      setPullRequestError(null);
    }

    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = readFreshChangesCache(pullRequestChangesCache, cacheKey);
        if (fresh) {
          pullRequestChangesRef.current = fresh;
          setPullRequestChanges(fresh);
          setPullRequestError(null);
          setPullRequestLoading(false);
          return;
        }
      }
      if (!silent) setPullRequestLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestChangesPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${activePullNumber}/changes`,
        );
        if (!mounted) return;
        writeChangesCache(pullRequestChangesCache, cacheKey, data);
        if (!sameRepoPullRequestChangesPayload(pullRequestChangesRef.current, data)) {
          pullRequestChangesRef.current = data;
          setPullRequestChanges(data);
        }
        setPullRequestError(null);
      } catch (e: any) {
        if (!mounted) return;
        const status = Number(e?.status ?? 0);
        if (status === 404) {
          pullRequestChangesRef.current = null;
          setPullRequestChanges(null);
          setPullRequestError(`PR #${activePullNumber} was not found on GitHub (it may have been deleted or is inaccessible).`);
          return;
        }
        setPullRequestError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setPullRequestLoading(false);
      }
    };

    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);

    return () => {
      mounted = false;
    };
  }, [dataMode, disabled, droneId, pullRequestNumber, refreshNonce, repoAttached, repoPath]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      branchCommitListRef.current = null;
      setBranchCommitList(null);
      setBranchCommitListError(null);
      setBranchCommitListLoading(false);
      return;
    }
    if (primaryView !== 'commits' || contextMode !== 'branch') {
      setBranchCommitListLoading(false);
      return;
    }
    let mounted = true;
    const cacheKey = changesCacheKey('branch-commits', droneId, repoPath);
    const forceInitialLoad = refreshNonce !== branchCommitListRefreshNonceRef.current;
    branchCommitListRefreshNonceRef.current = refreshNonce;
    const cacheKeyChanged = branchCommitListCacheKeyRef.current !== cacheKey;
    branchCommitListCacheKeyRef.current = cacheKey;
    const cached = forceInitialLoad ? null : readFreshChangesCache(branchCommitListCache, cacheKey);
    if (cached) {
      branchCommitListRef.current = cached;
      setBranchCommitList(cached);
      setBranchCommitListError(null);
      setBranchCommitListLoading(false);
    } else if (cacheKeyChanged) {
      branchCommitListRef.current = null;
      setBranchCommitList(null);
      setBranchCommitListError(null);
    }
    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = readFreshChangesCache(branchCommitListCache, cacheKey);
        if (fresh) {
          branchCommitListRef.current = fresh;
          setBranchCommitList(fresh);
          setBranchCommitListError(null);
          setBranchCommitListLoading(false);
          return;
        }
      }
      if (!silent) setBranchCommitListLoading(true);
      try {
        const data = await requestJson<Extract<RepoCommitListPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/commits?limit=100`,
        );
        if (!mounted) return;
        writeChangesCache(branchCommitListCache, cacheKey, data);
        if (!sameRepoCommitListPayload(branchCommitListRef.current, data)) {
          branchCommitListRef.current = data;
          setBranchCommitList(data);
        }
        setBranchCommitListError(null);
      } catch (e: any) {
        if (!mounted) return;
        setBranchCommitListError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setBranchCommitListLoading(false);
      }
    };
    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);
    return () => {
      mounted = false;
    };
  }, [contextMode, disabled, droneId, primaryView, refreshNonce, repoAttached, repoPath]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      pullRequestCommitListRef.current = null;
      setPullRequestCommitList(null);
      setPullRequestCommitListError(null);
      setPullRequestCommitListLoading(false);
      return;
    }
    if (primaryView !== 'commits' || contextMode !== 'pull-request' || !pullRequestNumber) {
      setPullRequestCommitListLoading(false);
      return;
    }
    let mounted = true;
    const activePullNumber = pullRequestNumber;
    const cacheKey = changesCacheKey('pull-request-commits', droneId, repoPath, activePullNumber);
    const forceInitialLoad = refreshNonce !== pullRequestCommitListRefreshNonceRef.current;
    pullRequestCommitListRefreshNonceRef.current = refreshNonce;
    const cacheKeyChanged = pullRequestCommitListCacheKeyRef.current !== cacheKey;
    pullRequestCommitListCacheKeyRef.current = cacheKey;
    const cached = forceInitialLoad ? null : readFreshChangesCache(pullRequestCommitListCache, cacheKey);
    if (cached) {
      pullRequestCommitListRef.current = cached;
      setPullRequestCommitList(cached);
      setPullRequestCommitListError(null);
      setPullRequestCommitListLoading(false);
    } else if (cacheKeyChanged) {
      pullRequestCommitListRef.current = null;
      setPullRequestCommitList(null);
      setPullRequestCommitListError(null);
    }
    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = readFreshChangesCache(pullRequestCommitListCache, cacheKey);
        if (fresh) {
          pullRequestCommitListRef.current = fresh;
          setPullRequestCommitList(fresh);
          setPullRequestCommitListError(null);
          setPullRequestCommitListLoading(false);
          return;
        }
      }
      if (!silent) setPullRequestCommitListLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestCommitListPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${activePullNumber}/commits`,
        );
        if (!mounted) return;
        writeChangesCache(pullRequestCommitListCache, cacheKey, data);
        if (!sameRepoPullRequestCommitListPayload(pullRequestCommitListRef.current, data)) {
          pullRequestCommitListRef.current = data;
          setPullRequestCommitList(data);
        }
        setPullRequestCommitListError(null);
      } catch (e: any) {
        if (!mounted) return;
        setPullRequestCommitListError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setPullRequestCommitListLoading(false);
      }
    };
    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);
    return () => {
      mounted = false;
    };
  }, [contextMode, disabled, droneId, primaryView, pullRequestNumber, refreshNonce, repoAttached, repoPath]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      branchCommitDetailsRef.current = null;
      setBranchCommitDetails(null);
      branchCommitDetailsErrorKeyRef.current = null;
      setBranchCommitDetailsError(null);
      setBranchCommitDetailsLoading(false);
      return;
    }
    if (primaryView !== 'commits' || contextMode !== 'branch') {
      setBranchCommitDetailsLoading(false);
      return;
    }
    if (!selectedCommitSha) {
      branchCommitDetailsRef.current = null;
      setBranchCommitDetails(null);
      branchCommitDetailsErrorKeyRef.current = null;
      setBranchCommitDetailsError(null);
      setBranchCommitDetailsLoading(false);
      return;
    }
    let mounted = true;
    const sha = selectedCommitSha;
    const cacheKey = changesCacheKey('branch-commit-details', droneId, repoPath, sha);
    const forceInitialLoad = refreshNonce !== branchCommitDetailsRefreshNonceRef.current;
    branchCommitDetailsRefreshNonceRef.current = refreshNonce;
    const cacheKeyChanged = branchCommitDetailsCacheKeyRef.current !== cacheKey;
    branchCommitDetailsCacheKeyRef.current = cacheKey;
    const cached = forceInitialLoad ? null : readFreshChangesCache(branchCommitDetailsCache, cacheKey);
    if (cached) {
      branchCommitDetailsRef.current = cached;
      setBranchCommitDetails(cached);
      branchCommitDetailsErrorKeyRef.current = null;
      setBranchCommitDetailsError(null);
      setBranchCommitDetailsLoading(false);
    } else if (cacheKeyChanged) {
      branchCommitDetailsRef.current = null;
      setBranchCommitDetails(null);
      branchCommitDetailsErrorKeyRef.current = null;
      setBranchCommitDetailsError(null);
    }
    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = readFreshChangesCache(branchCommitDetailsCache, cacheKey);
        if (fresh) {
          branchCommitDetailsRef.current = fresh;
          setBranchCommitDetails(fresh);
          branchCommitDetailsErrorKeyRef.current = null;
          setBranchCommitDetailsError(null);
          setBranchCommitDetailsLoading(false);
          return;
        }
      }
      if (!silent) setBranchCommitDetailsLoading(true);
      try {
        const data = await requestJson<Extract<RepoCommitChangesPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/commits/${encodeURIComponent(sha)}/changes`,
        );
        if (!mounted) return;
        writeChangesCache(branchCommitDetailsCache, cacheKey, data);
        if (!sameRepoCommitChangesPayload(branchCommitDetailsRef.current, data)) {
          branchCommitDetailsRef.current = data;
          setBranchCommitDetails(data);
        }
        branchCommitDetailsErrorKeyRef.current = null;
        setBranchCommitDetailsError(null);
      } catch (e: any) {
        if (!mounted) return;
        branchCommitDetailsErrorKeyRef.current = cacheKey;
        setBranchCommitDetailsError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setBranchCommitDetailsLoading(false);
      }
    };
    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);
    return () => {
      mounted = false;
    };
  }, [contextMode, disabled, droneId, primaryView, refreshNonce, repoAttached, repoPath, selectedCommitSha]);

  React.useEffect(() => {
    if (!repoAttached || disabled) {
      pullRequestCommitDetailsRef.current = null;
      setPullRequestCommitDetails(null);
      pullRequestCommitDetailsErrorKeyRef.current = null;
      setPullRequestCommitDetailsError(null);
      setPullRequestCommitDetailsLoading(false);
      return;
    }
    if (primaryView !== 'commits' || contextMode !== 'pull-request') {
      setPullRequestCommitDetailsLoading(false);
      return;
    }
    if (!pullRequestNumber || !selectedCommitSha) {
      pullRequestCommitDetailsRef.current = null;
      setPullRequestCommitDetails(null);
      pullRequestCommitDetailsErrorKeyRef.current = null;
      setPullRequestCommitDetailsError(null);
      setPullRequestCommitDetailsLoading(false);
      return;
    }
    let mounted = true;
    const activePullNumber = pullRequestNumber;
    const sha = selectedCommitSha;
    const cacheKey = changesCacheKey('pull-request-commit-details', droneId, repoPath, activePullNumber, sha);
    const forceInitialLoad = refreshNonce !== pullRequestCommitDetailsRefreshNonceRef.current;
    pullRequestCommitDetailsRefreshNonceRef.current = refreshNonce;
    const cacheKeyChanged = pullRequestCommitDetailsCacheKeyRef.current !== cacheKey;
    pullRequestCommitDetailsCacheKeyRef.current = cacheKey;
    const cached = forceInitialLoad ? null : readFreshChangesCache(pullRequestCommitDetailsCache, cacheKey);
    if (cached) {
      pullRequestCommitDetailsRef.current = cached;
      setPullRequestCommitDetails(cached);
      pullRequestCommitDetailsErrorKeyRef.current = null;
      setPullRequestCommitDetailsError(null);
      setPullRequestCommitDetailsLoading(false);
    } else if (cacheKeyChanged) {
      pullRequestCommitDetailsRef.current = null;
      setPullRequestCommitDetails(null);
      pullRequestCommitDetailsErrorKeyRef.current = null;
      setPullRequestCommitDetailsError(null);
    }
    const load = async (silent: boolean, force = false) => {
      if (!mounted) return;
      if (!force) {
        const fresh = readFreshChangesCache(pullRequestCommitDetailsCache, cacheKey);
        if (fresh) {
          pullRequestCommitDetailsRef.current = fresh;
          setPullRequestCommitDetails(fresh);
          pullRequestCommitDetailsErrorKeyRef.current = null;
          setPullRequestCommitDetailsError(null);
          setPullRequestCommitDetailsLoading(false);
          return;
        }
      }
      if (!silent) setPullRequestCommitDetailsLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestCommitChangesPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${activePullNumber}/commits/${encodeURIComponent(sha)}/changes`,
        );
        if (!mounted) return;
        writeChangesCache(pullRequestCommitDetailsCache, cacheKey, data);
        if (!sameRepoPullRequestCommitChangesPayload(pullRequestCommitDetailsRef.current, data)) {
          pullRequestCommitDetailsRef.current = data;
          setPullRequestCommitDetails(data);
        }
        pullRequestCommitDetailsErrorKeyRef.current = null;
        setPullRequestCommitDetailsError(null);
      } catch (e: any) {
        if (!mounted) return;
        pullRequestCommitDetailsErrorKeyRef.current = cacheKey;
        setPullRequestCommitDetailsError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setPullRequestCommitDetailsLoading(false);
      }
    };
    void load(Boolean(cached) && !forceInitialLoad, Boolean(cached) || forceInitialLoad);
    return () => {
      mounted = false;
    };
  }, [contextMode, disabled, droneId, primaryView, pullRequestNumber, refreshNonce, repoAttached, repoPath, selectedCommitSha]);

  const activePullRequestChanges =
    contextMode === 'pull-request' &&
    pullRequestNumber &&
    pullRequestChanges?.id === droneId &&
    pullRequestChanges.pullRequest.number === pullRequestNumber
      ? pullRequestChanges
      : null;

  const workingTreeEntries = React.useMemo(() => sortRepoChangeEntries(changes?.entries ?? []), [changes?.entries]);

  const pullEntriesAsWorkingEntries: RepoChangeEntry[] = React.useMemo(() => {
    return sortRepoChangeEntries(toWorkingEntriesFromPull(pullChanges?.entries ?? []));
  }, [pullChanges?.entries]);

  const pullRequestEntriesAsWorkingEntries: RepoChangeEntry[] = React.useMemo(() => {
    return sortRepoChangeEntries(toWorkingEntriesFromPull(activePullRequestChanges?.entries ?? []));
  }, [activePullRequestChanges?.entries]);

  const allEntries =
    dataMode === 'working-tree'
      ? workingTreeEntries
      : dataMode === 'pull-request'
        ? pullRequestEntriesAsWorkingEntries
        : pullEntriesAsWorkingEntries;
  const activeReviewScopeId =
    primaryView !== 'changes'
      ? null
      : dataMode === 'working-tree'
        ? changes?.reviewScopeId ?? null
        : dataMode === 'pull-request'
          ? activePullRequestChanges?.reviewScopeId ?? null
          : pullChanges?.reviewScopeId ?? null;
  const entryViewedStatus = React.useCallback(
    (entry: RepoChangeEntry): ViewedEntryState => viewedStateForEntry(viewedStore, activeReviewScopeId, entry),
    [activeReviewScopeId, viewedStore],
  );
  const viewedCounts = React.useMemo(() => {
    let viewed = 0;
    let stale = 0;
    for (const entry of allEntries) {
      const state = entryViewedStatus(entry);
      if (state === 'viewed') viewed += 1;
      else if (state === 'stale') stale += 1;
    }
    return {
      viewed,
      stale,
      remaining: Math.max(0, allEntries.length - viewed),
    };
  }, [allEntries, entryViewedStatus]);
  const hideViewedMenuLabel =
    viewedCounts.viewed > 0 ? `Hide viewed files (${viewedCounts.viewed})` : 'Hide viewed files';
  const entries = React.useMemo(
    () => (hideViewed ? allEntries.filter((entry) => entryViewedStatus(entry) !== 'viewed') : allEntries),
    [allEntries, entryViewedStatus, hideViewed],
  );
  const listLoading =
    dataMode === 'working-tree' ? changesLoading : dataMode === 'pull-request' ? pullRequestLoading : pullLoading;
  const rawListError =
    dataMode === 'working-tree' ? changesError : dataMode === 'pull-request' ? pullRequestError : pullError;
  const activeListCacheKey =
    dataMode === 'working-tree'
      ? changesCacheKey('working-tree', droneId, repoPath)
      : dataMode === 'pull-request'
        ? pullRequestNumber
          ? changesCacheKey('pull-request', droneId, repoPath, pullRequestNumber)
          : ''
        : changesCacheKey('pull-preview', droneId, repoPath);
  const loadedListCacheKey =
    dataMode === 'working-tree'
      ? workingTreeCacheKeyRef.current
      : dataMode === 'pull-request'
        ? pullRequestCacheKeyRef.current
        : pullPreviewCacheKeyRef.current;
  const listError = activeListCacheKey === loadedListCacheKey ? rawListError : null;
  const activeCommitList =
    contextMode === 'pull-request'
      ? pullRequestNumber &&
        pullRequestCommitList?.id === droneId &&
        pullRequestCommitList.pullNumber === pullRequestNumber
        ? pullRequestCommitList
        : null
      : branchCommitList?.id === droneId
        ? branchCommitList
        : null;
  const commitList = activeCommitList?.commits ?? [];
  const commitListLoading = contextMode === 'pull-request' ? pullRequestCommitListLoading : branchCommitListLoading;
  const rawCommitListError = contextMode === 'pull-request' ? pullRequestCommitListError : branchCommitListError;
  const activeCommitListCacheKey =
    contextMode === 'pull-request'
      ? pullRequestNumber
        ? changesCacheKey('pull-request-commits', droneId, repoPath, pullRequestNumber)
        : ''
      : changesCacheKey('branch-commits', droneId, repoPath);
  const loadedCommitListCacheKey =
    contextMode === 'pull-request'
      ? pullRequestCommitListCacheKeyRef.current
      : branchCommitListCacheKeyRef.current;
  const commitListError =
    activeCommitListCacheKey === loadedCommitListCacheKey ? rawCommitListError : null;
  const storedActiveCommitDetails = contextMode === 'pull-request' ? pullRequestCommitDetails : branchCommitDetails;
  const activeCommitDetails =
    storedActiveCommitDetails && storedActiveCommitDetails.commit.sha === selectedCommitSha ? storedActiveCommitDetails : null;
  const activeCommitDetailsLoadingRaw = contextMode === 'pull-request' ? pullRequestCommitDetailsLoading : branchCommitDetailsLoading;
  const activeCommitDetailsError =
    contextMode === 'pull-request'
      ? selectedCommitSha &&
        pullRequestNumber &&
        pullRequestCommitDetailsErrorKeyRef.current ===
          changesCacheKey('pull-request-commit-details', droneId, repoPath, pullRequestNumber, selectedCommitSha)
        ? pullRequestCommitDetailsError
        : null
      : selectedCommitSha &&
          branchCommitDetailsErrorKeyRef.current === changesCacheKey('branch-commit-details', droneId, repoPath, selectedCommitSha)
        ? branchCommitDetailsError
        : null;
  const commitEntries = React.useMemo(
    () => sortRepoChangeEntries(toWorkingEntriesFromCommit(activeCommitDetails?.entries ?? [])),
    [activeCommitDetails?.entries],
  );
  const selectedCommitSummary = React.useMemo(
    () => (selectedCommitSha ? commitList.find((entry) => entry.sha === selectedCommitSha) ?? null : null),
    [commitList, selectedCommitSha],
  );
  const selectedCommit =
    activeCommitDetails && activeCommitDetails.commit.sha === selectedCommitSha ? activeCommitDetails.commit : selectedCommitSummary;
  const activeCommitDetailsLoading =
    activeCommitDetailsLoadingRaw || Boolean(selectedCommit && selectedCommitSha && !activeCommitDetails && !activeCommitDetailsError);

  const entriesSignature = React.useMemo(
    () =>
      dataMode === 'working-tree'
        ? entries.map((e) => `${e.path}\u0000${e.code}\u0000${e.originalPath ?? ''}`).join('\n')
        : dataMode === 'pull-request'
          ? [
              'pull-request',
              String(activePullRequestChanges?.pullRequest.number ?? ''),
              activePullRequestChanges?.pullRequest.baseSha ?? '',
              activePullRequestChanges?.pullRequest.headSha ?? '',
              entries.map((e) => `${e.path}\u0000${e.code}\u0000${e.originalPath ?? ''}`).join('\n'),
            ].join('\n')
          : [
              'pull-preview',
              pullChanges?.baseSha ?? '',
              pullChanges?.headSha ?? '',
              entries.map((e) => `${e.path}\u0000${e.code}\u0000${e.originalPath ?? ''}`).join('\n'),
            ].join('\n'),
    [activePullRequestChanges?.pullRequest.baseSha, activePullRequestChanges?.pullRequest.headSha, activePullRequestChanges?.pullRequest.number, dataMode, entries, pullChanges?.baseSha, pullChanges?.headSha],
  );

  React.useEffect(() => {
    setSelectedPath((prev) => {
      if (entries.length === 0) {
        return listLoading || activeListCacheKey !== loadedListCacheKey ? prev : null;
      }
      if (prev && entries.some((e) => e.path === prev)) return prev;
      return entries[0].path;
    });
  }, [activeListCacheKey, entriesSignature, listLoading, loadedListCacheKey]);

  React.useEffect(() => {
    if (primaryView !== 'commits') return;
    setSelectedCommitSha((prev) => {
      if (commitList.length === 0) {
        return commitListLoading || activeCommitListCacheKey !== loadedCommitListCacheKey ? prev : null;
      }
      if (prev && commitList.some((entry) => entry.sha === prev)) return prev;
      return null;
    });
  }, [activeCommitListCacheKey, commitList, commitListLoading, loadedCommitListCacheKey, primaryView]);

  React.useEffect(() => {
    setCommitFileSelectedPath((prev) => {
      if (commitEntries.length === 0) return activeCommitDetailsLoading ? prev : null;
      if (prev && commitEntries.some((entry) => entry.path === prev)) return prev;
      return commitEntries[0].path;
    });
  }, [
    activeCommitDetailsLoading,
    selectedCommitSha,
    activeCommitDetails?.commit.sha,
    commitEntries,
  ]);

  React.useEffect(() => {
    diffByKeyRef.current = diffByKey;
  }, [diffByKey]);
  React.useEffect(() => {
    commitDiffByKeyRef.current = commitDiffByKey;
  }, [commitDiffByKey]);

  const selectedEntry = React.useMemo(
    () => (selectedPath ? entries.find((e) => e.path === selectedPath) ?? null : null),
    [entries, selectedPath],
  );
  const setEntryViewedState = React.useCallback(
    (entry: RepoChangeEntry, viewed: boolean) => {
      if (primaryView !== 'changes') return;
      setViewedStore((prev) => setEntryViewed(prev, activeReviewScopeId, entry, viewed));
    },
    [activeReviewScopeId, primaryView],
  );

  React.useEffect(() => {
    if (dataMode !== 'working-tree') return;
    setSplitKind((prev) => {
      const next = effectiveKindForEntry(selectedEntry, prev);
      return next ?? defaultKindForEntry(selectedEntry);
    });
  }, [dataMode, selectedEntry]);

  const allExplorerTree = React.useMemo(() => buildExplorerTree(allEntries), [allEntries]);
  const explorerTree = React.useMemo(() => buildExplorerTree(entries), [entries]);
  const stagedEntries = React.useMemo(
    () => (dataMode === 'working-tree' ? entries.filter(hasStaged) : []),
    [dataMode, entries],
  );
  const unstagedEntries = React.useMemo(
    () => (dataMode === 'working-tree' ? entries.filter(hasUnstaged) : []),
    [dataMode, entries],
  );
  const stagedExplorerTree = React.useMemo(() => buildExplorerTree(stagedEntries), [stagedEntries]);
  const unstagedExplorerTree = React.useMemo(() => buildExplorerTree(unstagedEntries), [unstagedEntries]);
  const explorerReviewSummaryByPath = React.useMemo(
    () => (primaryView === 'changes' ? summarizeExplorerReviewState(allExplorerTree, entryViewedStatus) : {}),
    [allExplorerTree, entryViewedStatus, primaryView],
  );
  const commitExplorerTree = React.useMemo(() => buildExplorerTree(commitEntries), [commitEntries]);
  const activeExplorerTree = primaryView === 'commits' ? commitExplorerTree : explorerTree;
  const activeExpandedDirs = primaryView === 'commits' ? expandedCommitDirs : expandedDirs;

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
  React.useEffect(() => {
    setExpandedCommitDirs((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const node of commitExplorerTree) {
        if (node.kind !== 'dir') continue;
        if (!(node.path in next)) {
          next[node.path] = true;
          changed = true;
        }
      }
      if (commitFileSelectedPath) {
        for (const p of parentDirPaths(commitFileSelectedPath)) {
          if (!next[p]) {
            next[p] = true;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [commitExplorerTree, commitFileSelectedPath]);

  const recomputeExplorerWidth = React.useCallback(() => {
    if (viewMode !== 'split') return;
    if (explorerDragRef.current) return;
    const splitWidth = splitLayoutRef.current?.clientWidth ?? 0;
    if (splitWidth <= 0) return;
    const bounds = resolveExplorerSidebarWidthBounds(splitWidth, explorerWidthOptions);
    const rows = flattenVisibleExplorerRows(activeExplorerTree, activeExpandedDirs);
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
  }, [activeExpandedDirs, activeExplorerTree, explorerManualWidthPx, explorerWidthOptions, explorerZoom, viewMode]);

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

  const resolveCommitListWidthBounds = React.useCallback(() => {
    const panelWidth = commitLayoutRef.current?.clientWidth ?? 0;
    return resolveExplorerSidebarWidthBounds(panelWidth, {
      minWidthPx: COMMIT_LIST_MIN_WIDTH_PX,
      maxWidthPx: COMMIT_LIST_MAX_WIDTH_PX,
      maxWidthRatio: COMMIT_LIST_MAX_RATIO,
      minDiffWidthPx: COMMIT_DETAIL_MIN_WIDTH_PX,
      fallbackWidthPx: COMMIT_LIST_DEFAULT_WIDTH_PX,
    });
  }, []);

  const restoreCommitListResizeBodyStyles = React.useCallback(() => {
    const styles = commitListResizeBodyStyleRef.current;
    if (!styles) return;
    document.body.style.cursor = styles.cursor;
    document.body.style.userSelect = styles.userSelect;
    commitListResizeBodyStyleRef.current = null;
  }, []);

  const finishCommitListResize = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = commitListDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      commitListDragRef.current = null;
      setCommitListResizing(false);
      setCommitListWidthPx(Math.floor(drag.liveWidth));
      restoreCommitListResizeBodyStyles();
    },
    [restoreCommitListResizeBodyStyles],
  );

  const startCommitListResize = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const bounds = resolveCommitListWidthBounds();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      commitListDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: clampNumber(commitListWidthPx, bounds.minWidthPx, bounds.maxWidthPx),
        liveWidth: clampNumber(commitListWidthPx, bounds.minWidthPx, bounds.maxWidthPx),
      };
      commitListResizeBodyStyleRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      setCommitListResizing(true);
    },
    [commitListWidthPx, resolveCommitListWidthBounds],
  );

  const moveCommitListResize = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = commitListDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const bounds = resolveCommitListWidthBounds();
      const nextWidth = clampNumber(drag.startWidth + (event.clientX - drag.startX), bounds.minWidthPx, bounds.maxWidthPx);
      drag.liveWidth = nextWidth;
      setCommitListWidthPx(Math.floor(nextWidth));
    },
    [resolveCommitListWidthBounds],
  );

  const resetCommitListWidth = React.useCallback(() => {
    const bounds = resolveCommitListWidthBounds();
    setCommitListWidthPx(clampNumber(COMMIT_LIST_DEFAULT_WIDTH_PX, bounds.minWidthPx, bounds.maxWidthPx));
  }, [resolveCommitListWidthBounds]);

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
  React.useEffect(() => {
    if (primaryView !== 'commits') return;
    const panel = commitLayoutRef.current;
    if (!panel) return;
    let raf = 0;
    const sync = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        const bounds = resolveCommitListWidthBounds();
        setCommitListWidthPx((prev) => clampNumber(prev, bounds.minWidthPx, bounds.maxWidthPx));
      });
    };
    sync();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => {
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('resize', sync);
      };
    }
    const observer = new ResizeObserver(() => {
      sync();
    });
    observer.observe(panel);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [primaryView, resolveCommitListWidthBounds]);
  React.useEffect(() => {
    return () => {
      restoreCommitListResizeBodyStyles();
    };
  }, [restoreCommitListResizeBodyStyles]);

  const workingDiffStateKey = React.useCallback(
    (path: string, kind: DiffKind) => scopedChangesStateKey(droneId, `wt\u0000${diffKey(path, kind)}`),
    [droneId],
  );
  const pullPreviewDiffStateKey = React.useCallback(
    (path: string, baseSha: string | null | undefined, headSha: string | null | undefined) =>
      scopedChangesStateKey(
        droneId,
        `pull\u0000${String(baseSha ?? '').trim().toLowerCase()}\u0000${String(headSha ?? '').trim().toLowerCase()}\u0000${path}`,
      ),
    [droneId],
  );
  const pullRequestDiffStateKey = React.useCallback(
    (path: string, prNumber: number | null | undefined) =>
      scopedChangesStateKey(droneId, `pr\u0000${Math.max(1, Math.floor(Number(prNumber ?? 0)))}\u0000${path}`),
    [droneId],
  );
  const commitDiffStateKey = React.useCallback(
    (path: string, sha: string | null | undefined, mode: ChangesContextMode) =>
      scopedChangesStateKey(droneId, `commit\u0000${mode}\u0000${String(sha ?? '').trim().toLowerCase()}\u0000${path}`),
    [droneId],
  );
  const validDiffStateKeys = React.useMemo(() => {
    const keys = new Set<string>();
    if (dataMode === 'working-tree') {
      for (const entry of entries) {
        if (hasStaged(entry)) keys.add(workingDiffStateKey(entry.path, 'staged'));
        if (hasUnstaged(entry)) keys.add(workingDiffStateKey(entry.path, 'unstaged'));
      }
      return keys;
    }
    if (dataMode === 'pull-preview') {
      for (const entry of entries) {
        keys.add(pullPreviewDiffStateKey(entry.path, pullChanges?.baseSha, pullChanges?.headSha));
      }
      return keys;
    }
    for (const entry of entries) {
      keys.add(pullRequestDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber));
    }
    return keys;
  }, [
    dataMode,
    entries,
    pullChanges?.baseSha,
    pullChanges?.headSha,
    activePullRequestChanges?.pullRequest.number,
    pullRequestDiffStateKey,
    pullPreviewDiffStateKey,
    pullRequestNumber,
    workingDiffStateKey,
  ]);
  const validCommitDiffStateKeys = React.useMemo(() => {
    const keys = new Set<string>();
    const sha = selectedCommit?.sha ?? selectedCommitSha;
    if (!sha) return keys;
    for (const entry of commitEntries) {
      keys.add(commitDiffStateKey(entry.path, sha, contextMode));
    }
    return keys;
  }, [commitDiffStateKey, commitEntries, contextMode, selectedCommit?.sha, selectedCommitSha]);

  React.useEffect(() => {
    setDiffByKey((prev) => pruneRecordKeys(prev, validDiffStateKeys));
    setExpandedRangesByDiffKey((prev) => pruneRecordKeys(prev, validDiffStateKeys));
    diffByKeyRef.current = pruneRecordKeys(diffByKeyRef.current, validDiffStateKeys);
    diffSourceByKeyRef.current = pruneRecordKeys(diffSourceByKeyRef.current, validDiffStateKeys);
    diffSourceInflightByKeyRef.current = pruneRecordKeys(diffSourceInflightByKeyRef.current, validDiffStateKeys);
    inflightRef.current = new Set(Array.from(inflightRef.current).filter((key) => validDiffStateKeys.has(key)));
    setExpandedPullFiles((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [path, open] of Object.entries(prev)) {
        if (!entries.some((entry) => entry.path === path)) {
          changed = true;
          continue;
        }
        next[path] = open;
      }
      return changed ? next : prev;
    });
  }, [entries, validDiffStateKeys]);
  React.useEffect(() => {
    setCommitDiffByKey((prev) => pruneRecordKeys(prev, validCommitDiffStateKeys));
    commitDiffByKeyRef.current = pruneRecordKeys(commitDiffByKeyRef.current, validCommitDiffStateKeys);
    commitInflightRef.current = new Set(Array.from(commitInflightRef.current).filter((key) => validCommitDiffStateKeys.has(key)));
    setExpandedCommitFiles((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [path, open] of Object.entries(prev)) {
        if (!commitEntries.some((entry) => entry.path === path)) {
          changed = true;
          continue;
        }
        next[path] = open;
      }
      return changed ? next : prev;
    });
  }, [commitEntries, validCommitDiffStateKeys]);

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
      const keepRenderedDiff = force && cur?.status === 'loaded';
      clearDiffExpansionSource(key);
      if (!keepRenderedDiff) {
        clearExpandedRangesForDiff(key);
      }
      if (!keepRenderedDiff) {
        setDiffByKey((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      }
      try {
        const data = await requestJson<Extract<RepoDiffPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/diff?path=${encodeURIComponent(path)}&kind=${kind}&contextLines=3`,
        );
        if (!mountedRef.current) return;
        const nextState: DiffState = {
          status: 'loaded',
          text: typeof data.diff === 'string' ? data.diff : '',
          truncated: Boolean(data.truncated),
          fromUntracked: Boolean(data.fromUntracked),
          isBinary: false,
          noTextReason: null,
          contextLines: 3,
        };
        setDiffByKey((prev) => {
          const existing = prev[key];
          if (
            existing &&
            existing.status === 'loaded' &&
            existing.text === nextState.text &&
            existing.truncated === nextState.truncated &&
            existing.fromUntracked === nextState.fromUntracked &&
            existing.isBinary === nextState.isBinary &&
            existing.noTextReason === nextState.noTextReason &&
            existing.contextLines === nextState.contextLines
          ) {
            return prev;
          }
          return {
            ...prev,
            [key]: nextState,
          };
        });
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
      const keepRenderedDiff = force && cur?.status === 'loaded';
      clearDiffExpansionSource(key);
      if (!keepRenderedDiff) {
        clearExpandedRangesForDiff(key);
      }
      if (!keepRenderedDiff) {
        setDiffByKey((prev) => ({ ...prev, [key]: { status: 'loading' } }));
      }
      try {
        const data = await requestJson<Extract<RepoPullDiffPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull/diff?path=${encodeURIComponent(filePath)}&base=${encodeURIComponent(
            String(baseSha ?? '').trim().toLowerCase(),
          )}&head=${encodeURIComponent(String(headSha ?? '').trim().toLowerCase())}&contextLines=3`,
        );
        if (!mountedRef.current) return;
        const nextState: DiffState = {
          status: 'loaded',
          text: typeof data.diff === 'string' ? data.diff : '',
          truncated: Boolean(data.truncated),
          fromUntracked: false,
          isBinary: false,
          noTextReason: null,
          contextLines: 3,
        };
        setDiffByKey((prev) => {
          const existing = prev[key];
          if (
            existing &&
            existing.status === 'loaded' &&
            existing.text === nextState.text &&
            existing.truncated === nextState.truncated &&
            existing.fromUntracked === nextState.fromUntracked &&
            existing.isBinary === nextState.isBinary &&
            existing.noTextReason === nextState.noTextReason &&
            existing.contextLines === nextState.contextLines
          ) {
            return prev;
          }
          return {
            ...prev,
            [key]: nextState,
          };
        });
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

  const loadCommitDiff = React.useCallback(
    async ({
      filePath,
      sha,
      stateKey,
      mode,
      force = false,
    }: {
      filePath: string;
      sha: string | null | undefined;
      stateKey: string;
      mode: ChangesContextMode;
      force?: boolean;
    }) => {
      const normalizedSha = String(sha ?? '').trim().toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(normalizedSha)) return;
      if (commitInflightRef.current.has(stateKey)) return;
      const cur = commitDiffByKeyRef.current[stateKey];
      if (cur?.status === 'loading') return;
      if (!force && cur?.status === 'loaded') return;

      commitInflightRef.current.add(stateKey);
      if (!(force && cur?.status === 'loaded')) {
        setCommitDiffByKey((prev) => ({ ...prev, [stateKey]: { status: 'loading' } }));
      }
      try {
        const url =
          mode === 'pull-request' && pullRequestNumber
            ? `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${pullRequestNumber}/commits/${encodeURIComponent(normalizedSha)}/diff?path=${encodeURIComponent(filePath)}&contextLines=3`
            : `/api/drones/${encodeURIComponent(droneId)}/repo/commits/${encodeURIComponent(normalizedSha)}/diff?path=${encodeURIComponent(filePath)}&contextLines=3`;
        const data = await requestJson<Extract<RepoCommitDiffPayload, { ok: true }>>(url);
        if (!mountedRef.current) return;
        const nextState: DiffState = {
          status: 'loaded',
          text: typeof data.diff === 'string' ? data.diff : '',
          truncated: Boolean(data.truncated),
          fromUntracked: false,
          isBinary: Boolean(data.isBinary),
          noTextReason: data.isBinary ? 'binary' : data.truncated && !String(data.diff ?? '').trim() ? 'truncated' : null,
          contextLines: 3,
        };
        setCommitDiffByKey((prev) => ({ ...prev, [stateKey]: nextState }));
      } catch (e: any) {
        if (!mountedRef.current) return;
        setCommitDiffByKey((prev) => ({
          ...prev,
          [stateKey]: { status: 'error', error: e?.message ?? String(e) },
        }));
      } finally {
        commitInflightRef.current.delete(stateKey);
      }
    },
    [droneId, pullRequestNumber],
  );

  React.useEffect(() => {
    if (dataMode !== 'pull-request') return;
    const prNumber = Number(activePullRequestChanges?.pullRequest.number);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return;
    const list = activePullRequestChanges?.entries ?? [];
    for (const entry of list) {
      const key = pullRequestDiffStateKey(entry.path, prNumber);
      clearDiffExpansionSource(key);
      clearExpandedRangesForDiff(key);
    }
    setDiffByKey((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const entry of list) {
        const key = pullRequestDiffStateKey(entry.path, prNumber);
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
  }, [
    clearDiffExpansionSource,
    clearExpandedRangesForDiff,
    dataMode,
    activePullRequestChanges?.entries,
    activePullRequestChanges?.pullRequest.number,
    pullRequestDiffStateKey,
  ]);

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
    if (refreshNonce <= 0) return;
    if (dataMode !== 'working-tree') return;
    if (!repoAttached || disabled) return;
    if (viewMode === 'stacked') {
      for (const entry of entries) {
        const k = effectiveKindForEntry(entry, stackedPreferredKind);
        if (!k) continue;
        void loadDiff(entry.path, k, true, true);
      }
      return;
    }
    if (!selectedEntry || !splitShownKind) return;
    void loadDiff(selectedEntry.path, splitShownKind, true, true);
  }, [dataMode, disabled, entries, loadDiff, refreshNonce, repoAttached, selectedEntry, splitShownKind, stackedPreferredKind, viewMode]);

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

  React.useEffect(() => {
    if (refreshNonce <= 0) return;
    if (dataMode !== 'pull-preview') return;
    if (!repoAttached || disabled || !selectedEntry) return;
    const key = pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha);
    void loadRangeDiff({
      filePath: selectedEntry.path,
      baseSha: pullChanges?.baseSha,
      headSha: pullChanges?.headSha,
      stateKey: key,
      force: true,
    });
  }, [dataMode, disabled, loadRangeDiff, pullChanges?.baseSha, pullChanges?.headSha, pullPreviewDiffStateKey, refreshNonce, repoAttached, selectedEntry]);

  const selectedCommitFileEntry = React.useMemo(
    () => (commitFileSelectedPath ? commitEntries.find((entry) => entry.path === commitFileSelectedPath) ?? null : null),
    [commitEntries, commitFileSelectedPath],
  );

  React.useEffect(() => {
    if (primaryView !== 'commits') return;
    if (!repoAttached || disabled) return;
    if (!selectedCommit || !selectedCommitFileEntry || viewMode !== 'split') return;
    const key = commitDiffStateKey(selectedCommitFileEntry.path, selectedCommit.sha, contextMode);
    void loadCommitDiff({
      filePath: selectedCommitFileEntry.path,
      sha: selectedCommit.sha,
      stateKey: key,
      mode: contextMode,
    });
  }, [commitDiffStateKey, contextMode, disabled, loadCommitDiff, primaryView, repoAttached, selectedCommit, selectedCommitFileEntry, viewMode]);

  React.useEffect(() => {
    if (primaryView !== 'commits') return;
    if (!repoAttached || disabled || viewMode !== 'stacked' || !selectedCommit) return;
    for (const entry of commitEntries) {
      const key = commitDiffStateKey(entry.path, selectedCommit.sha, contextMode);
      if (expandedCommitFiles[entry.path] !== true) continue;
      void loadCommitDiff({
        filePath: entry.path,
        sha: selectedCommit.sha,
        stateKey: key,
        mode: contextMode,
      });
    }
  }, [commitDiffStateKey, commitEntries, contextMode, disabled, expandedCommitFiles, loadCommitDiff, primaryView, repoAttached, selectedCommit, viewMode]);

  React.useEffect(() => {
    if (primaryView !== 'commits') return;
    if (refreshNonce <= 0) return;
    if (!repoAttached || disabled || !selectedCommit) return;
    if (viewMode === 'stacked') {
      for (const entry of commitEntries) {
        if (expandedCommitFiles[entry.path] !== true) continue;
        const key = commitDiffStateKey(entry.path, selectedCommit.sha, contextMode);
        void loadCommitDiff({
          filePath: entry.path,
          sha: selectedCommit.sha,
          stateKey: key,
          mode: contextMode,
          force: true,
        });
      }
      return;
    }
    if (!selectedCommitFileEntry) return;
    const key = commitDiffStateKey(selectedCommitFileEntry.path, selectedCommit.sha, contextMode);
    void loadCommitDiff({
      filePath: selectedCommitFileEntry.path,
      sha: selectedCommit.sha,
      stateKey: key,
      mode: contextMode,
      force: true,
    });
  }, [
    commitDiffStateKey,
    commitEntries,
    contextMode,
    disabled,
    expandedCommitFiles,
    loadCommitDiff,
    primaryView,
    refreshNonce,
    repoAttached,
    selectedCommit,
    selectedCommitFileEntry,
    viewMode,
  ]);

  const pullBase = contextMode === 'pull-request' ? (activePullRequestChanges?.pullRequest.baseSha ?? null) : (pullChanges?.baseSha ?? null);
  const pullHead = contextMode === 'pull-request' ? (activePullRequestChanges?.pullRequest.headSha ?? null) : (pullChanges?.headSha ?? null);
  const selectedPullRequestNumber =
    contextMode === 'pull-request' ? Math.max(1, Math.floor(Number(pullRequestNumber ?? 0))) || null : null;
  const loadedPullRequestNumber =
    contextMode === 'pull-request' ? Math.max(1, Math.floor(Number(activePullRequestChanges?.pullRequest.number ?? 0))) || null : null;
  const hasLoadedActivePullRequest =
    contextMode === 'pull-request' &&
    Boolean(selectedPullRequestNumber) &&
    Boolean(loadedPullRequestNumber) &&
    selectedPullRequestNumber === loadedPullRequestNumber;
  const activePullRequestNumber = hasLoadedActivePullRequest ? loadedPullRequestNumber : null;
  const awaitingPullRequestDetails =
    contextMode === 'pull-request' && Boolean(selectedPullRequestNumber) && !hasLoadedActivePullRequest && !pullRequestError;
  const activePullRequestTitleRaw = contextMode === 'pull-request' ? String(activePullRequestChanges?.pullRequest.title ?? '').trim() : '';
  const activePullRequestHtmlUrl = contextMode === 'pull-request' ? String(activePullRequestChanges?.pullRequest.htmlUrl ?? '').trim() : '';
  const activePullRequestState = contextMode === 'pull-request' ? String(activePullRequestChanges?.pullRequest.state ?? '').trim().toLowerCase() : '';
  const activePullRequestStatus = contextMode === 'pull-request' ? pullRequestStateBadge(activePullRequestChanges?.pullRequest.state) : null;
  const activePullRequestIsFinalState = activePullRequestState === 'merged' || activePullRequestState === 'closed';
  const activePullRequestActionBlockedReason = !activePullRequestNumber
    ? 'No pull request selected.'
    : activePullRequestIsFinalState
      ? `PR is already ${activePullRequestState}.`
      : null;
  const mergeActivePullRequest = React.useCallback(async () => {
    if (!activePullRequestNumber || pullRequestActionBusy || activePullRequestIsFinalState) return;
    const mergeMethod = readPullRequestMergeMethod();
    if (
      !(await confirm(
        pullRequestMergeConfirmation({
          pullNumber: activePullRequestNumber,
          baseRefName: activePullRequestChanges?.pullRequest.baseRefName,
          method: mergeMethod,
        }),
      ))
    )
      return;
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
        pullRequestChangesCache.delete(changesCacheKey('pull-request', droneId, repoPath, activePullRequestNumber));
      }
      setPullRequestActionNotice(merged.message || `Merged PR #${activePullRequestNumber}.`);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setPullRequestActionError(e?.message ?? String(e));
    } finally {
      if (mountedRef.current) setPullRequestActionBusy(null);
    }
  }, [activePullRequestChanges?.pullRequest.baseRefName, activePullRequestIsFinalState, activePullRequestNumber, confirm, droneId, pullRequestActionBusy, repoPath]);

  const closeActivePullRequest = React.useCallback(async () => {
    if (!activePullRequestNumber || pullRequestActionBusy || activePullRequestIsFinalState) return;
    if (!(await confirm(pullRequestCloseConfirmation({ pullNumber: activePullRequestNumber })))) return;
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
      pullRequestChangesCache.delete(changesCacheKey('pull-request', droneId, repoPath, activePullRequestNumber));
      setPullRequestActionNotice(`Closed PR #${closed.number}.`);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setPullRequestActionError(e?.message ?? String(e));
    } finally {
      if (mountedRef.current) setPullRequestActionBusy(null);
    }
  }, [activePullRequestIsFinalState, activePullRequestNumber, confirm, droneId, pullRequestActionBusy, repoPath]);

  const openEntryInEditor = React.useCallback(
    (entry: RepoChangeEntry | null) => {
      if (!entry || !entryPathExistsInCurrentTree(entry, dataMode)) return;
      onOpenFileInEditor(entry.path);
    },
    [dataMode, onOpenFileInEditor],
  );

  const runWorkingTreeAction = React.useCallback(
    async (entry: RepoChangeEntry, action: 'stage' | 'unstage' | 'discard') => {
      if (dataMode !== 'working-tree' || workingTreeActionBusy) return;
      if (
        action === 'discard' &&
        !(await confirm({
          title: 'Discard file changes?',
          message: entry.isUntracked
            ? `${entry.path} is untracked and will be deleted. This cannot be undone.`
            : `All unstaged changes in ${entry.path} will be permanently discarded.`,
          confirmLabel: 'Discard Changes',
          destructive: true,
        }))
      ) {
        return;
      }

      const busyKey = `${action}:${entry.path}`;
      setWorkingTreeActionBusy(busyKey);
      setWorkingTreeActionError(null);
      try {
        await requestJson(`/api/drones/${encodeURIComponent(droneId)}/repo/changes/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: entry.path, originalPath: entry.originalPath, action }),
        });
        workingTreeChangesCache.delete(changesCacheKey('working-tree', droneId, repoPath));
        setDiffByKey((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([key]) =>
                key !== workingDiffStateKey(entry.path, 'staged') &&
                key !== workingDiffStateKey(entry.path, 'unstaged'),
            ),
          ),
        );
        setRefreshNonce((value) => value + 1);
      } catch (error: any) {
        setWorkingTreeActionError(error?.message ?? String(error));
      } finally {
        setWorkingTreeActionBusy(null);
      }
    },
    [
      confirm,
      dataMode,
      droneId,
      repoPath,
      workingDiffStateKey,
      workingTreeActionBusy,
    ],
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

  const workingTreeExpansionSourceId = React.useCallback(
    (entry: RepoChangeEntry | null, kind: DiffKind | null | undefined) => {
      if (!entry || !kind) return null;
      if (kind === 'unstaged' && entry.isUntracked) return null;
      return workingDiffStateKey(entry.path, kind);
    },
    [workingDiffStateKey],
  );

  const pullExpansionSourceLoader = React.useCallback(
    (entry: RepoChangeEntry | null) => {
      if (!entry) return null;
      const baseSha = dataMode === 'pull-request' ? activePullRequestChanges?.pullRequest.baseSha : pullChanges?.baseSha;
      const headSha = dataMode === 'pull-request' ? activePullRequestChanges?.pullRequest.headSha : pullChanges?.headSha;
      if (!/^[0-9a-f]{40}$/.test(String(baseSha ?? '').trim().toLowerCase())) return null;
      const stateKey =
        dataMode === 'pull-request'
          ? pullRequestDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
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
      activePullRequestChanges?.pullRequest.baseSha,
      activePullRequestChanges?.pullRequest.headSha,
      activePullRequestChanges?.pullRequest.number,
      pullRequestDiffStateKey,
      pullRequestNumber,
    ],
  );

  const pullExpansionSourceId = React.useCallback(
    (entry: RepoChangeEntry | null) => {
      if (!entry) return null;
      const baseSha = dataMode === 'pull-request' ? activePullRequestChanges?.pullRequest.baseSha : pullChanges?.baseSha;
      const headSha = dataMode === 'pull-request' ? activePullRequestChanges?.pullRequest.headSha : pullChanges?.headSha;
      if (!/^[0-9a-f]{40}$/.test(String(baseSha ?? '').trim().toLowerCase())) return null;
      return dataMode === 'pull-request'
        ? pullRequestDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
        : pullPreviewDiffStateKey(entry.path, baseSha, headSha);
    },
    [
      dataMode,
      pullChanges?.baseSha,
      pullChanges?.headSha,
      pullPreviewDiffStateKey,
      activePullRequestChanges?.pullRequest.baseSha,
      activePullRequestChanges?.pullRequest.headSha,
      activePullRequestChanges?.pullRequest.number,
      pullRequestDiffStateKey,
      pullRequestNumber,
    ],
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
      if (primaryView === 'commits') {
        const commitIndex = selectedCommitSha ? commitList.findIndex((entry) => entry.sha === selectedCommitSha) : -1;
        const fileIndex = commitFileSelectedPath ? commitEntries.findIndex((entry) => entry.path === commitFileSelectedPath) : -1;
        const key = event.key.toLowerCase();
        if (key === '[' || key === ']') {
          if (commitList.length === 0) return;
          const delta = key === ']' ? 1 : -1;
          const baseIndex = commitIndex >= 0 ? commitIndex : key === ']' ? -1 : 0;
          const nextIndex = Math.min(commitList.length - 1, Math.max(0, baseIndex + delta));
          const nextCommit = commitList[nextIndex];
          if (!nextCommit || nextCommit.sha === selectedCommitSha) return;
          setSelectedCommitSha(nextCommit.sha);
          setCommitFileSelectedPath(null);
          event.preventDefault();
          return;
        }
        if (key === 'j' || key === 'k') {
          if (commitEntries.length === 0) return;
          const delta = key === 'j' ? 1 : -1;
          const baseIndex = fileIndex >= 0 ? fileIndex : key === 'j' ? -1 : 0;
          const nextIndex = Math.min(commitEntries.length - 1, Math.max(0, baseIndex + delta));
          const nextEntry = commitEntries[nextIndex];
          if (!nextEntry || nextEntry.path === commitFileSelectedPath) return;
          setCommitFileSelectedPath(nextEntry.path);
          event.preventDefault();
          return;
        }
        return;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    commitEntries,
    commitFileSelectedPath,
    commitList,
    primaryView,
    selectedCommitSha,
  ]);

  function renderFileQuickActions(
    entry: RepoChangeEntry,
    alwaysVisible: boolean = false,
    showViewedAction: boolean = true,
    workingKind?: DiffKind,
  ): React.ReactNode {
    const canOpenInEditor = entryPathExistsInCurrentTree(entry, dataMode);
    const viewedState = entryViewedStatus(entry);
    const canToggleViewed = primaryView === 'changes' && Boolean(activeReviewScopeId);
    const buttonClassName = `dh-changes-icon-button ${
      alwaysVisible
        ? ''
        : 'opacity-0 pointer-events-none group-hover/file:opacity-100 group-hover/file:pointer-events-auto'
    }`;
    return (
      <div className="shrink-0 inline-flex items-center gap-1">
        {showViewedAction && canToggleViewed ? (
          <button
            type="button"
            onClick={() => setEntryViewedState(entry, viewedState !== 'viewed')}
            className={`${buttonClassName} ${
              viewedState === 'viewed'
                ? 'is-active'
                : viewedState === 'stale'
                  ? 'is-warning'
                  : ''
            }`}
            title={
              viewedState === 'viewed'
                ? 'Mark file unviewed'
                : viewedState === 'stale'
                  ? 'File changed since it was viewed. Mark viewed again.'
                  : 'Mark file viewed'
            }
          >
            {viewedState === 'viewed' ? <IconEyeOff className="w-3 h-3" /> : <IconEye className="w-3 h-3" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => openEntryInEditor(entry)}
          disabled={!canOpenInEditor}
          className={`${buttonClassName} disabled:opacity-35 disabled:cursor-not-allowed`}
          title={canOpenInEditor ? 'Open in editor' : 'This path no longer exists in the current tree.'}
        >
          <OpenFileIcon />
        </button>
        {dataMode === 'working-tree' && workingKind === 'unstaged' ? (
          <>
            <button
              type="button"
              onClick={() => {
                void runWorkingTreeAction(entry, 'discard');
              }}
              disabled={Boolean(workingTreeActionBusy)}
              className={`${buttonClassName} text-[var(--muted)] hover:text-[var(--red)] disabled:opacity-35 disabled:cursor-wait`}
              title="Discard unstaged changes"
            >
              <DiscardChangesIcon />
            </button>
            <button
              type="button"
              onClick={() => {
                void runWorkingTreeAction(entry, 'stage');
              }}
              disabled={Boolean(workingTreeActionBusy)}
              className={`${buttonClassName} disabled:opacity-35 disabled:cursor-wait`}
              title="Stage changes"
            >
              <StageIcon />
            </button>
          </>
        ) : null}
        {dataMode === 'working-tree' && workingKind === 'staged' ? (
          <button
            type="button"
            onClick={() => {
              void runWorkingTreeAction(entry, 'unstage');
            }}
            disabled={Boolean(workingTreeActionBusy)}
            className={`${buttonClassName} disabled:opacity-35 disabled:cursor-wait`}
            title="Unstage changes"
          >
            <StageIcon unstage />
          </button>
        ) : null}
      </div>
    );
  }

  function renderExplorer(nodes: ExplorerNode[], depth: number, workingKind?: DiffKind): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = explorerIndentBasePx + depth * explorerIndentStepPx;
      if (node.kind === 'dir') {
        const open = expandedDirs[node.path] !== false;
        const reviewSummary = workingKind ? undefined : explorerReviewSummaryByPath[node.path];
        const dirAllViewed = Boolean(
          reviewSummary && reviewSummary.viewed > 0 && reviewSummary.unviewed === 0 && reviewSummary.stale === 0,
        );
        const dirHasChanged = Boolean(reviewSummary && reviewSummary.stale > 0);
        const dirHasViewed = Boolean(reviewSummary && reviewSummary.viewed > 0);
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
                className={`dh-changes-explorer-row w-full rounded-[var(--radius-small)] pr-2 text-left transition-colors flex items-center gap-1.5 font-mono ${
                  dirAllViewed
                    ? 'opacity-65 hover:bg-[var(--surface-soft)]'
                    : dirHasChanged
                      ? 'bg-[var(--yellow-subtle)] hover:bg-[var(--yellow-subtle)]'
                      : ''
                }`}
                style={{
                  height: `${explorerRowHeightPx}px`,
                  minHeight: `${explorerRowHeightPx}px`,
                }}
                title={
                  reviewSummary
                    ? `${node.path} • ${reviewSummary.unviewed + reviewSummary.stale} remaining • ${reviewSummary.viewed} viewed${
                        reviewSummary.stale > 0 ? ` • ${reviewSummary.stale} changed since viewed` : ''
                      }`
                    : node.path
                }
              >
                <span
                  className="inline-flex items-center justify-center flex-shrink-0 text-[var(--muted)]"
                  style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
                >
                  <IconFolder size={explorerIconSizePx} />
                </span>
                <span
                  className={`truncate flex-1 ${dirAllViewed ? 'text-[var(--muted)]' : 'text-[var(--fg-secondary)]'}`}
                  style={{ fontSize: `${explorerTextSizePx}px` }}
                >
                  {node.name}
                </span>
                {reviewSummary?.stale ? (
                  <span
                    className="inline-flex items-center justify-center rounded border px-1 text-[var(--yellow)] border-[var(--yellow-border)] bg-[var(--yellow-subtle)] tabular-nums"
                    style={{ fontSize: `${Math.max(8, explorerMetaTextSizePx - 1)}px`, height: `${explorerBadgeHeightPx}px` }}
                    title={`${reviewSummary.stale} file${reviewSummary.stale === 1 ? '' : 's'} changed since viewed`}
                  >
                    {reviewSummary.stale} changed
                  </span>
                ) : null}
                {reviewSummary && dirHasViewed ? (
                  <span
                    className={`inline-flex items-center justify-center rounded border px-1 tabular-nums ${
                      hideViewed
                        ? 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]'
                        : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    }`}
                    style={{ fontSize: `${Math.max(8, explorerMetaTextSizePx - 1)}px`, height: `${explorerBadgeHeightPx}px` }}
                    title={
                      hideViewed
                        ? `${reviewSummary.viewed} viewed file${reviewSummary.viewed === 1 ? '' : 's'} hidden by the filter`
                        : `${reviewSummary.viewed} viewed file${reviewSummary.viewed === 1 ? '' : 's'}`
                    }
                  >
                    {hideViewed ? `+${reviewSummary.viewed} viewed` : dirAllViewed ? 'All viewed' : `${reviewSummary.viewed} viewed`}
                  </span>
                ) : null}
                <span className="text-[var(--muted-dim)] tabular-nums" style={{ fontSize: `${explorerMetaTextSizePx}px` }}>
                  {reviewSummary?.total ?? node.count}
                </span>
              </button>
            </div>
            {open && node.children && node.children.length > 0 ? renderExplorer(node.children, depth + 1, workingKind) : null}
          </React.Fragment>
        );
      }

      const entry = node.entry ?? null;
      if (!entry) return null;
      const active =
        entry.path === selectedPath &&
        (!workingKind || splitShownKind === workingKind);
      const viewedState = entryViewedStatus(entry);
      const FileIcon = iconForFilePath(entry.path);
      return (
        <div
          key={`file:${entry.path}`}
          className="w-full group/file"
          style={{ paddingLeft: `${indentPx}px` }}
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setSelectedPath(entry.path);
                if (dataMode === 'working-tree') setSplitKind(workingKind ?? defaultKindForEntry(entry));
              }}
              aria-selected={active}
              className={`dh-changes-explorer-row w-full min-w-0 rounded-[var(--radius-small)] pr-2 text-left font-mono transition-all flex items-center gap-1.5 ${
                active
                  ? 'is-selected text-[var(--accent)]'
                  : viewedState === 'viewed'
                    ? 'opacity-60 hover:bg-[var(--surface-soft)]'
                    : viewedState === 'stale'
                      ? 'bg-[var(--yellow-subtle)] hover:bg-[var(--yellow-subtle)]'
                      : ''
              }`}
              style={{
                height: `${explorerRowHeightPx}px`,
                minHeight: `${explorerRowHeightPx}px`,
              }}
              title={
                viewedState === 'viewed'
                  ? `${entry.path} • viewed`
                  : viewedState === 'stale'
                    ? `${entry.path} • changed since viewed`
                    : entry.path
              }
            >
              <span
                className={`w-3 shrink-0 text-center font-mono font-[var(--weight-bold)] ${changesEntryStatusTextClass(entry, workingKind)}`}
                style={{ fontSize: `${explorerMetaTextSizePx}px` }}
                title={statusBadgeTitle(entry, dataMode)}
              >
                {changesEntryStatusShortLabel(entry, workingKind)}
              </span>
              <span
                className={`inline-flex items-center justify-center flex-shrink-0 ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                }`}
                style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
              >
                <FileIcon size={explorerIconSizePx} />
              </span>
              <span
                className={`truncate flex-1 ${active ? 'text-[var(--accent)]' : 'text-[var(--fg-secondary)]'}`}
                style={{ fontSize: `${explorerTextSizePx}px` }}
              >
                {node.name}
              </span>
              {viewedState !== 'unviewed' ? (
                <span
                  className={`inline-flex items-center justify-center rounded border px-1 font-[var(--weight-semibold)] ${
                    viewedState === 'viewed'
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]'
                  }`}
                  style={{ fontSize: `${Math.max(8, explorerMetaTextSizePx - 1)}px`, height: `${explorerBadgeHeightPx}px` }}
                  title={viewedState === 'viewed' ? 'Viewed' : 'Changed since viewed'}
                >
                  {viewedState === 'viewed' ? 'Viewed' : 'Changed'}
                </span>
              ) : null}
            </button>
            <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 rounded bg-[var(--chat-background)] px-0.5 opacity-0 shadow-[-8px_0_12px_var(--chat-background)] transition-opacity group-hover/file:pointer-events-auto group-hover/file:opacity-100 group-focus-within/file:pointer-events-auto group-focus-within/file:opacity-100">
              {renderFileQuickActions(entry, true, false, workingKind)}
            </div>
          </div>
        </div>
      );
    });
  }

  function renderCommitExplorer(nodes: ExplorerNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = explorerIndentBasePx + depth * explorerIndentStepPx;
      if (node.kind === 'dir') {
        const open = expandedCommitDirs[node.path] !== false;
        return (
          <React.Fragment key={`commit-dir:${node.path}`}>
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
                  setExpandedCommitDirs((prev) => ({ ...prev, [node.path]: !open }));
                }}
                className="dh-changes-explorer-row w-full rounded-[var(--radius-small)] pr-2 text-left font-mono flex items-center gap-1.5"
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
            {open && node.children && node.children.length > 0 ? renderCommitExplorer(node.children, depth + 1) : null}
          </React.Fragment>
        );
      }

      const entry = node.entry ?? null;
      if (!entry) return null;
      const active = entry.path === commitFileSelectedPath;
      const FileIcon = iconForFilePath(entry.path);
      return (
        <div key={`commit-file:${entry.path}`} className="w-full group/file" style={{ paddingLeft: `${indentPx}px` }}>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setCommitFileSelectedPath(entry.path);
              }}
              aria-selected={active}
              className={`dh-changes-explorer-row w-full min-w-0 rounded-[var(--radius-small)] pr-2 text-left font-mono transition-colors flex items-center gap-1.5 ${
                active ? 'is-selected text-[var(--accent)]' : ''
              }`}
              style={{
                height: `${explorerRowHeightPx}px`,
                minHeight: `${explorerRowHeightPx}px`,
              }}
              title={entry.path}
            >
              <span
                className={`w-3 shrink-0 text-center font-mono font-[var(--weight-bold)] ${changesEntryStatusTextClass(entry)}`}
                style={{ fontSize: `${explorerMetaTextSizePx}px` }}
                title={statusBadgeTitle(entry, 'pull-preview')}
              >
                {changesEntryStatusShortLabel(entry)}
              </span>
              <span
                className={`inline-flex items-center justify-center flex-shrink-0 ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                }`}
                style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
              >
                <FileIcon size={explorerIconSizePx} />
              </span>
              <span
                className={`truncate flex-1 ${active ? 'text-[var(--accent)]' : 'text-[var(--fg-secondary)]'}`}
                style={{ fontSize: `${explorerTextSizePx}px` }}
              >
                {node.name}
              </span>
            </button>
            <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 rounded bg-[var(--chat-background)] px-0.5 opacity-0 shadow-[-8px_0_12px_var(--chat-background)] transition-opacity group-hover/file:pointer-events-auto group-hover/file:opacity-100 group-focus-within/file:pointer-events-auto group-focus-within/file:opacity-100">
              {renderFileQuickActions(entry, true, false)}
            </div>
          </div>
        </div>
      );
    });
  }

  const unavailableReason = String(repoUnavailableReason ?? '').trim();
  const activeChangesPayload =
    dataMode === 'working-tree'
      ? changes?.id === droneId
        ? changes
        : null
      : dataMode === 'pull-request'
        ? activePullRequestChanges
        : pullChanges?.id === droneId
          ? pullChanges
          : null;
  const showingInitialLoad =
    repoAttached &&
    !disabled &&
    (primaryView === 'commits'
      ? !activeCommitList && !commitListError
      : !activeChangesPayload && !listError);
  const initialLoadingLabel =
    primaryView === 'commits'
      ? contextMode === 'pull-request'
        ? 'Loading pull request commits…'
        : 'Loading branch commits…'
      : dataMode === 'pull-request'
        ? 'Loading pull request…'
        : dataMode === 'pull-preview'
          ? 'Loading apply preview…'
          : 'Loading changes…';

  if (showingInitialLoad) {
    return (
      <div
        ref={dockRootRef}
        className="w-full h-full min-h-0 bg-[var(--chat-background)] overflow-hidden dh-changes-dock"
        style={diffZoomStyle(diffZoom)}
      >
        <PaneLoadingState label={initialLoadingLabel} />
      </div>
    );
  }

  return (
    <div
      ref={dockRootRef}
      className="w-full h-full min-h-0 bg-[var(--chat-background)] overflow-hidden flex flex-col relative dh-changes-dock"
      style={diffZoomStyle(diffZoom)}
    >
      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {repoAttached && !disabled && contextMode === 'branch' && primaryView === 'changes' ? (
            <div className="dh-changes-segment" aria-label="Branch change source">
              <button
                type="button"
                onClick={() => setBranchChangesMode('working-tree')}
                aria-pressed={branchChangesMode === 'working-tree'}
                className={changesSegmentButtonClass(branchChangesMode === 'working-tree')}
                title="Working tree changes inside the drone (staged/unstaged)"
              >
                Working
              </button>
              <button
                type="button"
                onClick={() => setBranchChangesMode('pull-preview')}
                aria-pressed={branchChangesMode === 'pull-preview'}
                className={changesSegmentButtonClass(branchChangesMode === 'pull-preview')}
                title="Apply preview: committed diff from base to drone HEAD (what applying changes would merge)"
              >
                Apply
              </button>
            </div>
          ) : null}
        </div>
        <div data-onboarding-id="changes.viewMode" className="dh-changes-toolbar-controls">
          {repoAttached && !disabled ? (
            <>
              {!fixedContextMode ? (
                <div className="dh-changes-toolbar-group">
                  <div className="dh-changes-segment" aria-label="Changes context">
                    <button
                      type="button"
                      onClick={() => setContextModeState('branch')}
                      aria-pressed={contextMode === 'branch'}
                      className={changesSegmentButtonClass(contextMode === 'branch')}
                      title="Branch"
                    >
                      Branch
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!pullRequestNumber) return;
                        setContextModeState('pull-request');
                      }}
                      disabled={!pullRequestNumber}
                      aria-pressed={contextMode === 'pull-request'}
                      className={changesSegmentButtonClass(contextMode === 'pull-request')}
                      title={pullRequestNumber ? `PR #${pullRequestNumber}` : 'Open a PR from the PRs tab first'}
                    >
                      PR
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="dh-changes-toolbar-group">
                <div className="dh-changes-segment" aria-label="Changes view">
                  <button
                    type="button"
                    onClick={() => setPrimaryView('changes')}
                    aria-pressed={primaryView === 'changes'}
                    className={changesSegmentButtonClass(primaryView === 'changes')}
                    title="Changes"
                  >
                    Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrimaryView('commits')}
                    aria-pressed={primaryView === 'commits'}
                    className={changesSegmentButtonClass(primaryView === 'commits')}
                    title="Commits"
                  >
                    Commits
                  </button>
                </div>
              </div>
            </>
          ) : null}
          <DiffZoomControl value={diffZoom} onChange={setDiffZoom} />
          <ChangesViewMenu
            viewMode={viewMode}
            diffViewType={diffViewType}
            showViewedControl={primaryView === 'changes'}
            hideViewed={hideViewed}
            hideViewedLabel={hideViewedMenuLabel}
            onViewModeChange={setViewMode}
            onDiffViewTypeChange={setDiffViewType}
            onToggleHideViewed={() => setHideViewed((prev) => !prev)}
          />
        </div>
      </div>

      {contextMode === 'pull-request' && awaitingPullRequestDetails ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-10)] text-[var(--muted)]">
          Loading PR #{selectedPullRequestNumber} details...
        </div>
      ) : null}
      {contextMode === 'pull-request' && hasLoadedActivePullRequest && activePullRequestNumber ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--surface-soft)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[var(--text-9)] font-[var(--weight-semibold)] tracking-[0.12em] uppercase text-[var(--muted-dim)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Pull Request
            </div>
            <div className="mt-1 text-[var(--text-13)] leading-snug font-[var(--weight-semibold)] text-[var(--fg-secondary)] truncate" title={activePullRequestTitleRaw || undefined}>
              <span className="font-mono text-[var(--accent)] mr-1.5">#{activePullRequestNumber}</span>
              <span>{activePullRequestTitleRaw || 'Untitled pull request'}</span>
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5 text-[var(--text-10)] text-[var(--muted)]">
              <MetaChip label="base" value={activePullRequestChanges?.pullRequest.baseRefName ?? '-'} mono />
              <MetaChip label="head" value={activePullRequestChanges?.pullRequest.headRefName ?? '-'} mono />
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void mergeActivePullRequest();
              }}
              disabled={Boolean(pullRequestActionBusy) || Boolean(activePullRequestActionBlockedReason)}
              className="inline-flex items-center h-6 px-2 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
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
              className="inline-flex items-center h-6 px-2 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed"
              title={activePullRequestActionBlockedReason ?? 'Close pull request without merging'}
              style={{ fontFamily: 'var(--display)' }}
            >
              {pullRequestActionBusy === 'close' ? 'Closing...' : 'Close'}
            </button>
            {activePullRequestStatus ? (
              <span
                className={`inline-flex items-center h-6 px-2 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide ${activePullRequestStatus.className}`}
                title={activePullRequestStatus.title}
                style={{ fontFamily: 'var(--display)' }}
              >
                {activePullRequestStatus.label}
              </span>
            ) : null}
            {activePullRequestHtmlUrl ? (
              <a
                className="inline-flex items-center h-6 px-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
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
      {contextMode === 'pull-request' && pullRequestActionNotice ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] text-[var(--text-10)] text-[var(--green)] bg-[var(--green-subtle)]">{pullRequestActionNotice}</div>
      ) : null}
      {contextMode === 'pull-request' && pullRequestActionError ? (
        <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] text-[var(--text-10)] text-[var(--red)] bg-[var(--red-subtle)]">{pullRequestActionError}</div>
      ) : null}

      {!repoAttached ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[var(--text-11)] text-[var(--muted)]">
          {unavailableReason || 'Attach a repo to see source-control changes.'}
        </div>
      ) : disabled ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[var(--text-11)] text-[var(--muted)]">
          <div className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3">
            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              {provisioningLabel(hubPhase)}
            </div>
            <div className="mt-1">
              {startup.timedOut
                ? 'Still waiting for the repository to become available.'
                : 'Waiting for repository…'}
            </div>
            {String(hubMessage ?? '').trim() ? (
              <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">{String(hubMessage ?? '').trim()}</div>
            ) : null}
            {startup.timedOut ? (
              <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
                If this persists, check the drone status/error details in the sidebar.
              </div>
            ) : null}
          </div>
        </div>
      ) : primaryView === 'commits' ? (
        commitListError ? (
          <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[var(--text-11)] text-[var(--red)]">{commitListError}</div>
        ) : commitList.length === 0 && !commitListLoading ? (
          <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[var(--text-11)] text-[var(--muted)]">
            {contextMode === 'pull-request'
              ? pullRequestNumber
                ? `No commits found for PR #${pullRequestNumber}.`
                : 'No pull request selected.'
              : 'No commits found for this branch context.'}
          </div>
        ) : (
          <CommitInspectionView
            contextMode={contextMode}
            pullRequestNumber={pullRequestNumber}
            commitList={commitList}
            commitListLoading={commitListLoading}
            selectedCommitSha={selectedCommitSha}
            onSelectCommit={setSelectedCommitSha}
            selectedCommit={selectedCommit}
            activeCommitDetails={activeCommitDetails}
            activeCommitDetailsLoading={activeCommitDetailsLoading}
            activeCommitDetailsError={activeCommitDetailsError}
            commitEntries={commitEntries}
            commitFileSelectedPath={commitFileSelectedPath}
            selectedCommitFileEntry={selectedCommitFileEntry}
            onSelectCommitFile={setCommitFileSelectedPath}
            expandedCommitFiles={expandedCommitFiles}
            onToggleCommitFile={(path, nextOpen) => setExpandedCommitFiles((prev) => ({ ...prev, [path]: nextOpen }))}
            commitDiffByKey={commitDiffByKey}
            commitDiffStateKey={commitDiffStateKey}
            loadCommitDiff={loadCommitDiff}
            diffViewType={diffViewType}
            viewMode={viewMode}
            commitExplorerTree={commitExplorerTree}
            renderCommitExplorer={renderCommitExplorer}
            renderFileQuickActions={renderFileQuickActions}
            commitLayoutRef={commitLayoutRef}
            commitListWidthPx={commitListWidthPx}
            commitListResizing={commitListResizing}
            startCommitListResize={startCommitListResize}
            moveCommitListResize={moveCommitListResize}
            finishCommitListResize={finishCommitListResize}
            resetCommitListWidth={resetCommitListWidth}
            splitLayoutRef={splitLayoutRef}
            explorerResizing={explorerResizing}
            explorerWidthPx={explorerWidthPx}
            startExplorerResize={startExplorerResize}
            moveExplorerResize={moveExplorerResize}
            finishExplorerResize={finishExplorerResize}
            resetExplorerWidthPreference={resetExplorerWidthPreference}
          />
        )
      ) : listError ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[var(--text-11)] text-[var(--red)]">{listError}</div>
      ) : entries.length === 0 && !listLoading ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[var(--text-11)] text-[var(--muted)]">
          {allEntries.length > 0 && hideViewed ? (
            <div className="inline-flex flex-col items-start gap-2">
              <span>All files in this view are marked viewed. Turn off Hide Viewed to revisit them.</span>
              <button
                type="button"
                onClick={() => setHideViewed(false)}
                className="h-7 px-2.5 rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--accent)] hover:bg-[var(--selected)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Show Viewed Files
              </button>
            </div>
          ) : dataMode === 'pull-request' ? (
            pullRequestNumber ? `No file changes found for PR #${pullRequestNumber}.` : 'No pull request selected.'
          ) : dataMode === 'pull-preview' ? (
            <div className="inline-flex flex-col items-start gap-2">
              <span>No apply changes to preview. This view only shows committed changes from the drone base to HEAD.</span>
              <span>If you just cancelled Apply because of uncommitted files, open Working Tree to review them there.</span>
              <button
                type="button"
                onClick={() => setBranchChangesMode('working-tree')}
                className="h-7 px-2.5 rounded-[var(--radius-medium)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--accent)] hover:bg-[var(--selected)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Open Working Tree
              </button>
            </div>
          ) : (
            'Working tree is clean.'
          )}
        </div>
      ) : viewMode === 'stacked' ? (
        <div className="flex-1 min-h-0 overflow-auto">
          {dataMode === 'working-tree' ? (
            <>
              <div className="sticky top-0 z-10 px-2.5 py-1 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur flex items-center gap-1">
                <span className="dh-changes-toolbar-label mr-1">Prefer</span>
                <div className="dh-changes-segment">
                  <button
                    type="button"
                    onClick={() => setStackedPreferredKind('unstaged')}
                    aria-pressed={stackedPreferredKind === 'unstaged'}
                    className={changesSegmentButtonClass(stackedPreferredKind === 'unstaged')}
                  >
                    Unstaged
                  </button>
                  <button
                    type="button"
                    onClick={() => setStackedPreferredKind('staged')}
                    aria-pressed={stackedPreferredKind === 'staged'}
                    className={changesSegmentButtonClass(stackedPreferredKind === 'staged')}
                  >
                    Staged
                  </button>
                </div>
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
                      className="group/file rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] overflow-hidden"
                    >
                      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/70 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center min-w-[32px] h-5 rounded border px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] ${badgeTone(entry)}`}
                          title={statusBadgeTitle(entry, dataMode)}
                        >
                          {changesEntryStatusLabel(entry)}
                        </span>
                        <span className="text-[var(--text-11)] text-[var(--fg-secondary)] font-mono truncate flex-1" title={entry.path}>
                          {fileNameForChangesPath(entry.path)}
                        </span>
                        {renderFileQuickActions(entry)}
                        <span className="text-[var(--text-9)] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                          {k}{fallback ? ' (fallback)' : ''}
                        </span>
                      </div>
                      <DiffBlock
                        state={state}
                        filePath={entry.path}
                        viewType={diffViewType}
                        expansionSourceId={workingTreeExpansionSourceId(entry, k)}
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
                    ? pullRequestDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
                    : pullPreviewDiffStateKey(entry.path, pullChanges?.baseSha, pullChanges?.headSha);
                const state = diffByKey[key];
                return (
                  <section
                    key={`${dataMode === 'pull-request' ? 'pr' : 'apply'}:${entry.path}`}
                    className="group/file rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] overflow-hidden"
                  >
                    <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/70 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center justify-center min-w-[32px] h-5 rounded border px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] ${badgeTone(entry)}`}
                        title={statusBadgeTitle(entry, dataMode)}
                      >
                        {changesEntryStatusLabel(entry)}
                      </span>
                      <span className="text-[var(--text-11)] text-[var(--fg-secondary)] font-mono truncate flex-1" title={entry.path}>
                        {fileNameForChangesPath(entry.path)}
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
                        className="h-6 px-2 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
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
                        expansionSourceId={pullExpansionSourceId(entry)}
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
          <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-[var(--chat-background)]">
            <div className="sticky top-0 z-10 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur flex items-center justify-between gap-2">
              <div className="min-w-0 text-[var(--text-10)] text-[var(--muted)] font-mono truncate">
                <span title={selectedEntry?.path}>
                  {selectedEntry ? fileNameForChangesPath(selectedEntry.path) : 'No file selected'}
                </span>
              </div>
              <div className="inline-flex items-center gap-1">
                {selectedEntry ? renderFileQuickActions(selectedEntry, true) : null}
                {dataMode === 'working-tree' ? (
                  selectedEntry && hasUnstaged(selectedEntry) && hasStaged(selectedEntry) ? (
                    <div className="dh-changes-segment" aria-label="Diff source">
                      <button
                        type="button"
                        onClick={() => setSplitKind('unstaged')}
                        aria-pressed={splitShownKind === 'unstaged'}
                        className={changesSegmentButtonClass(splitShownKind === 'unstaged')}
                        title="Changes in the working tree that are not staged"
                      >
                        Unstaged
                      </button>
                      <button
                        type="button"
                        onClick={() => setSplitKind('staged')}
                        aria-pressed={splitShownKind === 'staged'}
                        className={changesSegmentButtonClass(splitShownKind === 'staged')}
                        title="Changes already added to the Git index"
                      >
                        Staged
                      </button>
                    </div>
                  ) : null
                ) : (
                  <div className="text-[var(--text-9)] text-[var(--muted-dim)] font-mono whitespace-nowrap">
                    {dataMode === 'pull-request'
                      ? `PR #${activePullRequestChanges?.pullRequest.number ?? pullRequestNumber ?? '-'} ${shortSha(pullBase)}..${shortSha(pullHead)}`
                      : `${shortSha(pullBase)}..${shortSha(pullHead)}`}
                  </div>
                )}
              </div>
            </div>

            {dataMode === 'working-tree' ? (
              !selectedEntry || !splitShownKind ? (
                <div className="px-3 py-3 text-[var(--text-11)] text-[var(--muted)]">Select a changed file to inspect its diff.</div>
              ) : (
                <DiffBlock
                  state={diffByKey[workingDiffStateKey(selectedEntry.path, splitShownKind)]}
                  filePath={selectedEntry.path}
                  viewType={diffViewType}
                  expansionSourceId={workingTreeExpansionSourceId(selectedEntry, splitShownKind)}
                  loadExpansionSource={workingTreeExpansionSourceLoader(selectedEntry, splitShownKind)}
                  expansionRanges={expandedRangesByDiffKey[workingDiffStateKey(selectedEntry.path, splitShownKind)] ?? []}
                  onAddExpansionRange={(range) => addExpandedRangeForDiff(workingDiffStateKey(selectedEntry.path, splitShownKind), range)}
                />
              )
            ) : !selectedEntry ? (
              <div className="px-3 py-3 text-[var(--text-11)] text-[var(--muted)]">Select a changed file to inspect its diff.</div>
            ) : (
              <DiffBlock
                state={
                  dataMode === 'pull-request'
                    ? diffByKey[pullRequestDiffStateKey(selectedEntry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)]
                    : diffByKey[pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha)]
                }
                filePath={selectedEntry.path}
                viewType={diffViewType}
                expansionSourceId={pullExpansionSourceId(selectedEntry)}
                loadExpansionSource={pullExpansionSourceLoader(selectedEntry)}
                expansionRanges={
                  expandedRangesByDiffKey[
                    dataMode === 'pull-request'
                      ? pullRequestDiffStateKey(selectedEntry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
                      : pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha)
                  ] ?? []
                }
                onAddExpansionRange={(range) =>
                  addExpandedRangeForDiff(
                    dataMode === 'pull-request'
                      ? pullRequestDiffStateKey(selectedEntry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
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
            className={`group relative w-1.5 shrink-0 cursor-col-resize touch-none ${
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
            className={`shrink-0 overflow-hidden flex flex-col ${
              explorerResizing ? '' : 'transition-[width] duration-150 ease-out'
            }`}
            style={{
              width: `${explorerWidthPx}px`,
              minWidth: `${explorerWidthPx}px`,
              maxWidth: `${explorerWidthPx}px`,
            }}
          >
            <div className="shrink-0 h-8 px-2 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/80 flex items-center justify-between gap-1">
              <span className="dh-changes-toolbar-label">
                Files
              </span>
              <div className="dh-changes-segment" aria-label="Explorer zoom">
                <button
                  type="button"
                  onClick={decreaseExplorerZoom}
                  disabled={explorerZoom <= EXPLORER_ZOOM_MIN}
                  className="dh-changes-segment-button w-5 px-0 text-[var(--text-10)]"
                  title="Decrease explorer zoom"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={resetExplorerZoom}
                  className="dh-changes-segment-button min-w-9 px-1 font-mono"
                  title="Reset explorer zoom"
                >
                  {explorerZoomPercent}%
                </button>
                <button
                  type="button"
                  onClick={increaseExplorerZoom}
                  disabled={explorerZoom >= EXPLORER_ZOOM_MAX}
                  className="dh-changes-segment-button w-5 px-0 text-[var(--text-10)]"
                  title="Increase explorer zoom"
                >
                  +
                </button>
              </div>
            </div>
            <div role="tree" className="flex-1 min-h-0 overflow-auto py-1">
              {workingTreeActionError ? (
                <div className="mx-2 mb-1 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-2 py-1.5 text-[var(--text-10)] text-[var(--red)]">
                  {workingTreeActionError}
                </div>
              ) : null}
              {dataMode === 'working-tree' ? (
                <>
                  {stagedEntries.length > 0 ? (
                    <section>
                      <button
                        type="button"
                        onClick={() => setStagedSectionOpen((open) => !open)}
                        aria-expanded={stagedSectionOpen}
                        className="flex h-7 w-full items-center gap-1 px-2 text-left text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                      >
                        <IconChevron down={stagedSectionOpen} size={11} />
                        <span className="min-w-0 flex-1 truncate">Staged Changes</span>
                        <span className="font-mono text-[var(--text-10)] tabular-nums text-[var(--muted)]">
                          {stagedEntries.length}
                        </span>
                      </button>
                      {stagedSectionOpen ? (
                        <div className="px-1.5">{renderExplorer(stagedExplorerTree, 0, 'staged')}</div>
                      ) : null}
                    </section>
                  ) : null}
                  {unstagedEntries.length > 0 ? (
                    <section>
                      <button
                        type="button"
                        onClick={() => setUnstagedSectionOpen((open) => !open)}
                        aria-expanded={unstagedSectionOpen}
                        className="flex h-7 w-full items-center gap-1 px-2 text-left text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                      >
                        <IconChevron down={unstagedSectionOpen} size={11} />
                        <span className="min-w-0 flex-1 truncate">Changes</span>
                        <span className="font-mono text-[var(--text-10)] tabular-nums text-[var(--muted)]">
                          {unstagedEntries.length}
                        </span>
                      </button>
                      {unstagedSectionOpen ? (
                        <div className="px-1.5">{renderExplorer(unstagedExplorerTree, 0, 'unstaged')}</div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : (
                <div className="px-1.5">{renderExplorer(explorerTree, 0)}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
