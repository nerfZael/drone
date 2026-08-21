import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';
import {
  pullRequestCloseConfirmation,
  pullRequestMergeConfirmation,
} from '@drone/assistant-chat';
import { requestJson } from '../http';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import {
  UiActionMenu,
  UiCenteredLoadingState,
  UiPaneState,
  UiPanel,
  UiPanelStatusStrip,
  UiPanelToolbar,
  UiResizeHandle,
  UiTabs,
  UiToolbarButton,
  UiToolbarIconButton,
  UiToolbarSegmentedControl,
} from '../../ui/components';
import { IconChevron } from '../icons';
import { IconEye, IconEyeOff } from '../app/icons';
import { WorkspaceExplorerHeader } from '../app/WorkspaceExplorerHeader';
import {
  clampWorkspaceExplorerZoom as clampExplorerZoom,
  readWorkspaceExplorerWidth,
  readWorkspaceExplorerZoom,
  subscribeWorkspaceExplorerZoom,
  WORKSPACE_EXPLORER_WIDTH_DEFAULT_PX as EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX,
  WORKSPACE_EXPLORER_WIDTH_MAX_PX as EXPLORER_SIDEBAR_MAX_WIDTH_PX,
  WORKSPACE_EXPLORER_WIDTH_MIN_PX as EXPLORER_SIDEBAR_MIN_WIDTH_PX,
  WORKSPACE_EXPLORER_ZOOM_DEFAULT as EXPLORER_ZOOM_DEFAULT,
  WORKSPACE_EXPLORER_ZOOM_STEP as EXPLORER_ZOOM_STEP,
  writeWorkspaceExplorerWidth,
  writeWorkspaceExplorerZoom,
} from '../app/workspace-explorer-preferences';
import { FileTypeIcon } from '../files/FileTypeIcon';
import { provisioningLabel, usePaneReadiness } from '../panes/usePaneReadiness';
import { readPullRequestMergeMethod } from '../pullRequests/pull-request-preferences';
import { RequestOverview } from '../requests/RequestOverview';
import type {
  RepoChangeEntry,
  RepoCommitDiffPayload,
  RepoDiffPayload,
  RepoPullDiffPayload,
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
import { diffZoomStyle } from './diff-zoom-style';
import { useEditorZoomLevel } from '../files/editor-zoom';
import { CommitInspectionView } from './CommitInspectionView';
import { ChangesFileCountPill, ChangesLineSummary } from './ChangesLineSummary';
import type { DiffExpansionRange, DiffState, DiffViewType } from './types';
import {
  CHANGES_BRANCH_MODE_STORAGE_KEY,
  CHANGES_COMMIT_LIST_WIDTH_STORAGE_KEY,
  CHANGES_CONTEXT_STORAGE_KEY,
  CHANGES_DIFF_VIEW_STORAGE_KEY,
  CHANGES_HIDE_VIEWED_STORAGE_KEY,
  CHANGES_PRIMARY_VIEW_STORAGE_KEY,
  CHANGES_VIEW_STORAGE_KEY,
  readChangesStorage,
  writeChangesStorage,
} from './storage';
import {
  badgeTone,
  appendDiffExpansionRange,
  buildExplorerTree,
  defaultKindForEntry,
  entryPathExistsInCurrentTree,
  explorerNodeEntries,
  fileNameForChangesPath,
  diffKey,
  effectiveKindForEntry,
  hasStaged,
  hasUnstaged,
  parentDirPaths,
  pullRequestNoTextReason,
  pullRequestStateBadge,
  resolveExplorerSidebarWidthBounds,
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
import { changesQueryKeys, useChangesQueries } from './useChangesQueries';
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
type SuccessfulPullRequestChanges = Extract<RepoPullRequestChangesPayload, { ok: true }>;

export type DroneChangesReviewOverride = {
  kind: 'change-request';
  number: number;
  revisionKey: string;
  payload: SuccessfulPullRequestChanges | null;
  lineCounts?: {
    changed: number;
    additions: number;
    deletions: number;
    modified?: number;
  } | null;
  loading: boolean;
  error: string | null;
  renderHeader: (controls: React.ReactNode) => React.ReactNode;
  loadingLabel?: string;
  loadDiff: (path: string) => Promise<{ diff: string; truncated: boolean; isBinary?: boolean }>;
};
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
const EXPLORER_SIDEBAR_MAX_RATIO = 0.45;
const CHANGES_DIFF_MIN_WIDTH_PX = 420;
const EXPLORER_WIDTH_UPDATE_THRESHOLD_PX = 8;
const COMMIT_LIST_MIN_WIDTH_PX = 220;
const COMMIT_LIST_DEFAULT_WIDTH_PX = 300;
const COMMIT_LIST_MAX_WIDTH_PX = 460;
const COMMIT_LIST_MAX_RATIO = 0.42;
const COMMIT_DETAIL_MIN_WIDTH_PX = 420;

function PullRequestOverview({ payload }: { payload: SuccessfulPullRequestChanges }) {
  const pullRequest = payload.pullRequest;
  return (
    <RequestOverview
      id={`pull-request-${pullRequest.number}-overview-panel`}
      labelledBy={`pull-request-${pullRequest.number}-overview-tab`}
      description={String(pullRequest.body ?? '')}
      facts={[
        {
          label: 'Branches',
          value: `${pullRequest.headRefName} → ${pullRequest.baseRefName}`,
          mono: true,
        },
        {
          label: 'Author',
          value: pullRequest.authorLogin ? `@${pullRequest.authorLogin}` : 'Unknown',
        },
        {
          label: 'Repository',
          value: `${payload.github.owner}/${payload.github.repo}`,
          mono: true,
        },
        { label: 'Created', value: formatPullRequestDetailTime(pullRequest.createdAt) },
        { label: 'Updated', value: formatPullRequestDetailTime(pullRequest.updatedAt) },
        {
          label: 'Lines',
          value: `+${payload.counts.additions} −${payload.counts.deletions}`,
          mono: true,
        },
      ]}
    />
  );
}

function formatPullRequestDetailTime(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '—';
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return normalized;
  return new Date(timestamp).toLocaleString();
}

function changesSegmentButtonClass(active: boolean): string {
  return `dh-changes-segment-button ${active ? 'is-active' : ''}`;
}

function ReviewBackIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m9.5 3-5 5 5 5M5 8h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M6 4H3.5A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h7a1.5 1.5 0 0 0 1.5-1.5V10M9 2h5v5M14 2 7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  return (
    <UiActionMenu
      label="Changes view options"
      size="xsmall"
      triggerContent={
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          View
          <IconChevron down size={13} />
        </span>
      }
      entries={[
        { kind: 'label', id: 'layout-label', label: 'Layout' },
        {
          id: 'layout-stacked',
          label: 'Stacked',
          selectionRole: 'radio',
          checked: viewMode === 'stacked',
        },
        {
          id: 'layout-explorer',
          label: 'Explorer',
          selectionRole: 'radio',
          checked: viewMode === 'split',
        },
        { kind: 'separator', id: 'diff-separator' },
        { kind: 'label', id: 'diff-label', label: 'Diff' },
        {
          id: 'diff-unified',
          label: 'Unified',
          selectionRole: 'radio',
          checked: diffViewType === 'unified',
        },
        {
          id: 'diff-split',
          label: 'Side by side',
          selectionRole: 'radio',
          checked: diffViewType === 'split',
        },
        ...(showViewedControl
          ? [
              { kind: 'separator' as const, id: 'viewed-separator' },
              {
                id: 'toggle-viewed',
                label: hideViewedLabel,
                selectionRole: 'checkbox' as const,
                checked: hideViewed,
              },
            ]
          : []),
      ]}
      onSelect={(id) => {
        if (id === 'layout-stacked') onViewModeChange('stacked');
        else if (id === 'layout-explorer') onViewModeChange('split');
        else if (id === 'diff-unified') onDiffViewTypeChange('unified');
        else if (id === 'diff-split') onDiffViewTypeChange('split');
        else if (id === 'toggle-viewed') onToggleHideViewed();
      }}
    />
  );
}

const changesWorkspaceUiByDrone = new Map<string, ChangesWorkspaceUiSnapshot>();

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (droneId) changesWorkspaceUiByDrone.delete(droneId);
  });
}
function changesCacheKey(...parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => String(part ?? '').trim()).join('\u0000');
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  reviewOverride?: DroneChangesReviewOverride | null;
  onReviewBack?: (() => void) | null;
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
  reviewOverride = null,
  onReviewBack = null,
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
  const startup = usePaneReadiness({
    hubPhase,
    resetKey: `${droneId}\u0000changes`,
    timeoutMs: 18_000,
  });

  const initialRequestedPullNumberRef = React.useRef<number | null>(requestedPullRequestForDrone(droneId));
  const [pullRequestNumber, setPullRequestNumber] = React.useState<number | null>(
    () => reviewOverride?.number ?? initialRequestedPullNumberRef.current ?? workspaceSnapshot?.pullRequestNumber ?? selectedPullRequestForDrone(droneId),
  );
  const [pullRequestActionBusy, setPullRequestActionBusy] = React.useState<'merge' | 'close' | null>(null);
  const [pullRequestActionError, setPullRequestActionError] = React.useState<string | null>(null);
  const [pullRequestActionNotice, setPullRequestActionNotice] = React.useState<string | null>(null);
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
  const [pullRequestDetailTab, setPullRequestDetailTab] = React.useState<'overview' | 'files'>(
    () => fixedContextMode === 'pull-request' && !reviewOverride ? 'overview' : 'files',
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
  const [selectedExplorerDirectoryKey, setSelectedExplorerDirectoryKey] = React.useState<string | null>(null);
  const [selectedCommitSha, setSelectedCommitSha] = React.useState<string | null>(workspaceSnapshot?.selectedCommitSha ?? null);
  const [commitFileSelectedPath, setCommitFileSelectedPath] = React.useState<string | null>(workspaceSnapshot?.commitFileSelectedPath ?? null);
  const [selectedCommitDirectoryPath, setSelectedCommitDirectoryPath] = React.useState<string | null>(null);
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
  const [explorerManualWidthPx, setExplorerManualWidthPx] = React.useState<number>(readWorkspaceExplorerWidth);
  const [explorerZoom, setExplorerZoom] = React.useState<number>(readWorkspaceExplorerZoom);
  React.useEffect(
    () => subscribeWorkspaceExplorerZoom(() => setExplorerZoom(readWorkspaceExplorerZoom())),
    [],
  );
  const editorZoomLevel = useEditorZoomLevel();
  const [explorerWidthPx, setExplorerWidthPx] = React.useState(EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX);
  const [explorerResizing, setExplorerResizing] = React.useState(false);
  const [splitLayoutWidthPx, setSplitLayoutWidthPx] = React.useState(0);
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
  const explorerRowHeightPx = Math.round(24 * explorerZoom);
  const explorerIconSizePx = Math.round(13 * explorerZoom * 10) / 10;
  const explorerLeadingSlotPx = Math.round(14 * explorerZoom * 10) / 10;
  const explorerTextSizePx = Math.round(12 * explorerZoom * 10) / 10;
  const explorerMetaTextSizePx = Math.round(9.5 * explorerZoom * 10) / 10;
  const explorerIndentBasePx = Math.round(5 * explorerZoom * 10) / 10;
  const explorerIndentStepPx = Math.round(10 * explorerZoom * 10) / 10;
  const explorerBadgeHeightPx = Math.round(15 * explorerZoom * 10) / 10;

  const queryClient = useQueryClient();
  const {
    changes,
    changesLoading,
    changesError,
    pullChanges,
    pullLoading,
    pullError,
    pullRequestChanges,
    pullRequestLoading,
    pullRequestError,
    branchCommitList,
    branchCommitListLoading,
    branchCommitListError,
    pullRequestCommitList,
    pullRequestCommitListLoading,
    pullRequestCommitListError,
    branchCommitDetails,
    branchCommitDetailsLoading,
    branchCommitDetailsError,
    pullRequestCommitDetails,
    pullRequestCommitDetailsLoading,
    pullRequestCommitDetailsError,
  } = useChangesQueries({
    droneId,
    repoPath,
    repoAttached,
    disabled,
    dataMode,
    contextMode,
    primaryView,
    pullRequestNumber,
    selectedCommitSha,
    externalPullRequestData: Boolean(reviewOverride),
  });

  React.useEffect(() => {
    if (!reviewOverride) return;
    setPullRequestNumber(reviewOverride.number);
    setPrimaryView('changes');
  }, [reviewOverride?.number]);

  React.useEffect(() => {
    if (reviewOverride || fixedContextMode !== 'pull-request' || !pullRequestNumber) return;
    setPullRequestDetailTab('overview');
    setPrimaryView('changes');
  }, [fixedContextMode, pullRequestNumber, reviewOverride]);

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
    writeWorkspaceExplorerWidth(explorerManualWidthPx);
  }, [explorerManualWidthPx]);
  React.useEffect(() => {
    writeWorkspaceExplorerZoom(explorerZoom);
  }, [explorerZoom]);
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
    if (reviewOverride) return;
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
  }, [droneId, fixedContextMode, reviewOverride]);

  React.useEffect(() => {
    if (fixedContextMode) return;
    if (contextMode !== 'pull-request') return;
    if (pullRequestNumber && pullRequestNumber > 0) return;
    setContextModeState('branch');
  }, [contextMode, fixedContextMode, pullRequestNumber]);

  React.useEffect(() => {
    setSelectedPath(null);
    setSelectedExplorerDirectoryKey(null);
    setSelectedCommitSha(null);
    setCommitFileSelectedPath(null);
    setSelectedCommitDirectoryPath(null);
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
    if (primaryView === 'changes' && dataMode === 'working-tree' && changes) startup.markReady();
  }, [changes, dataMode, primaryView, startup.markReady]);

  React.useEffect(() => {
    if (refreshNonce <= 0) return;
    void queryClient.invalidateQueries({ queryKey: changesQueryKeys.drone(droneId), refetchType: 'active' });
  }, [droneId, queryClient, refreshNonce]);
  const activePullRequestChanges = reviewOverride
    ? reviewOverride.payload
    : contextMode === 'pull-request' &&
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
  const listLoading = reviewOverride
    ? reviewOverride.loading
    : dataMode === 'working-tree'
      ? changesLoading
      : dataMode === 'pull-request'
        ? pullRequestLoading
        : pullLoading;
  const listError = reviewOverride
    ? reviewOverride.error
    : dataMode === 'working-tree'
      ? changesError
      : dataMode === 'pull-request'
        ? pullRequestError
        : pullError;
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
  const commitListError = contextMode === 'pull-request' ? pullRequestCommitListError : branchCommitListError;
  const storedActiveCommitDetails = contextMode === 'pull-request' ? pullRequestCommitDetails : branchCommitDetails;
  const activeCommitDetails =
    storedActiveCommitDetails && storedActiveCommitDetails.commit.sha === selectedCommitSha ? storedActiveCommitDetails : null;
  const activeCommitDetailsLoadingRaw = contextMode === 'pull-request' ? pullRequestCommitDetailsLoading : branchCommitDetailsLoading;
  const activeCommitDetailsError = selectedCommitSha
    ? contextMode === 'pull-request'
      ? pullRequestCommitDetailsError
      : branchCommitDetailsError
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
        return listLoading ? prev : null;
      }
      if (prev && entries.some((e) => e.path === prev)) return prev;
      return entries[0].path;
    });
  }, [entriesSignature, listLoading]);

  React.useEffect(() => {
    if (primaryView !== 'commits') return;
    setSelectedCommitSha((prev) => {
      if (commitList.length === 0) {
        return commitListLoading ? prev : null;
      }
      if (prev && commitList.some((entry) => entry.sha === prev)) return prev;
      return null;
    });
  }, [commitList, commitListLoading, primaryView]);

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
    const splitWidth = splitLayoutRef.current?.clientWidth ?? 0;
    if (splitWidth <= 0) return;
    setSplitLayoutWidthPx((current) =>
      current === splitWidth ? current : splitWidth,
    );
    if (explorerDragRef.current || explorerResizing) return;
    const bounds = resolveExplorerSidebarWidthBounds(splitWidth, explorerWidthOptions);
    const nextWidth = clampNumber(explorerManualWidthPx, bounds.minWidthPx, bounds.maxWidthPx);
    setExplorerWidthPx((prev) => {
      const outOfBounds = prev < bounds.minWidthPx || prev > bounds.maxWidthPx;
      if (outOfBounds || Math.abs(prev - nextWidth) >= EXPLORER_WIDTH_UPDATE_THRESHOLD_PX) return nextWidth;
      return prev;
    });
  }, [
    explorerManualWidthPx,
    explorerResizing,
    explorerWidthOptions,
    viewMode,
  ]);

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
    setExplorerManualWidthPx(EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX);
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
  const reviewDiffStateKey = React.useCallback(
    (path: string, prNumber: number | null | undefined) =>
      reviewOverride
        ? scopedChangesStateKey(
            droneId,
            `review\u0000${reviewOverride.kind}\u0000${reviewOverride.number}\u0000${reviewOverride.revisionKey}\u0000${path}`,
          )
        : pullRequestDiffStateKey(path, prNumber),
    [droneId, pullRequestDiffStateKey, reviewOverride?.kind, reviewOverride?.number, reviewOverride?.revisionKey],
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
      keys.add(reviewDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber));
    }
    return keys;
  }, [
    dataMode,
    entries,
    pullChanges?.baseSha,
    pullChanges?.headSha,
    activePullRequestChanges?.pullRequest.number,
    reviewDiffStateKey,
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

  const loadExternalReviewDiff = React.useCallback(
    async (path: string, force = false) => {
      if (!reviewOverride) return;
      const key = reviewDiffStateKey(path, reviewOverride.number);
      if (inflightRef.current.has(key)) return;
      const current = diffByKeyRef.current[key];
      if (current?.status === 'loading') return;
      if (!force && current?.status === 'loaded') return;

      inflightRef.current.add(key);
      if (!(force && current?.status === 'loaded')) {
        setDiffByKey((previous) => ({ ...previous, [key]: { status: 'loading' } }));
      }
      try {
        const result = await reviewOverride.loadDiff(path);
        if (!mountedRef.current) return;
        const text = typeof result.diff === 'string' ? result.diff : '';
        setDiffByKey((previous) => ({
          ...previous,
          [key]: {
            status: 'loaded',
            text,
            truncated: Boolean(result.truncated),
            fromUntracked: false,
            isBinary: Boolean(result.isBinary),
            noTextReason: result.isBinary ? 'binary' : text ? null : 'empty',
            contextLines: 5,
          },
        }));
      } catch (error: any) {
        if (!mountedRef.current) return;
        setDiffByKey((previous) => ({
          ...previous,
          [key]: { status: 'error', error: error?.message ?? String(error) },
        }));
      } finally {
        inflightRef.current.delete(key);
      }
    },
    [reviewDiffStateKey, reviewOverride],
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
      const key = reviewDiffStateKey(entry.path, prNumber);
      clearDiffExpansionSource(key);
      clearExpandedRangesForDiff(key);
    }
    setDiffByKey((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const entry of list) {
        if (reviewOverride && typeof entry.patch !== 'string') continue;
        const key = reviewDiffStateKey(entry.path, prNumber);
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
    reviewDiffStateKey,
    reviewOverride,
  ]);

  React.useEffect(() => {
    if (!reviewOverride || dataMode !== 'pull-request' || !selectedEntry) return;
    void loadExternalReviewDiff(selectedEntry.path);
  }, [dataMode, loadExternalReviewDiff, reviewOverride, selectedEntry]);

  React.useEffect(() => {
    if (!reviewOverride || dataMode !== 'pull-request' || viewMode !== 'stacked') return;
    for (const entry of entries) {
      if (expandedPullFiles[entry.path] !== true) continue;
      void loadExternalReviewDiff(entry.path);
    }
  }, [dataMode, entries, expandedPullFiles, loadExternalReviewDiff, reviewOverride, viewMode]);

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
    contextMode === 'pull-request' && Boolean(selectedPullRequestNumber) && !hasLoadedActivePullRequest && !listError;
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
        queryClient.setQueryData<Extract<RepoPullRequestChangesPayload, { ok: true }>>(
          changesQueryKeys.pullRequest(droneId, repoPath, activePullRequestNumber),
          (prev) =>
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
  }, [activePullRequestChanges?.pullRequest.baseRefName, activePullRequestIsFinalState, activePullRequestNumber, confirm, droneId, pullRequestActionBusy, queryClient, repoPath]);

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
      queryClient.setQueryData<Extract<RepoPullRequestChangesPayload, { ok: true }>>(
        changesQueryKeys.pullRequest(droneId, repoPath, activePullRequestNumber),
        (prev) =>
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
  }, [activePullRequestIsFinalState, activePullRequestNumber, confirm, droneId, pullRequestActionBusy, queryClient, repoPath]);

  const openEntryInEditor = React.useCallback(
    (entry: RepoChangeEntry | null) => {
      if (!entry || !entryPathExistsInCurrentTree(entry, dataMode)) return;
      onOpenFileInEditor(entry.path);
    },
    [dataMode, onOpenFileInEditor],
  );

  const runWorkingTreeAction = React.useCallback(
    async (
      target: {
        path: string;
        paths: string[];
        affectedPaths: string[];
        isDirectory: boolean;
        isUntracked: boolean;
      },
      action: 'stage' | 'unstage' | 'discard',
    ) => {
      if (dataMode !== 'working-tree' || workingTreeActionBusy) return;
      if (
        action === 'discard' &&
        !(await confirm({
          title: target.isDirectory ? 'Discard folder changes?' : 'Discard file changes?',
          message: target.isDirectory
            ? `All unstaged changes in ${target.path}, including untracked files, will be permanently discarded.`
            : target.isUntracked
              ? `${target.path} is untracked and will be deleted. This cannot be undone.`
              : `All unstaged changes in ${target.path} will be permanently discarded.`,
          confirmLabel: 'Discard Changes',
          destructive: true,
        }))
      ) {
        return;
      }

      const busyKey = `${action}:${target.path}`;
      setWorkingTreeActionBusy(busyKey);
      setWorkingTreeActionError(null);
      try {
        await requestJson(`/api/drones/${encodeURIComponent(droneId)}/repo/changes/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: target.path, paths: target.paths, action }),
        });
        const affectedStateKeySet = new Set(
          target.affectedPaths.flatMap((affectedPath) => [
            workingDiffStateKey(affectedPath, 'staged'),
            workingDiffStateKey(affectedPath, 'unstaged'),
          ]),
        );
        setDiffByKey((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([key]) => !affectedStateKeySet.has(key)),
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
          ? reviewDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
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
      reviewDiffStateKey,
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
        ? reviewDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
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
      reviewDiffStateKey,
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
          setSelectedCommitDirectoryPath(null);
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
          setSelectedCommitDirectoryPath(null);
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
    const workingTreeTarget = {
      path: entry.path,
      paths: [entry.path, entry.originalPath].filter((path): path is string => Boolean(path)),
      affectedPaths: [entry.path],
      isDirectory: false,
      isUntracked: entry.isUntracked,
    };
    const buttonClassName = `!h-5 !min-w-5 !w-5 !rounded-[3px] ${
      alwaysVisible
        ? ''
        : 'opacity-0 pointer-events-none group-hover/file:opacity-100 group-hover/file:pointer-events-auto'
    }`;
    return (
      <div className="shrink-0 inline-flex items-center gap-0.5">
        {showViewedAction && canToggleViewed ? (
          <UiToolbarIconButton
            size="xsmall"
            label={viewedState === 'viewed' ? 'Mark file unviewed' : 'Mark file viewed'}
            icon={viewedState === 'viewed' ? <IconEyeOff className="w-3 h-3" /> : <IconEye className="w-3 h-3" />}
            onClick={() => setEntryViewedState(entry, viewedState !== 'viewed')}
            className={buttonClassName}
            active={viewedState === 'viewed' || viewedState === 'stale'}
            tone={viewedState === 'stale' ? 'warning' : 'accent'}
            title={
              viewedState === 'viewed'
                ? 'Mark file unviewed'
                : viewedState === 'stale'
                  ? 'File changed since it was viewed. Mark viewed again.'
                  : 'Mark file viewed'
            }
          />
        ) : null}
        <UiToolbarIconButton
          size="xsmall"
          label="Open file in editor"
          icon={<OpenFileIcon />}
          onClick={() => openEntryInEditor(entry)}
          disabled={!canOpenInEditor}
          className={buttonClassName}
          title={canOpenInEditor ? 'Open in editor' : 'This path no longer exists in the current tree.'}
        />
        {dataMode === 'working-tree' && workingKind === 'unstaged' ? (
          <>
            <UiToolbarIconButton
              size="xsmall"
              tone="danger"
              label="Discard unstaged changes"
              icon={<DiscardChangesIcon />}
              onClick={() => {
                void runWorkingTreeAction(workingTreeTarget, 'discard');
              }}
              disabled={Boolean(workingTreeActionBusy)}
              className={buttonClassName}
              title="Discard unstaged changes"
            />
            <UiToolbarIconButton
              size="xsmall"
              tone="success"
              label="Stage changes"
              icon={<StageIcon />}
              onClick={() => {
                void runWorkingTreeAction(workingTreeTarget, 'stage');
              }}
              disabled={Boolean(workingTreeActionBusy)}
              className={buttonClassName}
              title="Stage changes"
            />
          </>
        ) : null}
        {dataMode === 'working-tree' && workingKind === 'staged' ? (
          <UiToolbarIconButton
            size="xsmall"
            tone="warning"
            label="Unstage changes"
            icon={<StageIcon unstage />}
            onClick={() => {
              void runWorkingTreeAction(workingTreeTarget, 'unstage');
            }}
            disabled={Boolean(workingTreeActionBusy)}
            className={buttonClassName}
            title="Unstage changes"
          />
        ) : null}
      </div>
    );
  }

  function renderDirectoryQuickActions(node: ExplorerNode, workingKind?: DiffKind): React.ReactNode {
    if (dataMode !== 'working-tree' || !workingKind) return null;
    const actionButtonClassName = '!h-5 !min-w-5 !w-5 !rounded-[3px]';
    const directoryEntries = explorerNodeEntries(node);
    const target = {
      path: node.path,
      paths: Array.from(
        new Set(
          directoryEntries.flatMap((entry) =>
            [entry.path, entry.originalPath].filter((path): path is string => Boolean(path)),
          ),
        ),
      ),
      affectedPaths: directoryEntries.map((entry) => entry.path),
      isDirectory: true,
      isUntracked: directoryEntries.every((entry) => entry.isUntracked),
    };

    return (
      <div className="shrink-0 inline-flex items-center gap-0.5">
        {workingKind === 'unstaged' ? (
          <>
            <UiToolbarIconButton
              size="xsmall"
              tone="danger"
              label={`Discard changes in ${node.path}`}
              icon={<DiscardChangesIcon />}
              onClick={() => {
                void runWorkingTreeAction(target, 'discard');
              }}
              disabled={Boolean(workingTreeActionBusy)}
              className={actionButtonClassName}
              title="Discard folder changes"
            />
            <UiToolbarIconButton
              size="xsmall"
              tone="success"
              label={`Stage changes in ${node.path}`}
              icon={<StageIcon />}
              onClick={() => {
                void runWorkingTreeAction(target, 'stage');
              }}
              disabled={Boolean(workingTreeActionBusy)}
              className={actionButtonClassName}
              title="Stage folder changes"
            />
          </>
        ) : (
          <UiToolbarIconButton
            size="xsmall"
            tone="warning"
            label={`Unstage changes in ${node.path}`}
            icon={<StageIcon unstage />}
            onClick={() => {
              void runWorkingTreeAction(target, 'unstage');
            }}
            disabled={Boolean(workingTreeActionBusy)}
            className={actionButtonClassName}
            title="Unstage folder changes"
          />
        )}
      </div>
    );
  }

  function renderExplorer(nodes: ExplorerNode[], depth: number, workingKind?: DiffKind): React.ReactNode {
    return nodes.map((node) => {
      const indentPx = explorerIndentBasePx + depth * explorerIndentStepPx;
      if (node.kind === 'dir') {
        const open = expandedDirs[node.path] !== false;
        const directoryKey = `${workingKind ?? dataMode}\u0000${node.path}`;
        const selected = selectedExplorerDirectoryKey === directoryKey;
        const hasSelectedDirectChild = Boolean(
          node.children?.some((child) => {
            if (child.kind === 'dir') {
              return selectedExplorerDirectoryKey === `${workingKind ?? dataMode}\u0000${child.path}`;
            }
            return (
              selectedExplorerDirectoryKey === null &&
              child.entry?.path === selectedPath &&
              (!workingKind || splitShownKind === workingKind)
            );
          }),
        );
        const reviewSummary = workingKind ? undefined : explorerReviewSummaryByPath[node.path];
        const dirAllViewed = Boolean(
          reviewSummary && reviewSummary.viewed > 0 && reviewSummary.unviewed === 0 && reviewSummary.stale === 0,
        );
        const dirHasChanged = Boolean(reviewSummary && reviewSummary.stale > 0);
        const dirHasViewed = Boolean(reviewSummary && reviewSummary.viewed > 0);
        return (
          <div
            key={`dir:${node.path}`}
            data-changes-explorer-directory={node.path}
            className="flex w-full flex-col"
          >
            <div
              className={`dh-changes-explorer-row group/directory flex w-full min-w-0 items-center pr-1 transition-colors ${
                selected
                  ? 'is-selected'
                  : dirAllViewed
                    ? 'opacity-65'
                    : dirHasChanged
                      ? 'bg-[var(--yellow-subtle)]'
                      : ''
              }`}
              style={{ height: `${explorerRowHeightPx}px`, minHeight: `${explorerRowHeightPx}px` }}
            >
              <button
                type="button"
                role="treeitem"
                onClick={() => {
                  setSelectedExplorerDirectoryKey(directoryKey);
                  setExpandedDirs((prev) => ({ ...prev, [node.path]: !open }));
                }}
                aria-expanded={open}
                aria-selected={selected}
                className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden text-left font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                style={{
                  paddingLeft: `${indentPx}px`,
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
                  aria-hidden="true"
                  className="pointer-events-none inline-flex shrink-0 items-center justify-center text-[var(--muted-dim)]"
                  style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
                >
                  <IconChevron down={open} size={explorerIconSizePx} />
                </span>
                <span
                  className={`min-w-0 truncate flex-1 ${selected ? 'text-[var(--fg)]' : dirAllViewed ? 'text-[var(--muted)]' : 'text-[var(--fg-secondary)]'}`}
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
              {workingKind ? (
                <div className="pointer-events-none shrink-0 opacity-0 transition-opacity group-hover/directory:pointer-events-auto group-hover/directory:opacity-100 group-focus-within/directory:pointer-events-auto group-focus-within/directory:opacity-100">
                  {renderDirectoryQuickActions(node, workingKind)}
                </div>
              ) : null}
            </div>
            {open && node.children && node.children.length > 0 ? (
              <div
                role="group"
                className="dh-changes-explorer-directory-body relative flex w-full flex-col"
                data-changes-explorer-guide-selected={hasSelectedDirectChild ? 'true' : undefined}
              >
                <span
                  aria-hidden="true"
                  className="dh-changes-explorer-guide pointer-events-none absolute inset-y-0 w-px"
                  style={{ left: `${indentPx + Math.floor(explorerLeadingSlotPx / 2) - 1}px` }}
                />
                {renderExplorer(node.children, depth + 1, workingKind)}
              </div>
            ) : null}
          </div>
        );
      }

      const entry = node.entry ?? null;
      if (!entry) return null;
      const active =
        selectedExplorerDirectoryKey === null &&
        entry.path === selectedPath &&
        (!workingKind || splitShownKind === workingKind);
      const viewedState = entryViewedStatus(entry);
      return (
        <div key={`file:${entry.path}`} className="w-full group/file">
          <div
            className={`dh-changes-explorer-row flex w-full min-w-0 items-center pr-1 transition-colors ${
              active
                ? 'is-selected'
                : viewedState === 'viewed'
                  ? 'opacity-60'
                  : viewedState === 'stale'
                    ? 'bg-[var(--yellow-subtle)]'
                    : ''
            }`}
            style={{ height: `${explorerRowHeightPx}px`, minHeight: `${explorerRowHeightPx}px` }}
          >
            <button
              type="button"
              role="treeitem"
              onClick={() => {
                setSelectedExplorerDirectoryKey(null);
                setSelectedPath(entry.path);
                if (dataMode === 'working-tree') setSplitKind(workingKind ?? defaultKindForEntry(entry));
              }}
              aria-selected={active}
              className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden text-left font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
              style={{ paddingLeft: `${indentPx}px` }}
              title={
                viewedState === 'viewed'
                  ? `${entry.path} • viewed`
                  : viewedState === 'stale'
                    ? `${entry.path} • changed since viewed`
                    : entry.path
              }
            >
              <span
                className={`inline-flex items-center justify-center flex-shrink-0 ${
                  active ? 'text-[var(--fg)]' : 'text-[var(--muted)]'
                }`}
                style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
              >
                <FileTypeIcon path={entry.path} size={explorerIconSizePx} />
              </span>
              <span
                className={`min-w-0 truncate flex-1 ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}
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
            <div className="pointer-events-none shrink-0 opacity-0 transition-opacity group-hover/file:pointer-events-auto group-hover/file:opacity-100 group-focus-within/file:pointer-events-auto group-focus-within/file:opacity-100">
              {renderFileQuickActions(entry, true, false, workingKind)}
            </div>
            <span
              className={`w-3 shrink-0 text-center font-mono font-[var(--weight-bold)] ${changesEntryStatusTextClass(entry, workingKind)}`}
              style={{ fontSize: `${explorerMetaTextSizePx}px` }}
              title={statusBadgeTitle(entry, dataMode)}
            >
              {changesEntryStatusShortLabel(entry, workingKind)}
            </span>
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
        const selected = selectedCommitDirectoryPath === node.path;
        const hasSelectedDirectChild = Boolean(
          node.children?.some((child) =>
            child.kind === 'dir'
              ? selectedCommitDirectoryPath === child.path
              : selectedCommitDirectoryPath === null && child.entry?.path === commitFileSelectedPath,
          ),
        );
        return (
          <div
            key={`commit-dir:${node.path}`}
            data-changes-explorer-directory={node.path}
            className="flex w-full flex-col"
          >
            <div
              className={`dh-changes-explorer-row flex w-full min-w-0 items-center pr-1 ${selected ? 'is-selected' : ''}`}
              style={{ height: `${explorerRowHeightPx}px`, minHeight: `${explorerRowHeightPx}px` }}
            >
              <button
                type="button"
                role="treeitem"
                onClick={() => {
                  setSelectedCommitDirectoryPath(node.path);
                  setExpandedCommitDirs((prev) => ({ ...prev, [node.path]: !open }));
                }}
                aria-expanded={open}
                aria-selected={selected}
                className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden text-left font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                style={{ paddingLeft: `${indentPx}px` }}
                title={node.path}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none inline-flex shrink-0 items-center justify-center text-[var(--muted-dim)]"
                  style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
                >
                  <IconChevron down={open} size={explorerIconSizePx} />
                </span>
                <span className={`${selected ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]'} min-w-0 truncate flex-1`} style={{ fontSize: `${explorerTextSizePx}px` }}>
                  {node.name}
                </span>
                <span className="text-[var(--muted-dim)] tabular-nums" style={{ fontSize: `${explorerMetaTextSizePx}px` }}>
                  {node.count}
                </span>
              </button>
            </div>
            {open && node.children && node.children.length > 0 ? (
              <div
                role="group"
                className="dh-changes-explorer-directory-body relative flex w-full flex-col"
                data-changes-explorer-guide-selected={hasSelectedDirectChild ? 'true' : undefined}
              >
                <span
                  aria-hidden="true"
                  className="dh-changes-explorer-guide pointer-events-none absolute inset-y-0 w-px"
                  style={{ left: `${indentPx + Math.floor(explorerLeadingSlotPx / 2) - 1}px` }}
                />
                {renderCommitExplorer(node.children, depth + 1)}
              </div>
            ) : null}
          </div>
        );
      }

      const entry = node.entry ?? null;
      if (!entry) return null;
      const active = selectedCommitDirectoryPath === null && entry.path === commitFileSelectedPath;
      return (
        <div key={`commit-file:${entry.path}`} className="w-full group/file">
          <div
            className={`dh-changes-explorer-row flex w-full min-w-0 items-center pr-1 ${active ? 'is-selected' : ''}`}
            style={{ height: `${explorerRowHeightPx}px`, minHeight: `${explorerRowHeightPx}px` }}
          >
            <button
              type="button"
              role="treeitem"
              onClick={() => {
                setSelectedCommitDirectoryPath(null);
                setCommitFileSelectedPath(entry.path);
              }}
              aria-selected={active}
              className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden text-left font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
              style={{ paddingLeft: `${indentPx}px` }}
              title={entry.path}
            >
              <span
                className={`inline-flex items-center justify-center flex-shrink-0 ${
                  active ? 'text-[var(--fg)]' : 'text-[var(--muted)]'
                }`}
                style={{ width: `${explorerLeadingSlotPx}px`, height: `${explorerLeadingSlotPx}px` }}
              >
                <FileTypeIcon path={entry.path} size={explorerIconSizePx} />
              </span>
              <span
                className={`min-w-0 truncate flex-1 ${active ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}
                style={{ fontSize: `${explorerTextSizePx}px` }}
              >
                {node.name}
              </span>
            </button>
            <div className="pointer-events-none shrink-0 opacity-0 transition-opacity group-hover/file:pointer-events-auto group-hover/file:opacity-100 group-focus-within/file:pointer-events-auto group-focus-within/file:opacity-100">
              {renderFileQuickActions(entry, true, false)}
            </div>
            <span
              className={`w-3 shrink-0 text-center font-mono font-[var(--weight-bold)] ${changesEntryStatusTextClass(entry)}`}
              style={{ fontSize: `${explorerMetaTextSizePx}px` }}
              title={statusBadgeTitle(entry, 'pull-preview')}
            >
              {changesEntryStatusShortLabel(entry)}
            </span>
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
  const activeLineChangeCounts =
    reviewOverride?.lineCounts ?? (dataMode === 'working-tree'
      ? changes?.id === droneId
        ? changes.counts
        : null
      : dataMode === 'pull-request'
        ? activePullRequestChanges
          ? {
              ...activePullRequestChanges.counts,
              modified: activePullRequestChanges.entries.reduce(
                (sum, entry) => sum + Math.min(entry.additions, entry.deletions),
                0,
              ),
            }
          : null
        : pullChanges?.id === droneId
          ? pullChanges.counts
          : null);
  const showingInitialLoad =
    repoAttached &&
    !disabled &&
    (primaryView === 'commits'
      ? !activeCommitList && !commitListError
      : !activeChangesPayload && !listError);
  const initialLoadingLabel =
    reviewOverride?.loadingLabel ?? (primaryView === 'commits'
      ? contextMode === 'pull-request'
        ? 'Loading pull request commits…'
        : 'Loading branch commits…'
      : dataMode === 'pull-request'
        ? 'Loading pull request…'
        : dataMode === 'pull-preview'
          ? 'Loading apply preview…'
          : 'Loading changes…');
  const allVisibleChangesViewed = allEntries.length > 0 && hideViewed;
  const emptyChangesTitle = allVisibleChangesViewed
    ? 'All visible files are viewed'
    : dataMode === 'pull-request'
      ? pullRequestNumber
        ? `No changes in ${reviewOverride ? 'change request' : 'PR'} #${pullRequestNumber}`
        : 'No pull request selected'
      : dataMode === 'pull-preview'
        ? 'No apply changes to preview'
        : 'Working tree is clean';
  const emptyChangesDescription = allVisibleChangesViewed
    ? 'Turn off Hide Viewed to revisit files in this view.'
    : dataMode === 'pull-preview'
      ? 'This view only shows committed changes from the drone base to HEAD. Open Working Tree to review uncommitted files.'
      : undefined;
  const emptyChangesAction = allVisibleChangesViewed ? (
    <UiToolbarButton tone="accent" onClick={() => setHideViewed(false)}>
      Show viewed files
    </UiToolbarButton>
  ) : dataMode === 'pull-preview' ? (
    <UiToolbarButton tone="accent" onClick={() => setBranchChangesMode('working-tree')}>
      Open working tree
    </UiToolbarButton>
  ) : undefined;
  const explorerResizeBounds = resolveExplorerSidebarWidthBounds(
    splitLayoutWidthPx,
    explorerWidthOptions,
  );
  const showsPullRequestDetailTabs =
    !reviewOverride && fixedContextMode === 'pull-request' && Boolean(pullRequestNumber);
  const showingPullRequestOverview =
    showsPullRequestDetailTabs && pullRequestDetailTab === 'overview';
  const reviewControls = reviewOverride ? (
    <>
      {activeLineChangeCounts && activeLineChangeCounts.changed > 0 ? (
        <ChangesLineSummary counts={activeLineChangeCounts} />
      ) : null}
      <ChangesViewMenu
        viewMode={viewMode}
        diffViewType={diffViewType}
        showViewedControl
        hideViewed={hideViewed}
        hideViewedLabel={hideViewedMenuLabel}
        onViewModeChange={setViewMode}
        onDiffViewTypeChange={setDiffViewType}
        onToggleHideViewed={() => setHideViewed((prev) => !prev)}
      />
    </>
  ) : null;

  if (showingInitialLoad) {
    return (
      <UiPanel
        ref={dockRootRef}
        data-editor-zoom-surface="changes"
        flush
        className="dh-utility-panel h-full w-full dh-changes-dock"
        surface="alternate"
        style={{ background: 'var(--chat-background)', ...diffZoomStyle(editorZoomLevel) }}
      >
        {reviewOverride ? reviewOverride.renderHeader(reviewControls) : onReviewBack ? (
          <div className="flex min-h-9 items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1">
            <UiToolbarIconButton
              size="xsmall"
              label="Back to pull requests"
              title="Back to pull requests"
              icon={<ReviewBackIcon />}
              onClick={onReviewBack}
            />
            <span className="truncate text-[var(--text-10)] text-[var(--muted)]">
              Loading pull request{pullRequestNumber ? ` #${pullRequestNumber}` : ''}…
            </span>
          </div>
        ) : null}
        <UiCenteredLoadingState message={initialLoadingLabel} />
      </UiPanel>
    );
  }

  return (
    <UiPanel
      ref={dockRootRef}
      data-editor-zoom-surface="changes"
      flush
      className="dh-utility-panel relative h-full w-full dh-changes-dock"
      surface="alternate"
      style={{ background: 'var(--chat-background)', ...diffZoomStyle(editorZoomLevel) }}
    >
      {!reviewOverride && !showingPullRequestOverview ? (
        <UiPanelToolbar
          aria-label="Changes controls"
          className="!min-h-8 !gap-1.5 !px-1.5 !py-0.5"
        >
        <div className="flex min-w-0 flex-nowrap items-center gap-1">
          {repoAttached && !disabled && contextMode === 'branch' && primaryView === 'changes' ? (
            <UiToolbarSegmentedControl
              label="Branch change source"
              value={branchChangesMode}
              onValueChange={setBranchChangesMode}
              size="xsmall"
              options={[
                { value: 'working-tree', label: 'Working' },
                { value: 'pull-preview', label: 'Apply' },
              ]}
            />
          ) : null}
        </div>
        <div
          data-onboarding-id="changes.viewMode"
          className="ml-auto flex shrink-0 items-center gap-1"
        >
          {repoAttached && !disabled ? (
            <>
              {!fixedContextMode ? (
                <UiToolbarSegmentedControl
                  label="Changes context"
                  value={contextMode}
                  onValueChange={setContextModeState}
                  size="xsmall"
                  options={[
                    { value: 'branch', label: 'Branch' },
                    {
                      value: 'pull-request',
                      label: 'PR',
                      disabled: !pullRequestNumber,
                    },
                  ]}
                />
              ) : null}
              {primaryView === 'changes' && activeLineChangeCounts && activeLineChangeCounts.changed > 0 ? (
                <ChangesLineSummary counts={activeLineChangeCounts} />
              ) : null}
              {!reviewOverride ? (
                <UiToolbarSegmentedControl
                  label="Changes view"
                  value={primaryView}
                  onValueChange={setPrimaryView}
                  size="xsmall"
                  options={[
                    { value: 'changes', label: 'Changes' },
                    { value: 'commits', label: 'Commits' },
                  ]}
                />
              ) : null}
            </>
          ) : null}
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
        </UiPanelToolbar>
      ) : null}

      {!reviewOverride && contextMode === 'pull-request' && awaitingPullRequestDetails ? (
        <UiPanelStatusStrip>
          Loading PR #{selectedPullRequestNumber} details...
        </UiPanelStatusStrip>
      ) : null}
      {reviewOverride ? reviewOverride.renderHeader(reviewControls) : null}
      {!reviewOverride && contextMode === 'pull-request' && hasLoadedActivePullRequest && activePullRequestNumber ? (
        <div className="flex min-h-10 items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1.5">
          {onReviewBack ? (
            <UiToolbarIconButton
              size="xsmall"
              label="Back to pull requests"
              title="Back to pull requests"
              icon={<ReviewBackIcon />}
              onClick={onReviewBack}
            />
          ) : null}
          <div
            className="flex min-w-0 flex-1 items-baseline gap-2"
            title={activePullRequestTitleRaw || undefined}
          >
            <span className="truncate text-[16px] font-[var(--weight-bold)] text-[var(--fg)]">
              {activePullRequestTitleRaw || 'Untitled pull request'}
            </span>
            <span className="shrink-0 font-mono text-[var(--text-10)] font-[var(--weight-normal)] text-[var(--muted-dim)]">
              #{activePullRequestNumber}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <UiToolbarButton
              size="xsmall"
              tone="success"
              onClick={() => {
                void mergeActivePullRequest();
              }}
              disabled={Boolean(pullRequestActionBusy) || Boolean(activePullRequestActionBlockedReason)}
              loading={pullRequestActionBusy === 'merge'}
              title={activePullRequestActionBlockedReason ?? 'Merge pull request'}
            >
              Merge
            </UiToolbarButton>
            <UiToolbarButton
              size="xsmall"
              tone="danger"
              onClick={() => {
                void closeActivePullRequest();
              }}
              disabled={Boolean(pullRequestActionBusy) || Boolean(activePullRequestActionBlockedReason)}
              loading={pullRequestActionBusy === 'close'}
              title={activePullRequestActionBlockedReason ?? 'Close pull request without merging'}
            >
              Close
            </UiToolbarButton>
            {activePullRequestStatus ? (
              <span
                className={`inline-flex h-5 items-center rounded-full px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] ${activePullRequestStatus.className}`}
                title={activePullRequestStatus.title}
              >
                {activePullRequestStatus.label}
              </span>
            ) : null}
            {activePullRequestHtmlUrl ? (
              <a
                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                href={activePullRequestHtmlUrl}
                target="_blank"
                rel="noreferrer"
                title="Open externally"
                aria-label="Open pull request externally"
              >
                <ExternalLinkIcon />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {showsPullRequestDetailTabs && hasLoadedActivePullRequest ? (
        <UiTabs
          label="Pull request sections"
          value={pullRequestDetailTab}
          onValueChange={(value) => {
            setPullRequestDetailTab(value);
            if (value === 'files') setPrimaryView('changes');
          }}
          size="small"
          className="shrink-0 px-2"
          options={[
            {
              value: 'overview',
              label: 'Overview',
              tabId: `pull-request-${activePullRequestNumber}-overview-tab`,
              panelId: `pull-request-${activePullRequestNumber}-overview-panel`,
            },
            {
              value: 'files',
              label: 'Files changed',
              badge: activePullRequestChanges?.counts.changed ?? 0,
              tabId: `pull-request-${activePullRequestNumber}-files-tab`,
              panelId: `pull-request-${activePullRequestNumber}-files-panel`,
            },
          ]}
        />
      ) : null}
      {!reviewOverride && contextMode === 'pull-request' && pullRequestActionNotice ? (
        <UiPanelStatusStrip tone="success">
          {pullRequestActionNotice}
        </UiPanelStatusStrip>
      ) : null}
      {!reviewOverride && contextMode === 'pull-request' && pullRequestActionError ? (
        <UiPanelStatusStrip tone="danger">
          {pullRequestActionError}
        </UiPanelStatusStrip>
      ) : null}

      {!repoAttached ? (
        <UiPaneState
          kind="unavailable"
          title="Repository unavailable"
          description={unavailableReason || 'Attach a repo to see source-control changes.'}
        />
      ) : disabled ? (
        <UiPaneState
          kind={startup.timedOut ? 'warning' : 'loading'}
          title={provisioningLabel(hubPhase)}
          description={
            <>
              {startup.timedOut
                ? 'Still waiting for the repository to become available.'
                : 'Waiting for repository…'}
            {String(hubMessage ?? '').trim() ? (
              <span className="mt-1 block">{String(hubMessage ?? '').trim()}</span>
            ) : null}
            {startup.timedOut ? (
              <span className="mt-2 block">
                If this persists, check the drone status/error details in the sidebar.
              </span>
            ) : null}
            </>
          }
        />
      ) : showingPullRequestOverview && activePullRequestChanges ? (
        <PullRequestOverview payload={activePullRequestChanges} />
      ) : primaryView === 'commits' ? (
        commitListError ? (
          <UiPaneState
            kind="error"
            title="Could not load commits"
            description={commitListError}
          />
        ) : commitListLoading && commitList.length === 0 ? (
          <UiCenteredLoadingState message={initialLoadingLabel} />
        ) : commitList.length === 0 ? (
          <UiPaneState
            kind="empty"
            title="No commits found"
            description={
              contextMode === 'pull-request'
              ? pullRequestNumber
                ? `No commits found for PR #${pullRequestNumber}.`
                : 'No pull request selected.'
                : 'No commits found for this branch context.'
            }
          />
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
        <UiPaneState kind="error" title="Could not load changes" description={listError} />
      ) : listLoading && entries.length === 0 ? (
        <UiCenteredLoadingState message={initialLoadingLabel} />
      ) : entries.length === 0 ? (
        <UiPaneState
          kind="empty"
          title={emptyChangesTitle}
          description={emptyChangesDescription}
          action={emptyChangesAction}
        />
      ) : viewMode === 'stacked' ? (
        <div className="flex-1 min-h-0 overflow-auto">
          {dataMode === 'working-tree' ? (
            <>
              <div className="sticky top-0 z-10 px-2.5 py-1 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/95 backdrop-blur flex items-center gap-1">
                <span className="dh-changes-toolbar-label mr-1">Prefer</span>
                <UiToolbarSegmentedControl
                  label="Preferred change source"
                  value={stackedPreferredKind}
                  onValueChange={setStackedPreferredKind}
                  options={[
                    { value: 'unstaged', label: 'Unstaged' },
                    { value: 'staged', label: 'Staged' },
                  ]}
                />
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
                        {renderFileQuickActions(entry, false, true, k)}
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
                    ? reviewDiffStateKey(entry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
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
                          if (!open) {
                            if (reviewOverride) {
                              void loadExternalReviewDiff(entry.path);
                            } else if (dataMode === 'pull-preview') {
                              void loadRangeDiff({
                                filePath: entry.path,
                                baseSha: pullChanges?.baseSha,
                                headSha: pullChanges?.headSha,
                                stateKey: key,
                              });
                            }
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
            <div className="dh-utility-panel-chrome sticky top-0 z-10 px-2.5 py-1.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
              <div className="min-w-0 text-[var(--text-10)] text-[var(--muted)] font-mono truncate">
                <span title={selectedEntry?.path}>
                  {selectedEntry ? fileNameForChangesPath(selectedEntry.path) : 'No file selected'}
                </span>
              </div>
              <div className="inline-flex items-center gap-1">
                {selectedEntry
                  ? renderFileQuickActions(
                      selectedEntry,
                      true,
                      true,
                      dataMode === 'working-tree' ? splitShownKind ?? undefined : undefined,
                    )
                  : null}
                {dataMode === 'working-tree' ? (
                  selectedEntry && hasUnstaged(selectedEntry) && hasStaged(selectedEntry) ? (
                    <UiToolbarSegmentedControl<DiffKind>
                      label="Diff source"
                      value={splitShownKind ?? 'unstaged'}
                      onValueChange={setSplitKind}
                      options={[
                        { value: 'unstaged', label: 'Unstaged' },
                        { value: 'staged', label: 'Staged' },
                      ]}
                    />
                  ) : null
                ) : (
                  <div className="text-[var(--text-9)] text-[var(--muted-dim)] font-mono whitespace-nowrap">
                    {dataMode === 'pull-request'
                      ? `${reviewOverride ? 'CR' : 'PR'} #${activePullRequestChanges?.pullRequest.number ?? pullRequestNumber ?? '-'} ${shortSha(pullBase)}..${shortSha(pullHead)}`
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
                    ? diffByKey[reviewDiffStateKey(selectedEntry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)]
                    : diffByKey[pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha)]
                }
                filePath={selectedEntry.path}
                viewType={diffViewType}
                expansionSourceId={pullExpansionSourceId(selectedEntry)}
                loadExpansionSource={pullExpansionSourceLoader(selectedEntry)}
                expansionRanges={
                  expandedRangesByDiffKey[
                    dataMode === 'pull-request'
                      ? reviewDiffStateKey(selectedEntry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
                      : pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha)
                  ] ?? []
                }
                onAddExpansionRange={(range) =>
                  addExpandedRangeForDiff(
                    dataMode === 'pull-request'
                      ? reviewDiffStateKey(selectedEntry.path, activePullRequestChanges?.pullRequest.number ?? pullRequestNumber)
                      : pullPreviewDiffStateKey(selectedEntry.path, pullChanges?.baseSha, pullChanges?.headSha),
                    range,
                  )
                }
              />
            )}
          </div>

          <UiResizeHandle
            orientation="vertical"
            value={explorerWidthPx}
            min={explorerResizeBounds.minWidthPx}
            max={explorerResizeBounds.maxWidthPx}
            step={10}
            label="Resize changes explorer"
            reversed
            onValueChange={setExplorerWidthPx}
            onValueCommit={(nextWidth) =>
              setExplorerManualWidthPx(Math.floor(nextWidth))
            }
            onResizingChange={setExplorerResizing}
            onReset={resetExplorerWidthPreference}
            className="dh-changes-split-resize-handle"
          />

          <div
            className={`dh-utility-panel-inset shrink-0 overflow-hidden flex flex-col ${
              explorerResizing ? '' : 'transition-[width] duration-150 ease-out'
            }`}
            style={{
              width: `${explorerWidthPx}px`,
              minWidth: `${explorerWidthPx}px`,
              maxWidth: `${explorerWidthPx}px`,
            }}
          >
            <WorkspaceExplorerHeader
              zoom={explorerZoom}
              onDecreaseZoom={decreaseExplorerZoom}
              onIncreaseZoom={increaseExplorerZoom}
              onResetZoom={resetExplorerZoom}
            />
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
                        <ChangesFileCountPill count={stagedEntries.length} tone="staged" />
                      </button>
                      {stagedSectionOpen ? (
                        <div className="w-full">{renderExplorer(stagedExplorerTree, 0, 'staged')}</div>
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
                        <ChangesFileCountPill count={unstagedEntries.length} tone="unstaged" />
                      </button>
                      {unstagedSectionOpen ? (
                        <div className="w-full">{renderExplorer(unstagedExplorerTree, 0, 'unstaged')}</div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : (
                <div className="w-full">{renderExplorer(explorerTree, 0)}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </UiPanel>
  );
}
