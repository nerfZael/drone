import React from 'react';
import { createPortal } from 'react-dom';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import type { CodexApprovalDecision, CodexPendingApproval } from '@drone/assistant-chat';
import {
  AgentChatTranscript,
  ChatSurface,
  ChatSurfaceComposer,
  ChatSurfaceLoadingView,
  ChatLoadingState,
  adaptExternalAgentChatSurface,
  adaptNativeAgentChatSurface,
  type AgentChatTranscriptItem,
  type ChatSendContext,
  type DroneHubTask,
  type DroneHubTaskSpawnMode,
  type ChatSendPayload,
  type ChatComposerMenuAction,
  CollapsibleOutput,
  EmptyState,
  PendingTranscriptTurn,
  TranscriptTurn,
  usePinnedTranscriptScroll,
} from '../chat';
import type { MarkdownFileReference } from '../chat/MarkdownMessage';
import { StatusBadge } from '../overview';
import { TypingDots } from '../overview/icons';
import { requestJson } from '../http';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  ChatResourceSubscriptionInfo,
} from '../../domain';
import type { DroneSummary, PendingPrompt, TranscriptItem } from '../types';
import {
  IconChat,
  IconChevron,
  IconChevronLeft,
  IconCirclePause,
  IconCopy,
  IconCursorApp,
  IconDownload,
  IconFileDiff,
  IconGitCommitHorizontal,
  IconGitPullRequest,
  IconMonitor,
  IconNetwork,
  IconRefresh,
  IconSidebarExpand,
  IconTerminal,
  IconTune,
  IconVsCode,
} from './icons';
import {
  DockableDroneWorkspace,
  readWorkspacePaneHeaderMode,
  writeWorkspacePaneHeaderMode,
  type WorkspacePaneHeaderMode,
} from './DockableDroneWorkspace';
import { DroneWorkspaceHeaderFrame } from './DroneWorkspaceHeaderFrame';
import { HeaderActionButton } from './HeaderActionButton';
import { rightPanelHeaderTabs, type RightPanelTab } from './app-config';
import type { ChatModelOption, StartupSeedState } from './app-types';
import {
  chatConfigResolutionState,
  shouldShowDroneStartupFailureEmptyState,
} from './chat-selection-model';
import type { RepoOpErrorMeta } from './helpers';
import type { DroneDeleteMode } from './settings-types';
import { requestChangesPullRequest } from '../changes/navigation';
import { copyText, downloadTextFile } from './clipboard';
import {
  chatInputDraftKeyForDroneChat,
  droneHomePath,
  isHostRuntimeDrone,
  isDroneStartingOrSeeding,
  resolveChatNameForDrone,
} from './helpers';
import { openDroneTabFromLastPreview, resolveDroneOpenTabUrl } from './quick-actions';
import { cn } from '../../ui/cn';
import {
  contextMenuItemBaseClass as dropdownMenuItemBaseClass,
  contextMenuPanelBaseClass,
  contextMenuSeparatorClass,
  useDropdownDismiss,
} from '../../ui/dropdown';
import { UiTooltip, type UiMenuSelectEntry } from '../../ui/components';
import { fetchDroneChatTranscript } from './chat-api';
import { useDroneHubUiStore, useSelectedDroneWorkspaceUiState } from './use-drone-hub-ui-store';
import { CliPendingPromptStrip } from './CliPendingPromptStrip';
import { formatBytes } from './selected-drone-workspace-utils';
import { buildExternalAgentComposerControls } from './external-agent-composer-controls';
import { parseGithubPullRequestHref } from '../chat/github-pull-request-links';
import { useHeaderRepoPullRequestSummary } from './HeaderPullRequestShortcuts';
import { useFleetAssignmentDropState } from './use-fleet-assignment-drop-state';
import { AssistantDock } from '../assistant/AssistantDock';
import { CodexApprovalCard } from '../assistant/CodexApprovalCard';
import {
  buildTranscriptExportFilename,
  formatTranscriptJson,
  formatTranscriptMarkdown,
} from '../chat/transcript-export';
import { buildChatTimelineItems } from './chat-timeline-items';
import { pendingPromptShowsWorkingState } from './optimistic-pending-prompts';
import { useChatMcpAccess } from './use-chat-mcp-access';
import { parseDroneHubDragData } from './drone-hub-dnd';
import { assignedDroneIdsFromData } from './drone-hub-dnd-utils';
import { DroneHubPermissionsView } from './DroneHubPermissionsView';
import type { LocalAutoUpdates, LocalCheckoutView } from './use-local-checkout';
import { WorkspaceToolIcon } from './WorkspaceToolIcon';
import { DroneChatComposerMetadata } from './ChatComposerMetadata';
import { AgentComposerPicker } from './AgentComposerPicker';
import { NewDroneAccessPicker } from './NewDroneAccessPicker';

type LaunchHint = {
  context: 'terminal' | 'code' | 'cursor';
  command?: string;
  launcher?: string;
  kind: 'copied';
} | null;

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
  const [position, setPosition] = React.useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

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
      className={cn('fixed z-[11000]', contextMenuPanelBaseClass)}
      style={{ top: position.top, left: position.left, width }}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}

function HeaderMenuToggleRow({
  label,
  value,
  checked,
  disabled = false,
  title,
  onToggle,
}: {
  label: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      title={title}
      className={cn(
        dropdownMenuItemBaseClass,
        'flex items-center justify-between gap-4 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <span>{label}</span>
      <span className="inline-flex flex-shrink-0 items-center gap-2">
        <span className={checked ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}>{value}</span>
        <span
          className={`relative inline-flex h-3.5 w-6 rounded-full ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'}`}
        >
          <span
            className={`absolute top-px h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-[11px]' : 'translate-x-px'}`}
          />
        </span>
      </span>
    </button>
  );
}

function HeaderMenuItemIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--muted-dim)]"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function HeaderMenuRadioRow({
  label,
  checked,
  disabled = false,
  onSelect,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        dropdownMenuItemBaseClass,
        'flex items-center justify-between gap-4 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', checked ? 'bg-[var(--accent)]' : 'bg-transparent')}
      />
    </button>
  );
}

const LOCAL_AUTO_UPDATE_OPTIONS = [
  { mode: 'off', label: 'Off' },
  { mode: 'commits', label: 'Commits only' },
  { mode: 'all', label: 'All changes' },
] as const satisfies ReadonlyArray<{
  mode: LocalAutoUpdates;
  label: string;
}>;

function LocalAutoUpdateIcon({ mode }: { mode: LocalAutoUpdates }) {
  const iconClassName = 'h-4 w-4';
  if (mode === 'off') return <IconCirclePause className={iconClassName} />;
  if (mode === 'commits') return <IconGitCommitHorizontal className={iconClassName} />;
  return <IconFileDiff className={iconClassName} />;
}

function LocalAutoUpdatesControl({
  active,
  activeForAnotherDroneName,
  mode,
  disabled,
  onSelect,
}: {
  active: boolean;
  activeForAnotherDroneName: string | null;
  mode: LocalAutoUpdates;
  disabled: boolean;
  onSelect: (mode: LocalAutoUpdates) => void;
}) {
  const localStatusTitle = active
    ? 'This drone is being used locally'
    : activeForAnotherDroneName
      ? `${activeForAnotherDroneName} is currently being used locally`
      : 'This drone is not being used locally';
  const optionRefs = React.useRef(new Map<LocalAutoUpdates, HTMLButtonElement>());
  const moveSelection = (currentMode: LocalAutoUpdates, key: string) => {
    const currentIndex = LOCAL_AUTO_UPDATE_OPTIONS.findIndex(
      (option) => option.mode === currentMode,
    );
    let nextIndex = currentIndex;
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % LOCAL_AUTO_UPDATE_OPTIONS.length;
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      nextIndex =
        (currentIndex - 1 + LOCAL_AUTO_UPDATE_OPTIONS.length) % LOCAL_AUTO_UPDATE_OPTIONS.length;
    } else if (key === 'Home') {
      nextIndex = 0;
    } else if (key === 'End') {
      nextIndex = LOCAL_AUTO_UPDATE_OPTIONS.length - 1;
    } else {
      return;
    }
    const nextMode = LOCAL_AUTO_UPDATE_OPTIONS[nextIndex].mode;
    onSelect(nextMode);
    window.requestAnimationFrame(() => optionRefs.current.get(nextMode)?.focus());
  };

  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-[var(--radius-medium)] bg-[var(--surface-inset)] p-0.5 dh-type-header-action">
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-[calc(var(--radius-medium)-1px)] px-2.5"
        aria-label={`Local status: ${localStatusTitle}`}
        title={localStatusTitle}
      >
        <IconMonitor
          className={cn('h-4 w-4', active ? 'text-[var(--accent)]' : 'text-[var(--muted-dim)]')}
        />
        <span className={active ? 'text-[var(--fg-secondary)]' : 'text-[var(--muted)]'}>Local</span>
      </span>
      <div
        className="inline-flex items-center gap-0.5"
        role="radiogroup"
        aria-label="Local auto-updates"
      >
        {LOCAL_AUTO_UPDATE_OPTIONS.map((option) => {
          const selected = option.mode === mode;
          const action = active
            ? `Set local auto-updates to ${option.label}`
            : `Use this drone locally with auto-updates ${option.label.toLowerCase()}`;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={action}
              title={action}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(option.mode)}
              onKeyDown={(event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                    event.key,
                  )
                ) {
                  return;
                }
                event.preventDefault();
                moveSelection(option.mode, event.key);
              }}
              ref={(element) => {
                if (element) optionRefs.current.set(option.mode, element);
                else optionRefs.current.delete(option.mode);
              }}
              className={cn(
                'inline-flex h-7 w-8 items-center justify-center rounded-[calc(var(--radius-medium)-1px)] transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
                selected
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'text-[var(--muted)] hover:text-[var(--fg-secondary)]',
              )}
            >
              <LocalAutoUpdateIcon mode={option.mode} />
            </button>
          );
        })}
      </div>
    </div>
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
  chatId: string | null;
  chatSubscriptions: ChatResourceSubscriptionInfo[];
  modelControlEnabled: boolean;
  availableChatModels: ChatModelOption[];
  currentModel: string | null;
  currentReasoning: string | null;
  setChatModelSettings: (settings: {
    model?: string | null;
    reasoning?: string | null;
  }) => Promise<void>;
  agentPermissionMode: AgentPermissionMode;
  setChatAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  approvalPolicy: AgentApprovalPolicy;
  setChatApprovalPolicy: (policy: AgentApprovalPolicy) => Promise<void>;
  dockerSnapshotAfterAgentMessageEnabled: boolean;
  setDockerSnapshotAfterAgentMessageEnabled: (enabled: boolean) => Promise<void>;
  setChatInfoError: React.Dispatch<React.SetStateAction<string | null>>;
  modelDisabled: boolean;
  loadingChatModels: boolean;
  chatModelsError: string | null;
  chatModelsStale: boolean;
  currentDroneRepoAttached: boolean;
  currentDroneRepoPath: string;
  createRepoMenuEntries: UiMenuSelectEntry[];
  openDroneTerminal: (mode: 'ssh' | 'agent') => void;
  openingTerminal: { mode: 'ssh' | 'agent' } | null;
  openDroneEditor: (editor: 'code' | 'cursor') => void;
  openingEditor: { editor: 'code' | 'cursor' } | null;
  pullRepoChanges: () => Promise<void>;
  pushRepoChanges: () => Promise<void>;
  localCheckout: LocalCheckoutView | null;
  localCheckoutLoading: boolean;
  localCheckoutBusy: boolean;
  useRepoLocally: (mode?: LocalAutoUpdates) => Promise<void>;
  updateRepoLocally: () => Promise<void>;
  setLocalAutoUpdates: (mode: LocalAutoUpdates) => Promise<void>;
  returnRepoLocalCheckout: () => Promise<void>;
  applyRepoLocalCheckout: () => Promise<void>;
  onRequestDropActions: (
    targetDroneId: string,
    sourceDroneIds: string[],
  ) => { ok: boolean; error?: string | null };
  repoOp: { kind: 'pull' | 'push' | 'reseed' | 'pull-from-drone' | 'push-to-drone' } | null;
  headerOverflowRef: React.RefObject<HTMLDivElement | null>;
  reseedRepo: () => Promise<void>;
  terminalMenuRef: React.RefObject<HTMLDivElement | null>;
  terminalLabel: string;
  terminalOptions: Array<{ id: string; label: string }>;
  requestRightPanelTab: (tab: RightPanelTab) => void;
  rightPanelTabs: RightPanelTab[];
  rightPanelTab: RightPanelTab;
  setRightPanelTab: React.Dispatch<React.SetStateAction<RightPanelTab>>;
  rightPanelTabLabels: Record<RightPanelTab, string>;
  transcripts: TranscriptItem[] | null;
  visiblePendingPromptsWithStartup: PendingPrompt[];
  transcriptMessageId: (item: TranscriptItem) => string;
  spawnDroneHubTaskFromAgentMessage: (opts: {
    sourceDroneId: string;
    sourceChatName: string;
    task: DroneHubTask;
    mode: DroneHubTaskSpawnMode;
  }) => Promise<{ ok: boolean; error?: string | null }>;
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
  updatePinned: (el: HTMLDivElement) => void;
  startupSeedForCurrentDrone: StartupSeedState | null;
  clearStartupSeedForDrone: (droneId: string) => void;
  sessionText: string;
  pinnedToBottom: boolean;
  selectedDroneIdentity: string;
  promptError: string | null;
  sendPromptText: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  onSendPromptInNewChat: (payload: ChatSendPayload, context: ChatSendContext) => Promise<boolean>;
  publishSelectedDraft: () => Promise<boolean>;
  publishingDraft: boolean;
  canStopResponse: boolean;
  requestStopResponse: () => Promise<void>;
  stoppingResponse: boolean;
  stopResponseError: string | null;
  requestCancelPendingPrompt: (promptId: string) => Promise<void>;
  cancellingPendingPromptById: Record<string, true>;
  cancelPendingPromptErrorById: Record<string, string>;
  onCreateQueuedNewChatNow: (promptId: string) => Promise<void>;
  focusedNewChatActionId: string;
  onCreateNewChatAutoFocusHandled: (promptId: string) => void;
  promotingNewChatActionById: Record<string, true>;
  promoteNewChatActionErrorById: Record<string, string>;
  openedEditorFileOpenFailureMessage: string | null;
  openedEditorFileOpenFailureAt: number | null;
  onOpenMarkdownFileReference: (ref: MarkdownFileReference) => void;
  rightPanelOpenRequestSeq: number;
  visibleToolTabs: RightPanelTab[];
  onVisibleToolTabsChange: (tabs: RightPanelTab[]) => void;
  renderRightPanelTabContent: (
    drone: DroneSummary,
    tab: RightPanelTab,
    pane: 'single' | 'top' | 'bottom',
  ) => React.ReactNode;
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
  chatId,
  chatSubscriptions,
  modelControlEnabled,
  availableChatModels,
  currentModel,
  currentReasoning,
  setChatModelSettings,
  agentPermissionMode,
  setChatAgentPermissionMode,
  approvalPolicy,
  setChatApprovalPolicy,
  dockerSnapshotAfterAgentMessageEnabled,
  setDockerSnapshotAfterAgentMessageEnabled,
  setChatInfoError,
  modelDisabled,
  loadingChatModels,
  chatModelsError,
  chatModelsStale,
  currentDroneRepoAttached,
  currentDroneRepoPath,
  openDroneTerminal,
  openingTerminal,
  openDroneEditor,
  openingEditor,
  pullRepoChanges,
  pushRepoChanges,
  localCheckout,
  localCheckoutLoading,
  localCheckoutBusy,
  useRepoLocally,
  updateRepoLocally,
  setLocalAutoUpdates,
  returnRepoLocalCheckout,
  applyRepoLocalCheckout,
  onRequestDropActions,
  repoOp,
  headerOverflowRef,
  reseedRepo,
  terminalMenuRef,
  terminalLabel,
  terminalOptions,
  requestRightPanelTab,
  rightPanelTabs,
  rightPanelTab,
  setRightPanelTab,
  rightPanelTabLabels,
  transcripts,
  visiblePendingPromptsWithStartup,
  transcriptMessageId,
  spawnDroneHubTaskFromAgentMessage,
  outputScrollRef,
  updatePinned,
  startupSeedForCurrentDrone,
  clearStartupSeedForDrone,
  sessionText,
  pinnedToBottom,
  selectedDroneIdentity,
  promptError,
  sendPromptText,
  onSendPromptInNewChat,
  publishSelectedDraft,
  publishingDraft,
  canStopResponse,
  requestStopResponse,
  stoppingResponse,
  stopResponseError,
  requestCancelPendingPrompt,
  cancellingPendingPromptById,
  cancelPendingPromptErrorById,
  onCreateQueuedNewChatNow,
  focusedNewChatActionId,
  onCreateNewChatAutoFocusHandled,
  promotingNewChatActionById,
  promoteNewChatActionErrorById,
  openedEditorFileOpenFailureMessage,
  openedEditorFileOpenFailureAt,
  onOpenMarkdownFileReference,
  rightPanelOpenRequestSeq,
  visibleToolTabs,
  onVisibleToolTabsChange,
  renderRightPanelTabContent,
  onPersistentPreviewHostChange,
}: SelectedDroneWorkspaceProps) {
  const {
    sidebarCollapsed,
    terminalMenuOpen,
    headerOverflowOpen,
    outputView,
    selectedChat,
    terminalEmulator,
    setSidebarCollapsed,
    setTerminalMenuOpen,
    setHeaderOverflowOpen,
    setOutputView,
    setSelectedChat,
    setTerminalEmulator,
  } = useSelectedDroneWorkspaceUiState();
  const explicitSelectedChat = String(selectedChat ?? '').trim();
  const activeChatName = React.useMemo(
    () => explicitSelectedChat || resolveChatNameForDrone(currentDrone, selectedChat),
    [currentDrone, explicitSelectedChat, selectedChat],
  );
  const selectedChatIsDraft = currentDrone.draftChats?.[activeChatName] === true;
  const currentDroneIsDraft = currentDrone.draft === true || currentDrone.hubPhase === 'draft';
  const currentChatIsDraft = currentDroneIsDraft || selectedChatIsDraft;
  const externalTimelineItems = React.useMemo(
    () => buildChatTimelineItems(transcripts ?? [], visiblePendingPromptsWithStartup),
    [transcripts, visiblePendingPromptsWithStartup],
  );
  const {
    bindContentRef: bindTranscriptContentRef,
    bindScrollRef: bindTranscriptScrollRef,
    scrollRef: transcriptScrollRef,
    scrollToBottom: scrollTranscriptToBottom,
    updatePinned: updateTranscriptPinned,
  } = usePinnedTranscriptScroll({
    contextKey: `${currentDrone.id}:${activeChatName}`,
    contentVersion: externalTimelineItems,
    enabled: chatUiMode === 'transcript' && (currentAgentKey !== 'native' || currentChatIsDraft),
  });
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
  }, [chatUiMode, outputScrollRef, transcriptScrollRef]);
  const restoreWorkspaceChatScroll = React.useCallback(() => {
    const snapshot = workspaceChatScrollSnapshotRef.current;
    if (!snapshot) return;
    requestAnimationFrame(() => {
      const node =
        snapshot.mode === 'transcript' ? transcriptScrollRef.current : outputScrollRef.current;
      workspaceChatScrollSnapshotRef.current = null;
      if (!node) return;
      const heightDelta = node.scrollHeight - snapshot.scrollHeight;
      const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      node.scrollTop = Math.min(maxScrollTop, Math.max(0, snapshot.scrollTop + heightDelta));
      if (snapshot.mode === 'transcript') updateTranscriptPinned(node);
      else updatePinned(node);
    });
  }, [outputScrollRef, transcriptScrollRef, updatePinned, updateTranscriptPinned]);
  const currentDroneHomePath = React.useMemo(() => droneHomePath(currentDrone), [currentDrone]);
  const [codexApprovalBusyId, setCodexApprovalBusyId] = React.useState('');
  const [codexApprovalErrors, setCodexApprovalErrors] = React.useState<Record<string, string>>({});
  const [resolvedCodexApprovalIds, setResolvedCodexApprovalIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  React.useEffect(() => {
    setCodexApprovalBusyId('');
    setCodexApprovalErrors({});
    setResolvedCodexApprovalIds(new Set());
  }, [activeChatName, currentDrone.id]);
  const resolveCodexApproval = React.useCallback(
    async (approval: CodexPendingApproval, decision: CodexApprovalDecision) => {
      if (codexApprovalBusyId) return;
      setCodexApprovalBusyId(approval.id);
      setCodexApprovalErrors((current) => {
        const next = { ...current };
        delete next[approval.id];
        return next;
      });
      try {
        await requestJson(
          `/api/drones/${encodeURIComponent(currentDrone.id)}/chats/${encodeURIComponent(activeChatName)}/approvals/${encodeURIComponent(approval.promptId)}/${encodeURIComponent(approval.id)}/${decision}`,
          { method: 'POST' },
        );
        setResolvedCodexApprovalIds((current) => new Set(current).add(approval.id));
      } catch (error: any) {
        setCodexApprovalErrors((current) => ({
          ...current,
          [approval.id]: error?.message ?? String(error),
        }));
      } finally {
        setCodexApprovalBusyId((current) => (current === approval.id ? '' : current));
      }
    },
    [activeChatName, codexApprovalBusyId, currentDrone.id],
  );
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
    () =>
      Array.isArray(currentDrone.chats) &&
      currentDrone.chats.some((chat) => String(chat ?? '').trim().length > 0),
    [currentDrone.chats],
  );
  const syncMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [syncMenuOpen, setSyncMenuOpen] = React.useState(false);
  useDropdownDismiss(syncMenuRef, syncMenuOpen, setSyncMenuOpen);
  React.useEffect(() => {
    setSyncMenuOpen(false);
  }, [currentDrone.id, repoOp?.kind]);
  const hostRuntime = isHostRuntimeDrone(currentDrone);
  const dockerSnapshotSupported = !hostRuntime && currentDrone.persistVolume === false;
  const readOnlySupported =
    currentAgentKey === 'native' ||
    currentAgentKey === 'builtin:codex' ||
    currentAgentKey === 'builtin:blip';
  const approvalPolicySupported =
    currentAgentKey === 'native' || currentAgentKey === 'builtin:codex';
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
  const dockerSize =
    dockerSizeState.droneId === currentDrone.id
      ? dockerSizeState.dockerSize
      : (currentDrone.dockerSize ?? null);
  const dockerSizeLoading = dockerSizeState.droneId === currentDrone.id && dockerSizeState.loading;
  const dockerSizeError =
    dockerSizeState.droneId === currentDrone.id ? dockerSizeState.error : null;
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
      ? 'Applying'
      : repoOp?.kind === 'push'
        ? 'Pulling host'
        : repoOp?.kind === 'pull-from-drone'
          ? 'Pulling drone'
          : repoOp?.kind === 'push-to-drone'
            ? 'Applying to drone'
            : repoOp?.kind === 'reseed'
              ? 'Reseeding'
              : 'Sync';
  const localSession = localCheckout?.session ?? null;
  const localActiveForCurrentDrone = localSession?.droneId === currentDrone.id;
  const localActiveForAnotherDrone = Boolean(localSession && !localActiveForCurrentDrone);
  const localActionDisabled = localCheckoutLoading || localCheckoutBusy || Boolean(repoOp);
  const syncButtonLabel = localCheckoutBusy ? 'Working…' : repoSyncBusyLabel;
  const syncDisabled =
    isDroneStartingOrSeeding(currentDrone.hubPhase) ||
    Boolean(openingEditor) ||
    Boolean(openingTerminal) ||
    Boolean(repoOp) ||
    localCheckoutBusy;
  const selectLocalAutoUpdates = (mode: LocalAutoUpdates) => {
    if (localActiveForCurrentDrone) {
      if ((localCheckout?.autoUpdates ?? 'off') === mode) return;
      void setLocalAutoUpdates(mode);
      return;
    }
    void useRepoLocally(mode);
  };
  const {
    fleetBadgeDropActive,
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
  const nativeChatActive = currentAgentKey === 'native' && !currentChatIsDraft;
  const chatConfigResolution = chatConfigResolutionState({
    currentChatIsDraft,
    hasChats,
    metadataAvailable: chatRuntimeMetadataAvailable,
    loading: loadingChatInfo,
    startupFailed: currentDrone.hubPhase === 'error',
  });
  const chatConfigPending = chatConfigResolution === 'loading';
  const chatConfigFailed = chatConfigResolution === 'unavailable';
  const droneStartupFailed = chatConfigResolution === 'drone-error';
  const droneStartupError = String(currentDrone.hubMessage ?? currentDrone.statusError ?? '').trim();
  const showDroneStartupFailureEmptyState = shouldShowDroneStartupFailureEmptyState({
    startupFailed: droneStartupFailed,
    transcriptCount: transcripts?.length ?? 0,
    pendingPromptCount: visiblePendingPromptsWithStartup.length,
  });
  const genericChatActive =
    !nativeChatActive &&
    !chatConfigFailed &&
    (currentChatIsDraft || !hasChats || chatRuntimeMetadataAvailable);
  const chatComposerControlsAvailable = genericChatActive || nativeChatActive;
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
      ? selectedChatDockerSnapshotBusy ||
        visiblePendingPromptsWithStartup.some(pendingPromptShowsWorkingState)
      : showRespondingAsStatusInHeader || canStopResponse;
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
  const visibleCliPendingPrompts = React.useMemo(() => {
    if (chatUiMode !== 'cli') return [];
    return visiblePendingPromptsWithStartup.filter((item) => item.state !== 'failed').slice(-3);
  }, [chatUiMode, visiblePendingPromptsWithStartup]);
  const shouldAutoFocusInput = React.useMemo(() => {
    if (chatUiMode === 'transcript') {
      return (
        !loadingTranscript &&
        (transcripts?.length ?? 0) === 0 &&
        visiblePendingPromptsWithStartup.length === 0
      );
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
  const [workspacePaneHeaderMode, setWorkspacePaneHeaderModeState] =
    React.useState<WorkspacePaneHeaderMode>(() => readWorkspacePaneHeaderMode());
  const [droneControlsMenuOpen, setDroneControlsMenuOpen] = React.useState(false);
  const [droneHubPermissionsOpen, setDroneHubPermissionsOpen] = React.useState(false);
  const chatMcpAccess = useChatMcpAccess(
    currentDrone.id,
    activeChatName,
    !nativeChatActive && hasChats && chatUiMode === 'transcript',
  );
  const chatMcpAccessDropId = `chat-mcp-access:${currentDrone.id}:${activeChatName}`;
  const { isOver: chatMcpAccessDropActive, setNodeRef: setChatMcpAccessDropNodeRef } = useDroppable(
    { id: chatMcpAccessDropId },
  );
  useDndMonitor({
    onDragEnd(event) {
      if (chatMcpAccess.loading || !chatMcpAccess.available) {
        return;
      }
      if (String(event.over?.id ?? '') !== chatMcpAccessDropId) return;
      const droneIds = assignedDroneIdsFromData(parseDroneHubDragData(event.active.data.current));
      if (droneIds.length === 0) return;
      void chatMcpAccess.addSelectedDrones(droneIds);
    },
  });
  React.useEffect(() => {
    setDroneHubPermissionsOpen(false);
  }, [activeChatName, currentDrone.id]);

  const openPullRequestsTab = React.useCallback(() => {
    requestRightPanelTab('prs');
  }, [requestRightPanelTab]);
  const quickOpenTabUrl = resolveDroneOpenTabUrl(currentDrone);
  const quickOpenTabDisabled = isDroneStartingOrSeeding(currentDrone.hubPhase) || !quickOpenTabUrl;
  const [fileOpenToast, setFileOpenToast] = React.useState<{ id: number; message: string } | null>(
    null,
  );
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
  const availableTranscriptItems = React.useMemo(
    () => (Array.isArray(transcripts) ? transcripts : []),
    [transcripts],
  );
  const transcriptExportDisabled =
    chatUiMode !== 'transcript' ||
    loadingTranscript ||
    exportingTranscript ||
    availableTranscriptItems.length === 0;

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
    [
      activeChatName,
      availableTranscriptItems,
      currentDrone.id,
      currentDrone.name,
      currentDroneLabel,
    ],
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
      const markdown = formatTranscriptMarkdown(
        buildTranscriptExportArgs(exportedAt, fullTranscript),
      );
      await copyText(markdown);
      showTranscriptExportToast('Transcript copied as Markdown.');
    } catch (error: any) {
      showTranscriptExportToast(error?.message ?? 'Unable to load the full transcript.');
    }
  }, [
    buildTranscriptExportArgs,
    loadTranscriptForExport,
    showTranscriptExportToast,
    transcriptExportDisabled,
  ]);

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
    if (
      !currentDroneRepoAttached ||
      isDroneStartingOrSeeding(currentDrone.hubPhase) ||
      !currentDroneRepoPath.trim()
    ) {
      repoIdentityRef.current = null;
      return;
    }
    const data = pullRequestSummary.pullRequestsData;
    if (!data) {
      repoIdentityRef.current = null;
      return;
    }
    const owner = String(data?.github?.owner ?? '')
      .trim()
      .toLowerCase();
    const repo = String(data?.github?.repo ?? '')
      .trim()
      .toLowerCase();
    repoIdentityRef.current = owner && repo ? { owner, repo } : null;
  }, [
    currentDrone.hubPhase,
    currentDroneRepoAttached,
    currentDroneRepoPath,
    pullRequestSummary.pullRequestsData,
  ]);

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
      if (knownRepo && (knownRepo.owner !== parsed.owner || knownRepo.repo !== parsed.repo))
        return false;
      requestRightPanelTab('prs');
      requestChangesPullRequest({ droneId: currentDrone.id, pullNumber: parsed.pullNumber });
      return true;
    },
    [currentDrone.hubPhase, currentDrone.id, currentDroneRepoAttached, requestRightPanelTab],
  );

  const openWorkspacePane = React.useCallback(
    (tab: RightPanelTab) => {
      setSyncMenuOpen(false);
      setTerminalMenuOpen(false);
      setDroneControlsMenuOpen(false);
      setHeaderOverflowOpen(false);
      requestRightPanelTab(tab);
    },
    [requestRightPanelTab],
  );

  const setWorkspacePaneHeaderMode = React.useCallback((next: WorkspacePaneHeaderMode) => {
    setWorkspacePaneHeaderModeState(next);
    writeWorkspacePaneHeaderMode(next);
  }, []);
  React.useEffect(() => {
    if (!headerOverflowOpen) setDroneControlsMenuOpen(false);
  }, [headerOverflowOpen]);

  const externalModelComposerControls = buildExternalAgentComposerControls({
    hasChats,
    modelControlEnabled,
    currentAgentKey,
    models: availableChatModels,
    currentModel,
    currentReasoning,
    modelDisabled,
    loading: loadingChatModels,
    error: chatModelsError,
    stale: chatModelsStale,
    transcripts,
    onUpdate: (settings) => {
      void setChatModelSettings(settings).catch((err: any) =>
        setChatInfoError(err?.message ?? String(err)),
      );
    },
  });
  const externalComposerMenuActions: ChatComposerMenuAction[] = [
    {
      id: 'drone-hub-permissions',
      label: 'DroneHub permissions',
      title: 'Configure what this chat can access through the DroneHub MCP server.',
      icon: <IconNetwork className="h-3.5 w-3.5" />,
      active: droneHubPermissionsOpen,
      onSelect: () => setDroneHubPermissionsOpen(true),
    },
  ];
  const externalComposerControls = {
    ...(externalModelComposerControls ?? { controls: [] }),
    menuActions: [
      ...(externalModelComposerControls?.menuActions ?? []),
      ...externalComposerMenuActions,
    ],
  };
  const externalLeadingComposerControls = chatComposerControlsAvailable ? (
    <AgentComposerPicker
      value={currentAgentKey}
      label={agentLabel}
      entries={toolbarAgentMenuEntries}
      onChange={pickAgentValue}
      disabled={agentLocked || agentDisabled || chatInputWaiting}
    />
  ) : null;
  const externalTrailingComposerControls = chatComposerControlsAvailable ? (
    <NewDroneAccessPicker
      permissionMode={agentPermissionMode}
      onPermissionModeChange={(nextMode) => {
        void setChatAgentPermissionMode(nextMode).catch((err: any) =>
          setChatInfoError(err?.message ?? String(err)),
        );
      }}
      approvalPolicy={approvalPolicy}
      onApprovalPolicyChange={(nextPolicy) => {
        void setChatApprovalPolicy(nextPolicy).catch((err: any) =>
          setChatInfoError(err?.message ?? String(err)),
        );
      }}
      readOnlySupported={readOnlySupported}
      approvalsSupported={approvalPolicySupported}
      agentIsCodex={currentAgentKey === 'builtin:codex'}
      disabled={loadingChatInfo || chatInputWaiting}
    />
  ) : null;

  let latestFileChangesTimelineIndex = -1;
  for (let index = externalTimelineItems.length - 1; index >= 0; index -= 1) {
    if (!externalTimelineItems[index]?.item.fileChanges) continue;
    latestFileChangesTimelineIndex = index;
    break;
  }
  const externalTranscriptItems: AgentChatTranscriptItem[] = [];
  for (let timelineIndex = 0; timelineIndex < externalTimelineItems.length; timelineIndex += 1) {
    const entry = externalTimelineItems[timelineIndex]!;
    if (entry.kind === 'pending') {
      const prompt = entry.item;
      externalTranscriptItems.push({
        key: `pending:${prompt.id}`,
        kind: 'pending',
        content: ({ isLatestActivity }) => (
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
            onCreateNewChatNow={onCreateQueuedNewChatNow}
            createNewChatBusy={Boolean(promotingNewChatActionById[prompt.id])}
            createNewChatError={promoteNewChatActionErrorById[prompt.id] ?? null}
            autoFocusCreateNewChat={focusedNewChatActionId === prompt.id}
            onCreateNewChatAutoFocusHandled={onCreateNewChatAutoFocusHandled}
            autoExpandPrompt={isLatestActivity}
            initiallyExpandFileChanges={
              isLatestActivity && timelineIndex === latestFileChangesTimelineIndex
            }
          />
        ),
      });
      for (const approval of prompt.approvals ?? []) {
        if (resolvedCodexApprovalIds.has(approval.id)) continue;
        externalTranscriptItems.push({
          key: `approval:${approval.id}`,
          kind: 'message',
          content: () => (
            <CodexApprovalCard
              approval={approval}
              busy={codexApprovalBusyId === approval.id}
              error={codexApprovalErrors[approval.id] ?? null}
              onDecision={(decision) => void resolveCodexApproval(approval, decision)}
            />
          ),
        });
      }
      continue;
    }
    const turn = entry.item;
    const messageId = transcriptMessageId(turn);
    externalTranscriptItems.push({
      key: `transcript:${messageId}`,
      kind: 'message',
      content: ({ isLatestActivity }) => (
        <TranscriptTurn
          item={turn}
          autoExpandAgentMessage={isLatestActivity}
          initiallyExpandFileChanges={
            isLatestActivity && timelineIndex === latestFileChangesTimelineIndex
          }
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
  }
  return (
    <>
      {/* Header - spans full workspace width */}
      <DroneWorkspaceHeaderFrame selectedHeader>
        <div className="flex h-11 items-center px-3">
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
              <div className="flex min-w-0 flex-col justify-center">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="max-w-[min(34vw,360px)] truncate dh-type-title dh-type-workspace-title !text-[.875rem]">
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
                </div>
              </div>
            </div>
            {/* Status indicators */}
            <div data-drone-header-status="true" className="flex items-center gap-2 flex-shrink-0">
              {chatUiMode === 'cli' ? (
                <>
                  {sessionError && !loadingSession && (
                    <span
                      className="text-[var(--text-11)] text-[var(--red)] flex items-center gap-1"
                      title={sessionError}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
                      Error
                    </span>
                  )}
                </>
              ) : (
                <>
                  {transcriptError && !loadingTranscript && (
                    <span
                      className="text-[var(--text-11)] text-[var(--red)] flex items-center gap-1"
                      title={transcriptError}
                    >
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
                  title={
                    launchHint.launcher
                      ? `Launched: ${launchHint.launcher}`
                      : 'Paste the copied command into a terminal.'
                  }
                >
                  Command copied
                  {launchHint.launcher ? ` • ${launchHint.launcher.split(' ')[0]}` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Tier 2: Toolbar */}
        <div
          data-drone-header-toolbar="true"
          className="absolute right-3 top-1/2 flex max-w-[calc(100%-22rem)] -translate-y-1/2 flex-wrap items-center justify-end gap-1.5"
        >
          {currentDroneRepoAttached && !hostRuntime && (
            <>
              <LocalAutoUpdatesControl
                active={localActiveForCurrentDrone}
                activeForAnotherDroneName={
                  localActiveForAnotherDrone ? localSession?.droneName || 'Another drone' : null
                }
                mode={localActiveForCurrentDrone ? (localCheckout?.autoUpdates ?? 'off') : 'off'}
                disabled={syncDisabled || localActionDisabled}
                onSelect={selectLocalAutoUpdates}
              />
              <div ref={syncMenuRef} className="relative">
                <HeaderActionButton
                  onClick={() => {
                    setHeaderOverflowOpen(false);
                    setTerminalMenuOpen(false);
                    setSyncMenuOpen((open) => !open);
                  }}
                  disabled={syncDisabled}
                  title="Sync this drone repo with the host"
                  aria-haspopup="menu"
                  aria-expanded={syncMenuOpen}
                  className="dh-type-header-action--emphasis"
                >
                  <span>{syncButtonLabel}</span>
                  <IconChevron down={!syncMenuOpen} className="opacity-75" />
                </HeaderActionButton>
                {syncMenuOpen && !syncDisabled ? (
                  <HeaderDropdownPortal open={syncMenuOpen} anchorRef={syncMenuRef} width={260}>
                    <div>
                      {localActiveForCurrentDrone ? (
                        <>
                          <div className="px-3 py-2 text-[var(--text-10)] text-[var(--muted)]">
                            <div className="text-[var(--fg-secondary)]">
                              Using this drone locally
                            </div>
                            <div className="mt-0.5">
                              {localSession?.snapshotKind === 'working-tree'
                                ? `${localSession.sourceDirtyFileCount} uncommitted ${
                                    localSession.sourceDirtyFileCount === 1 ? 'file' : 'files'
                                  } included`
                                : 'Committed changes'}
                            </div>
                          </div>
                          <div className={contextMenuSeparatorClass} />
                          <button
                            type="button"
                            disabled={localActionDisabled}
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void updateRepoLocally();
                            }}
                            className={cn(
                              dropdownMenuItemBaseClass,
                              'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                            role="menuitem"
                            title="Refresh the host working tree from this drone"
                          >
                            <HeaderMenuItemIcon><IconRefresh className="h-3.5 w-3.5" /></HeaderMenuItemIcon>
                            <span>Update</span>
                          </button>
                          <button
                            type="button"
                            disabled={localActionDisabled}
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void applyRepoLocalCheckout();
                            }}
                            className={cn(
                              dropdownMenuItemBaseClass,
                              'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                            role="menuitem"
                            title="Apply this exact version through the normal host merge flow"
                          >
                            <HeaderMenuItemIcon>
                              <IconFileDiff className="h-3.5 w-3.5" />
                            </HeaderMenuItemIcon>
                            <span>Apply</span>
                          </button>
                          <button
                            type="button"
                            disabled={localActionDisabled}
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void returnRepoLocalCheckout();
                            }}
                            className={cn(
                              dropdownMenuItemBaseClass,
                              'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                            role="menuitem"
                            title="Return to the branch that was checked out before using this drone locally"
                          >
                            <HeaderMenuItemIcon>
                              <IconChevronLeft className="h-3.5 w-3.5" />
                            </HeaderMenuItemIcon>
                            <span>Return</span>
                          </button>
                          <div className={contextMenuSeparatorClass} />
                          <div className="px-3 pb-1 pt-2 text-[var(--text-10)] uppercase tracking-wide text-[var(--muted)]">
                            Auto-updates
                          </div>
                          {LOCAL_AUTO_UPDATE_OPTIONS.map(({ mode, label }) => (
                            <HeaderMenuRadioRow
                              key={mode}
                              label={label}
                              checked={(localCheckout?.autoUpdates ?? 'off') === mode}
                              disabled={localActionDisabled}
                              onSelect={() => {
                                setSyncMenuOpen(false);
                                selectLocalAutoUpdates(mode);
                              }}
                            />
                          ))}
                        </>
                      ) : (
                        <>
                          {localActiveForAnotherDrone ? (
                            <div className="px-3 py-2 text-[var(--text-10)] text-[var(--muted)]">
                              Switches local use from {localSession?.droneName || 'the other drone'}
                              .
                            </div>
                          ) : null}
                          <button
                            type="button"
                            disabled={localActionDisabled}
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void useRepoLocally();
                            }}
                            className={cn(
                              dropdownMenuItemBaseClass,
                              'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                            role="menuitem"
                            title={
                              localCheckout?.autoUpdates === 'all'
                                ? "Use this drone's committed and uncommitted code in the current host working tree"
                                : "Use this drone's committed code in the current host working tree"
                            }
                          >
                            <HeaderMenuItemIcon>
                              <IconMonitor className="h-3.5 w-3.5" />
                            </HeaderMenuItemIcon>
                            <span>Use locally</span>
                          </button>
                          <div className={contextMenuSeparatorClass} />
                          <button
                            type="button"
                            disabled={localCheckoutBusy}
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void pullRepoChanges();
                            }}
                            className={cn(
                              dropdownMenuItemBaseClass,
                              'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                            role="menuitem"
                            title="Apply this drone repo into the host repo"
                          >
                            <HeaderMenuItemIcon>
                              <IconFileDiff className="h-3.5 w-3.5" />
                            </HeaderMenuItemIcon>
                            <span>Apply to host</span>
                          </button>
                          <button
                            type="button"
                            disabled={localCheckoutBusy}
                            onClick={() => {
                              setSyncMenuOpen(false);
                              void pushRepoChanges();
                            }}
                            className={cn(
                              dropdownMenuItemBaseClass,
                              'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                            role="menuitem"
                            title="Pull the current host branch into this drone repo"
                          >
                            <HeaderMenuItemIcon>
                              <IconGitPullRequest className="h-3.5 w-3.5" />
                            </HeaderMenuItemIcon>
                            <span>Pull from host</span>
                          </button>
                        </>
                      )}
                    </div>
                  </HeaderDropdownPortal>
                ) : null}
              </div>
            </>
          )}
          {/* Overflow menu */}
          <div ref={headerOverflowRef as React.RefObject<HTMLDivElement>} className="relative">
            <HeaderActionButton
              onClick={() => {
                setSyncMenuOpen(false);
                setTerminalMenuOpen(false);
                setDroneControlsMenuOpen(false);
                setHeaderOverflowOpen((v) => !v);
              }}
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={headerOverflowOpen}
              className="dh-type-header-action--emphasis"
            >
              <span>Actions</span>
              <IconChevron down={!headerOverflowOpen} className="opacity-75" />
            </HeaderActionButton>
            {headerOverflowOpen && (
              <HeaderDropdownPortal
                open={headerOverflowOpen}
                anchorRef={headerOverflowRef}
                width={280}
              >
                <div className="max-h-[calc(100dvh-5rem)] overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      openDroneTerminal('ssh');
                    }}
                    disabled={
                      isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingTerminal)
                    }
                    className={cn(
                      dropdownMenuItemBaseClass,
                      'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    role="menuitem"
                    title={`SSH into "${currentDroneLabel}"`}
                  >
                    <HeaderMenuItemIcon><IconTerminal className="h-3.5 w-3.5" /></HeaderMenuItemIcon>
                    <span>SSH</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      openDroneTabFromLastPreview(currentDrone);
                    }}
                    disabled={quickOpenTabDisabled}
                    className={cn(
                      dropdownMenuItemBaseClass,
                      'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    role="menuitem"
                    title={
                      quickOpenTabUrl
                        ? `Open ${quickOpenTabUrl} in a new browser tab`
                        : 'No preview port selected yet'
                    }
                  >
                    <HeaderMenuItemIcon>
                      <IconMonitor className="h-3.5 w-3.5" />
                    </HeaderMenuItemIcon>
                    <span>Open default tab</span>
                  </button>
                  <div className={contextMenuSeparatorClass} />
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      copyTranscriptMarkdown();
                    }}
                    disabled={transcriptExportDisabled}
                    className={cn(
                      dropdownMenuItemBaseClass,
                      'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    role="menuitem"
                    title={
                      transcriptExportDisabled
                        ? 'No completed transcript turns are available yet.'
                        : 'Copy the current chat transcript as Markdown'
                    }
                  >
                    <HeaderMenuItemIcon><IconCopy className="h-3.5 w-3.5" /></HeaderMenuItemIcon>
                    <span>Copy transcript</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      downloadTranscriptJson();
                    }}
                    disabled={transcriptExportDisabled}
                    className={cn(
                      dropdownMenuItemBaseClass,
                      'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    role="menuitem"
                    title={
                      transcriptExportDisabled
                        ? 'No completed transcript turns are available yet.'
                        : 'Download the current chat transcript as JSON'
                    }
                  >
                    <HeaderMenuItemIcon>
                      <IconDownload className="h-3.5 w-3.5" />
                    </HeaderMenuItemIcon>
                    <span>Download transcript</span>
                  </button>
                  <div className={contextMenuSeparatorClass} />
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      openDroneTerminal('agent');
                    }}
                    disabled={
                      isDroneStartingOrSeeding(currentDrone.hubPhase) || Boolean(openingTerminal)
                    }
                    className={cn(
                      dropdownMenuItemBaseClass,
                      'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    role="menuitem"
                  >
                    <HeaderMenuItemIcon>
                      <IconChat className="h-3.5 w-3.5" />
                    </HeaderMenuItemIcon>
                    <span>SSH + Agent session</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      openDroneEditor('code');
                    }}
                    disabled={
                      isDroneStartingOrSeeding(currentDrone.hubPhase) ||
                      Boolean(openingEditor) ||
                      Boolean(openingTerminal)
                    }
                    className={cn(
                      dropdownMenuItemBaseClass,
                      'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    role="menuitem"
                  >
                    <HeaderMenuItemIcon><IconVsCode className="h-3.5 w-3.5" /></HeaderMenuItemIcon>
                    <span>Open VS Code</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderOverflowOpen(false);
                      openDroneEditor('cursor');
                    }}
                    disabled={
                      isDroneStartingOrSeeding(currentDrone.hubPhase) ||
                      Boolean(openingEditor) ||
                      Boolean(openingTerminal)
                    }
                    className={cn(
                      dropdownMenuItemBaseClass,
                      'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    role="menuitem"
                  >
                    <HeaderMenuItemIcon>
                      <IconCursorApp className="h-3.5 w-3.5" />
                    </HeaderMenuItemIcon>
                    <span>Open Cursor</span>
                  </button>
                  {currentDroneRepoAttached && (
                    <>
                      <div className={contextMenuSeparatorClass} />
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderOverflowOpen(false);
                          void reseedRepo();
                        }}
                        disabled={
                          isDroneStartingOrSeeding(currentDrone.hubPhase) ||
                          Boolean(openingEditor) ||
                          Boolean(openingTerminal) ||
                          Boolean(repoOp)
                        }
                        className={cn(
                          dropdownMenuItemBaseClass,
                          'text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed',
                        )}
                        role="menuitem"
                        title={
                          hostRuntime
                            ? 'Host runtime uses the host repository directly; this action is a no-op.'
                            : undefined
                        }
                      >
                        <HeaderMenuItemIcon>
                          <IconRefresh className="h-3.5 w-3.5" />
                        </HeaderMenuItemIcon>
                        <span>{hostRuntime ? 'Reseed repo (noop)' : 'Reseed repo'}</span>
                      </button>
                    </>
                  )}
                  <div className={contextMenuSeparatorClass} />
                  <div
                    ref={terminalMenuRef as React.RefObject<HTMLDivElement>}
                    className="relative"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDroneControlsMenuOpen(false);
                        setTerminalMenuOpen((v) => !v);
                      }}
                      className={cn(
                        dropdownMenuItemBaseClass,
                        'text-[var(--fg-secondary)] hover:bg-[var(--hover)] flex items-center justify-between',
                      )}
                      role="menuitem"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <HeaderMenuItemIcon>
                          <IconTerminal className="h-3.5 w-3.5" />
                        </HeaderMenuItemIcon>
                        <span className="truncate">Terminal: {terminalLabel}</span>
                      </span>
                      <IconChevron
                        down={!terminalMenuOpen}
                        className="text-[var(--muted-dim)] opacity-60"
                      />
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
                                active
                                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-[var(--weight-semibold)]'
                                  : 'text-[var(--muted)] hover:bg-[var(--hover)]'
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
                  <div className={contextMenuSeparatorClass} />
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setTerminalMenuOpen(false);
                        setDroneControlsMenuOpen((open) => !open);
                      }}
                      className={cn(
                        dropdownMenuItemBaseClass,
                        'flex items-center justify-between text-[var(--fg-secondary)] hover:bg-[var(--hover)]',
                      )}
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={droneControlsMenuOpen}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <HeaderMenuItemIcon>
                          <IconTune className="h-3.5 w-3.5" />
                        </HeaderMenuItemIcon>
                        <span>Drone controls</span>
                      </span>
                      <IconChevron
                        down={!droneControlsMenuOpen}
                        className="text-[var(--muted-dim)] opacity-60"
                      />
                    </button>
                    {droneControlsMenuOpen ? (
                      <div
                        className="border-t border-[var(--border-subtle)] bg-[var(--surface-inset-faint)]"
                        role="group"
                        aria-label="Drone controls"
                      >
                        {!hostRuntime ? (
                          <div
                            className="flex items-center justify-between gap-4 px-3 py-1.5 text-[var(--text-11)] text-[var(--muted)]"
                            title={dockerSizeTitle}
                          >
                            <span>Docker usage</span>
                            <span className="truncate text-right font-mono text-[var(--muted-dim)]">
                              {dockerSizeLabel.replace(/^Docker used\s*/i, '')}
                            </span>
                          </div>
                        ) : null}
                        {hasChats && chatUiMode === 'transcript' ? (
                          <>
                            <HeaderMenuToggleRow
                              label="Snapshots"
                              value={dockerSnapshotAfterAgentMessageEnabled ? 'On' : 'Off'}
                              checked={dockerSnapshotAfterAgentMessageEnabled}
                              disabled={loadingChatInfo || !dockerSnapshotSupported}
                              title={
                                dockerSnapshotSupported
                                  ? 'Commit a Docker image snapshot after each new agent message in this chat.'
                                  : 'Snapshots require a container drone created with Persist volume off.'
                              }
                              onToggle={() => {
                                if (!dockerSnapshotSupported) return;
                                void setDockerSnapshotAfterAgentMessageEnabled(
                                  !dockerSnapshotAfterAgentMessageEnabled,
                                ).catch((err: any) =>
                                  setChatInfoError(err?.message ?? String(err)),
                                );
                              }}
                            />
                          </>
                        ) : null}
                        {chatUiMode === 'cli' ? (
                          <HeaderMenuToggleRow
                            label="Output view"
                            value={outputView === 'screen' ? 'Screen' : 'Log'}
                            checked={outputView === 'screen'}
                            title={
                              outputView === 'screen'
                                ? 'Switch to raw log view.'
                                : 'Switch to screen capture view.'
                            }
                            onToggle={() =>
                              setOutputView(outputView === 'screen' ? 'log' : 'screen')
                            }
                          />
                        ) : null}
                        <div className="flex items-center justify-between gap-4 px-3 py-1.5 text-[var(--text-11)]">
                          <span className="text-[var(--muted)]">Chat</span>
                          <span className="min-w-0 truncate font-mono text-[var(--fg-secondary)]">
                            {activeChatName}
                            {selectedChatIsDraft ? ' · Draft' : ''}
                          </span>
                        </div>
                        <HeaderMenuToggleRow
                          label="Pane headers"
                          value={workspacePaneHeaderMode === 'compact' ? 'Compact' : 'Normal'}
                          checked={workspacePaneHeaderMode === 'compact'}
                          title={
                            workspacePaneHeaderMode === 'compact'
                              ? 'Use normal pane headers.'
                              : 'Use compact pane headers.'
                          }
                          onToggle={() =>
                            setWorkspacePaneHeaderMode(
                              workspacePaneHeaderMode === 'compact' ? 'normal' : 'compact',
                            )
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </HeaderDropdownPortal>
            )}
          </div>
          {/* Workspace pane controls */}
          <div className="ml-1 h-5 w-px bg-[var(--border-subtle)]" />
          <div
            className="flex min-w-0 items-center gap-px"
            role="toolbar"
            aria-label="Workspace tools"
          >
            {rightPanelHeaderTabs(rightPanelTabs).map((tab, index, tabs) => {
              const prCount = tab === 'prs' ? Number(openPullRequestCount ?? 0) : 0;
              const open = visibleToolTabs.includes(tab);
              const label = rightPanelTabLabels[tab];
              const tooltip =
                tab === 'prs' && prCount > 0 ? `${label} (${prCount} open)` : label;
              return (
                <UiTooltip
                  key={tab}
                  content={tooltip}
                  side="bottom"
                  align={index === tabs.length - 1 ? 'end' : 'center'}
                >
                  <HeaderActionButton
                    onClick={() => openWorkspacePane(tab)}
                    data-onboarding-id={tab === 'changes' ? 'rightPanel.tab.changes' : undefined}
                    className={cn(
                      'relative !h-9 !w-9 !justify-center !rounded-[4px] !px-0',
                      open
                        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] !text-[var(--fg)]'
                        : '!text-[var(--chrome-muted)] hover:bg-[var(--hover)] hover:!text-[var(--fg-secondary)]',
                    )}
                    aria-label={tooltip}
                    aria-pressed={open}
                  >
                    <span
                      className="flex h-[22px] w-[22px] items-center justify-center"
                      aria-hidden="true"
                    >
                      <WorkspaceToolIcon tab={tab} className="h-[22px] w-[22px]" />
                    </span>
                    {tab === 'prs' && prCount > 0 ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-px top-px flex h-3 min-w-3 items-center justify-center rounded-full border border-[var(--app-header-bg)] bg-[var(--accent)] px-[2px] font-mono text-[7px] font-[var(--weight-bold)] leading-none tabular-nums text-[var(--accent-contrast)]"
                      >
                        {prCount > 99 ? '99+' : prCount}
                      </span>
                    ) : null}
                  </HeaderActionButton>
                </UiTooltip>
              );
            })}
          </div>
        </div>
      </DroneWorkspaceHeaderFrame>

      <DockableDroneWorkspace
        key={currentDrone.id}
        currentDrone={currentDrone}
        paneHeaderMode={workspacePaneHeaderMode}
        activeToolTab={rightPanelTab}
        openRequestNonce={rightPanelOpenRequestSeq}
        renderToolPane={(tab, paneKey) => renderRightPanelTabContent(currentDrone, tab, paneKey)}
        previewTab="preview"
        onActiveToolTabChange={setRightPanelTab}
        onVisibleToolTabsChange={onVisibleToolTabsChange}
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
                    <div
                      className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.14em]"
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      Drone Drop Actions
                    </div>
                    <div className="mt-2 text-[var(--text-13)] leading-5">{fleetDropHintText}</div>
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
              {droneHubPermissionsOpen && !nativeChatActive ? (
                <div className="absolute inset-0 z-30 overflow-y-auto">
                  <DroneHubPermissionsView
                    chatLabel={`${currentDroneLabel} · ${activeChatName}`}
                    available={chatMcpAccess.available}
                    loading={chatMcpAccess.loading}
                    saving={chatMcpAccess.saving}
                    error={chatMcpAccess.error}
                    unavailableMessage={
                      chatUiMode === 'cli'
                        ? 'Terminal chats do not receive a DroneHub MCP credential. Use a managed agent chat to configure DroneHub access.'
                        : 'The DroneHub MCP server is not enabled for this chat.'
                    }
                    readMode={chatMcpAccess.accessScope.readMode}
                    writeMode={chatMcpAccess.accessScope.writeMode}
                    executeMode={chatMcpAccess.accessScope.executeMode}
                    selectedDrones={chatMcpAccess.accessScope.droneIds.map((droneId) => ({
                      id: droneId,
                      label: droneId === currentDrone.id ? currentDroneLabel : droneId,
                      removable: droneId !== currentDrone.id,
                    }))}
                    dropActive={chatMcpAccessDropActive}
                    dropTargetRef={setChatMcpAccessDropNodeRef}
                    onModeChange={(kind, mode) => void chatMcpAccess.setMode(kind, mode)}
                    onRemoveDrone={(droneId) => void chatMcpAccess.removeSelectedDrone(droneId)}
                    onBack={() => setDroneHubPermissionsOpen(false)}
                  />
                </div>
              ) : null}
              <div className="relative flex min-h-0 flex-1 flex-col">
                {showDroneStartupFailureEmptyState ? (
                  <EmptyState
                    icon={<IconChat className="h-8 w-8 text-[var(--red)]" />}
                    title="Drone failed to start"
                    description="The runtime failed before this chat could be created."
                    actions={
                      droneStartupError ? (
                        <button
                          type="button"
                          className="inline-flex h-9 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--surface-softest)] px-4 dh-type-control text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
                          onClick={() => openDroneErrorModal(currentDrone, droneStartupError, null)}
                        >
                          View startup error
                        </button>
                      ) : null
                    }
                  />
                ) : chatConfigPending ? (
                  <ChatSurfaceLoadingView
                    resetKey={`${selectedDroneIdentity}:${selectedChat ?? ''}:loading`}
                    draftPersistenceKey={chatDraftKey}
                    droneName={currentDrone.name}
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
                    startupPrompt={
                      startupSeedForCurrentDrone?.agent?.kind === 'native' &&
                      String(startupSeedForCurrentDrone.prompt ?? '').trim()
                        ? {
                            prompt: String(startupSeedForCurrentDrone.prompt).trim(),
                            at: startupSeedForCurrentDrone.at,
                          }
                        : null
                    }
                    onStartupPromptReconciled={() => clearStartupSeedForDrone(currentDrone.id)}
                    onSendPromptInNewChat={onSendPromptInNewChat}
                    onCreateQueuedNewChatNow={onCreateQueuedNewChatNow}
                    focusedNewChatActionId={focusedNewChatActionId}
                    onCreateNewChatAutoFocusHandled={onCreateNewChatAutoFocusHandled}
                    promotingNewChatActionById={promotingNewChatActionById}
                    promoteNewChatActionErrorById={promoteNewChatActionErrorById}
                    composerTopAction={
                      <DroneChatComposerMetadata
                        runtime={hostRuntime ? 'host' : 'container'}
                        chatId={chatId}
                        initialSubscriptions={chatSubscriptions}
                        branch={currentDrone.repoBranch}
                      />
                    }
                    composerLeadingControls={externalLeadingComposerControls}
                    composerTrailingControls={externalTrailingComposerControls}
                    messageFeatures={{
                      onSpawnTask: spawnCurrentDroneHubTask,
                      linkedPullRequestContext,
                      droneId: currentDrone.id,
                      droneHomePath: currentDroneHomePath,
                      onOpenFileReference: onOpenMarkdownFileReference,
                      onOpenLink: tryOpenMarkdownPullRequest,
                    }}
                  />
                ) : chatUiMode === 'transcript' ? (
                  <AgentChatTranscript
                    scrollRef={bindTranscriptScrollRef}
                    contentRef={bindTranscriptContentRef}
                    loading={
                      loadingTranscript &&
                      !transcripts &&
                      visiblePendingPromptsWithStartup.length === 0
                    }
                    hasContent={Boolean(
                      (transcripts && transcripts.length > 0) ||
                      visiblePendingPromptsWithStartup.length > 0,
                    )}
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
                    {isDroneStartingOrSeeding(currentDrone.hubPhase) &&
                      String(startupSeedForCurrentDrone?.prompt ?? '').trim() && (
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

              {genericChatActive && chatUiMode === 'cli' ? (
                <CliPendingPromptStrip items={visibleCliPendingPrompts} />
              ) : null}

              {genericChatActive ? (
                <ChatSurfaceComposer
                  resetKey={`${selectedDroneIdentity}:${selectedChat ?? ''}`}
                  draftPersistenceKey={chatDraftKey}
                  droneName={currentDrone.name}
                  focusTargetId="primary-chat"
                  promptError={stopResponseError || promptError}
                  publishing={publishingDraft}
                  waiting={chatInputWaiting}
                  composerTopAction={
                    <DroneChatComposerMetadata
                      runtime={hostRuntime ? 'host' : 'container'}
                      chatId={chatId}
                      initialSubscriptions={chatSubscriptions}
                      branch={currentDrone.repoBranch}
                    />
                  }
                  composerLeadingControls={externalLeadingComposerControls}
                  composerTrailingControls={externalTrailingComposerControls}
                  composerControls={externalComposerControls}
                  autoFocus={shouldAutoFocusInput}
                  onStop={
                    !currentChatIsDraft && canStopResponse ? () => requestStopResponse() : undefined
                  }
                  stopping={stoppingResponse}
                  onPublish={currentChatIsDraft ? publishSelectedDraft : undefined}
                  onSend={async (payload: ChatSendPayload, context: ChatSendContext) => {
                    if (chatUiMode === 'transcript') scrollTranscriptToBottom({ force: true });
                    const sent = await sendPromptText(payload, context);
                    if (sent && chatUiMode === 'transcript')
                      scrollTranscriptToBottom({ force: true });
                    return sent;
                  }}
                  onSendInNewChat={onSendPromptInNewChat}
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
                    <div
                      className="text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--red)]"
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      Open file failed
                    </div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--fg-secondary)] break-words">
                      {fileOpenToast.message}
                    </div>
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
