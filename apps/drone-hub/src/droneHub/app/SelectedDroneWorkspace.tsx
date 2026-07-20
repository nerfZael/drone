import React from 'react';
import { createPortal } from 'react-dom';
import {
  AgentChatTranscript,
  PromptLoopTranscriptGroup,
  AutomationLaneStatusCard,
  ChatSurface,
  ChatSurfaceComposer,
  ChatSurfaceLoadingView,
  ChatLoadingState,
  adaptExternalAgentChatSurface,
  adaptNativeAgentChatSurface,
  type AgentChatTranscriptItem,
  type ChatDraftAutomationPayload,
  type ChatComposerControlsConfig,
  type DroneHubTask,
  type DroneHubTaskSpawnMode,
  type ChatSendPayload,
  CollapsibleOutput,
  EmptyState,
  PendingTranscriptTurn,
  TranscriptTurn,
} from '../chat';
import type { MarkdownFileReference } from '../chat/MarkdownMessage';
import { StatusBadge } from '../overview';
import { TypingDots } from '../overview/icons';
import { requestJson } from '../http';
import type { AgentPermissionMode } from '../../domain';
import type {
  DroneSummary,
  PendingPrompt,
  TranscriptItem,
} from '../types';
import { IconAutoMinimize, IconChat, IconChevron, IconCursorApp, IconFolder, IconSidebarExpand, IconTune } from './icons';
import {
  DockableDroneWorkspace,
  WORKSPACE_LAYOUT_SCOPES,
  readWorkspaceLayoutScope,
  readWorkspacePaneHeaderMode,
  writeWorkspaceLayoutScope,
  writeWorkspacePaneHeaderMode,
  type WorkspaceLayoutScope,
  type WorkspacePaneHeaderMode,
} from './DockableDroneWorkspace';
import { DroneWorkspaceHeaderFrame } from './DroneWorkspaceHeaderFrame';
import { HeaderActionButton } from './HeaderActionButton';
import { type RightPanelTab } from './app-config';
import type { AgentSuggestionState, ChatModelOption, StartupSeedState } from './app-types';
import { chatConfigResolutionState } from './chat-selection-model';
import type { RepoOpErrorMeta } from './helpers';
import type { DroneDeleteMode } from './settings-types';
import { requestChangesPullRequest } from '../changes/navigation';
import { copyText, downloadTextFile } from './clipboard';
import { chatInputDraftKeyForDroneChat, droneHomePath, isDroneStartingOrSeeding, resolveChatNameForDrone } from './helpers';
import { openDroneTabFromLastPreview, resolveDroneOpenTabUrl } from './quick-actions';
import { cn } from '../../ui/cn';
import { dropdownMenuItemBaseClass, dropdownPanelBaseClass, useDropdownDismiss } from '../../ui/dropdown';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { createDraftChatAutomationLaunch } from './chat-draft-automation';
import { currentPromptAutomationDisplayStatus } from './prompt-automation-display-status';
import { fetchDroneChatTranscript } from './chat-api';
import { repoPathLabel } from './repo-path-label';
import { useDroneHubUiStore, useSelectedDroneWorkspaceUiState } from './use-drone-hub-ui-store';
import { usePromptAutomationState } from './use-prompt-automation-state';
import { CliPendingPromptStrip } from './CliPendingPromptStrip';
import { buildChatTimelineBlocks } from './chat-timeline-blocks';
import { buildPendingTimelineBlocks } from './pending-timeline-blocks';
import {
  buildPendingPromptLoopGroups,
  buildTranscriptTimelineBlocks,
  buildTranscriptRenderBlocks,
  type TranscriptRenderBlock,
  type TranscriptTimelineBlock,
} from './prompt-loop-groups';
import { resolveRunningPromptLoopIdentity } from './prompt-loop-running-identity';
import type { RepoTransferActionResult, RepoTransferPeer } from './use-workspace-actions';
import {
  displayedChatModelTitle,
  formatAgentModelMetadata,
  formatBytes,
  latestTranscriptRuntime,
  resolveDisplayedChatModel,
} from './selected-drone-workspace-utils';
import { parseGithubPullRequestHref } from '../chat/github-pull-request-links';
import { useHeaderRepoPullRequestSummary } from './HeaderPullRequestShortcuts';
import { useFleetAssignmentDropState } from './use-fleet-assignment-drop-state';
import { AssistantDock } from '../assistant/AssistantDock';
import {
  buildTranscriptExportFilename,
  formatTranscriptJson,
  formatTranscriptMarkdown,
} from '../chat/transcript-export';

type LaunchHint =
  | {
      context: 'terminal' | 'code' | 'cursor';
      command?: string;
      launcher?: string;
      kind: 'copied';
    }
  | null;

type DockerSizeSummary = NonNullable<DroneSummary['dockerSize']>;

type DockerSizePayload = {
  ok: true;
  id: string;
  name?: string;
  dockerSize: DockerSizeSummary;
};

const EXTERNAL_AGENT_CHAT_SURFACE = adaptExternalAgentChatSurface();
const NATIVE_AGENT_CHAT_SURFACE = adaptNativeAgentChatSurface();

function HeaderDropdownPortal({
  open,
  anchorRef,
  width,
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  width: number;
  children: React.ReactNode;
}) {
  const [position, setPosition] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  React.useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || width;
      const left = Math.max(8, Math.min(rect.right - width, viewportWidth - width - 8));
      setPosition({ top: rect.bottom + 8, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, open, width]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn('fixed z-[11000]', dropdownPanelBaseClass)}
      style={{ top: position.top, left: position.left, width }}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}

type SelectedDroneWorkspaceProps = {
  currentDrone: DroneSummary;
  deleteMode: DroneDeleteMode;
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
  agentLocked: boolean;
  agentDisabled: boolean;
  agentLabel: string;
  chatRuntimeMetadataAvailable: boolean;
  modelControlEnabled: boolean;
  availableChatModels: ChatModelOption[];
  currentModel: string | null;
  setChatModel: (model: string | null) => Promise<void>;
  agentPermissionMode: AgentPermissionMode;
  setChatAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  agentMessageAutoContinueEnabled: boolean;
  setAgentMessageAutoContinueEnabled: (enabled: boolean) => Promise<void>;
  agentSuggestionEnabled: boolean;
  setAgentSuggestionEnabled: (enabled: boolean) => Promise<void>;
  dockerSnapshotAfterAgentMessageEnabled: boolean;
  setDockerSnapshotAfterAgentMessageEnabled: (enabled: boolean) => Promise<void>;
  setChatInfoError: React.Dispatch<React.SetStateAction<string | null>>;
  modelDisabled: boolean;
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
  repoTransferPeers: RepoTransferPeer[];
  pullRepoChangesFromDrone: (sourceDroneId: string) => Promise<RepoTransferActionResult>;
  applyRepoChangesToDrone: (targetDroneId: string) => Promise<RepoTransferActionResult>;
  onRequestDropActions: (targetDroneId: string, sourceDroneIds: string[]) => { ok: boolean; error?: string | null };
  repoOp: { kind: 'pull' | 'push' | 'reseed' | 'pull-from-drone' | 'push-to-drone' } | null;
  headerOverflowRef: React.RefObject<HTMLDivElement | null>;
  reseedRepo: () => Promise<void>;
  terminalMenuRef: React.RefObject<HTMLDivElement | null>;
  terminalLabel: string;
  terminalOptions: Array<{ id: string; label: string }>;
  rightPanelOpen: boolean;
  setRightPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  requestRightPanelTab: (tab: RightPanelTab) => void;
  rightPanelSplit: boolean;
  rightPanelTabs: RightPanelTab[];
  rightPanelTab: RightPanelTab;
  setRightPanelTab: React.Dispatch<React.SetStateAction<RightPanelTab>>;
  rightPanelTabLabels: Record<RightPanelTab, string>;
  transcripts: TranscriptItem[] | null;
  visiblePendingPromptsWithStartup: PendingPrompt[];
  transcriptMessageId: (item: TranscriptItem) => string;
  parsingJobsByTurn: Record<number, unknown>;
  parseJobsFromAgentMessage: (opts: { turn: number; message: string }) => void;
  spawnDroneHubTaskFromAgentMessage: (opts: {
    sourceDroneId: string;
    sourceChatName: string;
    task: DroneHubTask;
    mode: DroneHubTaskSpawnMode;
  }) => Promise<{ ok: boolean; error?: string | null }>;
  latestAgentSuggestionTarget: TranscriptItem | null;
  latestAgentSuggestionState: AgentSuggestionState | null;
  requestAgentSuggestionForMessage: (item: TranscriptItem, opts?: { force?: boolean }) => Promise<void>;
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
  publishSelectedDraft: () => Promise<boolean>;
  publishingDraft: boolean;
  canStopResponse: boolean;
  requestStopResponse: () => Promise<void>;
  stoppingResponse: boolean;
  stopResponseError: string | null;
  requestCancelPendingPrompt: (promptId: string) => Promise<void>;
  cancellingPendingPromptById: Record<string, true>;
  cancelPendingPromptErrorById: Record<string, string>;
  openedEditorFileOpenFailureMessage: string | null;
  openedEditorFileOpenFailureAt: number | null;
  onOpenMarkdownFileReference: (ref: MarkdownFileReference) => void;
  rightPanelBottomTab: RightPanelTab;
  rightPanelOpenRequestSeq: number;
  renderRightPanelTabContent: (drone: DroneSummary, tab: RightPanelTab, pane: 'single' | 'top' | 'bottom') => React.ReactNode;
  onPersistentPreviewHostChange?: (state: {
    style: React.CSSProperties;
    activeDroneId: string | null;
    previewVisible: boolean;
  }) => void;
};

type ChatScrollSnapshot = {
  mode: 'transcript' | 'cli';
  scrollTop: number;
  scrollHeight: number;
};

export function SelectedDroneWorkspace({
  currentDrone,
  deleteMode,
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
  agentLocked,
  agentDisabled,
  agentLabel,
  chatRuntimeMetadataAvailable,
  modelControlEnabled,
  availableChatModels,
  currentModel,
  setChatModel,
  agentPermissionMode,
  setChatAgentPermissionMode,
  agentMessageAutoContinueEnabled,
  setAgentMessageAutoContinueEnabled,
  agentSuggestionEnabled,
  setAgentSuggestionEnabled,
  dockerSnapshotAfterAgentMessageEnabled,
  setDockerSnapshotAfterAgentMessageEnabled,
  setChatInfoError,
  modelDisabled,
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
  repoTransferPeers,
  pullRepoChangesFromDrone,
  applyRepoChangesToDrone,
  onRequestDropActions,
  repoOp,
  headerOverflowRef,
  reseedRepo,
  terminalMenuRef,
  terminalLabel,
  terminalOptions,
  rightPanelOpen,
  setRightPanelOpen,
  requestRightPanelTab,
  rightPanelTabs,
  rightPanelTab,
  setRightPanelTab,
  rightPanelTabLabels,
  transcripts,
  visiblePendingPromptsWithStartup,
  transcriptMessageId,
  parsingJobsByTurn,
  parseJobsFromAgentMessage,
  spawnDroneHubTaskFromAgentMessage,
  latestAgentSuggestionTarget,
  latestAgentSuggestionState,
  requestAgentSuggestionForMessage,
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
  publishSelectedDraft,
  publishingDraft,
  canStopResponse,
  requestStopResponse,
  stoppingResponse,
  stopResponseError,
  requestCancelPendingPrompt,
  cancellingPendingPromptById,
  cancelPendingPromptErrorById,
  openedEditorFileOpenFailureMessage,
  openedEditorFileOpenFailureAt,
  onOpenMarkdownFileReference,
  rightPanelOpenRequestSeq,
  renderRightPanelTabContent,
  onPersistentPreviewHostChange,
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
  const transcriptScrollRef = React.useRef<HTMLDivElement | null>(null);
  const workspaceChatScrollSnapshotRef = React.useRef<ChatScrollSnapshot | null>(null);
  const captureWorkspaceChatScroll = React.useCallback(() => {
    const mode = chatUiMode === 'transcript' ? 'transcript' : 'cli';
    const node = mode === 'transcript' ? transcriptScrollRef.current : outputScrollRef.current;
    if (!node) return;
    workspaceChatScrollSnapshotRef.current = {
      mode,
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
    };
  }, [chatUiMode, outputScrollRef]);
  const restoreWorkspaceChatScroll = React.useCallback(() => {
    const snapshot = workspaceChatScrollSnapshotRef.current;
    if (!snapshot) return;
    requestAnimationFrame(() => {
      const node = snapshot.mode === 'transcript' ? transcriptScrollRef.current : outputScrollRef.current;
      workspaceChatScrollSnapshotRef.current = null;
      if (!node) return;
      const heightDelta = node.scrollHeight - snapshot.scrollHeight;
      const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      node.scrollTop = Math.min(maxScrollTop, Math.max(0, snapshot.scrollTop + heightDelta));
      updatePinned(node);
    });
  }, [outputScrollRef, updatePinned]);
  const explicitSelectedChat = String(selectedChat ?? '').trim();
  const activeChatName = React.useMemo(
    () => explicitSelectedChat || resolveChatNameForDrone(currentDrone, selectedChat),
    [currentDrone, explicitSelectedChat, selectedChat],
  );
  const selectedChatIsDraft = currentDrone.draftChats?.[activeChatName] === true;
  const currentDroneHomePath = React.useMemo(() => droneHomePath(currentDrone), [currentDrone]);
  const spawnCurrentDroneHubTask = React.useCallback(
    (mode: DroneHubTaskSpawnMode, task: DroneHubTask) =>
      spawnDroneHubTaskFromAgentMessage({
        sourceDroneId: currentDrone.id,
        sourceChatName: activeChatName,
        task,
        mode,
      }),
    [activeChatName, currentDrone.id, spawnDroneHubTaskFromAgentMessage],
  );
  const hasChats = React.useMemo(
    () => Array.isArray(currentDrone.chats) && currentDrone.chats.some((chat) => String(chat ?? '').trim().length > 0),
    [currentDrone.chats],
  );
  const syncMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [syncMenuOpen, setSyncMenuOpen] = React.useState(false);
  useDropdownDismiss(syncMenuRef, syncMenuOpen, setSyncMenuOpen);
  React.useEffect(() => {
    setSyncMenuOpen(false);
  }, [currentDrone.id, repoOp?.kind]);
  const hostRuntime = String(currentDrone.runtime ?? '').trim().toLowerCase() === 'host';
  const dockerSnapshotSupported = !hostRuntime && currentDrone.persistVolume === false;
  const readOnlySupported = currentAgentKey === 'builtin:codex' || currentAgentKey === 'builtin:blip';
  const [dockerSizeState, setDockerSizeState] = React.useState<{
    droneId: string;
    loading: boolean;
    dockerSize: DockerSizeSummary | null;
    error: string | null;
  }>({ droneId: '', loading: false, dockerSize: null, error: null });
  React.useEffect(() => {
    const droneId = String(currentDrone.id ?? '').trim();
    const initialDockerSize = currentDrone.dockerSize ?? null;
    if (!droneId || hostRuntime) {
      setDockerSizeState({ droneId, loading: false, dockerSize: null, error: null });
      return;
    }

    const controller = new AbortController();
    setDockerSizeState({ droneId, loading: true, dockerSize: initialDockerSize, error: null });
    void requestJson<DockerSizePayload>(`/api/drones/${encodeURIComponent(droneId)}/docker-size`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setDockerSizeState({
          droneId,
          loading: false,
          dockerSize: data?.dockerSize ?? null,
          error: null,
        });
      })
      .catch((err: any) => {
        if (controller.signal.aborted) return;
        setDockerSizeState({
          droneId,
          loading: false,
          dockerSize: initialDockerSize,
          error: err?.message ?? String(err),
        });
      });

    return () => controller.abort();
  }, [currentDrone.id, hostRuntime]);
  const dockerSize = dockerSizeState.droneId === currentDrone.id ? dockerSizeState.dockerSize : (currentDrone.dockerSize ?? null);
  const dockerSizeLoading = dockerSizeState.droneId === currentDrone.id && dockerSizeState.loading;
  const dockerSizeError = dockerSizeState.droneId === currentDrone.id ? dockerSizeState.error : null;
  const dockerSizeTitle = (() => {
    if (dockerSize) {
      return `Docker tracked size: ${formatBytes(dockerSize.totalBytes)} current writable + unique snapshot layers. Current container writable layer: ${formatBytes(
        dockerSize.containerWritableBytes,
      )}. Snapshot unique layers: ${formatBytes(dockerSize.snapshotBytes)} across ${
        dockerSize.snapshotCount
      } snapshot${dockerSize.snapshotCount === 1 ? '' : 's'}${
        dockerSize.snapshotVirtualBytes != null
          ? ` (${formatBytes(dockerSize.snapshotVirtualBytes)} summed virtual image size; virtual sizes include shared base layers repeatedly).`
          : '.'
      }`;
    }
    if (dockerSizeLoading) return 'Docker size loading.';
    if (dockerSizeError) return `Docker size unavailable: ${dockerSizeError}`;
    return 'Docker size unavailable.';
  })();
  const dockerSizeLabel =
    dockerSizeLoading && !dockerSize
      ? 'Docker size loading'
      : dockerSize
        ? `Docker used ${formatBytes(dockerSize.totalBytes)}`
        : 'Docker size unavailable';
  const repoSyncBusyLabel =
    repoOp?.kind === 'pull'
      ? 'Applying...'
      : repoOp?.kind === 'push'
        ? 'Pulling host...'
        : repoOp?.kind === 'pull-from-drone'
          ? 'Pulling drone...'
          : repoOp?.kind === 'push-to-drone'
            ? 'Applying to drone...'
            : repoOp?.kind === 'reseed'
              ? 'Reseeding...'
              : 'Sync...';
  const syncDisabled =
    isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal) || Boolean(repoOp);
  const {
    fleetBadgeAssigning,
    fleetBadgeDropActive,
    fleetBadgeError,
    fleetBadgeSummaryText,
    fleetBadgeTitle,
    fleetDropHintVisible,
    fleetDropHintText,
    onFleetDropDragLeave,
    onFleetDropDragOver,
    onFleetDropDrop,
    setFleetDropNodeRef,
  } = useFleetAssignmentDropState({
    currentDrone,
    currentDroneLabel,
    openDroneErrorModal,
    onRequestDropActions,
  });
  const compactRepoPath = String(currentDrone.repoPath ?? '').trim();
  const compactRepoLabel = compactRepoPath ? repoPathLabel(compactRepoPath) : '';
  const compactTranscriptRuntime = latestTranscriptRuntime(transcripts);
  const compactModel = resolveDisplayedChatModel(
    currentModel,
    availableChatModels,
    loadingChatModels,
    modelControlEnabled,
    compactTranscriptRuntime.model,
  );
  const compactModelTitle = displayedChatModelTitle(compactModel, compactTranscriptRuntime.reasoning);
  const compactAgentModelLabel = formatAgentModelMetadata(agentLabel, compactModel, compactTranscriptRuntime.reasoning);
  const showCompactRuntimeMetadata = hasChats && chatRuntimeMetadataAvailable;
  const currentDroneIsDraft = currentDrone.draft === true || currentDrone.hubPhase === 'draft';
  const currentChatIsDraft = currentDroneIsDraft || selectedChatIsDraft;
  const nativeChatActive = currentAgentKey === 'native' && !currentChatIsDraft;
  const chatConfigResolution = chatConfigResolutionState({
    currentChatIsDraft,
    hasChats,
    metadataAvailable: chatRuntimeMetadataAvailable,
    loading: loadingChatInfo,
  });
  const chatConfigPending = chatConfigResolution === 'loading';
  const chatConfigFailed = chatConfigResolution === 'unavailable';
  const genericChatActive =
    !nativeChatActive &&
    !chatConfigFailed &&
    (currentChatIsDraft || !hasChats || chatRuntimeMetadataAvailable);
  const [nativeHistoryObserved, setNativeHistoryObserved] = React.useState(false);
  React.useEffect(() => {
    setNativeHistoryObserved(false);
  }, [currentAgentKey, currentDrone.id, activeChatName]);
  const effectiveAgentLocked = agentLocked || nativeHistoryObserved;
  const showFleetBadge =
    fleetBadgeAssigning ||
    fleetBadgeDropActive ||
    (!currentDroneIsDraft && (Boolean(fleetBadgeError) || /\b[1-9]\d*\b/.test(fleetBadgeSummaryText)));
  const selectedChatDockerSnapshotBusy = React.useMemo(
    () =>
      (transcripts ?? []).some((item) => {
        const status = String(item?.dockerSnapshot?.status ?? '').trim();
        return status === 'creating' || status === 'restoring';
      }),
    [transcripts],
  );
  const chatInputWaiting = currentChatIsDraft
    ? false
    : chatUiMode === 'transcript'
      ? selectedChatDockerSnapshotBusy || visiblePendingPromptsWithStartup.some((p) => p.state !== 'failed')
      : (showRespondingAsStatusInHeader || canStopResponse);
  const openChatErrorDetails = React.useCallback(() => {
    const message = String(chatInfoError ?? '').trim();
    if (!message) return;
    openDroneErrorModal(currentDrone, message, null);
  }, [chatInfoError, currentDrone, openDroneErrorModal]);
  const reportChatMutationError = React.useCallback(
    (action: string, error: unknown) => {
      const status = Number((error as any)?.status ?? 0);
      const reason = String((error as any)?.message ?? error ?? '').trim() || 'Unknown error.';
      const statusLabel = Number.isFinite(status) && status > 0 ? ` [HTTP ${status}]` : '';
      const missingEndpointHint =
        status === 404 && /^404\b/i.test(reason)
          ? ' (chat management endpoint may be unavailable; restart hub on latest build)'
          : '';
      const message = `${action} failed${statusLabel}: ${reason}${missingEndpointHint}`;
      setChatInfoError(message);
      openDroneErrorModal(currentDrone, message, null);
    },
    [currentDrone, openDroneErrorModal, setChatInfoError],
  );
  const chatDraftKey = React.useMemo(
    () => chatInputDraftKeyForDroneChat(currentDrone.id, activeChatName),
    [activeChatName, currentDrone.id],
  );
  const chatDraftValue = useDroneHubUiStore((s) => s.chatInputDrafts[chatDraftKey] ?? '');
  const setChatInputDraft = useDroneHubUiStore((s) => s.setChatInputDraft);
  const [sendingDirectAgentSuggestion, setSendingDirectAgentSuggestion] = React.useState(false);
  const automations = useDroneHubUiStore((s) => s.automations);
  const {
    promptAutomationJob,
    automationModeHint,
    cancelQueuedAutomationErrorById,
    cancellingQueuedAutomationById,
    cancelQueuedPromptAutomation,
    chatAutomationActions,
    queuedAutomationItems,
    startPromptAutomationLaunch,
    stopPromptAutomation,
    stoppingPromptAutomationMode,
    stopPromptAutomationError,
  } = usePromptAutomationState({
    droneId: currentDrone.id,
    chatName: activeChatName,
    chatUiMode: nativeChatActive ? 'transcript' : chatUiMode,
    automations,
  });
  const sendChatAutomation = React.useCallback(
    async (payload: ChatDraftAutomationPayload): Promise<boolean> => {
      try {
        const launch = createDraftChatAutomationLaunch({
          prompt: payload.prompt,
          runs: payload.runs,
          sleepAmount: payload.sleepAmount,
          sleepUnit: payload.sleepUnit,
        });
        return await startPromptAutomationLaunch(launch);
      } catch {
        return false;
      }
    },
    [startPromptAutomationLaunch],
  );
  const transcriptRenderBlocks = React.useMemo<TranscriptRenderBlock[]>(
    () => buildTranscriptRenderBlocks(transcripts ?? []),
    [transcripts],
  );
  const latestAgentSuggestionMessageId = React.useMemo(
    () => (latestAgentSuggestionTarget ? transcriptMessageId(latestAgentSuggestionTarget) : null),
    [latestAgentSuggestionTarget, transcriptMessageId],
  );
  const latestAgentSuggestionPromptId = React.useMemo(() => {
    const explicit = String(latestAgentSuggestionTarget?.id ?? '').trim();
    return explicit || null;
  }, [latestAgentSuggestionTarget]);
  const latestAgentSuggestionUsedDirectAt = React.useMemo(() => {
    const value = String(latestAgentSuggestionTarget?.agentSuggestion?.usedDirectAt ?? '').trim();
    return value || null;
  }, [latestAgentSuggestionTarget]);
  const latestAgentSuggestionKindLabel = React.useMemo(() => {
    if (!latestAgentSuggestionState || latestAgentSuggestionState.status !== 'ready') return null;
    const raw = String(latestAgentSuggestionState.kind ?? '').trim();
    if (!raw) return null;
    return raw.replace(/[-_]+/g, ' ');
  }, [latestAgentSuggestionState]);
  const showLatestAgentSuggestion = latestAgentSuggestionState?.status !== 'suppressed';

  React.useEffect(() => {
    setSendingDirectAgentSuggestion(false);
  }, [currentDrone.id, activeChatName, latestAgentSuggestionMessageId, agentSuggestionEnabled]);

  const editAgentSuggestionDraft = React.useCallback(() => {
    if (!latestAgentSuggestionTarget || latestAgentSuggestionState?.status !== 'ready') return;
    setChatInputDraft(chatDraftKey, latestAgentSuggestionState.suggestion);
  }, [chatDraftKey, latestAgentSuggestionState, latestAgentSuggestionTarget, setChatInputDraft]);

  const markAgentSuggestionUsedDirect = React.useCallback(
    async (candidate: { promptId: string; suggestion: string; policyFingerprint: string }) => {
      await requestJson(
        `/api/drones/${encodeURIComponent(currentDrone.id)}/chats/${encodeURIComponent(activeChatName)}/transcript/${encodeURIComponent(
          candidate.promptId,
        )}/agent-suggestion/used-direct`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            suggestion: candidate.suggestion,
            policyFingerprint: candidate.policyFingerprint,
          }),
        },
      );
    },
    [activeChatName, currentDrone.id],
  );
  const rollbackDockerSnapshot = React.useCallback(
    async (item: TranscriptItem): Promise<void> => {
      const promptId = String(item?.id ?? '').trim();
      const snapshotId = String(item?.dockerSnapshot?.id ?? '').trim();
      if (!promptId || !snapshotId) return;
      try {
        setChatInfoError(null);
        await requestJson(
          `/api/drones/${encodeURIComponent(currentDrone.id)}/chats/${encodeURIComponent(activeChatName)}/transcript/${encodeURIComponent(
            promptId,
          )}/docker-snapshot/${encodeURIComponent(snapshotId)}/rollback`,
          { method: 'POST' },
        );
      } catch (err: any) {
        const message = String(err?.message ?? err ?? '').trim() || 'Snapshot rollback failed.';
        setChatInfoError(message);
        openDroneErrorModal(currentDrone, message, null);
      }
    },
    [activeChatName, currentDrone, openDroneErrorModal, setChatInfoError],
  );
  const sendAgentSuggestionDirectly = React.useCallback(async (): Promise<void> => {
    if (
      !latestAgentSuggestionTarget ||
      latestAgentSuggestionState?.status !== 'ready' ||
      sendingDirectAgentSuggestion
    ) {
      return;
    }
    const candidate = {
      promptId: latestAgentSuggestionPromptId,
      suggestion: latestAgentSuggestionState.suggestion,
      policyFingerprint: latestAgentSuggestionState.policyFingerprint,
    };
    setSendingDirectAgentSuggestion(true);
    try {
      const sent = await sendPromptText({
        prompt: candidate.suggestion,
        attachments: [],
      });
      if (!sent) {
        setChatInputDraft(chatDraftKey, candidate.suggestion);
        return;
      }
      if (candidate.promptId) {
        try {
          await markAgentSuggestionUsedDirect({
            promptId: candidate.promptId,
            suggestion: candidate.suggestion,
            policyFingerprint: candidate.policyFingerprint,
          });
        } catch {
          // Ignore analytics write failures; the prompt already sent successfully.
        }
      }
    } finally {
      setSendingDirectAgentSuggestion(false);
    }
  }, [
    chatDraftKey,
    latestAgentSuggestionPromptId,
    latestAgentSuggestionState,
    latestAgentSuggestionTarget,
    markAgentSuggestionUsedDirect,
    sendPromptText,
    sendingDirectAgentSuggestion,
    setChatInputDraft,
  ]);
  const { pendingPromptLoopGroups, pendingPlainPrompts } = React.useMemo(
    () => {
      const built = buildPendingPromptLoopGroups(visiblePendingPromptsWithStartup);
      return {
        pendingPromptLoopGroups: built.groups,
        pendingPlainPrompts: built.plainPendingPrompts,
      };
    },
    [visiblePendingPromptsWithStartup],
  );
  const transcriptTimelineBlocks = React.useMemo<TranscriptTimelineBlock[]>(
    () =>
      buildTranscriptTimelineBlocks({
        transcriptRenderBlocks,
        pendingPlainPrompts,
      }),
    [pendingPlainPrompts, transcriptRenderBlocks],
  );
  const pendingPromptLoopByIdentity = React.useMemo(() => {
    const out = new Map<string, PendingPrompt[]>();
    for (const group of pendingPromptLoopGroups) out.set(group.identity, group.pendingRuns);
    return out;
  }, [pendingPromptLoopGroups]);
  const pendingOnlyPromptLoopGroups = React.useMemo(() => {
    const transcriptIdentities = new Set<string>();
    for (const block of transcriptRenderBlocks) {
      if (block.kind !== 'prompt-loop-group') continue;
      transcriptIdentities.add(block.identity);
    }
    return pendingPromptLoopGroups.filter((group) => !transcriptIdentities.has(group.identity));
  }, [pendingPromptLoopGroups, transcriptRenderBlocks]);
  const runningAutomationJobKey = String(promptAutomationJob?.running ? promptAutomationJob?.jobKey ?? '' : '').trim();
  const runningAutomationIdentity = React.useMemo(() => {
    return resolveRunningPromptLoopIdentity({
      job: promptAutomationJob,
      transcriptRenderBlocks,
      pendingPromptLoopGroups,
    });
  }, [pendingPromptLoopGroups, promptAutomationJob, transcriptRenderBlocks]);
  const runningAutomationProgressLabel = React.useMemo(() => {
    if (!promptAutomationJob?.running) return '';
    const completed = Math.max(0, Number(promptAutomationJob.runsCompleted ?? 0) || 0);
    const total = Math.max(0, Number(promptAutomationJob.runsTotal ?? 0) || 0);
    return `Running ${completed}/${total}`;
  }, [promptAutomationJob]);
  const currentAutomationCardStatus = React.useMemo(
    () => currentPromptAutomationDisplayStatus(promptAutomationJob),
    [promptAutomationJob],
  );
  const runningAutomationHasRenderedGroup = Boolean(promptAutomationJob?.running && runningAutomationIdentity);
  const pendingTimelineBlocks = React.useMemo(() => {
    return buildPendingTimelineBlocks({
      pendingOnlyPromptLoopGroups,
      pendingPlainPrompts: [],
      queuedAutomationItems,
      promptAutomationJob,
      runningAutomationIdentity,
      runningAutomationHasRenderedGroup,
      runningAutomationJobKey,
    });
  }, [
    pendingOnlyPromptLoopGroups,
    promptAutomationJob,
    runningAutomationIdentity,
    queuedAutomationItems,
    runningAutomationHasRenderedGroup,
    runningAutomationJobKey,
  ]);
  const chatTimelineBlocks = React.useMemo(
    () =>
      buildChatTimelineBlocks({
        transcriptTimelineBlocks,
        pendingTimelineBlocks,
        runningAutomationIdentity,
      }),
    [pendingTimelineBlocks, runningAutomationIdentity, transcriptTimelineBlocks],
  );
  const visibleCliPendingPrompts = React.useMemo(() => {
    if (chatUiMode !== 'cli') return [];
    return visiblePendingPromptsWithStartup.filter((item) => item.state !== 'failed').slice(-3);
  }, [chatUiMode, visiblePendingPromptsWithStartup]);
  const queuedAutomationById = React.useMemo(() => {
    const out = new Map<string, (typeof queuedAutomationItems)[number]>();
    for (const item of queuedAutomationItems) {
      const id = String(item.queueId ?? '').trim();
      if (!id) continue;
      out.set(id, item);
    }
    return out;
  }, [queuedAutomationItems]);
  const runningPromptLoopHeaderActions = React.useMemo(() => {
    if (!promptAutomationJob?.running) return null;
    const stopAllBusy = stoppingPromptAutomationMode === 'all';
    const stopRunsOnlyBusy = stoppingPromptAutomationMode === 'runs-only';
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => stopPromptAutomation({ mode: 'all', clearQueued: false })}
          disabled={stopAllBusy || stopRunsOnlyBusy}
          className={`inline-flex items-center h-6 px-2 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
            stopAllBusy || stopRunsOnlyBusy
              ? 'opacity-100 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)]'
              : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--red)] hover:border-[var(--red-border)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
          title="Stop remaining runs and skip final message"
        >
          {stopAllBusy ? 'Stopping...' : 'Stop all'}
        </button>
        <button
          type="button"
          onClick={() => stopPromptAutomation({ mode: 'runs-only', clearQueued: false })}
          disabled={stopAllBusy || stopRunsOnlyBusy}
          className={`inline-flex items-center h-6 px-2 rounded border text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
            stopAllBusy || stopRunsOnlyBusy
              ? 'opacity-100 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)]'
              : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
          title="Stop remaining runs and still send final message when possible"
        >
          {stopRunsOnlyBusy ? 'Stopping...' : 'Stop runs only'}
        </button>
      </div>
    );
  }, [promptAutomationJob, stopPromptAutomation, stoppingPromptAutomationMode]);
  const queuedAutomationStatusContent = (queued: (typeof queuedAutomationItems)[number]) => {
    const queueId = String(queued.queueId ?? '').trim();
    return (
      <AutomationLaneStatusCard
        status="queued"
        automationLabel={
          String(queued.automationLabel ?? '').trim() ||
          String(queued.automationId ?? '').trim() ||
          'Automation'
        }
        runsTotal={Number(queued.runsTotal ?? 0) || 0}
        atIso={queued.enqueuedAt}
        queueId={queueId}
        cancelBusy={Boolean(cancellingQueuedAutomationById[queueId])}
        cancelError={cancelQueuedAutomationErrorById[queueId] ?? null}
        onCancelQueued={cancelQueuedPromptAutomation}
      />
    );
  };
  const runningAutomationStatusContent = promptAutomationJob?.running ? (
    <AutomationLaneStatusCard
      status={currentAutomationCardStatus}
      automationLabel={String(promptAutomationJob.automationLabel ?? '').trim() || 'Automation'}
      runsTotal={Number(promptAutomationJob.runsTotal ?? 0) || 0}
      runsCompleted={Number(promptAutomationJob.runsCompleted ?? 0) || 0}
      atIso={promptAutomationJob.startedAt ?? promptAutomationJob.updatedAt}
      stopAllBusy={stoppingPromptAutomationMode === 'all'}
      stopRunsOnlyBusy={stoppingPromptAutomationMode === 'runs-only'}
      stopError={stopPromptAutomationError}
      onStopAll={() => stopPromptAutomation({ mode: 'all', clearQueued: false })}
      onStopRunsOnly={() => stopPromptAutomation({ mode: 'runs-only', clearQueued: false })}
    />
  ) : null;
  const nativeAutomationTranscriptItems: AgentChatTranscriptItem[] = [];
  if (runningAutomationStatusContent) {
    nativeAutomationTranscriptItems.push({
      key: `native-automation-running:${String(promptAutomationJob?.jobKey ?? 'current')}`,
      kind: 'automation',
      content: runningAutomationStatusContent,
    });
  }
  for (const queued of queuedAutomationItems) {
    const queueId = String(queued.queueId ?? '').trim();
    if (!queueId) continue;
    nativeAutomationTranscriptItems.push({
      key: `native-automation-queued:${queueId}`,
      kind: 'automation',
      content: queuedAutomationStatusContent(queued),
    });
  }
  const shouldAutoFocusInput = React.useMemo(() => {
    if (chatUiMode === 'transcript') {
      return !loadingTranscript && (transcripts?.length ?? 0) === 0 && visiblePendingPromptsWithStartup.length === 0;
    }
    return !loadingSession && !sessionText.trim();
  }, [
    chatUiMode,
    loadingSession,
    loadingTranscript,
    sessionText,
    transcripts,
    visiblePendingPromptsWithStartup.length,
  ]);
  const [workspaceLayoutResetNonce, setWorkspaceLayoutResetNonce] = React.useState(0);
  const [workspaceLayoutScope, setWorkspaceLayoutScopeState] = React.useState<WorkspaceLayoutScope>(() => readWorkspaceLayoutScope());
  const [workspacePaneHeaderMode, setWorkspacePaneHeaderModeState] = React.useState<WorkspacePaneHeaderMode>(() => readWorkspacePaneHeaderMode());
  const [droneControlsExpanded, setDroneControlsExpanded] = React.useState(false);
  React.useEffect(() => {
    if (
      !droneControlsExpanded ||
      !modelControlEnabled ||
      availableChatModels.length > 0 ||
      loadingChatModels ||
      chatModelsError ||
      chatModelsDiscoveredAt
    ) {
      return;
    }
    setChatModelsRefreshNonce((nonce) => nonce + 1);
  }, [
    activeChatName,
    availableChatModels.length,
    chatModelsDiscoveredAt,
    chatModelsError,
    currentAgentKey,
    currentDrone.id,
    droneControlsExpanded,
    loadingChatModels,
    modelControlEnabled,
    setChatModelsRefreshNonce,
  ]);

  const openPullRequestsTab = React.useCallback(() => {
    requestRightPanelTab('prs');
  }, [requestRightPanelTab]);
  const quickOpenTabUrl = resolveDroneOpenTabUrl(currentDrone);
  const quickOpenTabDisabled = isDroneStartingOrSeeding(currentDrone.hubPhase) || !quickOpenTabUrl;
  const [fileOpenToast, setFileOpenToast] = React.useState<{ id: number; message: string } | null>(null);
  const [transcriptExportToast, setTranscriptExportToast] = React.useState<string | null>(null);
  const [exportingTranscript, setExportingTranscript] = React.useState(false);
  const transcriptExportToastTimerRef = React.useRef<number | null>(null);
  const repoIdentityRef = React.useRef<{ owner: string; repo: string } | null>(null);
  const pullRequestSummary = useHeaderRepoPullRequestSummary({
    droneId: currentDrone.id,
    repoPath: currentDroneRepoPath,
    repoAttached: currentDroneRepoAttached,
    disabled: isDroneStartingOrSeeding(currentDrone.hubPhase),
  });
  const linkedPullRequestContext = React.useMemo(
    () => ({
      droneId: currentDrone.id,
      repoPath: currentDroneRepoPath,
      repoAttached: currentDroneRepoAttached,
      disabled: isDroneStartingOrSeeding(currentDrone.hubPhase),
      openPullRequestsData: pullRequestSummary.pullRequestsData,
      openPullRequestsLoading: pullRequestSummary.loading,
      openPullRequestsError: pullRequestSummary.error,
    }),
    [
      currentDrone.hubPhase,
      currentDrone.id,
      currentDroneRepoAttached,
      currentDroneRepoPath,
      pullRequestSummary.error,
      pullRequestSummary.loading,
      pullRequestSummary.pullRequestsData,
    ],
  );
  const openPullRequestCount = React.useMemo(() => {
    const count = Number(pullRequestSummary.pullRequestsData?.count ?? 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }, [pullRequestSummary.pullRequestsData]);
  const availableTranscriptItems = React.useMemo(() => (Array.isArray(transcripts) ? transcripts : []), [transcripts]);
  const transcriptExportDisabled =
    chatUiMode !== 'transcript' || loadingTranscript || exportingTranscript || availableTranscriptItems.length === 0;

  const showTranscriptExportToast = React.useCallback((message: string) => {
    setTranscriptExportToast(message);
    if (transcriptExportToastTimerRef.current != null) {
      clearTimeout(transcriptExportToastTimerRef.current);
    }
    transcriptExportToastTimerRef.current = window.setTimeout(() => {
      setTranscriptExportToast((current) => (current === message ? null : current));
      transcriptExportToastTimerRef.current = null;
    }, 2200);
  }, []);

  const buildTranscriptExportArgs = React.useCallback(
    (exportedAt: string, exportTranscripts: TranscriptItem[] = availableTranscriptItems) => ({
      droneId: currentDrone.id,
      droneName: currentDrone.name,
      droneLabel: currentDroneLabel,
      chatName: activeChatName,
      exportedAt,
      transcripts: exportTranscripts,
    }),
    [activeChatName, availableTranscriptItems, currentDrone.id, currentDrone.name, currentDroneLabel],
  );

  const loadTranscriptForExport = React.useCallback(async (): Promise<TranscriptItem[]> => {
    setExportingTranscript(true);
    try {
      return await fetchDroneChatTranscript(requestJson, {
        droneId: currentDrone.id,
        chatName: activeChatName,
        turn: 'all',
      });
    } finally {
      setExportingTranscript(false);
    }
  }, [activeChatName, currentDrone.id, requestJson]);

  const copyTranscriptMarkdown = React.useCallback(async () => {
    if (transcriptExportDisabled) return;
    try {
      const fullTranscript = await loadTranscriptForExport();
      const exportedAt = new Date().toISOString();
      const markdown = formatTranscriptMarkdown(buildTranscriptExportArgs(exportedAt, fullTranscript));
      await copyText(markdown);
      showTranscriptExportToast('Transcript copied as Markdown.');
    } catch (error: any) {
      showTranscriptExportToast(error?.message ?? 'Unable to load the full transcript.');
    }
  }, [buildTranscriptExportArgs, loadTranscriptForExport, showTranscriptExportToast, transcriptExportDisabled]);

  const downloadTranscriptJson = React.useCallback(async () => {
    if (transcriptExportDisabled) return;
    try {
      const fullTranscript = await loadTranscriptForExport();
      const exportedAt = new Date().toISOString();
      const json = formatTranscriptJson(buildTranscriptExportArgs(exportedAt, fullTranscript));
      downloadTextFile({
        filename: buildTranscriptExportFilename({
          droneLabel: currentDroneLabel,
          droneName: currentDrone.name,
          chatName: activeChatName,
          exportedAt,
          extension: 'json',
        }),
        text: json,
        mimeType: 'application/json;charset=utf-8',
      });
      showTranscriptExportToast('Transcript downloaded as JSON.');
    } catch (error: any) {
      showTranscriptExportToast(error?.message ?? 'Unable to load the full transcript.');
    }
  }, [
    activeChatName,
    buildTranscriptExportArgs,
    currentDrone.name,
    currentDroneLabel,
    loadTranscriptForExport,
    showTranscriptExportToast,
    transcriptExportDisabled,
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
    if (!currentDroneRepoAttached || isDroneStartingOrSeeding(currentDrone.hubPhase) || !currentDroneRepoPath.trim()) {
      repoIdentityRef.current = null;
      return;
    }
    const data = pullRequestSummary.pullRequestsData;
    if (!data) {
      repoIdentityRef.current = null;
      return;
    }
    const owner = String(data?.github?.owner ?? '').trim().toLowerCase();
    const repo = String(data?.github?.repo ?? '').trim().toLowerCase();
    repoIdentityRef.current = owner && repo ? { owner, repo } : null;
  }, [currentDrone.hubPhase, currentDroneRepoAttached, currentDroneRepoPath, pullRequestSummary.pullRequestsData]);

  React.useEffect(
    () => () => {
      if (transcriptExportToastTimerRef.current != null) {
        clearTimeout(transcriptExportToastTimerRef.current);
        transcriptExportToastTimerRef.current = null;
      }
    },
    [],
  );

  const tryOpenMarkdownPullRequest = React.useCallback(
    (href: string): boolean => {
      const parsed = parseGithubPullRequestHref(href);
      if (!parsed) return false;
      if (!currentDroneRepoAttached) return false;
      if (isDroneStartingOrSeeding(currentDrone.hubPhase)) return false;
      const knownRepo = repoIdentityRef.current;
      if (knownRepo && (knownRepo.owner !== parsed.owner || knownRepo.repo !== parsed.repo)) return false;
      requestRightPanelTab('prs');
      requestChangesPullRequest({ droneId: currentDrone.id, pullNumber: parsed.pullNumber });
      return true;
    },
    [currentDrone.hubPhase, currentDrone.id, currentDroneRepoAttached, requestRightPanelTab],
  );

  const openWorkspacePane = React.useCallback(
    (tab: RightPanelTab) => {
      requestRightPanelTab(tab);
    },
    [requestRightPanelTab],
  );

  const resetWorkspaceLayout = React.useCallback(() => {
    setWorkspaceLayoutResetNonce((nonce) => nonce + 1);
  }, []);
  const setWorkspaceLayoutScope = React.useCallback((next: WorkspaceLayoutScope) => {
    setWorkspaceLayoutScopeState(next);
    writeWorkspaceLayoutScope(next);
  }, []);
  const setWorkspacePaneHeaderMode = React.useCallback((next: WorkspacePaneHeaderMode) => {
    setWorkspacePaneHeaderModeState(next);
    writeWorkspacePaneHeaderMode(next);
  }, []);
  const toggleDroneControlsExpanded = React.useCallback(() => {
    setDroneControlsExpanded((expanded) => {
      const next = !expanded;
      if (!next) {
        setAgentMenuOpen(false);
        setTerminalMenuOpen(false);
        setHeaderOverflowOpen(false);
        setSyncMenuOpen(false);
      }
      return next;
    });
  }, [setAgentMenuOpen, setHeaderOverflowOpen, setTerminalMenuOpen]);

  const externalComposerControls: ChatComposerControlsConfig | undefined =
    hasChats && modelControlEnabled
      ? {
          onboardingId: 'chat.composer.model',
          controls: [
            {
              kind: 'model-picker',
              id: 'external-model',
              currentProvider: 'external',
              currentModel: currentModel ?? '',
              options: [
                { provider: 'external', id: '', name: 'Default model' },
                ...availableChatModels.map((model) => ({
                  provider: 'external',
                  id: model.id,
                  name: model.label,
                })),
              ],
              title: 'Choose model',
              disabled: modelDisabled,
              showReasoning: false,
              searchable: true,
              searchPlaceholder: 'Search models',
              onSelect: (choice) => {
                void setChatModel(choice.id || null).catch((err: any) =>
                  setChatInfoError(err?.message ?? String(err)),
                );
              },
            },
            ...(availableChatModels.length === 0
              ? [
                  {
                    kind: 'text' as const,
                    id: 'external-model-manual',
                    value: manualChatModelInput,
                    placeholder: 'Model id',
                    title: 'Type a model id and press Enter',
                    disabled: modelDisabled,
                    onValueChange: setManualChatModelInput,
                    onSubmit: applyManualChatModel,
                  },
                  {
                    kind: 'button' as const,
                    id: 'external-model-apply',
                    label: 'Set',
                    title: 'Use this model for the chat',
                    disabled: modelDisabled,
                    onSelect: applyManualChatModel,
                  },
                ]
              : []),
            {
              kind: 'button',
              id: 'external-model-refresh',
              label: 'Refresh',
              title: chatModelsError
                ? `Refresh model list: ${chatModelsError}`
                : 'Refresh model list from the agent CLI',
              disabled: modelDisabled || loadingChatModels,
              active: loadingChatModels,
              icon: 'refresh',
              onSelect: () => setChatModelsRefreshNonce((nonce) => nonce + 1),
            },
          ],
        }
      : undefined;

  const latestExternalAgentBlockKey = React.useMemo(() => {
    for (let index = chatTimelineBlocks.length - 1; index >= 0; index -= 1) {
      const entry = chatTimelineBlocks[index];
      if (entry?.source !== 'transcript') continue;
      if (entry.block.kind === 'turn' || entry.block.kind === 'prompt-loop-group') {
        return entry.block.key;
      }
    }
    return '';
  }, [chatTimelineBlocks]);
  const externalTranscriptItems: AgentChatTranscriptItem[] = [];
  for (const entry of chatTimelineBlocks) {
    if (entry.source === 'transcript') {
      const block = entry.block;
      if (block.kind === 'pending-prompt') {
        const prompt = block.item;
        externalTranscriptItems.push({
          key: block.key,
          kind: 'pending',
          content: (
            <PendingTranscriptTurn
              item={prompt}
              showRoleIcons={false}
              onCancelQueued={requestCancelPendingPrompt}
              onOpenFileReference={onOpenMarkdownFileReference}
              onOpenLink={tryOpenMarkdownPullRequest}
              droneId={currentDrone.id}
              droneHomePath={currentDroneHomePath}
              cancelBusy={Boolean(cancellingPendingPromptById[prompt.id])}
              cancelError={cancelPendingPromptErrorById[prompt.id] ?? null}
            />
          ),
        });
        continue;
      }
      if (block.kind === 'prompt-loop-group') {
        const runningGroup =
          Boolean(promptAutomationJob?.running) &&
          Boolean(runningAutomationIdentity) &&
          block.identity === runningAutomationIdentity;
        externalTranscriptItems.push({
          key: block.key,
          kind: 'automation',
          content: (
            <PromptLoopTranscriptGroup
              runs={block.runs}
              pendingRuns={pendingPromptLoopByIdentity.get(block.identity) ?? []}
              autoExpandLatestAgentMessage={block.key === latestExternalAgentBlockKey}
              headerBadgeLabel={runningGroup ? runningAutomationProgressLabel : undefined}
              headerBadgeTone={runningGroup ? 'running' : undefined}
              headerActions={runningGroup ? runningPromptLoopHeaderActions : undefined}
              headerError={runningGroup ? stopPromptAutomationError : null}
              onOpenFileReference={onOpenMarkdownFileReference}
              onOpenLink={tryOpenMarkdownPullRequest}
              linkedPullRequestContext={linkedPullRequestContext}
            />
          ),
        });
        continue;
      }
      const messageId = transcriptMessageId(block.item);
      externalTranscriptItems.push({
        key: block.key,
        kind: 'message',
        content: (
          <TranscriptTurn
            item={block.item}
            autoExpandAgentMessage={block.key === latestExternalAgentBlockKey}
            parsingJobs={Boolean(parsingJobsByTurn[block.item.turn])}
            onCreateJobs={parseJobsFromAgentMessage}
            onSpawnDroneHubTask={spawnCurrentDroneHubTask}
            messageId={messageId}
            onRollbackDockerSnapshot={rollbackDockerSnapshot}
            onOpenFileReference={onOpenMarkdownFileReference}
            onOpenLink={tryOpenMarkdownPullRequest}
            linkedPullRequestContext={linkedPullRequestContext}
            droneId={currentDrone.id}
            droneHomePath={currentDroneHomePath}
            showRoleIcons={false}
            dockerSnapshotsEnabled={dockerSnapshotAfterAgentMessageEnabled}
          />
        ),
      });
      continue;
    }

    const block = entry.block;
    if (block.kind === 'pending-prompt') {
      const prompt = block.item;
      externalTranscriptItems.push({
        key: block.key,
        kind: 'pending',
        content: (
          <PendingTranscriptTurn
            item={prompt}
            showRoleIcons={false}
            onCancelQueued={requestCancelPendingPrompt}
            onOpenFileReference={onOpenMarkdownFileReference}
            onOpenLink={tryOpenMarkdownPullRequest}
            droneId={currentDrone.id}
            droneHomePath={currentDroneHomePath}
            cancelBusy={Boolean(cancellingPendingPromptById[prompt.id])}
            cancelError={cancelPendingPromptErrorById[prompt.id] ?? null}
          />
        ),
      });
      continue;
    }
    if (block.kind === 'prompt-loop-group') {
      const runningGroup =
        Boolean(promptAutomationJob?.running) &&
        Boolean(runningAutomationIdentity) &&
        block.identity === runningAutomationIdentity;
      externalTranscriptItems.push({
        key: block.key,
        kind: 'automation',
        content: (
          <PromptLoopTranscriptGroup
            runs={[]}
            pendingRuns={block.pendingRuns}
            headerBadgeLabel={runningGroup ? runningAutomationProgressLabel : undefined}
            headerBadgeTone={runningGroup ? 'running' : undefined}
            headerActions={runningGroup ? runningPromptLoopHeaderActions : undefined}
            headerError={runningGroup ? stopPromptAutomationError : null}
            onOpenFileReference={onOpenMarkdownFileReference}
            onOpenLink={tryOpenMarkdownPullRequest}
            linkedPullRequestContext={linkedPullRequestContext}
          />
        ),
      });
      continue;
    }
    if (block.kind === 'queued-automation') {
      const queued = queuedAutomationById.get(block.queueId);
      if (!queued) continue;
      externalTranscriptItems.push({
        key: block.key,
        kind: 'automation',
        content: queuedAutomationStatusContent(queued),
      });
      continue;
    }
    if (!runningAutomationStatusContent) continue;
    externalTranscriptItems.push({
      key: block.key,
      kind: 'automation',
      content: runningAutomationStatusContent,
    });
  }
  externalTranscriptItems.push({
    key: 'external-chat-end',
    kind: 'sentinel',
    content: <div ref={chatEndRef as React.RefObject<HTMLDivElement>} />,
  });

  return (
    <>
      {/* Header - spans full workspace width */}
      <DroneWorkspaceHeaderFrame selectedHeader>
        <div className="flex h-full items-center px-4">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
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
              <div className="flex min-w-0 flex-col justify-center gap-0.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="max-w-[min(34vw,360px)] truncate dh-type-title dh-type-workspace-title">
                    {currentDroneLabel}
                  </span>
                  {showRespondingAsStatusInHeader ? (
                    <span className="inline-flex items-center" title="Agent responding">
                      <TypingDots color="var(--yellow)" />
                    </span>
                  ) : (
                    <StatusBadge
                      ok={currentDrone.statusOk}
                      error={currentDrone.statusError}
                      checking={currentDrone.statusChecking}
                      hubPhase={currentDrone.hubPhase}
                      hubMessage={currentDrone.hubMessage}
                    />
                  )}
                  {showFleetBadge ? (
                    <div
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] transition-all',
                        fleetBadgeDropActive
                          ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--fg-secondary)] shadow-[var(--glow-accent)]'
                          : fleetBadgeError
                            ? 'border-[var(--red-border)] bg-[var(--danger-panel)] text-[var(--red)] hover:border-[var(--red-border)]'
                            : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg-secondary)]',
                      )}
                      title={fleetBadgeError ? `${fleetBadgeTitle} ${fleetBadgeError}` : fleetBadgeTitle}
                      aria-label={`${fleetBadgeSummaryText}. Drop drones here to assign them.`}
                    >
                      <span className="uppercase tracking-[0.12em]" style={{ fontFamily: 'var(--display)' }}>
                        Relationships
                      </span>
                      <span className="font-mono text-[var(--text-10)] text-inherit">
                        {fleetBadgeAssigning ? 'Assigning…' : fleetBadgeSummaryText}
                      </span>
                    </div>
                  ) : null}
                </div>
                {compactRepoPath || showCompactRuntimeMetadata ? (
                  <div className="hidden min-w-0 max-w-[min(34vw,420px)] items-center gap-1.5 overflow-hidden dh-type-meta lg:flex">
                    {compactRepoPath ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5" title={compactRepoPath}>
                        <IconFolder className="h-3 w-3 flex-shrink-0 opacity-35" />
                        <span className="min-w-0 max-w-[140px] truncate font-mono">{compactRepoLabel}</span>
                      </span>
                    ) : null}
                    {compactRepoPath && showCompactRuntimeMetadata ? (
                      <span className="flex-shrink-0 text-[var(--muted-dim)] opacity-45" aria-hidden="true">·</span>
                    ) : null}
                    {showCompactRuntimeMetadata ? (
                      <span
                        className="min-w-0 max-w-[240px] truncate"
                        title={`${agentLabel} · ${compactModelTitle}`}
                      >
                        {compactAgentModelLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {/* Status indicators */}
            <div data-drone-header-status="true" className="flex items-center gap-2 flex-shrink-0">
              {chatUiMode === 'cli' ? (
                <>
                  {loadingSession && (
                    <span className="text-[var(--text-11)] text-[var(--muted)] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />
                      Loading...
                    </span>
                  )}
                  {sessionError && !loadingSession && (
                    <span className="text-[var(--text-11)] text-[var(--red)] flex items-center gap-1" title={sessionError}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                      Error
                    </span>
                  )}
                </>
              ) : (
                <>
                  {loadingTranscript && (
                    <span className="text-[var(--text-11)] text-[var(--muted)] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />
                      Loading...
                    </span>
                  )}
                  {transcriptError && !loadingTranscript && (
                    <span className="text-[var(--text-11)] text-[var(--red)] flex items-center gap-1" title={transcriptError}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                      Error
                    </span>
                  )}
                </>
              )}
              {chatInfoError && !loadingChatInfo && (
                <button
                  type="button"
                  onClick={openChatErrorDetails}
                  className="text-[var(--text-11)] text-[var(--red)] inline-flex items-center gap-1 hover:underline focus:outline-none"
                  title={chatInfoError}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                  Chat error
                </button>
              )}
              {repoOpError && (
                <button
                  type="button"
                  className="text-[var(--text-11)] text-[var(--red)] inline-flex items-center gap-1 hover:underline focus:outline-none"
                  title={repoOpError}
                  onClick={() => openDroneErrorModal(currentDrone, repoOpError, repoOpErrorMeta)}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                  Repo error
                </button>
              )}
              {transcriptExportToast ? (
                <span
                  className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded text-[var(--text-10)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {transcriptExportToast}
                </span>
              ) : null}
              {launchHint?.kind === 'copied' && (
                <span
                  className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded text-[var(--text-10)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] font-mono"
                  title={launchHint.launcher ? `Launched: ${launchHint.launcher}` : 'Paste the copied command into a terminal.'}
                >
                  Command copied{launchHint.launcher ? ` • ${launchHint.launcher.split(' ')[0]}` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      {/* Tier 2: Toolbar */}
        <div
          data-drone-header-toolbar="true"
          className={
            droneControlsExpanded
              ? 'px-5 pb-2.5 flex items-center justify-end gap-2 flex-wrap'
              : 'absolute right-5 top-1/2 flex max-w-[calc(100%-22rem)] -translate-y-1/2 flex-wrap items-center justify-end gap-2'
          }
        >
          {droneControlsExpanded ? (
            <>
              {/* Agent selector */}
              {hasChats ? (
                <div data-onboarding-id="chat.toolbar.agent" className="flex items-center gap-1.5">
                  <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
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
                    disabled={agentDisabled || effectiveAgentLocked}
                    title={
                      effectiveAgentLocked
                        ? 'This chat has history. Create a new chat to use a different agent.'
                        : 'Choose agent implementation for this chat.'
                    }
                    triggerLabel={agentLabel}
                    chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                    panelClassName="w-[260px]"
                    header="Choose agent"
                    headerStyle={{ fontFamily: 'var(--display)' }}
                  />
                </div>
              ) : null}
              {hasChats && chatUiMode === 'transcript' ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Access
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={agentPermissionMode === 'read-only'}
                    onClick={() => {
                      if (!readOnlySupported) return;
                      const nextMode: AgentPermissionMode = agentPermissionMode === 'read-only' ? 'full-access' : 'read-only';
                      void setChatAgentPermissionMode(nextMode).catch((err: any) =>
                        setChatInfoError(err?.message ?? String(err)),
                      );
                    }}
                    disabled={loadingChatInfo || !readOnlySupported}
                    className={`inline-flex items-center gap-2 h-[28px] px-2 rounded border text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                      loadingChatInfo || !readOnlySupported
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : agentPermissionMode === 'read-only'
                          ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                          : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title={
                      readOnlySupported
                        ? 'Run the next prompt with read-only agent permissions.'
                        : 'Read-only mode is currently available for Codex and Blip chats.'
                    }
                  >
                    <span
                      className={`relative inline-flex h-3.5 w-6 rounded-full transition-colors ${
                        agentPermissionMode === 'read-only' ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'
                      }`}
                    >
                      <span
                        className={`absolute top-[1px] h-3 w-3 rounded-full bg-white transition-transform ${
                          agentPermissionMode === 'read-only' ? 'translate-x-[11px]' : 'translate-x-[1px]'
                        }`}
                      />
                    </span>
                    {agentPermissionMode === 'read-only' ? 'Read only' : 'Full'}
                  </button>
                </div>
              ) : null}
              {!hostRuntime ? (
                <span
                  className="inline-flex items-center h-[28px] px-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted-dim)]"
                  style={{ fontFamily: 'var(--display)' }}
                  title={dockerSizeTitle}
                >
                  {dockerSizeLabel}
                </span>
              ) : null}
              {hasChats && chatUiMode === 'transcript' ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Snapshots
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={dockerSnapshotAfterAgentMessageEnabled}
                    onClick={() => {
                      if (!dockerSnapshotSupported) return;
                      void setDockerSnapshotAfterAgentMessageEnabled(!dockerSnapshotAfterAgentMessageEnabled).catch((err: any) =>
                        setChatInfoError(err?.message ?? String(err)),
                      );
                    }}
                    disabled={loadingChatInfo || !dockerSnapshotSupported}
                    className={`inline-flex items-center gap-2 h-[28px] px-2 rounded border text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                      loadingChatInfo || !dockerSnapshotSupported
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : dockerSnapshotAfterAgentMessageEnabled
                          ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                          : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title={
                      dockerSnapshotSupported
                        ? 'Commit a Docker image snapshot after each new agent message in this chat.'
                        : 'Snapshots require a container drone created with Persist volume off.'
                    }
                  >
                    <span
                      className={`relative inline-flex h-3.5 w-6 rounded-full transition-colors ${
                        dockerSnapshotAfterAgentMessageEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'
                      }`}
                    >
                      <span
                        className={`absolute top-[1px] h-3 w-3 rounded-full bg-white transition-transform ${
                          dockerSnapshotAfterAgentMessageEnabled ? 'translate-x-[11px]' : 'translate-x-[1px]'
                        }`}
                      />
                    </span>
                    {dockerSnapshotAfterAgentMessageEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              ) : null}
              {hasChats && chatUiMode === 'transcript' ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Auto-continue
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={agentMessageAutoContinueEnabled}
                    onClick={() => {
                      void setAgentMessageAutoContinueEnabled(!agentMessageAutoContinueEnabled).catch((err: any) =>
                        setChatInfoError(err?.message ?? String(err)),
                      );
                    }}
                    disabled={loadingChatInfo}
                    className={`inline-flex items-center gap-2 h-[28px] px-2 rounded border text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                      loadingChatInfo
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : agentMessageAutoContinueEnabled
                          ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                          : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Monitor agent messages in this chat and auto-send the configured continue prompt when the agent appears to have stopped mid-task."
                  >
                    <span
                      className={`relative inline-flex h-3.5 w-6 rounded-full transition-colors ${
                        agentMessageAutoContinueEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'
                      }`}
                    >
                      <span
                        className={`absolute top-[1px] h-3 w-3 rounded-full bg-white transition-transform ${
                          agentMessageAutoContinueEnabled ? 'translate-x-[11px]' : 'translate-x-[1px]'
                        }`}
                      />
                    </span>
                    {agentMessageAutoContinueEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              ) : null}
              {hasChats && chatUiMode === 'transcript' ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Agent suggestion
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={agentSuggestionEnabled}
                    onClick={() => {
                      void setAgentSuggestionEnabled(!agentSuggestionEnabled).catch((err: any) =>
                        setChatInfoError(err?.message ?? String(err)),
                      );
                    }}
                    disabled={loadingChatInfo}
                    className={`inline-flex items-center gap-2 h-[28px] px-2 rounded border text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                      loadingChatInfo
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : agentSuggestionEnabled
                          ? 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                          : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Suggest a likely next user reply for new agent messages in this transcript chat."
                  >
                    <span
                      className={`relative inline-flex h-3.5 w-6 rounded-full transition-colors ${
                        agentSuggestionEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'
                      }`}
                    >
                      <span
                        className={`absolute top-[1px] h-3 w-3 rounded-full bg-white transition-transform ${
                          agentSuggestionEnabled ? 'translate-x-[11px]' : 'translate-x-[1px]'
                        }`}
                      />
                    </span>
                    {agentSuggestionEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              ) : null}
              {/* Repo (read-only for repo-attached drones only) */}
              {currentDroneRepoAttached && (
                <div className="flex items-center gap-1.5">
                  <span className="dh-type-section-label">
                    Repo
                  </span>
                  <UiMenuSelect
                    variant="toolbar"
                    value={currentDroneRepoPath}
                    onValueChange={() => {}}
                    entries={createRepoMenuEntries}
                    disabled={true}
                    triggerClassName="min-w-[220px] max-w-[420px]"
                    panelClassName="w-[380px] max-w-[calc(100vw-3rem)]"
                    menuClassName="max-h-[240px] overflow-y-auto"
                    title={currentDroneRepoPath || 'No repo'}
                    triggerLabel={currentDroneRepoPath ? repoPathLabel(currentDroneRepoPath) : 'No repo'}
                    triggerLabelClassName={currentDroneRepoPath ? 'font-mono text-[var(--text-10)] text-[var(--chrome-muted)]' : undefined}
                    chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                  />
                </div>
              )}
              {/* View mode */}
              {chatUiMode === 'cli' ? (
                <button
                  onClick={() => setOutputView(outputView === 'screen' ? 'log' : 'screen')}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]"
                  style={{ fontFamily: 'var(--display)' }}
                  title={outputView === 'screen' ? 'Click for raw log view' : 'Click for screen capture view'}
                >
                  {outputView === 'screen' ? 'Screen' : 'Log'}
                </button>
              ) : null}
              {/* Separator */}
              <div className="w-px h-4 bg-[var(--border-subtle)]" />
              <div
                className="inline-flex items-center gap-1.5 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]"
                style={{ fontFamily: 'var(--display)' }}
                title={`Open chat: ${activeChatName}`}
              >
                Chat
                <span className="font-mono normal-case tracking-normal text-[var(--text-11)] text-[var(--fg-secondary)]">{activeChatName}</span>
                {selectedChatIsDraft ? (
                  <span className="rounded border border-[var(--accent-muted)] px-1 py-0.5 text-[var(--text-8)] text-[var(--accent)]">Draft</span>
                ) : null}
              </div>
              <div className="inline-flex items-center gap-1.5">
                <div
                  className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-0.5"
                  style={{ fontFamily: 'var(--display)' }}
                  title="Choose where this workspace layout is saved."
                >
                  {WORKSPACE_LAYOUT_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setWorkspaceLayoutScope(scope)}
                      className={`h-5 rounded px-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide border transition-all ${
                        workspaceLayoutScope === scope
                          ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                          : 'border-transparent text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]'
                      }`}
                      title={`Save this workspace layout for ${scope === 'global' ? 'all drones' : scope === 'drone' ? 'this drone' : 'this chat'}.`}
                    >
                      {scope}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setWorkspacePaneHeaderMode(workspacePaneHeaderMode === 'compact' ? 'normal' : 'compact')}
                  aria-pressed={workspacePaneHeaderMode === 'compact'}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-all ${
                    workspacePaneHeaderMode === 'compact'
                      ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:text-[var(--muted)]'
                  }`}
                  title={workspacePaneHeaderMode === 'compact' ? 'Use normal pane headers' : 'Use compact pane headers'}
                  aria-label={workspacePaneHeaderMode === 'compact' ? 'Use normal pane headers' : 'Use compact pane headers'}
                >
                  <IconAutoMinimize className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : null}
          <button
            type="button"
            onClick={toggleDroneControlsExpanded}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-all focus-visible:border-[var(--accent-muted)] focus-visible:outline-none ${
              droneControlsExpanded
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--toolbar-control-border)] bg-[var(--toolbar-control-bg)] text-[var(--muted-dim)] hover:border-[var(--toolbar-control-hover-border)] hover:bg-[var(--hover)] hover:text-[var(--muted)]'
            }`}
            title={droneControlsExpanded ? 'Hide drone controls' : 'Show drone controls'}
            aria-label={droneControlsExpanded ? 'Hide drone controls' : 'Show drone controls'}
            aria-expanded={droneControlsExpanded}
          >
            <IconTune className="h-3.5 w-3.5" />
          </button>
          {/* Primary actions */}
          <HeaderActionButton
            onClick={() => openDroneTerminal('ssh')}
            disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingTerminal)}
            title={`SSH into "${currentDroneLabel}"`}
          >
            SSH
          </HeaderActionButton>
          <HeaderActionButton
            onClick={() => {
              openDroneTabFromLastPreview(currentDrone);
            }}
            disabled={quickOpenTabDisabled}
            title={quickOpenTabUrl ? `Open ${quickOpenTabUrl} in a new browser tab` : 'No preview port selected yet'}
          >
            Open tab
          </HeaderActionButton>
          <HeaderActionButton
            onClick={() => openDroneEditor('cursor')}
            disabled={isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingEditor) || Boolean(openingTerminal)}
            title={`Open Cursor attached to "${currentDroneLabel}"`}
          >
            <IconCursorApp className="opacity-70" />
            Cursor
          </HeaderActionButton>
          {currentDroneRepoAttached && (
            <div ref={syncMenuRef} className="relative">
              <HeaderActionButton
                onClick={() => {
                  setHeaderOverflowOpen(false);
                  setTerminalMenuOpen(false);
                  setSyncMenuOpen((open) => !open);
                }}
                disabled={syncDisabled}
                title="Sync this drone repo with the host or another drone"
                aria-haspopup="menu"
                aria-expanded={syncMenuOpen}
              >
                <span>{hostRuntime ? 'Sync (host)' : repoSyncBusyLabel}</span>
                <IconChevron down={!syncMenuOpen} className="text-[var(--muted-dim)] opacity-60" />
              </HeaderActionButton>
              {syncMenuOpen && !syncDisabled ? (
                <HeaderDropdownPortal open={syncMenuOpen} anchorRef={syncMenuRef} width={280}>
                  <div className="py-1">
                    <div className="px-3 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">Host</div>
                    <button
                      type="button"
                      onClick={() => {
                        setSyncMenuOpen(false);
                        void pullRepoChanges();
                      }}
                      className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]')}
                      role="menuitem"
                      title={hostRuntime ? 'Host runtime uses the host repository directly; this action is a no-op.' : 'Apply this drone repo into the host repo'}
                    >
                      {hostRuntime ? 'Apply to host (noop)' : 'Apply to host'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSyncMenuOpen(false);
                        void pushRepoChanges();
                      }}
                      className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]')}
                      role="menuitem"
                      title={hostRuntime ? 'Host runtime uses the host repository directly; this action is a no-op.' : 'Pull the current host branch into this drone repo'}
                    >
                      {hostRuntime ? 'Pull from host (noop)' : 'Pull from host'}
                    </button>
                    <div className="my-1 border-t border-[var(--border-subtle)]" />
                    <div className="px-3 py-1 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted-dim)]">Peer Drones</div>
                    {repoTransferPeers.length > 0 ? (
                      <>
                        <div className="px-3 py-1 text-[var(--text-10)] text-[var(--muted)]">Apply current drone into:</div>
                        {repoTransferPeers.map((peer) => (
                          <button
                            key={`apply-${peer.id}`}
                            type="button"
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void applyRepoChangesToDrone(peer.id);
                            }}
                            className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]')}
                            role="menuitem"
                            title={`Apply "${currentDroneLabel}" into "${peer.name}"`}
                          >
                            Apply to {peer.name}
                            {peer.group ? <span className="ml-1 text-[var(--muted-dim)]">[{peer.group}]</span> : null}
                          </button>
                        ))}
                        <div className="my-1 border-t border-[var(--border-subtle)]" />
                        <div className="px-3 py-1 text-[var(--text-10)] text-[var(--muted)]">Pull another drone into current:</div>
                        {repoTransferPeers.map((peer) => (
                          <button
                            key={`pull-${peer.id}`}
                            type="button"
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void pullRepoChangesFromDrone(peer.id);
                            }}
                            className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]')}
                            role="menuitem"
                            title={`Pull "${peer.name}" into "${currentDroneLabel}"`}
                          >
                            Pull from {peer.name}
                            {peer.group ? <span className="ml-1 text-[var(--muted-dim)]">[{peer.group}]</span> : null}
                          </button>
                        ))}
                      </>
                    ) : (
                      <div className="px-3 py-2 text-[var(--text-11)] text-[var(--muted)]">No peer drones on the same repo are available.</div>
                    )}
                  </div>
                </HeaderDropdownPortal>
              ) : null}
            </div>
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
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
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
              <HeaderDropdownPortal open={headerOverflowOpen} anchorRef={headerOverflowRef} width={220}>
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      copyTranscriptMarkdown();
                    }}
                    disabled={transcriptExportDisabled}
                    className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                    role="menuitem"
                    title={transcriptExportDisabled ? 'No completed transcript turns are available yet.' : 'Copy the current chat transcript as Markdown'}
                  >
                    Copy transcript
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      downloadTranscriptJson();
                    }}
                    disabled={transcriptExportDisabled}
                    className={cn(dropdownMenuItemBaseClass, 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed')}
                    role="menuitem"
                    title={transcriptExportDisabled ? 'No completed transcript turns are available yet.' : 'Download the current chat transcript as JSON'}
                  >
                    Download transcript
                  </button>
                  <div className="my-1 border-t border-[var(--border-subtle)]" />
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
                  {currentDroneRepoAttached && (
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
                        title={hostRuntime ? 'Host runtime uses the host repository directly; this action is a no-op.' : undefined}
                      >
                        {hostRuntime ? 'Reseed repo (noop)' : 'Reseed repo'}
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
                              className={`w-full text-left pl-6 pr-3 py-1.5 text-[var(--text-11)] transition-colors ${
                                active ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-[var(--weight-semibold)]' : 'text-[var(--muted)] hover:bg-[var(--hover)]'
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
              </HeaderDropdownPortal>
            )}
          </div>
          {/* Workspace pane controls */}
          {rightPanelOpen && (
            <>
              <div className="w-px h-4 bg-[var(--border-subtle)] ml-1" />
              <div className="flex items-center gap-0.5">
                {rightPanelTabs.map((tab) => {
                  const prCount = tab === 'prs' ? Number(openPullRequestCount ?? 0) : 0;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => openWorkspacePane(tab)}
                      data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                      className="inline-flex items-center rounded border border-transparent px-2 py-1 text-[var(--text-10)] font-medium text-[var(--chrome-muted)] transition-all hover:border-[var(--border-subtle)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                      title={
                        tab === 'prs' && prCount > 0
                          ? `Open ${rightPanelTabLabels[tab]} pane (${prCount} open)`
                          : `Open ${rightPanelTabLabels[tab]} pane`
                      }
                    >
                      <span>{rightPanelTabLabels[tab]}</span>
                      {tab === 'prs' && prCount > 0 ? (
                        <span className="ml-1 inline-flex min-w-[14px] items-center justify-center rounded-full border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-1 text-[var(--text-9)] leading-3 text-[var(--accent)]">
                          {prCount > 99 ? '99+' : prCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {rightPanelOpen && (
            <button
              type="button"
              onClick={resetWorkspaceLayout}
              className={`inline-flex items-center h-7 px-2 rounded border text-[var(--text-10)] font-medium transition-all ${
                'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--chrome-muted)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
              }`}
              title={`Reset the saved ${workspaceLayoutScope} workspace layout`}
              aria-label="Reset workspace layout"
            >
              Reset layout
            </button>
          )}
          <button
            type="button"
            onClick={() => setRightPanelOpen((v) => !v)}
            data-onboarding-id="rightPanel.toggle"
            className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ml-1 ${
              rightPanelOpen
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            title={rightPanelOpen ? 'Keep existing panes and stop opening tool panes automatically' : 'Open workspace panes'}
            aria-label="Toggle workspace panes"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <line x1="10" y1="2" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      </DroneWorkspaceHeaderFrame>

      <DockableDroneWorkspace
        currentDrone={currentDrone}
        activeChatName={activeChatName}
        layoutScope={workspaceLayoutScope}
        paneHeaderMode={workspacePaneHeaderMode}
        toolPaneOpen={rightPanelOpen}
        activeToolTab={rightPanelTab}
        openRequestNonce={rightPanelOpenRequestSeq}
        resetLayoutNonce={workspaceLayoutResetNonce}
        renderToolPane={(tab, paneKey) => renderRightPanelTabContent(currentDrone, tab, paneKey)}
        previewTab="preview"
        onActiveToolTabChange={setRightPanelTab}
        onPreviewHostChange={onPersistentPreviewHostChange}
        onBeforeWorkspaceMouseDown={captureWorkspaceChatScroll}
        onAfterToolPanelRemove={restoreWorkspaceChatScroll}
        chatContent={
        <div
          ref={setFleetDropNodeRef}
          data-fleet-assignment-drop-zone="1"
          data-fleet-assignment-drone-id={currentDrone.id}
          data-fleet-assignment-owner-id={currentDrone.id}
          onDragOver={onFleetDropDragOver}
          onDragLeave={onFleetDropDragLeave}
          onDrop={onFleetDropDrop}
          className={cn(
            'flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative',
            fleetBadgeDropActive && 'ring-1 ring-inset ring-[var(--accent-muted)]',
          )}
        >
          {fleetDropHintVisible && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-6 py-6">
              <div
                className={cn(
                  'flex w-full max-w-[560px] items-center justify-center rounded-[var(--radius-xlarge)] border border-dashed px-6 py-8 text-center shadow-[0_24px_60px_var(--shadow-color)] backdrop-blur-sm transition-all',
                  fleetBadgeDropActive
                    ? 'border-[var(--accent)] bg-[var(--panel-overlay)] text-[var(--fg-secondary)] shadow-[inset_0_0_0_1px_var(--canvas-related-subtle),0_24px_60px_var(--shadow-color)]'
                    : 'border-[var(--accent-muted)] bg-[var(--panel-overlay-soft)] text-[var(--muted)] shadow-[inset_0_0_0_1px_var(--info-subtle),0_24px_60px_var(--shadow-color)]',
                )}
              >
                <div className="max-w-[420px]">
                  <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.14em]" style={{ fontFamily: 'var(--display)' }}>
                    Drone Drop Actions
                  </div>
                  <div className="mt-2 text-[var(--text-13)] leading-5">
                    {fleetDropHintText}
                  </div>
                </div>
              </div>
            </div>
          )}
          <ChatSurface
            adapter={nativeChatActive ? NATIVE_AGENT_CHAT_SURFACE : EXTERNAL_AGENT_CHAT_SURFACE}
            ariaHidden={fleetDropHintVisible}
            className={cn(
              'flex-1 flex min-h-0 flex-col transition-opacity duration-150',
              fleetDropHintVisible && 'pointer-events-none select-none opacity-0',
            )}
          >
          <div className="relative flex min-h-0 flex-1 flex-col">
            {chatConfigPending ? (
              <ChatSurfaceLoadingView
                resetKey={`${selectedDroneIdentity}:${selectedChat ?? ''}:loading`}
                droneName={currentDrone.name}
                draftValue={chatDraftValue}
                onDraftValueChange={(next) => {
                  setChatInputDraft(chatDraftKey, next);
                }}
                focusTargetId="primary-chat"
              />
            ) : chatConfigFailed ? (
              <EmptyState
                icon={<IconChat className="h-8 w-8 text-[var(--muted)]" />}
                title="Chat unavailable"
                description={chatInfoError || 'Unable to load this chat.'}
              />
            ) : nativeChatActive ? (
              <AssistantDock
                key={`${currentDrone.id}:${activeChatName}`}
                nativeChat={{ droneId: currentDrone.id, chatName: activeChatName }}
                messageFeatures={{
                  parsingJobsByTurn,
                  onCreateJobs: parseJobsFromAgentMessage,
                  onSpawnTask: spawnCurrentDroneHubTask,
                  linkedPullRequestContext,
                  droneId: currentDrone.id,
                  droneHomePath: currentDroneHomePath,
                  onOpenFileReference: onOpenMarkdownFileReference,
                  onOpenLink: tryOpenMarkdownPullRequest,
                }}
                automationFeatures={{
                  actions: chatAutomationActions,
                  transcriptItems: nativeAutomationTranscriptItems,
                  modeHint: automationModeHint,
                  onSend: sendChatAutomation,
                }}
                onHistoryChange={setNativeHistoryObserved}
              />
            ) : chatUiMode === 'transcript' ? (
              <AgentChatTranscript
                scrollRef={transcriptScrollRef}
                initialScrollKey={`${currentDrone.id}:${activeChatName}`}
                loading={loadingTranscript && !transcripts && visiblePendingPromptsWithStartup.length === 0}
                hasContent={Boolean((transcripts && transcripts.length > 0) || visiblePendingPromptsWithStartup.length > 0)}
                emptyState={
                  <EmptyState
                    icon={<IconChat className="h-8 w-8 text-[var(--muted)]" />}
                    title="No messages yet"
                    description={
                      transcriptError
                        ? `Error: ${transcriptError}`
                        : hasChats
                          ? `Send a prompt to ${currentDroneLabel} to see the conversation here.`
                          : `${currentDroneLabel} has no chats yet. Send the first prompt or click New to create one.`
                    }
                  />
                }
                items={externalTranscriptItems}
              />
            ) : (
              <div
                ref={outputScrollRef as React.RefObject<HTMLDivElement>}
                onScroll={(e) => updatePinned(e.currentTarget)}
                className="h-full min-w-0 min-h-0 overflow-auto relative"
              >
                {isDroneStartingOrSeeding(currentDrone.hubPhase) && String(startupSeedForCurrentDrone?.prompt ?? '').trim() && (
                  <div className="max-w-[1170px] mx-auto px-6 pt-2">
                    <div className="rounded-[var(--radius-medium)] border border-[var(--user-bubble-border)] bg-[var(--user-bubble)] px-3 py-2 text-[var(--text-12)] text-[var(--user-bubble-fg)] whitespace-pre-wrap">
                      {String(startupSeedForCurrentDrone?.prompt ?? '').trim()}
                    </div>
                  </div>
                )}
                {loadingSession && !sessionText ? (
                  <ChatLoadingState message="Loading session output…" />
                ) : sessionText ? (
                  <div className="max-w-[1170px] mx-auto px-6 py-6">
                    <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] px-4 py-3">
                      <CollapsibleOutput text={sessionText} ok={!sessionError} />
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
                    title="No output yet"
                    description={
                      sessionError
                        ? `Error: ${sessionError}`
                        : hasChats
                          ? `Send a prompt to ${currentDroneLabel} to see the session output here.`
                          : `${currentDroneLabel} has no chats yet. Send the first prompt or click New to create one.`
                    }
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
                      className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border border-[var(--accent-muted)] bg-[var(--panel-raised)] text-[var(--accent)] hover:shadow-[var(--glow-accent)] shadow-[0_8px_24px_var(--shadow-color)] transition-all"
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

          {genericChatActive && chatUiMode === 'cli' ? <CliPendingPromptStrip items={visibleCliPendingPrompts} /> : null}

          {genericChatActive && chatUiMode === 'transcript' && agentSuggestionEnabled && latestAgentSuggestionTarget && showLatestAgentSuggestion ? (
            <div className="mx-4 mb-3 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div
                    className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Agent suggestion
                    {latestAgentSuggestionKindLabel ? (
                      <span className="ml-2 normal-case tracking-normal text-[var(--muted)]">{latestAgentSuggestionKindLabel}</span>
                    ) : null}
                  </div>
                  {latestAgentSuggestionState?.status === 'loading' ? (
                    <div className="mt-2 text-[var(--text-12)] text-[var(--muted-dim)]">Thinking about the likely next reply…</div>
                  ) : latestAgentSuggestionState?.status === 'error' ? (
                    <div className="mt-2 text-[var(--text-12)] text-[var(--red)]">{latestAgentSuggestionState.error}</div>
                  ) : latestAgentSuggestionState?.status === 'ready' ? (
                    <>
                      <div className="mt-2 whitespace-pre-wrap text-[var(--text-13)] leading-relaxed text-[var(--fg-secondary)]">
                        {latestAgentSuggestionState.suggestion}
                      </div>
                      {latestAgentSuggestionState.reason ? (
                        <div className="mt-2 text-[var(--text-11)] text-[var(--muted)]">{latestAgentSuggestionState.reason}</div>
                      ) : null}
                      {latestAgentSuggestionUsedDirectAt ? (
                        <div className="mt-2 text-[var(--text-11)] text-[var(--muted-dim)]">
                          Used directly on {new Date(latestAgentSuggestionUsedDirectAt).toLocaleString()}.
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-2 text-[var(--text-12)] text-[var(--muted-dim)]">No assistant suggestion yet.</div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void sendAgentSuggestionDirectly();
                    }}
                    disabled={latestAgentSuggestionState?.status !== 'ready' || sendingDirectAgentSuggestion}
                    className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                      latestAgentSuggestionState?.status !== 'ready' || sendingDirectAgentSuggestion
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {sendingDirectAgentSuggestion ? 'Sending…' : 'Send'}
                  </button>
                  <button
                    type="button"
                    onClick={editAgentSuggestionDraft}
                    disabled={latestAgentSuggestionState?.status !== 'ready'}
                    className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                      latestAgentSuggestionState?.status !== 'ready'
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void requestAgentSuggestionForMessage(latestAgentSuggestionTarget, { force: true });
                    }}
                    disabled={latestAgentSuggestionState?.status === 'loading' || sendingDirectAgentSuggestion}
                    className={`h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                      latestAgentSuggestionState?.status === 'loading' || sendingDirectAgentSuggestion
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Re-suggest
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {genericChatActive ? (
            <ChatSurfaceComposer
              resetKey={`${selectedDroneIdentity}:${selectedChat ?? ''}`}
              droneName={currentDrone.name}
              focusTargetId="primary-chat"
              draftValue={chatDraftValue}
              onDraftValueChange={(next) => {
                setChatInputDraft(chatDraftKey, next);
              }}
              promptError={stopResponseError || promptError}
              sending={sendingPrompt}
              publishing={publishingDraft}
              waiting={chatInputWaiting}
              composerControls={externalComposerControls}
              automationActions={chatAutomationActions}
              modeHint={automationModeHint}
              autoFocus={shouldAutoFocusInput}
              onStop={
                !currentChatIsDraft && canStopResponse ? () => requestStopResponse() : undefined
              }
              stopping={stoppingResponse}
              onPublish={currentChatIsDraft ? publishSelectedDraft : undefined}
              onSend={async (payload: ChatSendPayload) => await sendPromptText(payload)}
              onSendAutomation={chatUiMode === 'transcript' ? sendChatAutomation : undefined}
            />
          ) : null}
          {fileOpenToast ? (
            <div className="absolute right-4 bottom-4 z-20">
              <button
                type="button"
                onClick={() => setFileOpenToast(null)}
                title="Click to dismiss"
                className="block max-w-[360px] text-left rounded border border-[var(--red-border)] bg-[var(--danger-panel)] px-3 py-2 shadow-[0_10px_26px_var(--shadow-color)] cursor-pointer"
              >
                <div className="text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--red)]" style={{ fontFamily: 'var(--display)' }}>
                  Open file failed
                </div>
                <div className="mt-1 text-[var(--text-11)] text-[var(--fg-secondary)] break-words">{fileOpenToast.message}</div>
              </button>
            </div>
          ) : null}
        </ChatSurface>
        </div>
        }
      />
    </>
  );
}
