import React from 'react';
import Editor from '@monaco-editor/react';
import {
  ChatInput,
  type ChatSendPayload,
  ChatTabs,
  CollapsibleOutput,
  EmptyState,
  PendingTranscriptTurn,
  TranscriptSkeleton,
  TranscriptTurn,
} from '../chat';
import type { MarkdownFileReference } from '../chat/MarkdownMessage';
import { GroupBadge, StatusBadge } from '../overview';
import { TypingDots } from '../overview/icons';
import { requestJson } from '../http';
import type {
  DroneSummary,
  PendingPrompt,
  RepoPullRequestClosePayload,
  RepoPullRequestMergeMethod,
  RepoPullRequestMergePayload,
  RepoPullRequestSummary,
  RepoPullRequestsPayload,
  TranscriptItem,
} from '../types';
import { IconChat, IconChevron, IconCursorApp, IconDrone, IconFolder, IconSidebarExpand } from './icons';
import { RightPanel } from './RightPanel';
import type { RightPanelTab } from './app-config';
import type { StartupSeedState, TldrState } from './app-types';
import type { RepoOpErrorMeta } from './helpers';
import { requestChangesPullRequest } from '../changes/navigation';
import { chatInputDraftKeyForDroneChat, isDroneStartingOrSeeding, resolveChatNameForDrone } from './helpers';
import { openDroneTabFromLastPreview, resolveDroneOpenTabUrl } from './quick-actions';
import { cn } from '../../ui/cn';
import { dropdownMenuItemBaseClass, dropdownPanelBaseClass } from '../../ui/dropdown';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { useDroneHubUiStore, useSelectedDroneWorkspaceUiState } from './use-drone-hub-ui-store';

function editorLanguageForPath(filePath: string): string {
  const lower = String(filePath ?? '').trim().toLowerCase();
  const seg = lower.split('/').pop() ?? lower;
  if (seg === 'dockerfile') return 'dockerfile';
  if (seg === 'makefile') return 'makefile';
  if (seg.endsWith('.ts')) return 'typescript';
  if (seg.endsWith('.tsx')) return 'typescript';
  if (seg.endsWith('.js')) return 'javascript';
  if (seg.endsWith('.jsx')) return 'javascript';
  if (seg.endsWith('.json')) return 'json';
  if (seg.endsWith('.md')) return 'markdown';
  if (seg.endsWith('.py')) return 'python';
  if (seg.endsWith('.go')) return 'go';
  if (seg.endsWith('.rs')) return 'rust';
  if (seg.endsWith('.sh') || seg.endsWith('.bash') || seg.endsWith('.zsh')) return 'shell';
  if (seg.endsWith('.yml') || seg.endsWith('.yaml')) return 'yaml';
  if (seg.endsWith('.xml')) return 'xml';
  if (seg.endsWith('.html') || seg.endsWith('.htm')) return 'html';
  if (seg.endsWith('.css')) return 'css';
  if (seg.endsWith('.scss')) return 'scss';
  return 'plaintext';
}

function formatEditorMtime(mtimeMs: number | null): string {
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return 'Unknown';
  try {
    return new Date(mtimeMs).toLocaleString();
  } catch {
    return 'Unknown';
  }
}

function parseGithubPullRequestHref(
  hrefRaw: string,
): { owner: string; repo: string; pullNumber: number } | null {
  const href = String(hrefRaw ?? '').trim();
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || String(u.hostname || '').toLowerCase() !== 'github.com') return null;
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i.exec(String(u.pathname ?? '').trim());
  if (!m) return null;
  const owner = String(m[1] ?? '').trim().toLowerCase();
  const repo = String(m[2] ?? '').trim().toLowerCase();
  const pullNumber = Number(m[3]);
  if (!owner || !repo || !Number.isFinite(pullNumber) || pullNumber <= 0) return null;
  return { owner, repo, pullNumber: Math.floor(pullNumber) };
}

const PR_MERGE_METHOD_STORAGE_KEY = 'droneHub.prMergeMethod';
const HEADER_REPO_PR_CACHE_TTL_MS = 12_000;
const headerRepoPullRequestSummaryCache = new Map<
  string,
  {
    atMs: number;
    payload: Extract<RepoPullRequestsPayload, { ok: true }>;
  }
>();

function headerPrMergeMethod(): RepoPullRequestMergeMethod {
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

function shortPrTitle(raw: string, maxLen: number = 34): string {
  const text = String(raw ?? '').trim();
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}...`;
}

function repoPullRequestStatusBadges(pr: RepoPullRequestSummary): Array<{ key: string; label: string; className: string }> {
  const out: Array<{ key: string; label: string; className: string }> = [];
  if (pr.draft) {
    out.push({
      key: 'draft',
      label: 'Draft',
      className: 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
    });
  }
  if (pr.checksState === 'failing') {
    out.push({
      key: 'checks_failing',
      label: 'Checks failing',
      className: 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]',
    });
  } else if (pr.checksState === 'pending') {
    out.push({
      key: 'checks_pending',
      label: 'Checks pending',
      className: 'border-[rgba(255,178,36,.35)] bg-[var(--yellow-subtle)] text-[var(--yellow)]',
    });
  }
  if (pr.reviewState === 'approved') {
    out.push({
      key: 'approved',
      label: 'Approved',
      className: 'border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)]',
    });
  }
  if (pr.hasMergeConflicts) {
    out.push({
      key: 'merge_conflict',
      label: 'Merge conflict',
      className: 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]',
    });
  }
  return out;
}

function PullRequestStatusBadgeStrip({ pullRequest, limit = 4 }: { pullRequest: RepoPullRequestSummary; limit?: number }) {
  const badges = repoPullRequestStatusBadges(pullRequest).slice(0, Math.max(1, Math.floor(limit)));
  if (badges.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {badges.map((badge) => (
        <span
          key={`pr-badge-${pullRequest.number}-${badge.key}`}
          className={`inline-flex items-center rounded border px-1 py-[1px] text-[9px] leading-none ${badge.className}`}
          title={badge.label}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

function HeaderPullRequestShortcuts({
  droneId,
  repoPath,
  repoAttached,
  disabled,
  onOpenPullRequestsTab,
}: {
  droneId: string;
  repoPath: string;
  repoAttached: boolean;
  disabled: boolean;
  onOpenPullRequestsTab: () => void;
}) {
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [pullRequestsData, setPullRequestsData] = React.useState<Extract<RepoPullRequestsPayload, { ok: true }> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<{ kind: 'merge' | 'close'; prNumber: number } | null>(null);
  const repoCacheKey = String(repoPath ?? '').trim();

  React.useEffect(() => {
    if (!repoAttached || disabled || !repoCacheKey) {
      setPullRequestsData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let mounted = true;
    let timer: any = null;

    const load = async (silent: boolean) => {
      if (!mounted) return;
      const cached = headerRepoPullRequestSummaryCache.get(repoCacheKey);
      if (cached && Date.now() - cached.atMs < HEADER_REPO_PR_CACHE_TTL_MS) {
        setPullRequestsData(cached.payload);
        setError(null);
        if (!silent) setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const data = await requestJson<Extract<RepoPullRequestsPayload, { ok: true }>>(
          `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests?state=open`,
        );
        if (!mounted) return;
        headerRepoPullRequestSummaryCache.set(repoCacheKey, { atMs: Date.now(), payload: data });
        setPullRequestsData(data);
        setError(null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? String(e));
      } finally {
        if (mounted && !silent) setLoading(false);
      }
    };

    void load(false);
    timer = setInterval(() => {
      void load(true);
    }, 20_000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [disabled, droneId, refreshNonce, repoAttached, repoCacheKey]);

  const count = Number(pullRequestsData?.count ?? 0);
  const previewRows = (pullRequestsData?.pullRequests ?? []).slice(0, 2);
  const firstPr = previewRows.length === 1 ? previewRows[0] : null;

  const onQuickMerge = React.useCallback(async () => {
    if (!firstPr) return;
    const prNumber = Number(firstPr.number);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return;
    if (busyAction) return;
    const method = headerPrMergeMethod();
    if (!window.confirm(`Merge PR #${prNumber} using "${method}"?`)) return;
    setBusyAction({ kind: 'merge', prNumber });
    setError(null);
    try {
      await requestJson<Extract<RepoPullRequestMergePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${prNumber}/merge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method }),
        },
      );
      if (repoCacheKey) headerRepoPullRequestSummaryCache.delete(repoCacheKey);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, droneId, firstPr, repoCacheKey]);

  const onQuickClose = React.useCallback(async () => {
    if (!firstPr) return;
    const prNumber = Number(firstPr.number);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return;
    if (busyAction) return;
    if (!window.confirm(`Close PR #${prNumber} without merging?`)) return;
    setBusyAction({ kind: 'close', prNumber });
    setError(null);
    try {
      await requestJson<Extract<RepoPullRequestClosePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${prNumber}/close`,
        { method: 'POST' },
      );
      if (repoCacheKey) headerRepoPullRequestSummaryCache.delete(repoCacheKey);
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, droneId, firstPr, repoCacheKey]);

  if (!repoAttached || disabled || !repoCacheKey) return null;

  return (
    <div className="hidden xl:flex items-center gap-1.5 pl-1 border-l border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={onOpenPullRequestsTab}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
          error
            ? 'border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)]'
            : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
        title={error ?? 'Open pull requests tab'}
      >
        PRs {loading && !pullRequestsData ? '...' : String(count)}
      </button>
      {previewRows.map((pr) => (
        <button
          key={`header-pr-${pr.number}`}
          type="button"
          onClick={onOpenPullRequestsTab}
          className="inline-flex items-start gap-1.5 max-w-[280px] px-2 py-1 rounded text-[10px] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-110 transition-all"
          title={`#${pr.number} ${pr.title}`}
        >
          <span className="font-mono pt-[1px]">#{pr.number}</span>
          <span className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span className="truncate">{shortPrTitle(pr.title)}</span>
            <PullRequestStatusBadgeStrip pullRequest={pr} limit={3} />
          </span>
        </button>
      ))}
      {firstPr ? (
        <>
          <button
            type="button"
            onClick={() => {
              void onQuickMerge();
            }}
            disabled={Boolean(busyAction)}
            className="inline-flex items-center px-2 py-1 rounded text-[9px] font-semibold tracking-wide uppercase border border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] text-[var(--green)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed transition-all"
            style={{ fontFamily: 'var(--display)' }}
            title={`Quick merge #${firstPr.number}`}
          >
            {busyAction?.kind === 'merge' && busyAction.prNumber === firstPr.number ? 'Merging...' : 'Merge'}
          </button>
          <button
            type="button"
            onClick={() => {
              void onQuickClose();
            }}
            disabled={Boolean(busyAction)}
            className="inline-flex items-center px-2 py-1 rounded text-[9px] font-semibold tracking-wide uppercase border border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] text-[var(--red)] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed transition-all"
            style={{ fontFamily: 'var(--display)' }}
            title={`Quick close #${firstPr.number}`}
          >
            {busyAction?.kind === 'close' && busyAction.prNumber === firstPr.number ? 'Closing...' : 'Close'}
          </button>
        </>
      ) : null}
    </div>
  );
}

type LaunchHint =
  | {
      context: 'terminal' | 'code' | 'cursor';
      command?: string;
      launcher?: string;
      kind: 'copied';
    }
  | null;

type SelectedDroneWorkspaceProps = {
  currentDrone: DroneSummary;
  currentDroneLabel: string;
  showRespondingAsStatusInHeader: boolean;
  chatUiMode: 'transcript' | 'cli';
  loadingSession: boolean;
  sessionError: string | null;
  loadingTranscript: boolean;
  transcriptError: string | null;
  chatInfoError: string | null;
  loadingChatInfo: boolean;
  repoOpError: string | null;
  repoOpErrorMeta: RepoOpErrorMeta | null;
  openDroneErrorModal: (drone: DroneSummary, message: string, meta: RepoOpErrorMeta | null) => void;
  launchHint: LaunchHint;
  currentAgentKey: string;
  pickAgentValue: (next: string) => void;
  toolbarAgentMenuEntries: UiMenuSelectEntry[];
  agentDisabled: boolean;
  agentLabel: string;
  modelControlEnabled: boolean;
  availableChatModels: unknown[];
  currentModel: string | null;
  setChatModel: (model: string | null) => Promise<void>;
  setChatInfoError: React.Dispatch<React.SetStateAction<string | null>>;
  modelMenuEntries: UiMenuSelectEntry[];
  modelDisabled: boolean;
  modelLabel: string;
  manualChatModelInput: string;
  setManualChatModelInput: React.Dispatch<React.SetStateAction<string>>;
  applyManualChatModel: () => void;
  setChatModelsRefreshNonce: React.Dispatch<React.SetStateAction<number>>;
  loadingChatModels: boolean;
  chatModelsError: string | null;
  chatModelsDiscoveredAt: string | null;
  chatModelsSource: string;
  currentDroneRepoAttached: boolean;
  currentDroneRepoPath: string;
  createRepoMenuEntries: UiMenuSelectEntry[];
  openDroneTerminal: (mode: 'ssh' | 'agent') => void;
  openingTerminal: { mode: 'ssh' | 'agent' } | null;
  openDroneEditor: (editor: 'code' | 'cursor') => void;
  openingEditor: { editor: 'code' | 'cursor' } | null;
  pullRepoChanges: () => Promise<void>;
  pushRepoChanges: () => Promise<void>;
  repoOp: { kind: 'pull' | 'push' | 'reseed' } | null;
  headerOverflowRef: React.RefObject<HTMLDivElement | null>;
  reseedRepo: () => Promise<void>;
  terminalMenuRef: React.RefObject<HTMLDivElement | null>;
  terminalLabel: string;
  terminalOptions: Array<{ id: string; label: string }>;
  rightPanelOpen: boolean;
  setRightPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRightPanelSplitMode: (next: boolean) => void;
  rightPanelSplit: boolean;
  rightPanelTabs: RightPanelTab[];
  rightPanelTab: RightPanelTab;
  setRightPanelTab: React.Dispatch<React.SetStateAction<RightPanelTab>>;
  rightPanelTabLabels: Record<RightPanelTab, string>;
  resetRightPanelWidth: () => void;
  rightPanelWidthIsDefault: boolean;
  transcripts: TranscriptItem[] | null;
  visiblePendingPromptsWithStartup: PendingPrompt[];
  transcriptMessageId: (item: TranscriptItem) => string;
  nowMs: number;
  parsingJobsByTurn: Record<number, unknown>;
  parseJobsFromAgentMessage: (opts: { turn: number; message: string }) => void;
  tldrByMessageId: Record<string, TldrState | null>;
  showTldrByMessageId: Record<string, boolean>;
  toggleTldrForAgentMessage: (item: TranscriptItem) => void;
  handleAgentMessageHover: (item: TranscriptItem | null) => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
  updatePinned: (el: HTMLDivElement) => void;
  startupSeedForCurrentDrone: StartupSeedState | null;
  sessionText: string;
  pinnedToBottom: boolean;
  selectedDroneIdentity: string;
  promptError: string | null;
  sendingPrompt: boolean;
  sendPromptText: (payload: ChatSendPayload) => Promise<boolean>;
  requestUnstickPendingPrompt: (promptId: string) => Promise<void>;
  unstickingPendingPromptById: Record<string, true>;
  unstickPendingPromptErrorById: Record<string, string>;
  openedEditorFilePath: string | null;
  openedEditorFileName: string | null;
  openedEditorFileLoading: boolean;
  openedEditorFileSaving: boolean;
  openedEditorFileError: string | null;
  openedEditorFileOpenFailureMessage: string | null;
  openedEditorFileOpenFailureAt: number | null;
  openedEditorFileContent: string;
  openedEditorFileDirty: boolean;
  openedEditorFileMtimeMs: number | null;
  openedEditorFileTargetLine: number | null;
  openedEditorFileTargetColumn: number | null;
  openedEditorFileNavigationSeq: number;
  onOpenedEditorFileContentChange: (next: string) => void;
  onSaveOpenedEditorFile: (contentOverride?: string) => Promise<boolean>;
  onCloseOpenedEditorFile: () => void;
  onOpenMarkdownFileReference: (ref: MarkdownFileReference) => void;
  rightPanelWidth: number;
  rightPanelWidthMax: number;
  rightPanelMinWidth: number;
  rightPanelResizing: boolean;
  rightPanelBottomTab: RightPanelTab;
  setRightPanelBottomTab: React.Dispatch<React.SetStateAction<RightPanelTab>>;
  startRightPanelResize: React.MouseEventHandler<HTMLDivElement>;
  renderRightPanelTabContent: (drone: DroneSummary, tab: RightPanelTab, pane: 'single' | 'top' | 'bottom') => React.ReactNode;
};

export function SelectedDroneWorkspace({
  currentDrone,
  currentDroneLabel,
  showRespondingAsStatusInHeader,
  chatUiMode,
  loadingSession,
  sessionError,
  loadingTranscript,
  transcriptError,
  chatInfoError,
  loadingChatInfo,
  repoOpError,
  repoOpErrorMeta,
  openDroneErrorModal,
  launchHint,
  currentAgentKey,
  pickAgentValue,
  toolbarAgentMenuEntries,
  agentDisabled,
  agentLabel,
  modelControlEnabled,
  availableChatModels,
  currentModel,
  setChatModel,
  setChatInfoError,
  modelMenuEntries,
  modelDisabled,
  modelLabel,
  manualChatModelInput,
  setManualChatModelInput,
  applyManualChatModel,
  setChatModelsRefreshNonce,
  loadingChatModels,
  chatModelsError,
  chatModelsDiscoveredAt,
  chatModelsSource,
  currentDroneRepoAttached,
  currentDroneRepoPath,
  createRepoMenuEntries,
  openDroneTerminal,
  openingTerminal,
  openDroneEditor,
  openingEditor,
  pullRepoChanges,
  pushRepoChanges,
  repoOp,
  headerOverflowRef,
  reseedRepo,
  terminalMenuRef,
  terminalLabel,
  terminalOptions,
  rightPanelOpen,
  setRightPanelOpen,
  setRightPanelSplitMode,
  rightPanelSplit,
  rightPanelTabs,
  rightPanelTab,
  setRightPanelTab,
  rightPanelTabLabels,
  resetRightPanelWidth,
  rightPanelWidthIsDefault,
  transcripts,
  visiblePendingPromptsWithStartup,
  transcriptMessageId,
  nowMs,
  parsingJobsByTurn,
  parseJobsFromAgentMessage,
  tldrByMessageId,
  showTldrByMessageId,
  toggleTldrForAgentMessage,
  handleAgentMessageHover,
  chatEndRef,
  outputScrollRef,
  updatePinned,
  startupSeedForCurrentDrone,
  sessionText,
  pinnedToBottom,
  selectedDroneIdentity,
  promptError,
  sendingPrompt,
  sendPromptText,
  requestUnstickPendingPrompt,
  unstickingPendingPromptById,
  unstickPendingPromptErrorById,
  openedEditorFilePath,
  openedEditorFileName,
  openedEditorFileLoading,
  openedEditorFileSaving,
  openedEditorFileError,
  openedEditorFileOpenFailureMessage,
  openedEditorFileOpenFailureAt,
  openedEditorFileContent,
  openedEditorFileDirty,
  openedEditorFileMtimeMs,
  openedEditorFileTargetLine,
  openedEditorFileTargetColumn,
  openedEditorFileNavigationSeq,
  onOpenedEditorFileContentChange,
  onSaveOpenedEditorFile,
  onCloseOpenedEditorFile,
  onOpenMarkdownFileReference,
  rightPanelWidth,
  rightPanelWidthMax,
  rightPanelMinWidth,
  rightPanelResizing,
  rightPanelBottomTab,
  setRightPanelBottomTab,
  startRightPanelResize,
  renderRightPanelTabContent,
}: SelectedDroneWorkspaceProps) {
  const {
    sidebarCollapsed,
    agentMenuOpen,
    terminalMenuOpen,
    headerOverflowOpen,
    outputView,
    selectedChat,
    terminalEmulator,
    setSidebarCollapsed,
    setAgentMenuOpen,
    setTerminalMenuOpen,
    setHeaderOverflowOpen,
    setOutputView,
    setSelectedChat,
    setTerminalEmulator,
  } = useSelectedDroneWorkspaceUiState();
  const activeChatName = React.useMemo(
    () => resolveChatNameForDrone(currentDrone, selectedChat),
    [currentDrone, selectedChat],
  );
  const chatDraftKey = React.useMemo(
    () => chatInputDraftKeyForDroneChat(currentDrone.id, activeChatName),
    [activeChatName, currentDrone.id],
  );
  const chatDraftValue = useDroneHubUiStore((s) => s.chatInputDrafts[chatDraftKey] ?? '');
  const setChatInputDraft = useDroneHubUiStore((s) => s.setChatInputDraft);
  const shouldAutoFocusInput = React.useMemo(() => {
    if (openedEditorFilePath) return false;
    if (chatUiMode === 'transcript') {
      return !loadingTranscript && (transcripts?.length ?? 0) === 0 && visiblePendingPromptsWithStartup.length === 0;
    }
    return !loadingSession && !sessionText.trim();
  }, [
    chatUiMode,
    loadingSession,
    loadingTranscript,
    openedEditorFilePath,
    sessionText,
    transcripts,
    visiblePendingPromptsWithStartup.length,
  ]);

  const openPullRequestsTab = React.useCallback(() => {
    setRightPanelOpen(true);
    setRightPanelTab('prs');
  }, [setRightPanelOpen, setRightPanelTab]);
  const quickOpenTabUrl = resolveDroneOpenTabUrl(currentDrone);
  const quickOpenTabDisabled = isDroneStartingOrSeeding(currentDrone.hubPhase) || !quickOpenTabUrl;
  const editorRef = React.useRef<any>(null);
  const [fileOpenToast, setFileOpenToast] = React.useState<{ id: number; message: string } | null>(null);
  const repoIdentityRef = React.useRef<{ owner: string; repo: string } | null>(null);
  const applyEditorCursorTarget = React.useCallback(() => {
    if (!openedEditorFilePath || !openedEditorFileTargetLine) return;
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel?.();
    const maxLine = Number(model?.getLineCount?.() ?? openedEditorFileTargetLine);
    const line = Math.min(Math.max(1, openedEditorFileTargetLine), Number.isFinite(maxLine) && maxLine > 0 ? maxLine : openedEditorFileTargetLine);
    const requestedColumn = openedEditorFileTargetColumn ?? 1;
    const maxColumn = Number(model?.getLineMaxColumn?.(line) ?? requestedColumn);
    const column = Math.min(Math.max(1, requestedColumn), Number.isFinite(maxColumn) && maxColumn > 0 ? maxColumn : requestedColumn);
    editor.setPosition?.({ lineNumber: line, column });
    editor.revealPositionInCenter?.({ lineNumber: line, column });
    editor.focus?.();
  }, [openedEditorFilePath, openedEditorFileTargetColumn, openedEditorFileTargetLine]);

  React.useEffect(() => {
    if (openedEditorFileLoading || !openedEditorFilePath || !openedEditorFileTargetLine) return;
    if (!openedEditorFileNavigationSeq) return;
    applyEditorCursorTarget();
  }, [
    applyEditorCursorTarget,
    openedEditorFileLoading,
    openedEditorFileNavigationSeq,
    openedEditorFilePath,
    openedEditorFileTargetLine,
  ]);

  React.useEffect(() => {
    if (!openedEditorFileOpenFailureMessage || !openedEditorFileOpenFailureAt) return;
    const id = openedEditorFileOpenFailureAt;
    setFileOpenToast({ id, message: openedEditorFileOpenFailureMessage });
    const timeout = window.setTimeout(() => {
      setFileOpenToast((prev) => (prev && prev.id === id ? null : prev));
    }, 4200);
    return () => window.clearTimeout(timeout);
  }, [openedEditorFileOpenFailureAt, openedEditorFileOpenFailureMessage]);

  React.useEffect(() => {
    repoIdentityRef.current = null;
    if (!(currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim()))) return;
    if (isDroneStartingOrSeeding(currentDrone.hubPhase)) return;
    let cancelled = false;
    void requestJson<Extract<RepoPullRequestsPayload, { ok: true }>>(
      `/api/drones/${encodeURIComponent(currentDrone.id)}/repo/pull-requests?state=open`,
    )
      .then((data) => {
        if (cancelled) return;
        const owner = String(data?.github?.owner ?? '').trim().toLowerCase();
        const repo = String(data?.github?.repo ?? '').trim().toLowerCase();
        if (!owner || !repo) return;
        repoIdentityRef.current = { owner, repo };
      })
      .catch(() => {
        // ignore; fallback behavior below is still safe
      });
    return () => {
      cancelled = true;
    };
  }, [currentDrone.hubPhase, currentDrone.id, currentDrone.repoAttached, currentDrone.repoPath]);

  const tryOpenMarkdownPullRequestInChanges = React.useCallback(
    (href: string): boolean => {
      const parsed = parseGithubPullRequestHref(href);
      if (!parsed) return false;
      if (!(currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim()))) return false;
      if (isDroneStartingOrSeeding(currentDrone.hubPhase)) return false;
      const knownRepo = repoIdentityRef.current;
      if (knownRepo && (knownRepo.owner !== parsed.owner || knownRepo.repo !== parsed.repo)) return false;
      setRightPanelOpen(true);
      setRightPanelTab('changes');
      requestChangesPullRequest({ droneId: currentDrone.id, pullNumber: parsed.pullNumber });
      return true;
    },
    [currentDrone.hubPhase, currentDrone.id, currentDrone.repoAttached, currentDrone.repoPath, setRightPanelOpen, setRightPanelTab],
  );

  return (
    <>
      {/* Header — spans full width (chat + right panel) */}
      <div className="flex-shrink-0 bg-[var(--panel-alt)] border-b border-[var(--border)] relative">
        <div className="px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--muted-dim)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all flex-shrink-0 mr-1"
                  title="Expand sidebar"
                >
                  <IconSidebarExpand />
                </button>
              )}
              <div
                className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border ${
                  isDroneStartingOrSeeding(currentDrone.hubPhase)
                    ? 'bg-[var(--yellow-subtle)] border-[rgba(255,178,36,.15)]'
                    : currentDrone.statusOk
                      ? 'bg-[var(--accent-subtle)] border-[rgba(167,139,250,.15)] shadow-[0_0_12px_rgba(167,139,250,.08)]'
                      : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.15)]'
                }`}
              >
                <IconDrone
                  className={
                    isDroneStartingOrSeeding(currentDrone.hubPhase)
                      ? 'text-[var(--yellow)]'
                      : currentDrone.statusOk
                        ? 'text-[var(--accent)]'
                        : 'text-[var(--red)]'
                  }
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'var(--display)' }}>
                    {currentDroneLabel}
                  </span>
                  {showRespondingAsStatusInHeader ? (
                    <span className="inline-flex items-center" title="Agent responding">
                      <TypingDots color="var(--yellow)" />
                    </span>
                  ) : (
                    <StatusBadge ok={currentDrone.statusOk} error={currentDrone.statusError} hubPhase={currentDrone.hubPhase} hubMessage={currentDrone.hubMessage} />
                  )}
                  {currentDrone.group && <GroupBadge group={currentDrone.group} />}
                </div>
                {String(currentDrone.repoPath ?? '').trim() ? (
                  <div className="text-[10px] text-[var(--muted)] truncate flex items-center gap-1.5 font-mono mt-0.5" title={currentDrone.repoPath}>
                    <IconFolder className="flex-shrink-0 opacity-40 w-3 h-3" />
                    {currentDrone.repoPath}
                  </div>
                ) : (
                  <div className="text-[10px] text-[var(--muted-dim)] truncate flex items-center gap-1.5 mt-0.5" title="No repo attached">
                    <IconFolder className="flex-shrink-0 opacity-30 w-3 h-3" />
                    No repo attached
                  </div>
                )}
              </div>
            </div>
            {/* Status indicators + right panel toggle */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {chatUiMode === 'cli' ? (
                <>
                  {loadingSession && (
                    <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />
                      Loading...
                    </span>
                  )}
                  {sessionError && !loadingSession && (
                    <span className="text-[11px] text-[var(--red)] flex items-center gap-1" title={sessionError}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                      Error
                    </span>
                  )}
                </>
              ) : (
                <>
                  {loadingTranscript && (
                    <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />
                      Loading...
                    </span>
                  )}
                  {transcriptError && !loadingTranscript && (
                    <span className="text-[11px] text-[var(--red)] flex items-center gap-1" title={transcriptError}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                      Error
                    </span>
                  )}
                </>
              )}
              {chatInfoError && !loadingChatInfo && (
                <span className="text-[11px] text-[var(--red)] flex items-center gap-1" title={chatInfoError}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                  Agent error
                </span>
              )}
              {repoOpError && (
                <button
                  type="button"
                  className="text-[11px] text-[var(--red)] inline-flex items-center gap-1 hover:underline focus:outline-none"
                  title={repoOpError}
                  onClick={() => openDroneErrorModal(currentDrone, repoOpError, repoOpErrorMeta)}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                  Repo error
                </button>
              )}
              {launchHint?.kind === 'copied' && (
                <span
                  className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] font-mono"
                  title={launchHint.launcher ? `Launched: ${launchHint.launcher}` : 'Paste the copied command into a terminal.'}
                >
                  Command copied{launchHint.launcher ? ` • ${launchHint.launcher.split(' ')[0]}` : ''}
                </span>
              )}
              <HeaderPullRequestShortcuts
                droneId={currentDrone.id}
                repoPath={currentDrone.repoPath}
                repoAttached={currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim())}
                disabled={isDroneStartingOrSeeding(currentDrone.hubPhase)}
                onOpenPullRequestsTab={openPullRequestsTab}
              />
            </div>
          </div>
        </div>
        {/* Tier 2: Toolbar */}
        <div className="px-5 pb-2.5 flex items-center gap-2 flex-wrap">
          {/* Agent selector */}
          <div data-onboarding-id="chat.toolbar.agent" className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
              Agent
            </span>
            <UiMenuSelect
              variant="toolbar"
              value={currentAgentKey}
              onValueChange={pickAgentValue}
              entries={toolbarAgentMenuEntries}
              open={agentMenuOpen}
              onOpenChange={(open) => {
                if (open) {
                  setTerminalMenuOpen(false);
                  setHeaderOverflowOpen(false);
                }
                setAgentMenuOpen(open);
              }}
              disabled={agentDisabled}
              title="Choose agent implementation for this chat."
              triggerLabel={agentLabel}
              chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
              panelClassName="w-[260px]"
              header="Choose agent"
              headerStyle={{ fontFamily: 'var(--display)' }}
            />
          </div>
          {modelControlEnabled && (
            <div data-onboarding-id="chat.toolbar.model" className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Model
              </span>
              {availableChatModels.length > 0 ? (
                <UiMenuSelect
                  variant="toolbar"
                  value={currentModel ?? ''}
                  onValueChange={(next) => {
                    void setChatModel(next || null).catch((err: any) => setChatInfoError(err?.message ?? String(err)));
                  }}
                  entries={modelMenuEntries}
                  disabled={modelDisabled}
                  triggerClassName="min-w-[170px] max-w-[240px]"
                  title="Choose model for this chat."
                  triggerLabel={modelLabel}
                  chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                  panelClassName="w-[260px]"
                />
              ) : (
                <>
                  <input
                    value={manualChatModelInput}
                    onChange={(e) => setManualChatModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      applyManualChatModel();
                    }}
                    disabled={modelDisabled}
                    placeholder="Model id (optional)"
                    className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all ${
                      modelDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                    }`}
                    title="Type a model id and press Enter."
                  />
                  <button
                    type="button"
                    onClick={applyManualChatModel}
                    disabled={modelDisabled}
                    className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                      modelDisabled
                        ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                        : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Apply typed model for this chat"
                  >
                    Set
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setChatModelsRefreshNonce((n) => n + 1)}
                disabled={modelDisabled || loadingChatModels}
                className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                  modelDisabled || loadingChatModels
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Refresh model list from the agent CLI in this drone"
              >
                {loadingChatModels ? 'Loading' : 'Refresh'}
              </button>
              {chatModelsError && (
                <span className="text-[10px] text-[var(--muted-dim)]" title={chatModelsError}>
                  unavailable
                </span>
              )}
            </div>
          )}
          {/* Repo (read-only for repo-attached drones only) */}
          {currentDroneRepoAttached && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Repo
              </span>
              <UiMenuSelect
                variant="toolbar"
                value={currentDroneRepoPath}
                onValueChange={() => {}}
                entries={createRepoMenuEntries}
                disabled={true}
                triggerClassName="min-w-[220px] max-w-[420px]"
                panelClassName="w-[720px] max-w-[calc(100vw-3rem)]"
                menuClassName="max-h-[240px] overflow-y-auto"
                title={currentDroneRepoPath || 'No repo'}
                triggerLabel={currentDroneRepoPath || 'No repo'}
                triggerLabelClassName={currentDroneRepoPath ? 'font-mono text-[11px]' : undefined}
                chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
              />
            </div>
          )}
          {/* View mode */}
          {chatUiMode === 'cli' ? (
            <button
              onClick={() => setOutputView(outputView === 'screen' ? 'log' : 'screen')}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]"
              style={{ fontFamily: 'var(--display)' }}
              title={outputView === 'screen' ? 'Click for raw log view' : 'Click for screen capture view'}
            >
              {outputView === 'screen' ? 'Screen' : 'Log'}
            </button>
          ) : null}
          {/* Separator */}
          <div className="w-px h-4 bg-[var(--border-subtle)]" />
          {/* Chat tabs (inline) */}
          {currentDrone.chats.length > 0 && <ChatTabs chats={currentDrone.chats} selected={selectedChat} onSelect={setSelectedChat} />}
          {/* Spacer */}
          <div className="flex-1" />
          {/* Primary actions */}
          <button
            onClick={() => openDroneTerminal('ssh')}
            disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || openingTerminal?.mode === 'ssh' || openingTerminal?.mode === 'agent'}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
              openingTerminal
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={`SSH into "${currentDroneLabel}"`}
          >
            SSH
          </button>
          <button
            type="button"
            onClick={() => {
              openDroneTabFromLastPreview(currentDrone);
            }}
            disabled={quickOpenTabDisabled}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
              quickOpenTabDisabled
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={quickOpenTabUrl ? `Open ${quickOpenTabUrl} in a new browser tab` : 'No preview port selected yet'}
          >
            Open tab
          </button>
          <button
            onClick={() => openDroneEditor('cursor')}
            disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
              openingEditor || openingTerminal
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={`Open Cursor attached to "${currentDroneLabel}"`}
          >
            <IconCursorApp className="opacity-70" />
            Cursor
          </button>
          {(currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim())) && (
            <>
              <button
                type="button"
                onClick={() => void pullRepoChanges()}
                disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                  isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp)
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Apply repo changes from the drone container into the local repo"
              >
                {repoOp?.kind === 'pull' ? 'Applying...' : 'Apply changes'}
              </button>
              <button
                type="button"
                onClick={() => void pushRepoChanges()}
                disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                  isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp)
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Merge the current host branch into this drone branch"
              >
                {repoOp?.kind === 'push' ? 'Pulling host…' : 'Pull host changes'}
              </button>
            </>
          )}
          {/* Overflow menu */}
          <div ref={headerOverflowRef as React.RefObject<HTMLDivElement>} className="relative">
            <button
              type="button"
              onClick={() => {
                setAgentMenuOpen(false);
                setTerminalMenuOpen(false);
                setHeaderOverflowOpen((v) => !v);
              }}
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
              title="More actions"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={headerOverflowOpen}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
              </svg>
            </button>
            {headerOverflowOpen && (
              <div className={cn('absolute right-0 mt-2 w-[220px] z-50', dropdownPanelBaseClass)} role="menu">
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      openDroneTerminal('agent');
                    }}
                    disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingTerminal)}
                    className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                    role="menuitem"
                  >
                    SSH + Agent session
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      openDroneEditor('code');
                    }}
                    disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal)}
                    className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                    role="menuitem"
                  >
                    Open VS Code
                  </button>
                  {(currentDrone.repoAttached ?? Boolean(String(currentDrone.repoPath ?? '').trim())) && (
                    <>
                      <div className="my-1 border-t border-[var(--border-subtle)]" />
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderOverflowOpen(false);
                          void reseedRepo();
                        }}
                        disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp)}
                        className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                        role="menuitem"
                      >
                        Reseed repo
                      </button>
                    </>
                  )}
                  <div className="my-1 border-t border-[var(--border-subtle)]" />
                  <div ref={terminalMenuRef as React.RefObject<HTMLDivElement>} className="relative">
                    <button
                      type="button"
                      onClick={() => setTerminalMenuOpen((v) => !v)}
                      className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] flex items-center justify-between')}
                      role="menuitem"
                    >
                      <span>Terminal: {terminalLabel}</span>
                      <IconChevron down={!terminalMenuOpen} className="text-[var(--muted-dim)] opacity-60" />
                    </button>
                    {terminalMenuOpen && (
                      <div className="border-t border-[var(--border-subtle)]">
                        {terminalOptions.map((opt) => {
                          const active = opt.id === terminalEmulator;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setTerminalEmulator(opt.id);
                                setTerminalMenuOpen(false);
                                setHeaderOverflowOpen(false);
                              }}
                              className={`w-full text-left pl-6 pr-3 py-1.5 text-[11px] transition-colors ${
                                active ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold' : 'text-[var(--muted)] hover:bg-[var(--hover)]'
                              }`}
                              role="menuitem"
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Panel tabs (right side of toolbar) */}
          {rightPanelOpen && (
            <>
              <div className="w-px h-4 bg-[var(--border-subtle)] ml-1" />
              <div
                className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-0.5"
                style={{ fontFamily: 'var(--display)' }}
                title="Choose right panel layout mode."
              >
                <button
                  type="button"
                  onClick={() => setRightPanelSplitMode(false)}
                  className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase transition-all border ${
                    rightPanelSplit
                      ? 'text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border-transparent'
                      : 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-muted)]'
                  }`}
                  title="Use one right panel pane"
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setRightPanelSplitMode(true)}
                  className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase transition-all border ${
                    rightPanelSplit
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-muted)]'
                      : 'text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border-transparent'
                  }`}
                  title="Split right panel into top and bottom panes"
                >
                  Split
                </button>
              </div>
              {!rightPanelSplit && (
                <div className="flex items-center gap-0.5">
                  {rightPanelTabs.map((tab) => {
                    const active = rightPanelTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setRightPanelTab(tab)}
                        data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                        className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide uppercase transition-all ${
                          active
                            ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-muted)]'
                            : 'text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border border-transparent'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        {rightPanelTabLabels[tab]}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {rightPanelOpen && (
            <button
              type="button"
              onClick={resetRightPanelWidth}
              disabled={rightPanelWidthIsDefault}
              className={`inline-flex items-center h-7 px-2 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                rightPanelWidthIsDefault
                  ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-40 cursor-not-allowed'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Reset right panel width"
              aria-label="Reset right panel width"
            >
              Reset size
            </button>
          )}
          <button
            type="button"
            onClick={() => setRightPanelOpen((v) => !v)}
            data-onboarding-id="rightPanel.toggle"
            className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ml-1 ${
              rightPanelOpen
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            title={rightPanelOpen ? 'Hide panel' : 'Show panel'}
            aria-label="Toggle right panel"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <line x1="10" y1="2" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body row: chat + right panel */}
      <div className="flex-1 flex min-h-0">
        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative">
          <div className="flex-1 min-h-0 relative">
            {openedEditorFilePath ? (
              <div className="h-full min-w-0 min-h-0 flex flex-col">
                <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--panel-alt)] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] text-[var(--muted-dim)] uppercase tracking-wide" style={{ fontFamily: 'var(--display)' }}>
                      {openedEditorFileName ? `Editing ${openedEditorFileName}` : 'Editing file'}
                    </div>
                    <div className="text-[12px] text-[var(--fg-secondary)] font-mono truncate" title={openedEditorFilePath}>
                      {openedEditorFilePath}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {openedEditorFileSaving
                        ? 'Saving...'
                        : openedEditorFileDirty
                          ? 'Unsaved changes'
                          : `Saved • ${formatEditorMtime(openedEditorFileMtimeMs)}`}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        void onSaveOpenedEditorFile();
                      }}
                      disabled={openedEditorFileLoading || openedEditorFileSaving || !openedEditorFileDirty}
                      className={`h-7 px-2.5 rounded border text-[10px] font-semibold tracking-wide uppercase transition-colors ${
                        openedEditorFileLoading || openedEditorFileSaving || !openedEditorFileDirty
                          ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-50 cursor-not-allowed'
                          : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:shadow-[var(--glow-accent)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                      title="Save file (Ctrl/Cmd+S)"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={onCloseOpenedEditorFile}
                      className="h-7 px-2.5 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-colors"
                      style={{ fontFamily: 'var(--display)' }}
                      title="Close file editor"
                    >
                      Close
                    </button>
                  </div>
                </div>
                {openedEditorFileError ? (
                  <div className="mx-4 mt-3 rounded border border-[rgba(255,90,90,.24)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">
                    {openedEditorFileError}
                  </div>
                ) : null}
                <div className="flex-1 min-h-0 border-t border-[var(--border-subtle)]">
                  {openedEditorFileLoading ? (
                    <div className="h-full w-full flex items-center justify-center text-[12px] text-[var(--muted)]">Loading file...</div>
                  ) : (
                    <Editor
                      path={openedEditorFilePath}
                      language={editorLanguageForPath(openedEditorFilePath)}
                      value={openedEditorFileContent}
                      onChange={(next) => onOpenedEditorFileContentChange(next ?? '')}
                      onMount={(editor, monaco) => {
                        editorRef.current = editor;
                        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                          void onSaveOpenedEditorFile(editor.getValue());
                        });
                        applyEditorCursorTarget();
                      }}
                      theme="vs-dark"
                      options={{
                        readOnly: openedEditorFileSaving,
                        fontSize: 12,
                        minimap: { enabled: false },
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        padding: { top: 12, bottom: 12 },
                      }}
                    />
                  )}
                </div>
              </div>
            ) : chatUiMode === 'transcript' ? (
              <div className="h-full min-w-0 min-h-0 overflow-auto">
                {loadingTranscript && !transcripts && visiblePendingPromptsWithStartup.length === 0 ? (
                  <TranscriptSkeleton message="Loading chat messages..." />
                ) : (transcripts && transcripts.length > 0) || visiblePendingPromptsWithStartup.length > 0 ? (
                  <div className="max-w-[1170px] mx-auto px-6 py-5 flex flex-col gap-6">
                    {(transcripts ?? []).map((t) => {
                      const messageId = transcriptMessageId(t);
                      return (
                        <TranscriptTurn
                          key={`${t.turn}-${t.at}`}
                          item={t}
                          nowMs={nowMs}
                          parsingJobs={Boolean(parsingJobsByTurn[t.turn])}
                          onCreateJobs={parseJobsFromAgentMessage}
                          messageId={messageId}
                          tldr={tldrByMessageId[messageId] ?? null}
                          showTldr={Boolean(showTldrByMessageId[messageId])}
                          onToggleTldr={toggleTldrForAgentMessage}
                          onHoverAgentMessage={handleAgentMessageHover}
                          onOpenFileReference={onOpenMarkdownFileReference}
                          onOpenLink={tryOpenMarkdownPullRequestInChanges}
                        />
                      );
                    })}
                    {visiblePendingPromptsWithStartup.map((p) => (
                      <PendingTranscriptTurn
                        key={`pending-${p.id}`}
                        item={p}
                        nowMs={nowMs}
                        onRequestUnstick={requestUnstickPendingPrompt}
                        onOpenFileReference={onOpenMarkdownFileReference}
                        onOpenLink={tryOpenMarkdownPullRequestInChanges}
                        unstickBusy={Boolean(unstickingPendingPromptById[p.id])}
                        unstickError={unstickPendingPromptErrorById[p.id] ?? null}
                      />
                    ))}
                    <div ref={chatEndRef as React.RefObject<HTMLDivElement>} />
                  </div>
                ) : (
                  <EmptyState
                    icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
                    title="No messages yet"
                    description={transcriptError ? `Error: ${transcriptError}` : `Send a prompt to ${currentDroneLabel} to see the conversation here.`}
                  />
                )}
              </div>
            ) : (
              <div
                ref={outputScrollRef as React.RefObject<HTMLDivElement>}
                onScroll={(e) => updatePinned(e.currentTarget)}
                className="h-full min-w-0 min-h-0 overflow-auto relative"
              >
                {isDroneStartingOrSeeding(currentDrone.hubPhase) && String(startupSeedForCurrentDrone?.prompt ?? '').trim() && (
                  <div className="max-w-[1170px] mx-auto px-6 pt-2">
                    <div className="rounded-md border border-[rgba(148,163,184,.2)] bg-[var(--user-dim)] px-3 py-2 text-[12px] text-[var(--fg-secondary)] whitespace-pre-wrap">
                      {String(startupSeedForCurrentDrone?.prompt ?? '').trim()}
                    </div>
                  </div>
                )}
                {loadingSession && !sessionText ? (
                  <TranscriptSkeleton message="Loading session output..." />
                ) : sessionText ? (
                  <div className="max-w-[1170px] mx-auto px-6 py-6">
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(0,0,0,.1)] px-4 py-3">
                      <CollapsibleOutput text={sessionText} ok={!sessionError} />
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
                    title="No output yet"
                    description={sessionError ? `Error: ${sessionError}` : `Send a prompt to ${currentDroneLabel} to see the session output here.`}
                  />
                )}

                {!pinnedToBottom && sessionText && (
                  <div className="pointer-events-none sticky bottom-4 flex justify-center px-6">
                    <button
                      type="button"
                      onClick={() => {
                        const el = outputScrollRef.current;
                        if (!el) return;
                        el.scrollTop = el.scrollHeight;
                        updatePinned(el);
                      }}
                      className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded text-[10px] font-semibold tracking-wide uppercase border border-[var(--accent-muted)] bg-[var(--panel-raised)] text-[var(--accent)] hover:shadow-[var(--glow-accent)] shadow-[0_8px_24px_rgba(0,0,0,.25)] transition-all"
                      style={{ fontFamily: 'var(--display)' }}
                      title="Scroll to bottom"
                    >
                      New output ↓
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {!openedEditorFilePath && (
            <ChatInput
              resetKey={`${selectedDroneIdentity}:${selectedChat ?? ''}`}
              droneName={currentDrone.name}
              draftValue={chatDraftValue}
              onDraftValueChange={(next) => setChatInputDraft(chatDraftKey, next)}
              promptError={promptError}
              sending={sendingPrompt}
              waiting={chatUiMode === 'transcript' && visiblePendingPromptsWithStartup.some((p) => p.state !== 'failed')}
              autoFocus={shouldAutoFocusInput}
              onSend={async (payload: ChatSendPayload) => {
                try {
                  return await sendPromptText(payload);
                } catch {
                  return false;
                }
              }}
            />
          )}
          {fileOpenToast ? (
            <div className="pointer-events-none absolute right-4 bottom-4 z-20">
              <div className="max-w-[360px] rounded border border-[rgba(255,90,90,.3)] bg-[rgba(30,12,14,.95)] px-3 py-2 shadow-[0_10px_26px_rgba(0,0,0,.35)]">
                <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--red)]" style={{ fontFamily: 'var(--display)' }}>
                  Open file failed
                </div>
                <div className="mt-1 text-[11px] text-[var(--fg-secondary)] break-words">{fileOpenToast.message}</div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right panel content (tabs are in the header toolbar) */}
        {rightPanelOpen && (
          <RightPanel
            currentDrone={currentDrone}
            rightPanelWidth={rightPanelWidth}
            rightPanelWidthMax={rightPanelWidthMax}
            rightPanelMinWidth={rightPanelMinWidth}
            rightPanelResizing={rightPanelResizing}
            rightPanelSplit={rightPanelSplit}
            rightPanelTab={rightPanelTab}
            rightPanelBottomTab={rightPanelBottomTab}
            rightPanelTabs={rightPanelTabs}
            rightPanelTabLabels={rightPanelTabLabels}
            onRightPanelTabChange={setRightPanelTab}
            onRightPanelBottomTabChange={setRightPanelBottomTab}
            onStartResize={startRightPanelResize}
            onResetWidth={resetRightPanelWidth}
            renderTabContent={renderRightPanelTabContent}
          />
        )}
      </div>
    </>
  );
}
