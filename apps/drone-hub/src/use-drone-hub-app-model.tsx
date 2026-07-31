import React from 'react';
import {
  type AgentApprovalPolicy,
  type AgentPermissionMode,
  type ChatAgentConfig,
  normalizeChatInfoPayload,
} from './domain';
import { requestJson } from './droneHub/http';
import { disposeDroneWorkspaceState } from './droneHub/workspace-state-events';
import { activeProfileStorageId, persistProfileStorageIdOverride } from './profile-storage';
import { requestGuidedOnboardingReplay, resetGuidedOnboardingDismissals } from './onboarding/control';
import { copyText } from './droneHub/app/clipboard';
import { isCanvasDraftNodeId, useDroneCanvasStore } from './droneHub/canvas/use-drone-canvas-store';
import { WHITEBOARD_OPEN_EVENT, writeActiveWhiteboardId } from './droneHub/whiteboard/whiteboard-events';
import {
  BUILTIN_AGENT_OPTIONS,
  HUB_LOGS_MAX_BYTES,
  HUB_LOGS_TAIL_LINES,
  RIGHT_PANEL_TAB_LABELS,
  rightPanelTabsForRuntime,
  STARTUP_SEED_MISSING_GRACE_MS,
  createCanvasChatNodeId,
  parseCanvasChatNodeId,
  type RightPanelTab,
} from './droneHub/app/app-config';
import type { DroneSidebarProps } from './droneHub/app/DroneSidebar';
import type { DroneDeleteConfirmModalDrone } from './droneHub/app/DroneDeleteConfirmModal';
import type { DroneHubOverlaysProps } from './droneHub/app/DroneHubOverlays';
import type { DroneHubWorkspaceContentProps } from './droneHub/app/DroneHubWorkspaceContent';
import { RightPanelTabContent } from './droneHub/app/RightPanelTabContent';
import { dispatchFleetAssignmentUpdated } from './droneHub/app/fleet-assignment-events';
import { assignFleetTargets } from './droneHub/fleet/fleet-api';
import { useHubLogs } from './droneHub/app/use-hub-logs';
import { useCreateDraftWorkflowState } from './droneHub/app/use-create-draft-workflow-store';
import { useAgentsMdLibraryCatalog } from './droneHub/app/use-agents-md-library-catalog';
import { useDroneCreationActions } from './droneHub/app/use-drone-creation-actions';
import { useChatRuntimeOrchestration } from './droneHub/app/use-chat-runtime-orchestration';
import { useDroneErrorModalActions } from './droneHub/app/use-drone-error-modal-actions';
import { useRepoBranchOptions } from './droneHub/app/use-repo-branch-options';
import { useDroneMutationActions } from './droneHub/app/use-drone-mutation-actions';
import { useFilesAndPortsPaneState } from './droneHub/app/use-files-and-ports-pane-state';
import { useFileEditorState } from './droneHub/app/use-file-editor-state';
import { useGroupBroadcast } from './droneHub/app/use-group-broadcast';
import { useGroupManagement } from './droneHub/app/use-group-management';
import { useLlmSettings } from './droneHub/app/use-llm-settings';
import { useUiPreferencesSettings } from './droneHub/app/use-ui-preferences-settings';
import {
  moveSidebarDroneToTopInNodeOrder,
  removeDroneIdsFromSidebarNodeOrderByParent,
} from './droneHub/app/sidebar-node-order';
import type { SidebarNodeTreeModel } from './droneHub/app/sidebar-node-tree';
import { resolveSelectedDronePinMutation } from './droneHub/app/pinned-drone-selection';
import { useDeleteActionSettings } from './droneHub/app/use-delete-action-settings';
import { useSetupStatus } from './droneHub/app/use-setup-status';
import type { DroneDeleteMode, ProfileSettingsResponse } from './droneHub/app/settings-types';
import { shellTerminalPrewarmKey, shouldPrewarmShellTerminal } from './droneHub/app/terminal-prewarm';
import { useQueuedPromptsState } from './droneHub/app/use-queued-prompts-state';
import { selectedChatRespondingStatus } from './droneHub/app/optimistic-pending-prompts';
import { useRightPanelLayout } from './droneHub/app/use-right-panel-layout';
import {
  resolveDroneDeleteTargetIds,
  type DroneSelectionClickOptions,
} from './droneHub/app/drone-selection-helpers';
import { useDroneSelectionState } from './droneHub/app/use-drone-selection-state';
import { SIDEBAR_VISIBLE_MULTI_CHAT_GROUP, useSidebarViewModel } from './droneHub/app/use-sidebar-view-model';
import { useChatConfigState } from './droneHub/app/use-chat-config-state';
import {
  resolveSpawnContextPreferencesForRepo,
  useDroneHubAppModelUiState,
  useDroneHubUiStore,
} from './droneHub/app/use-drone-hub-ui-store';
import { useDroneHubRuntimeState } from './droneHub/app/use-drone-hub-runtime-store';
import { useDroneHubLifecycleEffects } from './droneHub/app/use-drone-hub-lifecycle-effects';
import { useDroneHubRegistryData } from './droneHub/app/use-drone-hub-registry-data';
import { useDroneHubToolbarMenuState } from './droneHub/app/use-drone-hub-toolbar-menu-state';
import { useVoiceClipboardRecorder } from './droneHub/app/use-voice-clipboard-recorder';
import { transcriptMessageId } from './droneHub/app/transcript-message-id';
import { useWorkspaceNavigationActions } from './droneHub/app/use-workspace-navigation-actions';
import { useWorkspaceActions } from './droneHub/app/use-workspace-actions';
import { isWorkflowChildDrone } from './droneHub/workflows/workflow-drone-visibility';
import {
  loadDesktopNewDronePreferences,
  normalizeDesktopNewDronePreferences,
  saveDesktopNewDronePreferences,
} from './droneHub/app/new-drone-preferences';
import {
  resolveNewDroneContextFromCurrentSelection,
  shouldInheritNewDroneContextFromCurrentSelection,
} from './droneHub/app/new-drone-context';
import {
  approvalChatNodeIdsForDrone,
  busyChatNodeIdsForDrone,
  droneChatNodeIds,
  nextUnreadChatReadCursor,
  normalizedDroneChats,
  reconcileManualUnreadMarker,
  unreadChatNodeIdsForDrone,
  type ManualUnreadMarker,
} from './droneHub/app/chat-node-helpers';
import { orderSidebarEntries } from './droneHub/app/sidebar-group-order';
import {
  buildFleetAssignedIdsByDroneId,
  buildFleetParentIdByDroneId,
} from './droneHub/app/fleet-relationship-refs';
import {
  useDroneHubSidebarProps,
  useDroneHubOverlaysProps,
  useDroneHubWorkspaceContentProps,
} from './droneHub/app/use-drone-hub-view-props';
import type { MarkdownFileReference } from './droneHub/chat/MarkdownMessage';
import { ASSISTANT_OPEN_DRONE_CHAT_EVENT, type AssistantOpenDroneChatEventDetail } from './droneHub/assistant/open-drone-chat-event';
import { buildDroneHubTaskQueueSpec, type DroneHubTaskSpawnMode } from './droneHub/chat/drone-hub-task-spawn';
import {
  buildSuggestedChatNameCandidate,
  isGeneratedChatName,
  isSuggestedChatRenameConflict,
  isSuggestedChatRenameRetriable,
} from './droneHub/app/chat-name-suggestions';
import {
  chatInputDraftKeyForDroneChat,
  droneHomePath,
  isDroneStartingOrSeeding,
  makeId,
  normalizeContainerPathInput,
  resolveDroneFileOpenPath,
  resolveChatNameForDrone,
  suggestNextDroneChatName,
} from './droneHub/app/helpers';
import { allocateUntitledDisplayName } from './droneHub/app/name-helpers';
import {
  createTerminalPaneSessionsState,
} from './droneHub/terminal/terminal-tabs-state';
import { useTerminalPaneSessions } from './droneHub/terminal/use-terminal-pane-sessions';
import type { DronePortMapping, DroneSummary, PortReachabilityByHostPort } from './droneHub/types';

type PreviewPaneKey = 'single' | 'top' | 'bottom';
type PreviewPaneSnapshot = {
  drone: DroneSummary;
  currentDroneId: string | null;
  selectedPreviewPort: DronePortMapping | null;
  currentPortReachability: PortReachabilityByHostPort;
  portsLoading: boolean;
  portsError: string | null;
  portsErrorUi: string | null;
  portsPane: { waiting: boolean; timedOut: boolean };
  selectedPreviewDefaultUrl: string | null;
  selectedPreviewUrlOverride: string | null;
  setSelectedPreviewUrlOverride: (nextUrl: string | null) => void;
  portRows: DronePortMapping[];
};

type DroneDropActionModalState = {
  sourceDroneIds: string[];
  targetDroneId: string;
};

type DroneDeleteConfirmState = {
  drones: DroneDeleteConfirmModalDrone[];
};

const DRONE_DELETE_CONCURRENCY = 4;

export type DroneHubAppModel = {
  sidebarProps: DroneSidebarProps;
  overlaysProps: DroneHubOverlaysProps;
  workspaceContentProps: DroneHubWorkspaceContentProps;
};

function droneHubBusyDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('droneHub.debugBusy') !== '0';
  } catch {
    return true;
  }
}

export function useDroneHubAppModel(): DroneHubAppModel {
  const {
    optimisticallyDeletedDrones,
    startupSeedByDrone,
    localBusyChatCountByNodeId,
    unreadAgentMessageByChatNodeId,
    lastAgentSnippetByChatNodeId,
    transcripts,
    transcriptError,
    loadingTranscript,
    optimisticPendingPrompts,
    sessionText,
    sessionError,
    loadingSession,
    pinnedToBottom,
    setOptimisticallyDeletedDrones,
    setStartupSeedByDrone,
    setApprovalRequiredByChatNodeId,
    setUnreadAgentMessageByChatNodeId,
    setLastAgentSnippetByChatNodeId,
    setTranscripts,
    setTranscriptError,
    setLoadingTranscript,
    setOptimisticPendingPrompts,
    setSessionText,
    setSessionError,
    setLoadingSession,
    setPinnedToBottom,
  } = useDroneHubRuntimeState();
  const {
    activeRepoPath,
    settingsActiveTab,
    chatHeaderRepoPath,
    appView,
    sidebarGroupingMode,
    showRecentDronesOnly,
    collapsedGroups,
    sidebarGroupOrder,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    pinnedDroneIds,
    hiddenSidebarGroups,
    showHiddenSidebarGroups,
    autoDelete,
    terminalEmulator,
    homeOpen,
    selectedDrone,
    selectedDroneIds,
    selectedGroupMultiChat,
    selectedChat,
    draftChat,
    reposModalOpen,
    droneErrorModal,
    clearingDroneError,
    headerOverflowOpen,
    outputView,
    spawnContextRepoPath,
    spawnContextByRepoKey,
    spawnAgentKey,
    spawnModel,
    spawnReasoning,
    repoBranchSource,
    repoCreateRemoteBranch,
    pullHostBranchBeforeCreate,
    customAgents,
    customAgentModalOpen,
    newCustomAgentLabel,
    newCustomAgentCommand,
    customAgentError,
    nameSuggestToast,
    terminalMenuOpen,
    shortcutBindings,
    setActiveRepoPath,
    setSettingsActiveTab,
    setChatHeaderRepoPath,
    setAppView,
    setCollapsedGroups,
    setSidebarGroupOrder,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setHiddenSidebarGroups,
    setHomeOpen,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
    setGroupBroadcastExpanded,
    setSelectedChat,
    setDraftChat,
    setSidebarCollapsed,
    setReposModalOpen,
    setDroneErrorModal,
    setClearingDroneError,
    setHeaderOverflowOpen,
    setSpawnContextRepoPath,
    updateSpawnContextForRepo,
    setSpawnAgentKey,
    setSpawnModel,
    rememberSeenModels,
    setRepoBranchSource,
    setRepoCreateRemoteBranch,
    setPullHostBranchBeforeCreate,
    setCustomAgents,
    setCustomAgentModalOpen,
    setNewCustomAgentLabel,
    setNewCustomAgentCommand,
    setCustomAgentError,
    setNameSuggestToast,
    setTerminalMenuOpen,
  } = useDroneHubAppModelUiState();
  const [highlightedDroneIds, setHighlightedDroneIds] = React.useState<Set<string>>(() => new Set());
  const highlightClearTimerRef = React.useRef<number | null>(null);
  const droneByIdRef = React.useRef<Record<string, DroneSummary>>({});
  const {
    polledDrones,
    drones,
    droneById,
    dronesError,
    dronesLoading,
    repos,
    reposError,
    reposLoading,
    registeredRepoPaths,
    registeredRepoPathSet,
    registryGroupNames,
    registryGroupCreatedAtByName,
    registryGroupIdByName,
    dronesFilteredByRepo,
    dronesFilteredByRepoIdSet,
    droneCountByRepoPath,
    groups,
  } = useDroneHubRegistryData({
    activeRepoPath,
    optimisticallyDeletedDrones,
    setOptimisticallyDeletedDrones,
    setActiveRepoPath,
    setChatHeaderRepoPath,
  });
  React.useEffect(() => {
    droneByIdRef.current = droneById;
  }, [droneById]);
  React.useEffect(() => {
    const authoritativeApprovals: Record<string, boolean> = {};
    for (const drone of drones) {
      for (const nodeId of approvalChatNodeIdsForDrone(drone)) {
        authoritativeApprovals[nodeId] = true;
      }
    }
    setApprovalRequiredByChatNodeId((current) => {
      const currentIds = Object.keys(current).filter((nodeId) => current[nodeId]).sort();
      const authoritativeIds = Object.keys(authoritativeApprovals).sort();
      if (
        currentIds.length === authoritativeIds.length &&
        currentIds.every((nodeId, index) => nodeId === authoritativeIds[index])
      ) {
        return current;
      }
      return authoritativeApprovals;
    });
  }, [drones, setApprovalRequiredByChatNodeId]);
  const {
    creating,
    createRuntime,
    createAsDraft,
    createPersistVolume,
    draftCreateOpen,
    draftCreateMode,
    draftCreateName,
    draftCreateGroup,
    draftCreateParentDroneId,
    draftAgentsMdLibraryFileId,
    draftAgentsMdOverrideEnabled,
    draftAgentsMdOverride,
    draftCreateError,
    draftCreating,
    draftAutoRenaming,
    draftNameSuggesting,
    draftSuggestedName,
    draftNameSuggestionError,
    setCreating,
    setCreateRuntime,
    setCreateAsDraft,
    setCreatePersistVolume,
    setDraftCreateOpen,
    setDraftCreateMode,
    setDraftCreateName,
    setDraftCreateGroup,
    setDraftCreateParentDroneId,
    setDraftAgentsMdLibraryFileId,
    setDraftAgentsMdOverrideEnabled,
    setDraftAgentsMdOverride,
    setDraftCreateError,
    setDraftCreating,
    setDraftAutoRenaming,
    setDraftNameSuggesting,
    setDraftSuggestedName,
    setDraftNameSuggestionError,
  } = useCreateDraftWorkflowState();
  const {
    files: agentsMdLibraryFiles,
    loading: agentsMdLibraryLoading,
    error: agentsMdLibraryError,
  } = useAgentsMdLibraryCatalog(requestJson, Boolean(draftChat));
  React.useEffect(() => {
    if (agentsMdLibraryLoading || agentsMdLibraryError) return;
    const availableIds = new Set(agentsMdLibraryFiles.map((file) => file.id));
    if (draftAgentsMdLibraryFileId && !availableIds.has(draftAgentsMdLibraryFileId)) {
      setDraftAgentsMdLibraryFileId('');
    }
  }, [
    agentsMdLibraryError,
    agentsMdLibraryFiles,
    agentsMdLibraryLoading,
    draftAgentsMdLibraryFileId,
    setDraftAgentsMdLibraryFileId,
  ]);
  const repoBranchOptionsByPath = useRepoBranchOptions({
    requestJson,
    repoPaths: [chatHeaderRepoPath],
  });
  const {
    groupMoveError,
    setGroupMoveError,
    movingDroneGroups,
    deletingGroups,
    renamingGroups,
    createGroup: createSidebarGroup,
    renameGroup,
    deleteGroup,
    moveDronesToGroup,
    createGroupAndMove,
  } = useGroupManagement({
    autoDelete,
    activeRepoPath,
    groupIdByName: registryGroupIdByName,
    drones,
    polledDrones,
    optimisticallyDeletedDrones,
    setOptimisticallyDeletedDrones,
    setCollapsedGroups,
    setSidebarGroupOrder,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setHiddenSidebarGroups,
    selectedGroupMultiChat,
    setSelectedGroupMultiChat,
  });
  const {
    queuedPromptsByDroneChat,
    flushingQueuedKeysRef,
    enqueueQueuedPrompt,
    patchQueuedPrompt,
    removeQueuedPrompt,
    getQueuedPromptsForKey,
  } = useQueuedPromptsState();
  const draftNameSuggestSeqRef = React.useRef(0);
  const draftCreateNameRef = React.useRef<HTMLInputElement | null>(null);
  const selectionAnchorRef = React.useRef<string | null>(null);
  const {
    selectedDroneSet,
    orderedDroneIds,
    sidebarOptimisticDroneIdSet,
    sidebarDrones,
    uiDroneName,
    sidebarDronesFilteredByRepo,
    sidebarVisibleDrones,
    sidebarGroups,
    sidebarHiddenGroupCount,
    sidebarHasUngroupedGroup,
  } = useSidebarViewModel({
    selectedDroneIds,
    sidebarGroupingMode,
    collapsedGroups,
    deletingGroups,
    sidebarGroupOrder,
    sidebarDroneOrderByGroup,
    hiddenSidebarGroups,
    showHiddenSidebarGroups,
    drones,
    startupSeedByDrone,
    optimisticallyDeletedDrones,
    activeRepoPath,
    showRecentDronesOnly,
    registryGroupNames,
    registryGroupCreatedAtByName,
    registryGroupIdByName,
    registeredRepoPaths,
  });
  const draftSidebarPlaceholder = React.useMemo(() => {
    if (!draftChat) return null;
    if (String(draftChat.droneId ?? '').trim()) return null;
    return {
      name:
        String(draftChat.droneName ?? '').trim() ||
        allocateUntitledDisplayName(sidebarDrones.map((drone) => String(drone?.name ?? '').trim())),
      repoPath: String(chatHeaderRepoPath ?? '').trim(),
      group: String(draftCreateGroup ?? '').trim() || null,
      starting: Boolean(draftChat.prompt),
    };
  }, [chatHeaderRepoPath, draftChat, draftCreateGroup, sidebarDrones]);
  const droneNameById = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const drone of drones) {
      const id = String(drone?.id ?? '').trim();
      if (!id) continue;
      out[id] = uiDroneName(drone.name);
    }
    return out;
  }, [drones, uiDroneName]);
  const droneRepoById = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const drone of drones) {
      const id = String(drone?.id ?? '').trim();
      if (!id) continue;
      const repoPath = String(drone?.repoPath ?? '').trim();
      if (!repoPath) continue;
      const repoLabel = repoPath.split(/[\\/]/).filter(Boolean).pop() || repoPath;
      out[id] = repoLabel;
    }
    return out;
  }, [drones]);
  const fleetParentIdByDroneId = React.useMemo(() => {
    return buildFleetParentIdByDroneId(drones);
  }, [drones]);
  const fleetAssignedIdsByDroneId = React.useMemo(() => {
    return buildFleetAssignedIdsByDroneId(drones);
  }, [drones]);
  const validChatNodeIdSet = React.useMemo(() => {
    const out = new Set<string>();
    for (const drone of drones) {
      for (const nodeId of droneChatNodeIds(drone)) out.add(nodeId);
    }
    return out;
  }, [drones]);
  const markChatsUnread = React.useMemo(
    () => (chatNodeIdsRaw: string[]): number => {
      const targetNodeIds: string[] = [];
      for (const raw of Array.isArray(chatNodeIdsRaw) ? chatNodeIdsRaw : []) {
        const nodeId = String(raw ?? '').trim();
        if (!nodeId || targetNodeIds.includes(nodeId) || !validChatNodeIdSet.has(nodeId)) continue;
        targetNodeIds.push(nodeId);
      }
      if (targetNodeIds.length === 0) return 0;
      setUnreadAgentMessageByChatNodeId((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const nodeId of targetNodeIds) {
          if (next[nodeId]) continue;
          next[nodeId] = true;
          changed = true;
        }
        return changed ? next : prev;
      });
      return targetNodeIds.length;
    },
    [setUnreadAgentMessageByChatNodeId, validChatNodeIdSet],
  );
  const clearChatsUnread = React.useCallback(
    (chatNodeIdsRaw: string[]): number => {
      const targetNodeIds: string[] = [];
      for (const raw of Array.isArray(chatNodeIdsRaw) ? chatNodeIdsRaw : []) {
        const nodeId = String(raw ?? '').trim();
        if (!nodeId || targetNodeIds.includes(nodeId)) continue;
        targetNodeIds.push(nodeId);
      }
      if (targetNodeIds.length === 0) return 0;
      setUnreadAgentMessageByChatNodeId((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const nodeId of targetNodeIds) {
          if (!next[nodeId]) continue;
          delete next[nodeId];
          changed = true;
        }
        return changed ? next : prev;
      });
      return targetNodeIds.length;
    },
    [setUnreadAgentMessageByChatNodeId],
  );
  React.useEffect(() => {
    if (dronesLoading || dronesError) return;
    const next: Record<string, boolean> = {};
    for (const drone of drones) {
      for (const nodeId of unreadChatNodeIdsForDrone(drone)) {
        if (nodeId && validChatNodeIdSet.has(nodeId)) next[nodeId] = true;
      }
    }
    for (const [nodeId, marker] of manuallyMarkedUnreadChatsRef.current) {
      if (marker.latestAgentRevision == null) continue;
      const chatRef = parseCanvasChatNodeId(nodeId);
      const readState = chatRef
        ? droneById[chatRef.droneId]?.chatReadStates?.[chatRef.chatName]
        : null;
      const reconciled = reconcileManualUnreadMarker(marker, readState);
      if (!reconciled) {
        manuallyMarkedUnreadChatsRef.current.delete(nodeId);
      } else if (reconciled !== marker) {
        manuallyMarkedUnreadChatsRef.current.set(nodeId, reconciled);
      }
    }
    setUnreadAgentMessageByChatNodeId((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((nodeId) => prev[nodeId] === true)
      ) {
        return prev;
      }
      return next;
    });
  }, [
    droneById,
    drones,
    dronesError,
    dronesLoading,
    setUnreadAgentMessageByChatNodeId,
    validChatNodeIdSet,
  ]);
  React.useEffect(() => {
    if (dronesLoading || dronesError) return;
    setLastAgentSnippetByChatNodeId((prev) => {
      const prevEntries = Object.entries(prev);
      if (prevEntries.length === 0) return prev;
      const next: Record<string, string> = {};
      let changed = false;
      for (const [nodeId, snippet] of prevEntries) {
        if (!snippet || !validChatNodeIdSet.has(nodeId)) {
          changed = true;
          continue;
        }
        next[nodeId] = snippet;
      }
      return changed ? next : prev;
    });
  }, [dronesError, dronesLoading, setLastAgentSnippetByChatNodeId, validChatNodeIdSet]);
  const sidebarSelectableDroneIdSet = React.useMemo(
    () => new Set(sidebarDronesFilteredByRepo.map((drone) => drone.id)),
    [sidebarDronesFilteredByRepo],
  );

  /* ── Layout state ── */
  const {
    rightPanelOpen,
    setRightPanelOpen,
    requestRightPanelTab,
    rightPanelTab,
    setRightPanelTab,
    rightPanelSplit,
    setRightPanelSplitMode,
    rightPanelBottomTab,
    setRightPanelBottomTab,
    rightPanelOpenRequestSeq,
  } = useRightPanelLayout();
  const headerOverflowRef = React.useRef<HTMLDivElement | null>(null);
  const preferredSelectedDroneRef = React.useRef<string | null>(null);
  const preferredSelectedDroneHoldUntilRef = React.useRef<number>(0);
  const shellTerminalPrewarmReadyRef = React.useRef<Set<string>>(new Set());
  const shellTerminalPrewarmInFlightRef = React.useRef<Set<string>>(new Set());
  const lastSyncedCanvasRepoContextRef = React.useRef<string>('');
  const lastSyncedCanvasAgentModelContextRef = React.useRef<string>('');
  const previousUnreadChatNodeIdSetRef = React.useRef<Set<string>>(new Set());
  const manuallyMarkedUnreadChatsRef = React.useRef<Map<string, ManualUnreadMarker>>(new Map());
  const readAcknowledgementsInFlightRef = React.useRef<Set<string>>(new Set());
  const [chatOpenRequestRevision, setChatOpenRequestRevision] = React.useState(0);
  const droneIdentityByNameRef = React.useRef<Record<string, string>>({});
  const llmSettingsState = useLlmSettings(requestJson);
  const { reloadUiPreferences, reloadPinnedDrones, setDronePinned, setDronesPinned } =
    useUiPreferencesSettings({ requestJson });
  const selectedDronePinShortcutBusyRef = React.useRef(false);
  const renderedSidebarNodeTreeRef = React.useRef<SidebarNodeTreeModel | null>(null);
  const setRenderedSidebarNodeTree = React.useCallback((nodeTree: SidebarNodeTreeModel | null) => {
    renderedSidebarNodeTreeRef.current = nodeTree;
  }, []);
  const deleteActionSettingsState = useDeleteActionSettings(requestJson);
  const setupStatusState = useSetupStatus(requestJson);
  const { llmSettings } = llmSettingsState;

  React.useEffect(() => {
    let cancelled = false;
    void requestJson<ProfileSettingsResponse>('/api/settings/profiles')
      .then((data) => {
        if (cancelled) return;
        const serverProfile = data.activeProfile ?? null;
        if (serverProfile === activeProfileStorageId()) return;
        persistProfileStorageIdOverride(serverProfile);
        if (typeof window !== 'undefined') window.location.reload();
      })
      .catch(() => {
        // ignore; the settings hook surfaces fetch errors when needed
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hubLogsState = useHubLogs({
    appView,
    requestJson,
    copyText,
    tailLines: HUB_LOGS_TAIL_LINES,
    maxBytes: HUB_LOGS_MAX_BYTES,
  });
  const {
    chatInfo,
    chatInfoError,
    setChatInfoError,
    loadingChatInfo,
    chatModels,
    chatModelsError,
    loadingChatModels,
    chatModelsStale,
    setChatAgent,
    setChatModelSettings,
    setChatAgentPermissionMode,
    setChatApprovalPolicy,
    setDockerSnapshotAfterAgentMessageEnabled,
    handleSetAgentFailure,
  } = useChatConfigState({
    selectedDrone,
    selectedChat,
    droneById,
    requestJson,
  });
  const chatUiModeRef = React.useRef<'transcript' | 'cli'>('transcript');

  React.useEffect(() => {
    const ids = droneIdentityByNameRef.current;
    for (const d of drones) {
      const name = String(d?.name ?? '').trim();
      if (!name) continue;
      if (!ids[name]) ids[name] = makeId();
    }
  }, [drones]);

  React.useEffect(() => {
    const valid = new Set<string>([
      ...BUILTIN_AGENT_OPTIONS.map((o) => o.key),
      ...customAgents.map((a) => `custom:${a.id}`),
    ]);
    if (!valid.has(spawnAgentKey)) setSpawnAgentKey('builtin:cursor');
  }, [customAgents, spawnAgentKey]);

  React.useEffect(() => {
    if (createRuntime === 'host' && spawnAgentKey.startsWith('custom:')) {
      setSpawnAgentKey('builtin:cursor');
    }
  }, [createRuntime, spawnAgentKey, setSpawnAgentKey]);

  const resolveAgentKeyToConfig = React.useCallback(
    (key: string): ChatAgentConfig => {
      const k = String(key ?? '').trim();
      const builtin = BUILTIN_AGENT_OPTIONS.find((o) => o.key === k);
      if (builtin) return builtin.agent;
      if (k.startsWith('custom:')) {
        const id = k.slice('custom:'.length);
        const local = customAgents.find((a) => a.id === id) ?? null;
        if (local) return { kind: 'custom', id: local.id, label: local.label, command: local.command };
      }
      // Fallback if a saved custom agent no longer exists locally.
      return { kind: 'builtin', id: 'cursor' };
    },
    [customAgents],
  );

  const spawnAgentConfig = React.useMemo(() => resolveAgentKeyToConfig(spawnAgentKey), [resolveAgentKeyToConfig, spawnAgentKey]);
  const spawnAgentIsCodex =
    spawnAgentConfig.kind === 'builtin' && spawnAgentConfig.id === 'codex';
  const spawnModelValue = React.useMemo(() => {
    const value = String(spawnModel ?? '').trim();
    return value || null;
  }, [spawnModel]);
  const spawnModelForSeed = spawnAgentConfig.kind !== 'custom' ? spawnModelValue : null;
  const spawnReasoningForSeed =
    spawnAgentConfig.kind === 'native' ||
    (spawnAgentConfig.kind === 'builtin' &&
      (spawnAgentConfig.id === 'codex' || spawnAgentConfig.id === 'blip'))
      ? String(spawnReasoning ?? '').trim() || null
      : null;
  const [spawnAgentPermissionMode, setSpawnAgentPermissionMode] = React.useState<AgentPermissionMode>('full-access');
  const [spawnApprovalPolicy, setSpawnApprovalPolicy] =
    React.useState<AgentApprovalPolicy>('ask');
  const spawnAgentReadOnlySupported =
    spawnAgentConfig.kind === 'native' ||
    (spawnAgentConfig.kind === 'builtin' &&
      (spawnAgentConfig.id === 'codex' || spawnAgentConfig.id === 'blip'));
  const spawnAgentApprovalSupported =
    spawnAgentPermissionMode === 'full-access' &&
    (spawnAgentConfig.kind === 'native' ||
      (spawnAgentConfig.kind === 'builtin' && spawnAgentConfig.id === 'codex'));
  React.useEffect(() => {
    if (!spawnAgentReadOnlySupported && spawnAgentPermissionMode !== 'full-access') {
      setSpawnAgentPermissionMode('full-access');
    }
  }, [spawnAgentPermissionMode, spawnAgentReadOnlySupported]);
  React.useEffect(() => {
    if (!spawnAgentApprovalSupported) setSpawnApprovalPolicy('ask');
    else if (spawnAgentIsCodex && spawnApprovalPolicy === 'ask')
      setSpawnApprovalPolicy('agent-decides');
    else if (!spawnAgentIsCodex && spawnApprovalPolicy === 'agent-decides')
      setSpawnApprovalPolicy('ask');
  }, [spawnAgentApprovalSupported, spawnAgentIsCodex, spawnApprovalPolicy]);

  const rememberStartupSeed = React.useCallback((
    drones: Array<{ id: string; name: string }>,
    opts: {
      runtime?: 'container' | 'host';
      agent: ChatAgentConfig | null;
      model?: string | null;
      reasoning?: string | null;
      agentPermissionMode?: AgentPermissionMode;
      approvalPolicy?: AgentApprovalPolicy;
      prompt: string;
      chatName?: string;
      group?: string | null;
      repoPath?: string | null;
      at?: string | null;
    },
  ) => {
    const unique = new Map<string, string>();
    for (const d of drones) {
      const id = String(d?.id ?? '').trim();
      const name = String(d?.name ?? '').trim();
      if (!id) continue;
      if (!unique.has(id)) unique.set(id, name || id);
    }
    if (unique.size === 0) return;
    const prompt = String(opts.prompt ?? '').trim();
    const chatName = String(opts.chatName ?? 'default').trim() || 'default';
    const runtime = opts.runtime === 'host' ? 'host' : 'container';
    const model = String(opts.model ?? '').trim() || null;
    const reasoning = String(opts.reasoning ?? '').trim().toLowerCase() || null;
    const agentPermissionMode: AgentPermissionMode =
      opts.agentPermissionMode === 'read-only' ||
      opts.agentPermissionMode === 'workspace-write'
        ? opts.agentPermissionMode
        : 'full-access';
    const approvalPolicy: AgentApprovalPolicy =
      opts.approvalPolicy === 'agent-decides' || opts.approvalPolicy === 'never'
        ? opts.approvalPolicy
        : 'ask';
    const group = String(opts.group ?? '').trim() || null;
    const repoPath = String(opts.repoPath ?? '').trim() || null;
    if (
      !prompt &&
      !opts.agent &&
      !model &&
      agentPermissionMode === 'full-access' &&
      approvalPolicy === 'ask'
    )
      return;
    const submittedAt = String(opts.at ?? '').trim();
    const at = Number.isFinite(Date.parse(submittedAt)) ? submittedAt : new Date().toISOString();
    setStartupSeedByDrone((prev) => {
      const next = { ...prev };
      for (const [id, droneName] of unique.entries()) {
        next[id] = {
          droneName,
          runtime,
          chatName,
          agent: opts.agent ?? null,
          model,
          reasoning,
          agentPermissionMode,
          approvalPolicy,
          prompt,
          group,
          repoPath,
          at,
        };
      }
      return next;
    });
  }, []);

  type DroneQueueSpec = {
    name: string;
    runtime?: 'container' | 'host';
    group?: string;
    repoPath?: string;
    build?: boolean;
    containerPort?: number;
    cloneFrom?: string;
    cloneChats?: boolean;
    persistVolume?: boolean;
    seedAgent?: ChatAgentConfig;
    seedModel?: string | null;
    seedAgentPermissionMode?: AgentPermissionMode;
    seedChat?: string;
    seedPrompt?: string;
    seedCwd?: string;
    agentsMd?: string;
  };

  const queueDrones = React.useCallback(async (list: DroneQueueSpec[]) => {
    const drones = list.map((item) => {
      const runtime = item.runtime ?? 'container';
      if (runtime !== 'container' || typeof item.persistVolume === 'boolean') return item;
      return { ...item, persistVolume: false };
    });
    return await requestJson<{
      ok: true;
      accepted: Array<{ id: string; name: string; phase: 'starting' }>;
      rejected: Array<{ id?: string; name: string; error: string; status?: number }>;
      total: number;
    }>(`/api/drones/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drones, pullHostBranchBeforeCreate }),
    });
  }, [pullHostBranchBeforeCreate, requestJson]);

  const terminalMenuRef = React.useRef<HTMLDivElement | null>(null);

  const showNameSuggestionFailureToast = React.useCallback((error: unknown) => {
    const msg = String(error instanceof Error ? error.message : error ?? '').trim();
    const id = makeId();
    setNameSuggestToast({ id, title: 'Name suggestion failed', message: msg || 'Name suggestion failed.' });
    window.setTimeout(() => {
      setNameSuggestToast((cur) => (cur?.id === id ? null : cur));
    }, 6000);
  }, []);

  const showShortcutToast = React.useCallback(
    (
      message: string,
      title: string,
      tone: 'success' | 'error' = 'error',
      opts: { voiceActive?: boolean; voiceLevel?: number; autoDismissMs?: number | null } = {},
    ) => {
      const text = String(message ?? '').trim();
      if (!text) return null;
      const id = makeId();
      setNameSuggestToast({
        id,
        title,
        message: text,
        tone,
        voiceActive: opts.voiceActive,
        voiceLevel: opts.voiceLevel,
      });
      if (opts.autoDismissMs !== null) {
        window.setTimeout(() => {
          setNameSuggestToast((current) => (current?.id === id ? null : current));
        }, opts.autoDismissMs ?? 5000);
      }
      return id;
    },
    [setNameSuggestToast],
  );
  const { toggleVoiceClipboardRecording } = useVoiceClipboardRecorder({
    showToast: showShortcutToast,
  });
  const {
    deletingDrones,
    renamingDrones,
    renameDroneTarget,
    settingBaseImages,
    deleteDrone: deleteDroneBase,
    closeRenameDrone,
    clearRenameDroneError,
    confirmRenameDrone,
    setDroneBaseImage,
    reparentDronesToParent,
    renameDroneTo,
    suggestAndRenameDraftDrone,
  } = useDroneMutationActions({
    drones,
    autoDelete,
    deleteMode: deleteActionSettingsState.deleteSettings?.deleteAction.mode ?? 'permanent',
    requestJson,
    optimisticallyDeletedDrones,
    setOptimisticallyDeletedDrones,
    setStartupSeedByDrone,
    onNameSuggestionFailure: showNameSuggestionFailureToast,
  });
  const deleteDrone = React.useCallback(
    async (droneIdRaw: string, opts?: { confirmed?: boolean; showAlert?: boolean }): Promise<boolean> => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return false;
      const deleted = await deleteDroneBase(droneId, opts);
      if (!deleted) return false;
      disposeDroneWorkspaceState(droneId);
      setSidebarChatOrderByDrone((prev) => {
        if (!(droneId in prev)) return prev;
        const next = { ...prev };
        delete next[droneId];
        return next;
      });
      setSidebarDroneOrderByGroup((prev) => {
        let changed = false;
        const next: Record<string, string[]> = {};
        for (const [key, entries] of Object.entries(prev)) {
          const filtered = entries.filter((entry) => entry !== droneId);
          if (filtered.length !== entries.length) changed = true;
          if (filtered.length > 0) next[key] = filtered;
        }
        return changed ? next : prev;
      });
      setSidebarNodeOrderByParent((prev) => removeDroneIdsFromSidebarNodeOrderByParent(prev, [droneId]));
      return true;
    },
    [deleteDroneBase, setSidebarChatOrderByDrone, setSidebarDroneOrderByGroup, setSidebarNodeOrderByParent],
  );
  const [droneDeleteConfirm, setDroneDeleteConfirmState] = React.useState<DroneDeleteConfirmState | null>(null);
  const [droneDeleteConfirmError, setDroneDeleteConfirmError] = React.useState<string | null>(null);
  const [droneDeleteOperationModeById, setDroneDeleteOperationModeById] = React.useState<Record<string, DroneDeleteMode>>({});
  const droneDeleteOperationModeByIdRef = React.useRef<Record<string, DroneDeleteMode>>({});
  const droneDeleteConfirmRef = React.useRef<DroneDeleteConfirmState | null>(null);
  const droneDeleteConfirmLaunchRef = React.useRef(false);
  const setDroneDeleteConfirm = React.useCallback((next: DroneDeleteConfirmState | null) => {
    droneDeleteConfirmRef.current = next;
    if (next) droneDeleteConfirmLaunchRef.current = false;
    setDroneDeleteConfirmState(next);
  }, []);
  const markDroneDeleteOperations = React.useCallback((droneIds: string[], mode: DroneDeleteMode) => {
    const next = { ...droneDeleteOperationModeByIdRef.current };
    let changed = false;
    for (const droneId of droneIds) {
      if (!droneId || next[droneId] === mode) continue;
      next[droneId] = mode;
      changed = true;
    }
    if (!changed) return;
    droneDeleteOperationModeByIdRef.current = next;
    setDroneDeleteOperationModeById(next);
  }, []);
  const clearDroneDeleteOperations = React.useCallback((droneIds: string[]) => {
    const next = { ...droneDeleteOperationModeByIdRef.current };
    let changed = false;
    for (const droneId of droneIds) {
      if (!(droneId in next)) continue;
      delete next[droneId];
      changed = true;
    }
    if (!changed) return;
    droneDeleteOperationModeByIdRef.current = next;
    setDroneDeleteOperationModeById(next);
  }, []);
  React.useEffect(() => {
    const ids = Object.keys(droneDeleteOperationModeById);
    if (ids.length === 0) return;
    if (ids.some((id) => deletingDrones[id])) return;
    droneDeleteOperationModeByIdRef.current = {};
    setDroneDeleteOperationModeById({});
  }, [deletingDrones, droneDeleteOperationModeById]);
  const resolveDeleteDroneRows = React.useCallback(
    (droneIdsRaw: string[]): DroneDeleteConfirmModalDrone[] => {
      const seen = new Set<string>();
      const rows: DroneDeleteConfirmModalDrone[] = [];
      for (const rawId of droneIdsRaw) {
        const id = String(rawId ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const drone = droneById[id] ?? null;
        if (!drone) continue;
        if (
          deletingDrones[id] ||
          droneDeleteOperationModeById[id] ||
          droneDeleteOperationModeByIdRef.current[id] ||
          optimisticallyDeletedDrones[id]
        ) {
          continue;
        }
        rows.push({
          id,
          label: uiDroneName(drone.name) || id,
        });
      }
      return rows;
    },
    [deletingDrones, droneById, droneDeleteOperationModeById, optimisticallyDeletedDrones, uiDroneName],
  );
  const runConfirmedDroneDelete = React.useCallback(
    async (rows: DroneDeleteConfirmModalDrone[]): Promise<boolean> => {
      const targets = rows.filter((row) => String(row.id ?? '').trim());
      if (targets.length === 0) return false;
      const targetIds = targets.map((row) => String(row.id ?? '').trim()).filter(Boolean);
      const operationMode = deleteActionSettingsState.deleteSettings?.deleteAction.mode === 'archive' ? 'archive' : 'permanent';
      markDroneDeleteOperations(targetIds, operationMode);
      const results: Array<{ row: DroneDeleteConfirmModalDrone; deleted: boolean }> = new Array(targets.length);
      let nextIndex = 0;
      const workerCount = Math.min(DRONE_DELETE_CONCURRENCY, targets.length);
      const runWorker = async (): Promise<void> => {
        while (nextIndex < targets.length) {
          const index = nextIndex;
          nextIndex += 1;
          const row = targets[index]!;
          let deleted = false;
          try {
            deleted = await deleteDrone(row.id, { confirmed: true, showAlert: false });
          } catch (error) {
            console.error('[DroneHub] confirmed drone delete failed unexpectedly', { id: row.id, error });
          }
          results[index] = {
            row,
            deleted,
          };
        }
      };
      try {
        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      } finally {
        clearDroneDeleteOperations(targetIds);
      }
      const completedResults = results.filter((result): result is { row: DroneDeleteConfirmModalDrone; deleted: boolean } => Boolean(result));
      const deletedAny = completedResults.some((result) => result.deleted);
      const failedRows = completedResults.filter((result) => !result.deleted).map((result) => result.row);
      if (failedRows.length > 0) {
        const failedLabels = failedRows.map((row) => row.label || row.id);
        const preview = failedLabels.slice(0, 4).join(', ');
        const suffix = failedLabels.length > 4 ? `, and ${failedLabels.length - 4} more` : '';
        const action = deleteActionSettingsState.deleteSettings?.deleteAction.mode === 'archive' ? 'archive' : 'delete';
        const message = `Could not ${action} ${preview}${suffix}.`;
        if (droneDeleteConfirmRef.current && droneDeleteConfirmRef.current.drones.length > 0) {
          showShortcutToast(message, action === 'archive' ? 'Archive failed' : 'Delete failed', 'error');
        } else {
          setDroneDeleteConfirmError(message);
          setDroneDeleteConfirm({ drones: failedRows });
        }
        return false;
      }
      return deletedAny;
    },
    [
      clearDroneDeleteOperations,
      deleteActionSettingsState.deleteSettings?.deleteAction.mode,
      deleteDrone,
      markDroneDeleteOperations,
      setDroneDeleteConfirm,
      showShortcutToast,
    ],
  );
  const requestDeleteDrones = React.useCallback(
    (droneIdsRaw: string[]): boolean => {
      const requestedIds = Array.from(
        new Set(droneIdsRaw.map((id) => String(id ?? '').trim()).filter(Boolean)),
      );
      const rows = resolveDeleteDroneRows(droneIdsRaw);
      if (rows.length === 0) {
        if (requestedIds.length > 0) {
          console.warn('[DroneHub] sidebar drone delete request ignored', {
            requestedIds,
            selectedDrone,
            selectedDroneIds,
            reasonsByDroneId: Object.fromEntries(
              requestedIds.map((id) => [
                id,
                {
                  exists: Boolean(droneById[id]),
                  deleting: Boolean(deletingDrones[id]),
                  deleteOperationMode:
                    droneDeleteOperationModeById[id] ??
                    droneDeleteOperationModeByIdRef.current[id] ??
                    null,
                  optimisticallyDeleted: Boolean(optimisticallyDeletedDrones[id]),
                },
              ]),
            ),
          });
          showShortcutToast(
            requestedIds.length === 1
              ? 'That drone is already being removed or is no longer available.'
              : 'Those drones are already being removed or are no longer available.',
            'Nothing to delete',
            'error',
          );
        }
        return false;
      }
      setDroneDeleteConfirmError(null);
      if (autoDelete) {
        void runConfirmedDroneDelete(rows);
        return true;
      }
      setDroneDeleteConfirm({ drones: rows });
      return true;
    },
    [
      autoDelete,
      deletingDrones,
      droneById,
      droneDeleteOperationModeById,
      resolveDeleteDroneRows,
      runConfirmedDroneDelete,
      setDroneDeleteConfirm,
      showShortcutToast,
      selectedDrone,
      selectedDroneIds,
      optimisticallyDeletedDrones,
    ],
  );
  const requestDeleteDrone = React.useCallback(
    (droneId: string): void => {
      requestDeleteDrones(resolveDroneDeleteTargetIds({ droneId, selectedDrone, selectedDroneIds }));
    },
    [requestDeleteDrones, selectedDrone, selectedDroneIds],
  );
  const requestDeleteSelectedDrones = React.useCallback((): boolean => {
    return requestDeleteDrones(resolveDroneDeleteTargetIds({ selectedDrone, selectedDroneIds }));
  }, [requestDeleteDrones, selectedDrone, selectedDroneIds]);
  const closeDroneDeleteConfirm = React.useCallback(() => {
    setDroneDeleteConfirm(null);
    setDroneDeleteConfirmError(null);
  }, [setDroneDeleteConfirm]);
  const confirmDroneDelete = React.useCallback(() => {
    if (!droneDeleteConfirm || droneDeleteConfirmLaunchRef.current) return;
    const rows = droneDeleteConfirm.drones;
    droneDeleteConfirmLaunchRef.current = true;
    setDroneDeleteConfirmError(null);
    setDroneDeleteConfirm(null);
    void runConfirmedDroneDelete(rows);
  }, [droneDeleteConfirm, runConfirmedDroneDelete, setDroneDeleteConfirm]);

  const normalizeCreateRepoPath = React.useCallback(
    (candidate: string): string => {
      const p = String(candidate ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    },
    [registeredRepoPathSet],
  );
  const activeSpawnContextRepoPath = React.useMemo(
    () => normalizeCreateRepoPath(chatHeaderRepoPath),
    [chatHeaderRepoPath, normalizeCreateRepoPath],
  );
  React.useEffect(() => {
    if (spawnContextRepoPath === activeSpawnContextRepoPath) return;
    setSpawnContextRepoPath(activeSpawnContextRepoPath);
  }, [activeSpawnContextRepoPath, setSpawnContextRepoPath, spawnContextRepoPath]);

  const suggestCloneName = React.useCallback(
    (sourceName: string) => {
      const base = `${sourceName}-copy`;
      const taken = new Set(drones.map((d) => d.name.toLowerCase()));
      if (!taken.has(base.toLowerCase())) return base;
      let i = 2;
      while (taken.has(`${base}-${i}`.toLowerCase())) i += 1;
      return `${base}-${i}`;
    },
    [drones],
  );

  const { openDraftChatComposer: openDraftChatComposerBase } =
    useWorkspaceNavigationActions({
      activeRepoPath,
      normalizeCreateRepoPath,
      selectionAnchorRef,
      preferredSelectedDroneRef,
      preferredSelectedDroneHoldUntilRef,
      setAppView,
      setDraftChat,
      setDraftCreateOpen,
      setDraftCreateMode,
      setDraftCreateName,
      setDraftCreateGroup,
      setDraftCreateParentDroneId,
      setDraftAgentsMdLibraryFileId,
      setDraftAgentsMdOverrideEnabled,
      setDraftAgentsMdOverride,
      setDraftCreateError,
      setDraftCreating,
      setDraftAutoRenaming,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setCreateRuntime,
      setCreatePersistVolume,
      setChatHeaderRepoPath,
      setHomeOpen,
      setSelectedDrone,
      setSelectedDroneIds,
      setSelectedChat,
      resetDraftNameSuggestSeq: () => {
        draftNameSuggestSeqRef.current = 0;
      },
    });

  const closeDraftCreateSurface = React.useCallback(() => {
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftAgentsMdLibraryFileId('');
    setDraftAgentsMdOverrideEnabled(false);
    setDraftAgentsMdOverride('');
    setDraftCreateError(null);
  }, [
    setDraftAgentsMdOverride,
    setDraftAgentsMdOverrideEnabled,
    setDraftAgentsMdLibraryFileId,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
  ]);
  const resetSidebarDroneSelection = React.useCallback(() => {
    setSelectedDrone(null);
    setSelectedDroneIds([]);
    selectionAnchorRef.current = null;
    preferredSelectedDroneRef.current = null;
    preferredSelectedDroneHoldUntilRef.current = 0;
    setSelectedChat('default');
  }, [
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    selectionAnchorRef,
    setSelectedChat,
    setSelectedDrone,
    setSelectedDroneIds,
  ]);
  const openHome = React.useCallback(() => {
    setAppView('workspace');
    closeDraftCreateSurface();
    setHomeOpen(true);
    setSelectedGroupMultiChat(null);
    resetSidebarDroneSelection();
  }, [
    closeDraftCreateSurface,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    resetSidebarDroneSelection,
    selectionAnchorRef,
    setAppView,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
    setHomeOpen,
    setSelectedChat,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
  ]);

  const openGroupMultiChat = React.useCallback(
    (groupRaw: string) => {
      const group = String(groupRaw ?? '').trim();
      if (!group) return;
      setAppView('workspace');
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      setHomeOpen(false);
      setSelectedGroupMultiChat(group);
    },
    [setAppView, setDraftChat, setDraftCreateError, setDraftCreateOpen, setHomeOpen, setSelectedGroupMultiChat],
  );
  const openSidebarVisibleMultiChat = React.useCallback(() => {
    if (sidebarVisibleDrones.length === 0) return;
    setAppView('workspace');
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setHomeOpen(false);
    setSelectedGroupMultiChat(SIDEBAR_VISIBLE_MULTI_CHAT_GROUP);
  }, [
    setAppView,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
    setHomeOpen,
    setSelectedGroupMultiChat,
    sidebarVisibleDrones.length,
  ]);

  const terminalOptions = React.useMemo(
    () => [
      { id: 'auto', label: 'Auto' },
      { id: 'osascript', label: 'Terminal.app (macOS)' },
      { id: 'wt', label: 'Windows Terminal' },
      { id: 'powershell.exe', label: 'PowerShell (Windows)' },
      { id: 'pwsh', label: 'PowerShell Core' },
      { id: 'kitty', label: 'kitty' },
      { id: 'gnome-terminal', label: 'gnome-terminal' },
      { id: 'x-terminal-emulator', label: 'system default' },
      { id: 'xterm', label: 'xterm' },
      { id: 'konsole', label: 'konsole' },
      { id: 'alacritty', label: 'alacritty' },
    ],
    []
  );

  const terminalLabel =
    terminalOptions.find((o) => o.id === terminalEmulator)?.label ??
    (terminalEmulator === 'auto' ? 'Auto' : terminalEmulator);

  const outputScrollRef = React.useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = React.useRef(true);
  const prevOutputLenRef = React.useRef(0);

  const updatePinned = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = gap < 80;
    pinnedToBottomRef.current = pinned;
    setPinnedToBottom(pinned);
  }, []);

  const scrollChatToBottom = React.useCallback(() => {
    // Force-follow on selection change so newly loaded content lands at the bottom.
    pinnedToBottomRef.current = true;
    setPinnedToBottom(true);
    prevOutputLenRef.current = -1;
    let triesRemaining = 4;
    const attempt = () => {
      requestAnimationFrame(() => {
        let didScroll = false;
        const el = outputScrollRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
          updatePinned(el);
          didScroll = true;
        }
        if (!didScroll && triesRemaining > 0) {
          triesRemaining -= 1;
          attempt();
        }
      });
    };
    attempt();
  }, [updatePinned]);

  const resetGroupDndState = React.useCallback(() => {}, []);
  const prepareSidebarDroneDragStart = React.useCallback(
    (droneIdRaw: string) => {
      if (movingDroneGroups) return;
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      setGroupMoveError(null);
      if (!selectedDroneSet.has(droneId)) {
        setSelectedDroneIds([droneId]);
        selectionAnchorRef.current = droneId;
      }
    },
    [movingDroneGroups, selectedDroneSet, selectionAnchorRef, setGroupMoveError, setSelectedDroneIds],
  );
  const {
    selectDroneCard: selectDroneCardBase,
    selectDroneChat: selectDroneChatBase,
    setDroneSelectionFromSidebarFolder,
  } = useDroneSelectionState({
    orderedDroneIds,
    selectedDrone,
    selectedDroneIds,
    selectedChat,
    homeOpen,
    draftChat,
    droneById,
    dronesFilteredByRepoIdSet,
    visibleDronesFilteredByRepo: sidebarDronesFilteredByRepo,
    startupSeedByDrone,
    selectionAnchorRef,
    preferredSelectedDroneRef,
    preferredSelectedDroneHoldUntilRef,
    scrollChatToBottom,
    resetGroupDndState,
    setGroupMoveError,
    setAppView,
    setHomeOpen,
    setDraftChat,
    setDraftCreateOpen,
    setDraftCreateError,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
    setSelectedChat,
  });
  const selectDroneCard = React.useCallback(
    (droneIdRaw: string, opts?: DroneSelectionClickOptions) => {
      selectDroneCardBase(droneIdRaw, opts);
      if (!opts?.toggle && !opts?.range) {
        setChatOpenRequestRevision((revision) => revision + 1);
      }
    },
    [selectDroneCardBase],
  );
  const selectDroneChat = React.useCallback(
    (droneIdRaw: string, chatNameRaw: string) => {
      selectDroneChatBase(droneIdRaw, chatNameRaw);
      setChatOpenRequestRevision((revision) => revision + 1);
    },
    [selectDroneChatBase],
  );
  const {
    cloneDrone,
    cloneDroneWithoutSelection,
    createDroneFromDraft,
    queueDraftPromptDuringCreate,
    startDraftPrompt,
  } =
    useDroneCreationActions({
      drones,
      creating,
      repoBranchSource,
      repoCreateRemoteBranch,
      pullHostBranchBeforeCreate,
      createRuntime,
      createAsDraft,
      createPersistVolume,
      spawnAgentKey,
      spawnModelForSeed,
      spawnReasoningForSeed,
      spawnAgentPermissionMode,
      spawnApprovalPolicy,
      draftChat,
      draftCreateMode,
      draftCreateName,
      draftCreateGroup,
      draftCreateParentDroneId,
      draftAgentsMdLibraryFileId,
      draftAgentsMdOverrideEnabled,
      draftAgentsMdOverride,
      draftCreateRepoPath: chatHeaderRepoPath,
      startupSeedMissingGraceMs: STARTUP_SEED_MISSING_GRACE_MS,
      suggestCloneName,
      resolveAgentKeyToConfig,
      enqueueQueuedPrompt,
      requestJson,
      suggestAndRenameDraftDrone,
      rememberStartupSeed,
      rememberSeenModels,
      rememberNewDronePreferences: saveDesktopNewDronePreferences,
      setStartupSeedByDrone,
      setCreating,
      setCreateRuntime,
      setCreateAsDraft,
      setCreatePersistVolume,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateName,
      setDraftCreateGroup,
      setDraftCreateParentDroneId,
      setDraftAgentsMdLibraryFileId,
      setDraftAgentsMdOverrideEnabled,
      setDraftAgentsMdOverride,
      setDraftSuggestedName,
      setDraftNameSuggesting,
      setDraftNameSuggestionError,
      setDraftAutoRenaming,
      setDraftCreateOpen,
      setDraftCreating,
      setNameSuggestToast,
      setSelectedDrone,
      setSelectedDroneIds,
      setSelectedChat,
      selectionAnchorRef,
      preferredSelectedDroneRef,
      preferredSelectedDroneHoldUntilRef,
    });
  const cloneDroneFromSidebar = React.useCallback((source: DroneSummary) => {
    void cloneDrone(source);
  }, [cloneDrone]);

  const currentDrone = selectedDrone ? droneById[selectedDrone] ?? null : null;
  const currentDroneLabel = currentDrone ? uiDroneName(currentDrone.name) : '';
  const [droneDropActionModal, setDroneDropActionModal] = React.useState<DroneDropActionModalState | null>(null);
  const openDroneDropActionModal = React.useCallback(
    (targetDroneIdRaw: string, sourceDroneIdsRaw: string[]): { ok: boolean; error?: string | null } => {
      const targetDroneId = String(targetDroneIdRaw ?? '').trim();
      if (!targetDroneId || !droneById[targetDroneId]) {
        return { ok: false, error: 'Target drone is unavailable.' };
      }
      const sourceDroneIds = Array.from(
        new Set(
          (Array.isArray(sourceDroneIdsRaw) ? sourceDroneIdsRaw : [])
            .map((item) => String(item ?? '').trim())
            .filter((droneId) => droneId && droneId !== targetDroneId && Boolean(droneById[droneId])),
        ),
      );
      if (sourceDroneIds.length === 0) {
        return { ok: false, error: 'No drones were dropped.' };
      }
      setDroneDropActionModal({ targetDroneId, sourceDroneIds });
      return { ok: true, error: null };
    },
    [droneById],
  );
  const closeDroneDropActionModal = React.useCallback(() => {
    setDroneDropActionModal(null);
  }, []);
  const expandGroupsForDroneIds = React.useCallback(
    (droneIds: string[]) => {
      const groups = new Set<string>();
      for (const droneId of droneIds) {
        const drone = droneByIdRef.current[droneId];
        if (!drone) continue;
        const group = String(drone.group ?? '').trim() || 'Ungrouped';
        const parts = group.split('/').map((part) => part.trim()).filter(Boolean);
        for (let index = 0; index < parts.length; index += 1) {
          groups.add(parts.slice(0, index + 1).join('/'));
        }
        const repoPath = String(drone.repoPath ?? '').trim();
        groups.add(repoPath ? `repo:${repoPath}` : 'repo:ungrouped');
      }
      if (groups.size === 0) return;
      setCollapsedGroups((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const group of groups) {
          if (!next[group]) continue;
          next[group] = false;
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [setCollapsedGroups],
  );
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAssistantOpenDroneChat = (event: Event) => {
      const detail = (event as CustomEvent<AssistantOpenDroneChatEventDetail>).detail;
      const droneId = String(detail?.droneId ?? '').trim();
      if (!droneId || !droneByIdRef.current[droneId]) return;
      const chatName = String(detail?.chatName ?? '').trim() || 'default';
      expandGroupsForDroneIds([droneId]);
      selectDroneChat(droneId, chatName);
    };
    window.addEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, handleAssistantOpenDroneChat);
    return () => window.removeEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, handleAssistantOpenDroneChat);
  }, [expandGroupsForDroneIds, selectDroneChat]);
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return;
    let closed = false;
    const source = new window.EventSource('/api/assistant/events');
    const handleAssistantChange = (event: MessageEvent) => {
      if (closed) return;
      let data: any = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const action = data?.uiAction && typeof data.uiAction === 'object' ? data.uiAction : null;
      if (!action) return;
      if (action.type === 'reload_ui_preferences') {
        void reloadUiPreferences();
        return;
      }
      if (action.type === 'reload_pinned_drones') {
        void reloadPinnedDrones();
        return;
      }
      if (action.type === 'open_whiteboard') {
        const whiteboardId = String(action.whiteboardId ?? '').trim() || 'main';
        const droneId = String(selectedDrone ?? '').trim();
        if (droneId) writeActiveWhiteboardId(droneId, whiteboardId);
        requestRightPanelTab('whiteboard');
        window.dispatchEvent(new CustomEvent(WHITEBOARD_OPEN_EVENT, { detail: { droneId, whiteboardId } }));
        return;
      }
      if (action.type === 'close_whiteboard') {
        if (rightPanelTab === 'whiteboard' || rightPanelBottomTab === 'whiteboard') {
          requestRightPanelTab('files');
        }
        return;
      }
      const droneIds: string[] = Array.from(
        new Set(
          (Array.isArray(action.droneIds) ? action.droneIds : [action.droneId])
            .map((item: unknown) => String(item ?? '').trim())
            .filter((droneId: string): droneId is string => Boolean(droneId && droneByIdRef.current[droneId])),
        ),
      );
      if (droneIds.length === 0) return;
      expandGroupsForDroneIds(droneIds);
      if (action.type === 'open_drone_chat') {
        const droneId = droneIds[0];
        const chatName = String(action.chatName ?? '').trim() || 'default';
        selectDroneChat(droneId, chatName);
      } else if (action.type === 'highlight_drones') {
        setHighlightedDroneIds(new Set(droneIds));
        if (highlightClearTimerRef.current != null) window.clearTimeout(highlightClearTimerRef.current);
        const durationMsRaw = Number(action.durationMs);
        const durationMs = Number.isFinite(durationMsRaw) ? Math.max(1000, Math.min(60_000, Math.floor(durationMsRaw))) : 10_000;
        highlightClearTimerRef.current = window.setTimeout(() => {
          highlightClearTimerRef.current = null;
          setHighlightedDroneIds(new Set());
        }, durationMs);
      }
    };
    source.addEventListener('assistant_change', handleAssistantChange);
    return () => {
      closed = true;
      source.close();
    };
  }, [expandGroupsForDroneIds, reloadPinnedDrones, reloadUiPreferences, requestRightPanelTab, rightPanelBottomTab, rightPanelTab, selectDroneChat]);
  React.useEffect(
    () => () => {
      if (typeof window === 'undefined') return;
      if (highlightClearTimerRef.current != null) {
        window.clearTimeout(highlightClearTimerRef.current);
        highlightClearTimerRef.current = null;
      }
    },
    [],
  );
  React.useEffect(() => {
    const droneId = String(selectedDrone ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    const selectedNodeId = createCanvasChatNodeId(droneId, chatName);
    if (!selectedNodeId) return;
    for (const nodeId of manuallyMarkedUnreadChatsRef.current.keys()) {
      if (nodeId !== selectedNodeId) manuallyMarkedUnreadChatsRef.current.delete(nodeId);
    }
    if (unreadAgentMessageByChatNodeId[selectedNodeId] !== true) return;
    if (manuallyMarkedUnreadChatsRef.current.has(selectedNodeId)) return;
    if (readAcknowledgementsInFlightRef.current.has(selectedNodeId)) return;
    const initialReadState = currentDrone?.chatReadStates?.[chatName];
    if (!initialReadState) return;
    readAcknowledgementsInFlightRef.current.add(selectedNodeId);
    void (async () => {
      let cursor = initialReadState;
      try {
        while (cursor.unread) {
          const result = await requestJson<{
            readState?: {
              unread?: boolean;
              latestAgentTurnId?: string | null;
              latestAgentRevision?: number;
            };
          }>(
            `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/read`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                latestAgentTurnId: cursor.latestAgentTurnId,
                latestAgentRevision: cursor.latestAgentRevision,
                updatedByDeviceId: 'web',
              }),
            },
          );
          if (result?.readState?.unread === false) {
            clearChatsUnread([selectedNodeId]);
            return;
          }
          const nextCursor = nextUnreadChatReadCursor(
            cursor,
            result?.readState,
            droneByIdRef.current[droneId]?.chatReadStates?.[chatName],
          );
          if (!nextCursor) return;
          cursor = nextCursor;
        }
      } catch {
        // Keep the authoritative unread dot visible when acknowledgement fails.
      } finally {
        readAcknowledgementsInFlightRef.current.delete(selectedNodeId);
      }
    })();
  }, [
    clearChatsUnread,
    chatOpenRequestRevision,
    currentDrone,
    requestJson,
    selectedChat,
    selectedDrone,
    unreadAgentMessageByChatNodeId,
  ]);
  React.useEffect(() => {
    const previousUnreadChatNodeIdSet = previousUnreadChatNodeIdSetRef.current;
    const nextUnreadChatNodeIdSet = new Set<string>();
    for (const drone of drones) {
      for (const nodeId of unreadChatNodeIdsForDrone(drone)) {
        nextUnreadChatNodeIdSet.add(nodeId);
      }
    }
    previousUnreadChatNodeIdSetRef.current = nextUnreadChatNodeIdSet;
    const newlyUnreadChatNodeIds = [...nextUnreadChatNodeIdSet].filter(
      (nodeId) => !previousUnreadChatNodeIdSet.has(nodeId),
    );
    if (newlyUnreadChatNodeIds.length > 0) {
      for (const nodeId of newlyUnreadChatNodeIds) {
        const chatRef = parseCanvasChatNodeId(nodeId);
        if (!chatRef) continue;
        void (async () => {
          try {
            const data = await requestJson<{ ok: true; transcripts: Array<{ output?: string }> }>(
              `/api/drones/${encodeURIComponent(chatRef.droneId)}/chats/${encodeURIComponent(chatRef.chatName)}/state?turn=last&transcript=selected&pending=none`,
            );
            const output = String(data?.transcripts?.[0]?.output ?? '').trim();
            if (!output) return;
            const snippet = output.length > 200 ? `${output.slice(0, 197)}…` : output;
            setLastAgentSnippetByChatNodeId((prev) =>
              prev[nodeId] === snippet ? prev : { ...prev, [nodeId]: snippet },
            );
          } catch {
            // Ignore fetch errors for snippet preview.
          }
        })();
      }
    }
  }, [drones, requestJson, setLastAgentSnippetByChatNodeId]);

  const selectedDroneIdentity = React.useMemo(() => {
    if (!selectedDrone) return '';
    const ids = droneIdentityByNameRef.current;
    if (!ids[selectedDrone]) ids[selectedDrone] = makeId();
    return ids[selectedDrone];
  }, [selectedDrone]);
  const autoRenameChatFromFirstPromptRef = React.useRef<
    (droneId: string, chatName: string, prompt: string) => void
  >(() => {});
  const handleAutoRenameChatFromFirstPrompt = React.useCallback(
    (droneId: string, chatName: string, prompt: string) =>
      autoRenameChatFromFirstPromptRef.current(droneId, chatName, prompt),
    [],
  );

  const {
    cancelPendingPromptErrorById,
    cancellingPendingPromptById,
    canStopResponse,
    chatUiMode,
    promptError,
    requestCancelPendingPrompt,
    requestStopResponse,
    selectedIsResponding,
    sendPromptText,
    sendingPrompt,
    stopResponseError,
    stoppingResponse,
    visiblePendingPromptsWithStartup,
  } = useChatRuntimeOrchestration({
    chatInfo,
    currentDrone,
    droneById,
    outputView,
    optimisticPendingPrompts,
    queuedPromptsByDroneChat,
    getQueuedPromptsForKey,
    flushingQueuedKeysRef,
    selectedChat,
    selectedDrone,
    selectedDroneIdentity,
    startupSeedByDrone,
    transcriptError,
    transcripts,
    setLoadingSession,
    setLoadingTranscript,
    setOptimisticPendingPrompts,
    setSessionError,
    setSessionText,
    setTranscriptError,
    setTranscripts,
    enqueueQueuedPrompt,
    patchQueuedPrompt,
    removeQueuedPrompt,
    requestJson,
    onAutoRenameChatFromFirstPrompt: handleAutoRenameChatFromFirstPrompt,
  });
  React.useEffect(() => {
    if (!selectedDrone) return;
    scrollChatToBottom();
  }, [scrollChatToBottom, selectedChat, selectedDrone]);

  const {
    deletingRepos,
    openingTerminal,
    openingEditor,
    launchHint,
    repoOp,
    repoOpError,
    repoOpErrorMeta,
    dirtyDroneApplyModal,
    clearRepoOperationError,
    setRepoOperationError,
    closeDirtyDroneApplyModal,
    continueDirtyDroneApply,
    githubUrlForRepo,
    deleteRepo,
    openDroneTerminal,
    openDroneEditor,
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
    reseedRepo,
  } = useWorkspaceActions({
    autoDelete,
    currentDrone,
    drones,
    selectedChat,
    terminalEmulator,
    activeRepoPath,
    setActiveRepoPath,
    setNameSuggestToast,
    requestJson,
  });
  const { closeDroneErrorModal, openDroneErrorModal, clearDroneHubError } =
    useDroneErrorModalActions({
      currentDroneId: currentDrone?.id ?? null,
      requestJson,
      clearRepoOperationError,
      setRepoOperationError,
      setDroneErrorModal,
      setClearingDroneError,
    });
  const droppedDroneTarget = React.useMemo(
    () => (droneDropActionModal ? droneById[droneDropActionModal.targetDroneId] ?? null : null),
    [droneById, droneDropActionModal],
  );
  const droppedDroneRows = React.useMemo(() => {
    if (!droneDropActionModal) return [];
    return droneDropActionModal.sourceDroneIds
      .map((droneId) => droneById[droneId] ?? null)
      .filter(Boolean)
      .map((drone) => ({
        id: String(drone!.id ?? '').trim(),
        label: uiDroneName(drone!.name),
        group: typeof drone!.group === 'string' && drone!.group.trim() ? drone!.group.trim() : null,
      }));
  }, [droneById, droneDropActionModal, uiDroneName]);
  const droppedDroneTargetLabel = React.useMemo(
    () => (droppedDroneTarget ? uiDroneName(droppedDroneTarget.name) : ''),
    [droppedDroneTarget, uiDroneName],
  );
  React.useEffect(() => {
    if (!droneDropActionModal) return;
    if (!droppedDroneTarget || droppedDroneRows.length === 0) {
      setDroneDropActionModal(null);
    }
  }, [droppedDroneRows.length, droppedDroneTarget, droneDropActionModal]);
  const {
    selectedGroupMultiChatData,
    groupBroadcastPromptError,
    groupBroadcastSending,
    sendGroupBroadcastPrompt,
  } = useGroupBroadcast({
    selectedGroupMultiChat,
    sidebarGroups,
    sidebarVisibleDrones,
    selectedChat,
    requestJson,
    onAutoRenameChatFromFirstPrompt: handleAutoRenameChatFromFirstPrompt,
    setSelectedGroupMultiChat,
    setGroupBroadcastExpanded,
  });
  const currentDroneRepoAttached = Boolean(currentDrone?.repoAttached ?? Boolean(String(currentDrone?.repoPath ?? '').trim()));
  const currentDroneRepoPath = String(currentDrone?.repoPath ?? '').trim();
  const rightPanelTabs = React.useMemo(() => rightPanelTabsForRuntime(currentDrone?.runtime), [currentDrone?.runtime]);
  React.useEffect(() => {
    if (rightPanelTabs.length === 0) return;
    if (!rightPanelTabs.includes(rightPanelTab)) {
      setRightPanelTab(rightPanelTabs[0]);
      return;
    }
    const bottomTabUnsupported = !rightPanelTabs.includes(rightPanelBottomTab);
    const bottomTabConflictsInSplit = rightPanelSplit && rightPanelBottomTab === rightPanelTab;
    if (bottomTabUnsupported || bottomTabConflictsInSplit) {
      const fallbackBottomTab = rightPanelTabs.find((tab) => tab !== rightPanelTab) ?? rightPanelTabs[0];
      if (fallbackBottomTab !== rightPanelBottomTab) setRightPanelBottomTab(fallbackBottomTab);
    }
  }, [rightPanelBottomTab, rightPanelSplit, rightPanelTab, rightPanelTabs, setRightPanelBottomTab, setRightPanelTab]);
  const deleteSelectedDroneFromInputShortcut = React.useCallback((): boolean => {
    return requestDeleteSelectedDrones();
  }, [requestDeleteSelectedDrones]);
  const markSelectedDronesUnreadShortcut = React.useCallback((): boolean => {
    const targetChatNodeIds: string[] = [];
    const activeElement = document.activeElement;
    const canvasFocused =
      activeElement instanceof HTMLElement &&
      Boolean(activeElement.closest('[data-drone-canvas-viewport="1"]'));
    if (canvasFocused) {
      const canvasSelectedNodeIds = useDroneCanvasStore
        .getState()
        .selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id));
      for (const nodeId of canvasSelectedNodeIds) {
        if (!parseCanvasChatNodeId(nodeId)) continue;
        targetChatNodeIds.push(nodeId);
      }
    }
    if (targetChatNodeIds.length === 0 && selectedDroneIds.length > 0) {
      for (const droneId of selectedDroneIds) {
        const nodeId = createCanvasChatNodeId(droneId, droneId === selectedDrone ? selectedChat : 'default');
        if (!nodeId) continue;
        targetChatNodeIds.push(nodeId);
      }
    }
    if (targetChatNodeIds.length === 0) {
      const droneId = String(selectedDrone ?? '').trim();
      const nodeId = createCanvasChatNodeId(droneId, String(selectedChat ?? '').trim() || 'default');
      if (nodeId) targetChatNodeIds.push(nodeId);
    }
    const changed = markChatsUnread(targetChatNodeIds) > 0;
    if (changed) {
      const activeNodeId = createCanvasChatNodeId(
        String(selectedDrone ?? '').trim(),
        String(selectedChat ?? '').trim() || 'default',
      );
      for (const nodeId of targetChatNodeIds) {
        const chatRef = parseCanvasChatNodeId(nodeId);
        if (!chatRef) continue;
        if (nodeId === activeNodeId) {
          manuallyMarkedUnreadChatsRef.current.set(nodeId, {
            latestAgentRevision: null,
            observedInSummary: false,
          });
        }
        void requestJson<{
          readState?: { unread?: boolean; latestAgentRevision?: number };
        }>(
          `/api/drones/${encodeURIComponent(chatRef.droneId)}/chats/${encodeURIComponent(chatRef.chatName)}/read`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ unread: true, updatedByDeviceId: 'web' }),
          },
        )
          .then((result) => {
            if (result?.readState?.unread !== true) {
              manuallyMarkedUnreadChatsRef.current.delete(nodeId);
              clearChatsUnread([nodeId]);
              return;
            }
            const marker = manuallyMarkedUnreadChatsRef.current.get(nodeId);
            if (!marker) return;
            if (Number.isSafeInteger(result.readState.latestAgentRevision)) {
              marker.latestAgentRevision = Number(result.readState.latestAgentRevision);
            } else {
              manuallyMarkedUnreadChatsRef.current.delete(nodeId);
            }
          })
          .catch(() => {
            manuallyMarkedUnreadChatsRef.current.delete(nodeId);
            clearChatsUnread([nodeId]);
          });
      }
    }
    return changed;
  }, [clearChatsUnread, markChatsUnread, requestJson, selectedChat, selectedDrone, selectedDroneIds]);
  const currentGroup = currentDrone?.group ? groups.find((g) => g.group === currentDrone.group) ?? null : null;
  const filesPaneActive = Boolean(
    currentDrone &&
      rightPanelOpen &&
      (
        rightPanelTab === 'files' ||
        rightPanelTab === 'editor' ||
        (rightPanelSplit && (rightPanelBottomTab === 'files' || rightPanelBottomTab === 'editor'))
      ),
  );
  const portsPaneActive = Boolean(
    currentDrone &&
      rightPanelOpen &&
      (
        rightPanelTab === 'preview' ||
        rightPanelTab === 'links' ||
        (rightPanelSplit && (rightPanelBottomTab === 'preview' || rightPanelBottomTab === 'links'))
      ),
  );
  const {
    defaultFsPathForCurrentDrone,
    currentFsPath,
    setCurrentFsPath,
    refreshFsList,
    fsEntries,
    fsLoading,
    fsError,
    fsErrorUi,
    filesPane,
    selectedPreviewPort,
    currentPortReachability,
    portsLoading,
    portsError,
    portsErrorUi,
    portsPane,
    selectedPreviewDefaultUrl,
    selectedPreviewUrlOverride,
    setSelectedPreviewUrlOverride,
    portRows,
  } = useFilesAndPortsPaneState({
    currentDrone,
    requestJson,
    filesEnabled: filesPaneActive,
    portsEnabled: portsPaneActive,
  });
  React.useEffect(() => {
    if (
      !shouldPrewarmShellTerminal({
        drone: currentDrone,
        cwd: defaultFsPathForCurrentDrone,
        rightPanelOpen,
        rightPanelTab,
        rightPanelSplit,
        rightPanelBottomTab,
      })
    ) {
      return;
    }

    const droneId = String(currentDrone?.id ?? '').trim();
    const cwd = String(defaultFsPathForCurrentDrone ?? '').trim();
    const key = shellTerminalPrewarmKey({ droneId, cwd });
    if (!key) return;
    if (shellTerminalPrewarmReadyRef.current.has(key) || shellTerminalPrewarmInFlightRef.current.has(key)) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      shellTerminalPrewarmInFlightRef.current.add(key);
      const qs = new URLSearchParams();
      qs.set('mode', 'shell');
      qs.set('chat', String(selectedChat ?? '').trim() || 'default');
      qs.set('cwd', cwd);
      void requestJson(`/api/drones/${encodeURIComponent(droneId)}/terminal/open?${qs.toString()}`, {
        method: 'POST',
      })
        .then(() => {
          if (!cancelled) shellTerminalPrewarmReadyRef.current.add(key);
        })
        .catch(() => {
          // Best-effort prewarm only.
        })
        .finally(() => {
          shellTerminalPrewarmInFlightRef.current.delete(key);
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    currentDrone,
    defaultFsPathForCurrentDrone,
    requestJson,
    rightPanelBottomTab,
    rightPanelOpen,
    rightPanelSplit,
    rightPanelTab,
    selectedChat,
  ]);
  const {
    terminalSessionsByPane,
    terminalPaneStateKey,
    ensureTerminalPaneSessions,
    createTerminalPaneTab,
    setActiveTerminalPaneTab,
    setTerminalPaneTabSessionName,
    closeTerminalPaneTab,
  } = useTerminalPaneSessions();
  const [lockedPreviewByDrone, setLockedPreviewByDrone] = React.useState<Record<string, PreviewPaneSnapshot>>({});
  const setPreviewLockedForDrone = React.useCallback(
    (droneIdRaw: string, nextLocked: boolean, snapshot?: PreviewPaneSnapshot) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      setLockedPreviewByDrone((prev) => {
        const current = prev[droneId];
        if (nextLocked) {
          if (!snapshot) return prev;
          return {
            ...prev,
            [droneId]: snapshot,
          };
        }
        if (!current) return prev;
        const next = { ...prev };
        delete next[droneId];
        return next;
      });
    },
    [],
  );
  const {
    openedFile: openedEditorFile,
    loading: openedEditorFileLoading,
    saving: openedEditorFileSaving,
    error: openedEditorFileError,
    openFailure: openedEditorFileOpenFailure,
    kind: openedEditorFileKind,
    mime: openedEditorFileMime,
    size: openedEditorFileSize,
    content: openedEditorFileContent,
    dirty: openedEditorFileDirty,
    mtimeMs: openedEditorFileMtimeMs,
    revision: openedEditorFileRevision,
    externallyChanged: openedEditorFileExternallyChanged,
    canOverwriteExternalChange: openedEditorFileCanOverwriteExternalChange,
    recentFiles: openedEditorRecentFiles,
    quickOpenOpen,
    quickOpenQuery,
    quickOpenFiles,
    quickOpenLoading,
    quickOpenError,
    canGoBackLocation,
    canGoForwardLocation,
    openedFileTabs: openedEditorFileTabs,
    activeOpenedFileTabId,
    openEditorFile,
    closeEditorFile,
    confirmCloseOpenedFileTabsForPaths,
    closeOpenedFileTabsForPaths,
    remapOpenedFileTabsForPathChange,
    openQuickOpen,
    closeQuickOpen,
    setQuickOpenQuery,
    goBackLocation,
    goForwardLocation,
    setActiveOpenedFileTab,
    reorderOpenedFileTabs,
    setOpenedFileContent,
    refreshOpenedFile,
    reloadOpenedFileFromDisk,
    overwriteOpenedFile,
    saveOpenedFile,
  } = useFileEditorState({
    currentDrone,
    requestJson,
    onRefreshFsList: refreshFsList,
  });
  const startupSeedForCurrentDrone =
    currentDrone ? startupSeedByDrone[currentDrone.id] ?? null : null;
  const clearStartupSeedForDrone = React.useCallback(
    (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      setStartupSeedByDrone((prev) => {
        if (!prev[droneId]) return prev;
        const next = { ...prev };
        delete next[droneId];
        return next;
      });
    },
    [setStartupSeedByDrone],
  );
  const effectiveChatInfo = chatInfo
    ? chatInfo
    : currentDrone && startupSeedForCurrentDrone?.agent
      ? {
          name: currentDrone.name,
          chat: startupSeedForCurrentDrone.chatName || selectedChat || 'default',
          agent: startupSeedForCurrentDrone.agent,
          agentLocked: false,
          model: startupSeedForCurrentDrone.model ?? null,
          reasoning: startupSeedForCurrentDrone.reasoning ?? null,
          agentPermissionMode: startupSeedForCurrentDrone.agentPermissionMode ?? 'full-access',
          approvalPolicy: startupSeedForCurrentDrone.approvalPolicy ?? 'ask',
          dockerSnapshotAfterAgentMessageEnabled: false,
          sessionName: `drone-hub-chat-${startupSeedForCurrentDrone.chatName || selectedChat || 'default'}`,
          createdAt: startupSeedForCurrentDrone.at || new Date().toISOString(),
        }
      : null;
  const chatRuntimeMetadataAvailable = Boolean(
    effectiveChatInfo &&
      currentDrone &&
      effectiveChatInfo.chat === (selectedChat || 'default'),
  );
  const builtinAgentOptions: Array<{ key: string; label: string; agent: ChatAgentConfig }> = BUILTIN_AGENT_OPTIONS;
  const currentAgent = effectiveChatInfo?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig);
  const currentModel = String(chatInfo?.model ?? effectiveChatInfo?.model ?? '').trim() || null;
  const currentReasoning =
    String(chatInfo?.reasoning ?? effectiveChatInfo?.reasoning ?? '').trim().toLowerCase() || null;
  const currentAgentKey =
    currentAgent.kind === 'native'
      ? 'native'
      : currentAgent.kind === 'builtin'
      ? `builtin:${currentAgent.id}`
      : `custom:${currentAgent.id}`;
  const currentSelectionCreateSeed = React.useMemo(
    () => resolveNewDroneContextFromCurrentSelection(currentDrone),
    [currentDrone],
  );
  const currentSelectionSpawnModel = currentAgent.kind !== 'custom' ? String(currentModel ?? '') : '';
  const resolveCurrentSelectionDraftContext = React.useCallback((inheritSpawnContext = false) => {
    if (!selectedDrone || !currentDrone) return null;
    const nextRepoPath = normalizeCreateRepoPath(currentSelectionCreateSeed.repoPath);
    setSpawnContextRepoPath(nextRepoPath);
    if (inheritSpawnContext && effectiveChatInfo) {
      updateSpawnContextForRepo(nextRepoPath, {
        spawnAgentKey: currentAgentKey,
        spawnModel: currentSelectionSpawnModel,
      });
    }
    return {
      repoPath: nextRepoPath,
      group: currentSelectionCreateSeed.group,
    };
  }, [
    currentAgentKey,
    currentDrone,
    currentSelectionCreateSeed.group,
    currentSelectionCreateSeed.repoPath,
    currentSelectionSpawnModel,
    effectiveChatInfo,
    normalizeCreateRepoPath,
    selectedDrone,
    setSpawnContextRepoPath,
    updateSpawnContextForRepo,
  ]);
  const applyRememberedNewDronePreferences = React.useCallback(
    (repoPathRaw: string) => {
      const repoPath = normalizeCreateRepoPath(repoPathRaw);
      const preferences =
        loadDesktopNewDronePreferences(repoPath) ?? normalizeDesktopNewDronePreferences({});
      if (!preferences) return;
      setDraftCreateMode(preferences.mode);
      setCreateRuntime(preferences.runtime);
      setCreateAsDraft(preferences.createAsDraft);
      setCreatePersistVolume(preferences.persistVolume);
      setSpawnContextRepoPath(repoPath);
      updateSpawnContextForRepo(repoPath, {
        spawnAgentKey: preferences.spawnAgentKey,
        spawnModel: preferences.spawnModel,
        spawnReasoning: preferences.spawnReasoning,
      });
      setSpawnAgentPermissionMode(preferences.spawnAgentPermissionMode);
      setSpawnApprovalPolicy(preferences.spawnApprovalPolicy);
      setRepoBranchSource(preferences.repoBranchSource);
      setRepoCreateRemoteBranch(preferences.repoCreateRemoteBranch);
      setPullHostBranchBeforeCreate(preferences.pullHostBranchBeforeCreate);
    },
    [
      normalizeCreateRepoPath,
      setCreateAsDraft,
      setCreatePersistVolume,
      setCreateRuntime,
      setDraftCreateMode,
      setSpawnContextRepoPath,
      setRepoBranchSource,
      setRepoCreateRemoteBranch,
      setPullHostBranchBeforeCreate,
      updateSpawnContextForRepo,
    ],
  );
  const openDraftChatComposer = React.useCallback(
    (opts?: { repoPath?: string | null; group?: string | null }) => {
      if (!shouldInheritNewDroneContextFromCurrentSelection(opts)) {
        openDraftChatComposerBase(opts);
        const hasRepoOverride = Object.prototype.hasOwnProperty.call(opts ?? {}, 'repoPath');
        applyRememberedNewDronePreferences(
          hasRepoOverride ? String(opts?.repoPath ?? '') : activeRepoPath,
        );
        return;
      }
      const selectionDraftContext = resolveCurrentSelectionDraftContext();
      if (!selectionDraftContext) {
        openDraftChatComposerBase(opts);
        applyRememberedNewDronePreferences(activeRepoPath);
        return;
      }
      openDraftChatComposerBase({
        repoPath: selectionDraftContext.repoPath,
        group: selectionDraftContext.group,
      });
      applyRememberedNewDronePreferences(selectionDraftContext.repoPath);
    },
    [
      activeRepoPath,
      applyRememberedNewDronePreferences,
      openDraftChatComposerBase,
      resolveCurrentSelectionDraftContext,
    ],
  );
  const openSelectionScopedDraftChatComposer = React.useCallback(
    (parentDroneIdRaw?: string | null): boolean => {
      const selectionDraftContext = resolveCurrentSelectionDraftContext();
      if (!selectionDraftContext) return false;
      openDraftChatComposerBase({
        repoPath: selectionDraftContext.repoPath,
        group: selectionDraftContext.group,
        parentDroneId: String(parentDroneIdRaw ?? '').trim() || undefined,
      });
      applyRememberedNewDronePreferences(selectionDraftContext.repoPath);
      return true;
    },
    [
      applyRememberedNewDronePreferences,
      openDraftChatComposerBase,
      resolveCurrentSelectionDraftContext,
    ],
  );
  const openChildDraftChatComposer = React.useCallback(
    (): boolean => openSelectionScopedDraftChatComposer(currentDrone?.id),
    [currentDrone?.id, openSelectionScopedDraftChatComposer],
  );
  const spawnDroneHubTaskFromAgentMessage = React.useCallback(
    async (opts: {
      sourceDroneId: string;
      sourceChatName: string;
      task: { name: string; description: string };
      mode: DroneHubTaskSpawnMode;
    }): Promise<{ ok: boolean; error?: string | null }> => {
      const mode: DroneHubTaskSpawnMode = opts?.mode === 'clone' ? 'clone' : 'spawn';
      const sourceDroneId = String(opts?.sourceDroneId ?? '').trim();
      const sourceChatName = String(opts?.sourceChatName ?? 'default').trim() || 'default';
      const taskNameRaw = String(opts?.task?.name ?? '').replace(/[\r\n]+/g, ' ').trim();
      const taskDescription = String(opts?.task?.description ?? '').trim();
      if (!sourceDroneId) return { ok: false, error: 'Source drone is unavailable.' };
      if (!taskDescription) return { ok: false, error: 'Task description is empty.' };

      const sourceDrone = drones.find((drone) => drone.id === sourceDroneId) ?? null;
      if (!sourceDrone) return { ok: false, error: 'Source drone is unavailable.' };
      if (mode === 'clone' && String(sourceDrone.runtime ?? 'container').trim().toLowerCase() === 'host') {
        return { ok: false, error: 'Host runtime drones cannot be cloned.' };
      }

      const sourceContext = resolveNewDroneContextFromCurrentSelection(sourceDrone);
      const baseName = taskNameRaw.length > 80 ? taskNameRaw.slice(0, 80).trim() : taskNameRaw;
      const repoSpawnDefaults = resolveSpawnContextPreferencesForRepo(spawnContextByRepoKey, sourceContext.repoPath);
      const siblingNames = new Set(drones.map((drone) => String(drone?.name ?? '').trim()).filter(Boolean));
      const requestedName = (() => {
        const clean = baseName || (mode === 'clone' ? 'Task clone' : 'Task');
        if (!siblingNames.has(clean)) return clean;
        for (let i = 2; i < 1000; i += 1) {
          const suffix = ` (${i})`;
          const candidate =
            clean.length + suffix.length > 80
              ? `${clean.slice(0, Math.max(1, 80 - suffix.length)).trimEnd()}${suffix}`
              : `${clean}${suffix}`;
          if (!siblingNames.has(candidate)) return candidate;
        }
        return clean;
      })();

      let seedAgent: ChatAgentConfig | null = null;
      let seedModel: string | null = null;
      try {
        const data = await requestJson<any>(
          `/api/drones/${encodeURIComponent(sourceDroneId)}/chats/${encodeURIComponent(sourceChatName)}`,
        );
        const chatInfo = normalizeChatInfoPayload(data);
        seedAgent = chatInfo.agent;
        seedModel = chatInfo.agent.kind !== 'custom' ? chatInfo.model : null;
      } catch {
        const selectedChatName = String(effectiveChatInfo?.chat ?? '').trim() || 'default';
        if (selectedDrone === sourceDroneId && effectiveChatInfo && selectedChatName === sourceChatName) {
          seedAgent = effectiveChatInfo.agent;
          seedModel = effectiveChatInfo.agent.kind !== 'custom' ? effectiveChatInfo.model : null;
        }
      }

      try {
        const queueSpec = buildDroneHubTaskQueueSpec({
          mode,
          requestedName,
          taskDescription,
          sourceDroneId,
          sourceContext,
          seedAgent,
          seedModel,
          repoDefaults: repoSpawnDefaults,
        });
        const response = await queueDrones([queueSpec as DroneQueueSpec]);
        const accepted = Array.isArray(response?.accepted) ? response.accepted[0] : null;
        if (!accepted?.id) {
          const rejected = Array.isArray(response?.rejected) ? response.rejected[0] : null;
          return {
            ok: false,
            error: String((rejected as any)?.error ?? 'Failed to queue drone.').trim() || 'Failed to queue drone.',
          };
        }

        if (seedModel) rememberSeenModels([seedModel]);
        rememberStartupSeed(
          [{ id: String(accepted.id), name: String(accepted.name ?? requestedName).trim() || requestedName }],
          {
            runtime: 'container',
            agent: seedAgent,
            model: seedModel,
            prompt: taskDescription,
            chatName: 'default',
            group: sourceContext.group || null,
            repoPath: sourceContext.repoPath || null,
          },
        );
        return { ok: true, error: null };
      } catch (error: any) {
        return {
          ok: false,
          error: String(error?.message ?? error ?? 'Failed to queue drone.').trim() || 'Failed to queue drone.',
        };
      }
    },
    [drones, effectiveChatInfo, queueDrones, rememberSeenModels, rememberStartupSeed, requestJson, selectedDrone, spawnContextByRepoKey],
  );
  React.useEffect(() => {
    rememberSeenModels([currentModel, ...chatModels.map((model) => model.id)]);
  }, [chatModels, currentModel, rememberSeenModels]);
  React.useEffect(() => {
    const droneId = String(selectedDrone ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    if (!droneId) {
      lastSyncedCanvasRepoContextRef.current = '';
      return;
    }
    const contextKey = `${droneId}\u0000${chatName}`;
    if (lastSyncedCanvasRepoContextRef.current === contextKey) return;
    const nextRepoPath = normalizeCreateRepoPath(currentDroneRepoAttached ? currentDroneRepoPath : '');
    setChatHeaderRepoPath((prev) => (prev === nextRepoPath ? prev : nextRepoPath));
    lastSyncedCanvasRepoContextRef.current = contextKey;
  }, [
    currentDroneRepoAttached,
    currentDroneRepoPath,
    normalizeCreateRepoPath,
    selectedChat,
    selectedDrone,
    setChatHeaderRepoPath,
  ]);
  React.useEffect(() => {
    const droneId = String(selectedDrone ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    if (!droneId) {
      lastSyncedCanvasAgentModelContextRef.current = '';
      return;
    }
    const contextKey = `${droneId}\u0000${chatName}`;
    if (lastSyncedCanvasAgentModelContextRef.current === contextKey) return;
    const selectedDroneName = String(currentDrone?.name ?? '').trim();
    const chatInfoDroneName = String(effectiveChatInfo?.name ?? '').trim();
    const chatInfoChatName = String(effectiveChatInfo?.chat ?? '').trim() || 'default';
    if (!effectiveChatInfo || !selectedDroneName || chatInfoDroneName !== selectedDroneName || chatInfoChatName !== chatName) {
      return;
    }
    const nextAgentKey =
      effectiveChatInfo.agent.kind === 'builtin'
        ? `builtin:${effectiveChatInfo.agent.id}`
        : effectiveChatInfo.agent.kind === 'custom'
          ? `custom:${effectiveChatInfo.agent.id}`
          : 'native';
    const nextModel =
      effectiveChatInfo.agent.kind !== 'custom' ? String(effectiveChatInfo.model ?? '') : '';
    updateSpawnContextForRepo(currentDroneRepoAttached ? currentDroneRepoPath : '', {
      spawnAgentKey: nextAgentKey,
      spawnModel: nextModel,
    });
    setSpawnAgentPermissionMode(effectiveChatInfo.agentPermissionMode ?? 'full-access');
    lastSyncedCanvasAgentModelContextRef.current = contextKey;
  }, [
    currentDroneRepoAttached,
    currentDroneRepoPath,
    currentDrone?.name,
    effectiveChatInfo,
    selectedChat,
    selectedDrone,
    updateSpawnContextForRepo,
  ]);
  const selectedChatUsesDroneBusyStatus =
    chatUiMode === 'cli' ||
    (currentAgent.kind === 'native' &&
      currentDrone?.draft !== true &&
      currentDrone?.hubPhase !== 'draft' &&
      currentDrone?.draftChats?.[String(selectedChat ?? '').trim() || 'default'] !== true);
  const currentDroneBusy =
    currentDrone && !isDroneStartingOrSeeding(currentDrone.hubPhase)
      ? selectedChatRespondingStatus({
          includeDroneBusy: selectedChatUsesDroneBusyStatus,
          droneBusy: Boolean(currentDrone.busy),
          selectedIsResponding,
        })
      : false;
  const busyChatNodeIdSet = React.useMemo(() => {
    const out = new Set<string>();
    for (const drone of drones) {
      for (const nodeId of busyChatNodeIdsForDrone(drone)) out.add(nodeId);
    }
    const selectedNodeId = createCanvasChatNodeId(String(selectedDrone ?? '').trim(), String(selectedChat ?? '').trim() || 'default');
    if (selectedNodeId && selectedIsResponding) out.add(selectedNodeId);
    for (const [nodeId, count] of Object.entries(localBusyChatCountByNodeId)) {
      if (count > 0) out.add(nodeId);
    }
    return out;
  }, [drones, localBusyChatCountByNodeId, selectedChat, selectedDrone, selectedIsResponding]);
  const busyDebugLastSidebarSignatureRef = React.useRef('');
  React.useEffect(() => {
    if (!droneHubBusyDebugEnabled()) return;
    const busyChatNodeIds = Array.from(busyChatNodeIdSet).sort();
    const signature = JSON.stringify({
      busyChatNodeIds,
      selectedDrone: String(selectedDrone ?? '').trim(),
      selectedChat: String(selectedChat ?? '').trim() || 'default',
      selectedIsResponding,
    });
    if (busyDebugLastSidebarSignatureRef.current === signature) return;
    busyDebugLastSidebarSignatureRef.current = signature;
    console.debug('[DroneHub][busy-debug] sidebar busy state', {
      busyChatNodeIds,
      selectedDrone,
      selectedChat: String(selectedChat ?? '').trim() || 'default',
      selectedIsResponding,
    });
  }, [busyChatNodeIdSet, selectedChat, selectedDrone, selectedIsResponding]);
  const chatNodeStateById = React.useMemo(() => {
    const out: Record<
      string,
      {
        statusOk: boolean;
        statusError: string | null;
        statusChecking?: boolean;
        hubPhase?: DroneSummary['hubPhase'];
        hubMessage?: DroneSummary['hubMessage'];
        busy: boolean;
        unreadAgentMessage: boolean;
        lastAgentSnippet: string | null;
      }
    > = {};
    for (const drone of drones) {
      const droneId = String(drone?.id ?? '').trim();
      if (!droneId) continue;
      for (const chatName of normalizedDroneChats(drone, { includeDefaultWhenEmpty: true })) {
        const nodeId = createCanvasChatNodeId(droneId, chatName);
        if (!nodeId) continue;
        out[nodeId] = {
          statusOk: Boolean(drone.statusOk),
          statusError: drone.statusError ?? null,
          statusChecking: drone.statusChecking,
          hubPhase: drone.hubPhase,
          hubMessage: drone.hubMessage,
          busy: busyChatNodeIdSet.has(nodeId),
          unreadAgentMessage: unreadAgentMessageByChatNodeId[nodeId] === true,
          lastAgentSnippet: lastAgentSnippetByChatNodeId[nodeId] ?? null,
        };
      }
    }
    return out;
  }, [busyChatNodeIdSet, drones, lastAgentSnippetByChatNodeId, unreadAgentMessageByChatNodeId]);
  const showRespondingAsStatusInHeader =
    Boolean(currentDroneBusy) && Boolean(currentDrone?.statusOk) && currentDrone?.hubPhase !== 'error';
  const currentCustomAgentMissing = currentAgent.kind === 'custom' && !customAgents.some((a) => a.id === currentAgent.id);
  const currentDroneAllowsCustomAgents = String(currentDrone?.runtime ?? '').trim().toLowerCase() !== 'host';
  const agentControlBusy =
    loadingChatInfo ||
    Boolean(openingTerminal) ||
    Boolean(openingEditor) ||
    isDroneStartingOrSeeding(currentDrone?.hubPhase);
  const agentLocked =
    effectiveChatInfo?.agentLocked === true ||
    Boolean(transcripts?.length) ||
    visiblePendingPromptsWithStartup.length > 0;
  const agentDisabled = agentControlBusy || agentLocked;
  const modelControlEnabled = currentAgent.kind === 'builtin';
  const modelDisabled = agentControlBusy || !modelControlEnabled;
  const {
    availableChatModels,
    createRepoMenuEntries,
    spawnAgentMenuEntries,
    toolbarAgentMenuEntries,
    agentLabel,
    pickAgentValue,
  } = useDroneHubToolbarMenuState({
    chatModels,
    currentModel,
    registeredRepoPaths,
    customAgents,
    allowCustomAgents: currentDroneAllowsCustomAgents,
    builtinAgentOptions,
    currentAgent,
    currentCustomAgentMissing,
    currentAgentKey,
    agentLocked,
    setChatAgent,
    handleSetAgentFailure,
    setCustomAgentError,
    setNewCustomAgentLabel,
    setNewCustomAgentCommand,
    setCustomAgentModalOpen,
  });
  const focusEditorPane = React.useCallback(() => {
    requestRightPanelTab('editor');
  }, [requestRightPanelTab]);
  const openFileInFilesPane = React.useCallback(
    (next: { path: string; name: string; line?: number | null; column?: number | null }) => {
      const resolvedPath = resolveDroneFileOpenPath(currentDrone, next.path);
      if (!resolvedPath) return;
      const slash = resolvedPath.lastIndexOf('/');
      const parentPath = slash > 0 ? resolvedPath.slice(0, slash) : '/';
      const name = String(next.name ?? '').trim() || resolvedPath.split('/').filter(Boolean).pop() || resolvedPath;
      setCurrentFsPath(parentPath || '/');
      openEditorFile({ ...next, path: resolvedPath, name });
      focusEditorPane();
    },
    [currentDrone, focusEditorPane, openEditorFile, setCurrentFsPath],
  );
  const openFileInPanelFromFilesPane = React.useCallback(
    (next: { path: string; name: string; line?: number | null; column?: number | null }): boolean => {
      const droneId = String(currentDrone?.id ?? '').trim();
      const resolvedPath = resolveDroneFileOpenPath(currentDrone, next.path);
      if (!droneId || !resolvedPath) return false;
      const slash = resolvedPath.lastIndexOf('/');
      const parentPath = slash > 0 ? resolvedPath.slice(0, slash) : '/';
      const name = String(next.name ?? '').trim() || resolvedPath.split('/').filter(Boolean).pop() || resolvedPath;
      setCurrentFsPath(parentPath || '/');
      openEditorFile({ ...next, path: resolvedPath, name });
      focusEditorPane();
      return true;
    },
    [currentDrone, focusEditorPane, openEditorFile, setCurrentFsPath],
  );

  const openQuickOpenFromShortcut = React.useCallback(() => {
    if (!currentDrone?.id) return false;
    focusEditorPane();
    openQuickOpen();
    return true;
  }, [currentDrone?.id, focusEditorPane, openQuickOpen]);

  const revealEditorLocationParent = React.useCallback(
    (pathRaw: string) => {
      const resolvedPath = resolveDroneFileOpenPath(currentDrone, pathRaw);
      if (!resolvedPath) return;
      const slash = resolvedPath.lastIndexOf('/');
      const parentPath = slash > 0 ? resolvedPath.slice(0, slash) : '/';
      setCurrentFsPath(parentPath || '/');
      focusEditorPane();
    },
    [currentDrone, focusEditorPane, setCurrentFsPath],
  );

  const goBackEditorLocationFromShortcut = React.useCallback(() => {
    const location = goBackLocation();
    if (!location) return false;
    revealEditorLocationParent(location.path);
    return true;
  }, [goBackLocation, revealEditorLocationParent]);

  const goForwardEditorLocationFromShortcut = React.useCallback(() => {
    const location = goForwardLocation();
    if (!location) return false;
    revealEditorLocationParent(location.path);
    return true;
  }, [goForwardLocation, revealEditorLocationParent]);

  React.useEffect(() => {
    const isQuickOpenShortcut = (event: KeyboardEvent): boolean =>
      event.key.toLowerCase() === 'p' &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey;
    const isBackShortcut = (event: KeyboardEvent): boolean =>
      event.key === 'ArrowLeft' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const isForwardShortcut = (event: KeyboardEvent): boolean =>
      event.key === 'ArrowRight' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isQuickOpenShortcut(event)) {
        if (!openQuickOpenFromShortcut()) return;
        event.preventDefault();
        return;
      }
      if (quickOpenOpen) return;
      if (isBackShortcut(event)) {
        if (!goBackEditorLocationFromShortcut()) return;
        event.preventDefault();
        return;
      }
      if (isForwardShortcut(event)) {
        if (!goForwardEditorLocationFromShortcut()) return;
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [goBackEditorLocationFromShortcut, goForwardEditorLocationFromShortcut, openQuickOpenFromShortcut, quickOpenOpen]);

  const openMarkdownFileReference = React.useCallback(
    (ref: MarkdownFileReference) => {
      const containerPath = resolveDroneFileOpenPath(currentDrone, ref.path);
      if (!containerPath) return;
      const name = containerPath.split('/').filter(Boolean).pop() || containerPath;
      openFileInFilesPane({
        path: containerPath,
        name,
        line: ref.line,
        column: ref.column,
      });
    },
    [currentDrone, openFileInFilesPane],
  );
  const resolveCurrentDroneRepoFilePath = React.useCallback(
    (repoRelativePathRaw: string): string | null => {
      const relativePath = String(repoRelativePathRaw ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!relativePath) return null;
      const basePath = String(defaultFsPathForCurrentDrone ?? '').trim() || droneHomePath(currentDrone);
      return normalizeContainerPathInput(`${basePath.replace(/\/+$/g, '')}/${relativePath}`);
    },
    [currentDrone, defaultFsPathForCurrentDrone],
  );
  const openChangesFileInEditor = React.useCallback(
    (repoRelativePath: string) => {
      const containerPath = resolveCurrentDroneRepoFilePath(repoRelativePath);
      if (!containerPath) return;
      const name = containerPath.split('/').filter(Boolean).pop() || containerPath;
      openFileInFilesPane({ path: containerPath, name });
    },
    [openFileInFilesPane, resolveCurrentDroneRepoFilePath],
  );
  const revealChangesFileInFiles = React.useCallback(
    (pane: 'top' | 'bottom' | 'single', repoRelativePath: string) => {
      const containerPath = resolveCurrentDroneRepoFilePath(repoRelativePath);
      if (!containerPath) return;
      const slash = containerPath.lastIndexOf('/');
      const parentPath = slash > 0 ? containerPath.slice(0, slash) : '/';
      setCurrentFsPath(parentPath);
      if (pane === 'bottom') {
        setRightPanelBottomTab('files');
        setRightPanelOpen(true);
      } else {
        requestRightPanelTab('files');
      }
    },
    [requestRightPanelTab, resolveCurrentDroneRepoFilePath, setCurrentFsPath, setRightPanelBottomTab, setRightPanelOpen],
  );
  const onActivateChatFromCanvas = React.useCallback(
    (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (
        !droneId ||
        (!sidebarSelectableDroneIdSet.has(droneId) &&
          !isWorkflowChildDrone(droneByIdRef.current[droneId]))
      ) return;
      const chatName = String(chatNameRaw ?? '').trim() || 'default';
      selectDroneChat(droneId, chatName);
    },
    [selectDroneChat, sidebarSelectableDroneIdSet],
  );
  const assignCanvasDronesToOwner = React.useCallback(
    async (ownerDroneIdRaw: string, targetDroneIdsRaw: string[]): Promise<{ ok: boolean; error?: string | null }> => {
      const ownerDroneId = String(ownerDroneIdRaw ?? '').trim();
      if (!ownerDroneId) return { ok: false, error: 'Missing relationship owner.' };
      try {
        const latest = await assignFleetTargets(ownerDroneId, targetDroneIdsRaw);
        if (latest) dispatchFleetAssignmentUpdated({ ownerDroneId, actor: latest });
        return { ok: true, error: null };
      } catch (error: any) {
        return {
          ok: false,
          error: String(error?.message ?? error ?? '').trim() || 'Failed to assign drones.',
        };
      }
    },
    [],
  );
  const assignDroppedDronesToTarget = React.useCallback(async () => {
    const targetDroneId = String(droneDropActionModal?.targetDroneId ?? '').trim();
    const sourceDroneIds = droneDropActionModal?.sourceDroneIds ?? [];
    if (!targetDroneId || sourceDroneIds.length === 0) {
      return { ok: false, error: 'No dropped drones selected.', meta: null };
    }
    const result = await assignCanvasDronesToOwner(targetDroneId, sourceDroneIds);
    if (!result.ok && result.error && droppedDroneTarget) {
      openDroneErrorModal(droppedDroneTarget, result.error, null);
    }
    return { ok: result.ok, error: result.error ?? null, meta: null };
  }, [assignCanvasDronesToOwner, droneDropActionModal, droppedDroneTarget, openDroneErrorModal]);
  const sendCanvasPrompt = React.useCallback(
    async (
      targetsRaw: Array<{ droneId: string; chatName: string }>,
      promptRaw: string,
    ): Promise<{ ok: boolean; error?: string | null }> => {
      const prompt = String(promptRaw ?? '').trim();
      if (!prompt) return { ok: false, error: 'Message is empty.' };

      const targets: Array<{ droneId: string; chatName: string }> = [];
      for (const raw of Array.isArray(targetsRaw) ? targetsRaw : []) {
        const droneId = String(raw?.droneId ?? '').trim();
        if (!droneId) continue;
        const chatName = String(raw?.chatName ?? '').trim() || 'default';
        if (targets.some((x) => x.droneId === droneId && x.chatName === chatName)) continue;
        targets.push({ droneId, chatName });
      }
      if (targets.length === 0) return { ok: false, error: 'No chats selected.' };

      const droneById = new Map<string, DroneSummary>();
      for (const drone of drones) {
        const id = String(drone?.id ?? '').trim();
        if (!id) continue;
        droneById.set(id, drone);
      }
      const targetNames = targets.map(({ droneId, chatName }) => {
        const drone = droneById.get(droneId);
        const droneLabel = drone ? uiDroneName(drone.name) : droneId;
        return `${droneLabel} / ${chatName}`;
      });

      const results = await Promise.allSettled(
        targets.map(async ({ droneId, chatName }) => {
          const drone = droneById.get(droneId);
          if (!drone) throw new Error(`Drone "${droneId}" is unavailable.`);
          if (isDroneStartingOrSeeding(drone.hubPhase)) {
            throw new Error(`"${uiDroneName(drone.name)}" is still starting.`);
          }
          const resolvedChat = resolveChatNameForDrone(drone, chatName);
          const data = await requestJson<{
            ok: true;
            accepted: true;
            promptId: string;
            autoRenameChat?: boolean;
          }>(
            `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(resolvedChat)}/prompt`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                prompt,
                attachments: [],
                submittedAt: new Date().toISOString(),
                autoRenameHandledByClient: true,
              }),
            },
          );
          if (data.autoRenameChat) {
            autoRenameChatFromFirstPromptRef.current(drone.id, resolvedChat, prompt);
          }
        }),
      );

      const failed: string[] = [];
      for (let i = 0; i < results.length; i += 1) {
        if (results[i].status === 'rejected') failed.push(targetNames[i] ?? targets[i]?.droneId ?? 'unknown');
      }
      if (failed.length === 0) return { ok: true, error: null };
      if (failed.length === targets.length) {
        return { ok: false, error: `Failed to send to all ${targets.length} chats.` };
      }
      const preview = failed.slice(0, 3).join(', ');
      const more = failed.length > 3 ? ` +${failed.length - 3} more` : '';
      return {
        ok: true,
        error: `Sent to ${targets.length - failed.length}/${targets.length}. Failed: ${preview}${more}.`,
      };
    },
    [drones, requestJson, uiDroneName],
  );
  const [publishingDraft, setPublishingDraft] = React.useState(false);
  const publishSelectedDraft = React.useCallback(async (): Promise<boolean> => {
    if (!currentDrone || publishingDraft) return false;
    const droneId = String(currentDrone.id ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    if (!droneId) return false;
    setPublishingDraft(true);
    try {
      const isDraftDrone = currentDrone.draft === true || currentDrone.hubPhase === 'draft';
      await requestJson<{ ok: true }>(
        isDraftDrone
          ? `/api/drones/${encodeURIComponent(droneId)}/publish`
          : `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/publish`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      return true;
    } catch (error: any) {
      console.error('[DroneHub] publish draft failed', { droneId, chatName, error });
      return false;
    } finally {
      setPublishingDraft(false);
    }
  }, [currentDrone, publishingDraft, requestJson, selectedChat]);
  const createCanvasDroneFromDraft = React.useCallback(
    async (payload: {
      draftNodeId: string;
      prompt: string;
      label: string;
      overrides: {
        agentKey: string;
        model: string;
        repoPath: string;
        group: string;
        pullHostBranchBeforeCreate: boolean;
      };
    }): Promise<{ ok: boolean; droneId?: string; droneName?: string; error?: string | null }> => {
      const prompt = String(payload?.prompt ?? '').trim();
      if (!prompt) return { ok: false, error: 'Message is empty.' };

      const overrides = payload?.overrides ?? {
        agentKey: '',
        model: '',
        repoPath: '',
        group: '',
        pullHostBranchBeforeCreate: pullHostBranchBeforeCreate,
      };
      const seedAgentKey = String(overrides.agentKey ?? spawnAgentKey ?? '').trim() || 'builtin:cursor';
      const seedAgent = resolveAgentKeyToConfig(seedAgentKey);
      const seedModel =
        seedAgent.kind !== 'custom'
          ? String(overrides.model ?? spawnModel ?? '').trim() || null
          : null;
      const seedAgentPermissionMode: AgentPermissionMode = seedAgent ? spawnAgentPermissionMode : 'full-access';
      const seedApprovalPolicy: AgentApprovalPolicy =
        seedAgent.kind === 'builtin' &&
        seedAgent.id === 'codex' &&
        spawnApprovalPolicy === 'ask'
          ? 'agent-decides'
          : spawnApprovalPolicy;
      if (
        seedAgentPermissionMode !== 'full-access' &&
        !(
          seedAgent.kind === 'native' ||
          (seedAgent.kind === 'builtin' &&
            (seedAgent.id === 'codex' || seedAgent.id === 'blip'))
        )
      ) {
        return {
          ok: false,
          error: 'Agent access controls are available for native, Codex, and Blip chats.',
        };
      }
      const repoPath = String(overrides.repoPath ?? chatHeaderRepoPath ?? '').trim();
      const group = String(overrides.group ?? draftCreateGroup ?? '').trim();
      const shouldPullHostBranchBeforeCreate =
        overrides.pullHostBranchBeforeCreate === true ||
        (overrides.pullHostBranchBeforeCreate !== false && pullHostBranchBeforeCreate);
      const remoteBranch = String(repoCreateRemoteBranch ?? '').trim();

      try {
        const seedSubmittedAt = new Date().toISOString();
        const body: any = {
          ...(group ? { group } : {}),
          ...(repoPath ? { repoPath } : {}),
          pullHostBranchBeforeCreate: shouldPullHostBranchBeforeCreate,
          repoBranchSource,
          ...(repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
          seedChat: 'default',
          ...(seedAgent ? { seedAgent } : {}),
          ...(seedModel ? { seedModel } : {}),
          ...(seedAgentPermissionMode !== 'full-access' ? { seedAgentPermissionMode } : {}),
          ...(seedApprovalPolicy !== 'ask' ? { seedApprovalPolicy } : {}),
          seedPrompt: prompt,
          seedSubmittedAt,
        };
        const data = await requestJson<{ ok: true; id: string; name: string; phase: 'starting' }>(
          '/api/drones',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const droneId = String((data as any)?.id ?? '').trim();
        const droneName = String((data as any)?.name ?? '').trim() || droneId;
        if (!droneId) return { ok: false, error: 'Failed creating drone: missing id.' };

        if (seedModel) rememberSeenModels([seedModel]);
        rememberStartupSeed([{ id: droneId, name: droneName }], {
          runtime: 'container',
          agent: seedAgent,
          model: seedModel,
          agentPermissionMode: seedAgentPermissionMode,
          approvalPolicy: seedApprovalPolicy,
          prompt,
          chatName: 'default',
          group,
          repoPath,
        });
        preferredSelectedDroneRef.current = droneId;
        preferredSelectedDroneHoldUntilRef.current = Date.now() + STARTUP_SEED_MISSING_GRACE_MS;
        void suggestAndRenameDraftDrone(droneId, prompt);
        return { ok: true, droneId, droneName, error: null };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    },
    [
      chatHeaderRepoPath,
      draftCreateGroup,
      pullHostBranchBeforeCreate,
      repoBranchSource,
      repoCreateRemoteBranch,
      resolveAgentKeyToConfig,
      spawnAgentKey,
      spawnAgentPermissionMode,
      spawnApprovalPolicy,
      spawnModel,
      preferredSelectedDroneHoldUntilRef,
      preferredSelectedDroneRef,
      rememberSeenModels,
      rememberStartupSeed,
      requestJson,
      suggestAndRenameDraftDrone,
    ],
  );
  const renameCanvasChat = React.useCallback(
    async (
      droneIdRaw: string,
      chatNameRaw: string,
      newNameRaw: string,
    ): Promise<{ ok: boolean; chatName?: string; error?: string | null }> => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim() || 'default';
      const newName = String(newNameRaw ?? '').trim();
      if (!droneId) return { ok: false, error: 'Missing drone id.' };
      if (!chatName) return { ok: false, error: 'Missing chat name.' };
      if (!sidebarSelectableDroneIdSet.has(droneId)) return { ok: false, error: 'Drone is unavailable.' };

      const drone = drones.find((item) => item.id === droneId) ?? null;
      const chats = Array.isArray(drone?.chats) && drone!.chats.length > 0 ? drone!.chats : ['default'];
      if (!chats.includes(chatName)) return { ok: false, error: `Chat "${chatName}" is unavailable.` };
      if (chatName === 'default') return { ok: false, error: 'Default chat cannot be renamed.' };
      if (!newName) return { ok: false, error: 'New chat name is required.' };
      if (newName === chatName) return { ok: true, chatName, error: null };

      try {
        await requestJson<{ ok: true; chat: string }>(
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/rename`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newName }),
          },
        );
        setSidebarChatOrderByDrone((prev) => {
          const currentOrder = prev[droneId];
          if (!currentOrder || !currentOrder.includes(chatName)) return prev;
          return {
            ...prev,
            [droneId]: currentOrder.map((entry) => (entry === chatName ? newName : entry)),
          };
        });
        if (selectedDrone === droneId && selectedChat === chatName) {
          setSelectedChat(newName);
        }
        return { ok: true, chatName: newName, error: null };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    },
    [
      drones,
      requestJson,
      selectedChat,
      selectedDrone,
      setSelectedChat,
      setSidebarChatOrderByDrone,
      sidebarSelectableDroneIdSet,
    ],
  );
  const suggestAndRenameDroneChatFromMessage = React.useCallback(
    async (droneIdRaw: string, chatNameRaw: string, promptRaw: string): Promise<void> => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim();
      const prompt = String(promptRaw ?? '').trim();
      if (!droneId || !isGeneratedChatName(chatName) || !prompt) return;
      let originalChatSeen = (droneByIdRef.current[droneId]?.chats ?? []).includes(chatName);
      try {
        const data = await requestJson<{ ok: true; name: string }>(
          '/api/drones/name-from-message',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              message: prompt,
              source: 'chat-auto-rename',
              droneId,
            }),
          },
        );
        const base = String((data as any)?.name ?? '').trim();
        if (!base) {
          showNameSuggestionFailureToast(new Error('Chat name suggestion returned an empty value.'));
          return;
        }
        if (base === chatName) return;

        const startedAtMs = Date.now();
        const maxRetryMs = 2 * 60 * 1000;
        let candidateIndex = 1;
        let lastError = '';
        for (let attempt = 1; attempt <= 180; attempt += 1) {
          const currentChats = droneByIdRef.current[droneId]?.chats ?? [];
          if (currentChats.includes(chatName)) originalChatSeen = true;
          else if (originalChatSeen) return;
          const candidate = buildSuggestedChatNameCandidate(base, candidateIndex);
          if (!candidate) {
            showNameSuggestionFailureToast(new Error('Chat name suggestion produced an empty candidate.'));
            return;
          }
          try {
            await requestJson<{ ok: true; chat: string }>(
              `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/rename`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ newName: candidate }),
              },
            );
            const oldCanvasNodeId = createCanvasChatNodeId(droneId, chatName);
            const newCanvasNodeId = createCanvasChatNodeId(droneId, candidate);
            if (oldCanvasNodeId && newCanvasNodeId) {
              useDroneCanvasStore.getState().replaceNodeId(oldCanvasNodeId, newCanvasNodeId, candidate);
            }
            setSidebarChatOrderByDrone((prev) => {
              const currentOrder = prev[droneId];
              if (!currentOrder || !currentOrder.includes(chatName)) return prev;
              return {
                ...prev,
                [droneId]: currentOrder.map((entry) => (entry === chatName ? candidate : entry)),
              };
            });
            const { selectedDrone: activeDroneId, selectedChat: activeChatName } = useDroneHubUiStore.getState();
            if (activeDroneId === droneId && activeChatName === chatName) {
              setSelectedChat(candidate);
            }
            return;
          } catch (error: any) {
            const message = String(error?.message ?? error ?? '').trim();
            lastError = message || 'rename failed';
            if (isSuggestedChatRenameConflict(message)) {
              candidateIndex += 1;
              continue;
            }
            if (!isSuggestedChatRenameRetriable(message)) {
              showNameSuggestionFailureToast(new Error(`Chat auto-rename failed: ${lastError}`));
              return;
            }
            const delayMs = Math.min(3000, 250 + attempt * 250);
            if (Date.now() - startedAtMs + delayMs > maxRetryMs) break;
            await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
          }
        }
        const waitedMs = Date.now() - startedAtMs;
        const timeoutMessage = lastError
          ? `Chat auto-rename timed out after ${Math.round(waitedMs / 1000)}s (last error: ${lastError}).`
          : `Chat auto-rename timed out after ${Math.round(waitedMs / 1000)}s.`;
        showNameSuggestionFailureToast(new Error(timeoutMessage));
      } catch (error: any) {
        console.error('[DroneHub] chat auto-rename skipped', {
          id: droneId,
          chat: chatName,
          error: error?.message ?? String(error),
        });
        showNameSuggestionFailureToast(error);
      }
    },
    [requestJson, setSelectedChat, setSidebarChatOrderByDrone, showNameSuggestionFailureToast],
  );
  autoRenameChatFromFirstPromptRef.current = suggestAndRenameDroneChatFromMessage;
  const createDroneChat = React.useCallback(
    async (
      drone: DroneSummary,
      chatNameRaw: string,
      opts?: { draft?: boolean },
    ): Promise<{ ok: boolean; chatName?: string; error?: string | null }> => {
      const droneId = String(drone?.id ?? '').trim();
      if (!droneId) return { ok: false, error: 'Missing drone id.' };
      const availableChats = Array.isArray(drone?.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
      const chatName = String(chatNameRaw ?? '').trim();
      if (!chatName) {
        return { ok: false, error: 'Chat name is required.' };
      }
      const copyFromChat =
        selectedDrone === droneId
          ? (String(selectedChat ?? '').trim() || 'default')
          : (availableChats.includes('default') ? 'default' : availableChats[0] ?? 'default');
      try {
        await requestJson<{ ok: true }>(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: chatName,
            ...(availableChats.length > 0 ? { copyFromChat } : {}),
            ...(opts?.draft === true ? { draft: true } : {}),
          }),
        });
        setSelectedDrone(droneId);
        setSelectedChat(chatName);
        return { ok: true, chatName, error: null };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    },
    [requestJson, selectedChat, selectedDrone, setSelectedChat, setSelectedDrone],
  );
  const createDroneChatFromShortcut = React.useCallback(async (): Promise<boolean> => {
    if (!currentDrone) return false;
    const sourceChatName = resolveChatNameForDrone(currentDrone, selectedChat);
    const sourceDraftKey = chatInputDraftKeyForDroneChat(currentDrone.id, sourceChatName);
    const sourcePrompt = String(useDroneHubUiStore.getState().chatInputDrafts[sourceDraftKey] ?? '').trim();
    const chatName = suggestNextDroneChatName(currentDrone.chats);
    const result = await createDroneChat(currentDrone, chatName);
    if (result.ok && sourcePrompt) {
      void suggestAndRenameDroneChatFromMessage(currentDrone.id, chatName, sourcePrompt);
    }
    return result.ok === true;
  }, [createDroneChat, currentDrone, selectedChat, suggestAndRenameDroneChatFromMessage]);
  const toggleSelectedDronePinnedFromShortcut = React.useCallback((): boolean => {
    if (selectedDronePinShortcutBusyRef.current) return true;
    const mutation = resolveSelectedDronePinMutation({
      selectedDroneIds,
      activeDroneId: currentDrone?.id,
      availableDroneIds: new Set(
        [...drones, ...sidebarDrones]
          .map((drone) => String(drone?.id ?? '').trim())
          .filter(Boolean),
      ),
      pinnedDroneIds: useDroneHubUiStore.getState().pinnedDroneIds,
    });
    if (!mutation) return false;
    selectedDronePinShortcutBusyRef.current = true;
    void setDronesPinned(mutation.droneIds, mutation.pinned)
      .then((saved) => {
        if (saved) return;
        showShortcutToast(
          `Could not ${mutation.pinned ? 'pin' : 'unpin'} the selected ${mutation.droneIds.length === 1 ? 'drone' : 'drones'}.`,
          mutation.pinned ? 'Pin failed' : 'Unpin failed',
          'error',
        );
      })
      .finally(() => {
        selectedDronePinShortcutBusyRef.current = false;
      });
    return true;
  }, [currentDrone?.id, drones, selectedDroneIds, setDronesPinned, showShortcutToast, sidebarDrones]);
  const moveSelectedDroneToTopFromShortcut = React.useCallback((): boolean => {
    const droneId = String(selectedDrone ?? selectedDroneIds[0] ?? '').trim();
    if (!droneId) return false;
    const uiState = useDroneHubUiStore.getState();
    const pinnedIndex = uiState.pinnedDroneIds.indexOf(droneId);
    if (pinnedIndex >= 0) {
      if (pinnedIndex > 0) {
        uiState.setPinnedDroneIds([
          droneId,
          ...uiState.pinnedDroneIds.filter((pinnedDroneId) => pinnedDroneId !== droneId),
        ]);
      }
      return true;
    }
    const nodeTree = renderedSidebarNodeTreeRef.current;
    if (!nodeTree) return false;
    const nextNodeOrder = moveSidebarDroneToTopInNodeOrder(
      uiState.sidebarNodeOrderByParent,
      nodeTree,
      droneId,
    );
    if (!nextNodeOrder) return false;
    if (nextNodeOrder !== uiState.sidebarNodeOrderByParent) {
      uiState.setSidebarNodeOrderByParent(nextNodeOrder);
    }
    return true;
  }, [selectedDrone, selectedDroneIds]);
  const toggleSelectedDronesToDoFromShortcut = React.useCallback((): boolean => {
    const availableDroneIds = new Set(
      [...drones, ...sidebarDrones]
        .map((drone) => String(drone?.id ?? '').trim())
        .filter(Boolean),
    );
    const selectedIds = Array.from(
      new Set(
        selectedDroneIds
          .map((droneId) => String(droneId ?? '').trim())
          .filter((droneId) => droneId && availableDroneIds.has(droneId)),
      ),
    );
    const activeDroneId = String(currentDrone?.id ?? selectedDrone ?? '').trim();
    const targetIds =
      selectedIds.length > 0
        ? selectedIds
        : activeDroneId && availableDroneIds.has(activeDroneId)
          ? [activeDroneId]
          : [];
    if (targetIds.length === 0) return false;

    const uiState = useDroneHubUiStore.getState();
    const currentToDoIds = new Set(uiState.toDoDroneIds);
    const removeTag = targetIds.every((droneId) => currentToDoIds.has(droneId));
    if (removeTag) {
      uiState.setToDoDroneIds(uiState.toDoDroneIds.filter((droneId) => !targetIds.includes(droneId)));
    } else {
      uiState.setToDoDroneIds([...uiState.toDoDroneIds, ...targetIds]);
    }
    return true;
  }, [currentDrone?.id, drones, selectedDrone, selectedDroneIds, sidebarDrones]);
  useDroneHubLifecycleEffects({
    terminalMenuRef,
    terminalMenuOpen,
    setTerminalMenuOpen,
    headerOverflowRef,
    headerOverflowOpen,
    setHeaderOverflowOpen,
    droneErrorModal,
    setDroneErrorModal,
    openHome,
    openDraftChatComposer,
    openChildDraftChatComposer,
    createDroneChatFromShortcut,
    toggleSelectedDronePinnedFromShortcut,
    moveSelectedDroneToTopFromShortcut,
    toggleSelectedDronesToDoFromShortcut,
    openGroupMultiChat,
    openSidebarVisibleMultiChat,
    toggleVoiceClipboardRecording,
    draftCreateOpen,
    draftCreateNameRef,
    draftChat,
    setDraftCreateOpen,
    setDraftCreateError,
    setDraftCreating,
    setDraftCreateName,
    setDraftCreateGroup,
    setDraftCreateParentDroneId,
    setDraftNameSuggesting,
    setDraftSuggestedName,
    setDraftNameSuggestionError,
    draftNameSuggestSeqRef,
    rightPanelOpen,
    rightPanelTab,
    rightPanelSplit,
    rightPanelBottomTab,
    requestRightPanelTab,
    setSidebarCollapsed,
    shortcutBindings,
    llmSettings,
    requestJson,
    showNameSuggestionFailureToast,
    chatUiMode,
    chatUiModeRef,
    setStartupSeedByDrone,
    drones,
    transcripts,
    visiblePendingPromptsWithStartup,
    sessionText,
    prevOutputLenRef,
    pinnedToBottomRef,
    outputScrollRef,
    updatePinned,
    currentDrone,
    selectedDrone,
    selectedChat,
    draftCreating,
    draftAutoRenaming,
    setDraftChat,
    onDeleteSelectedDroneFromInputShortcut: deleteSelectedDroneFromInputShortcut,
    onMarkSelectedDronesUnreadShortcut: markSelectedDronesUnreadShortcut,
  });
  const deleteCanvasChat = React.useCallback(
    async (
      droneIdRaw: string,
      chatNameRaw: string,
    ): Promise<{ ok: boolean; deletedDrone?: boolean; error?: string | null }> => {
      const droneId = String(droneIdRaw ?? '').trim();
      const chatName = String(chatNameRaw ?? '').trim() || 'default';
      if (!droneId) return { ok: false, error: 'Missing drone id.' };
      if (!sidebarSelectableDroneIdSet.has(droneId)) return { ok: false, error: 'Drone is unavailable.' };

      const drone = drones.find((item) => item.id === droneId) ?? null;
      const chats = Array.isArray(drone?.chats) && drone!.chats.length > 0 ? drone!.chats : ['default'];
      const deleteMode = deleteActionSettingsState.deleteSettings?.deleteAction.mode ?? 'permanent';
      if (!chats.includes(chatName)) return { ok: false, error: `Chat "${chatName}" is unavailable.` };

      if (chats.length <= 1) {
        if (!autoDelete) {
          const opened = requestDeleteDrones([droneId]);
          return opened
            ? { ok: false, deletedDrone: false, error: '' }
            : { ok: false, deletedDrone: false, error: 'Failed to open delete confirmation.' };
        }
        const deletedDrone = await deleteDrone(droneId, { confirmed: true });
        return deletedDrone
          ? { ok: true, deletedDrone: true, error: null }
          : { ok: false, deletedDrone: false, error: autoDelete ? 'Failed to delete drone.' : '' };
      }
      if (chatName === 'default') {
        return { ok: false, error: 'Default chat cannot be deleted while other chats exist.' };
      }

      if (!autoDelete) {
        const droneLabel = drone ? uiDroneName(drone.name) : droneId;
        const confirmed = window.confirm(
          deleteMode === 'archive'
            ? `Archive chat "${chatName}" from "${droneLabel}"?\n\nYou can restore it from Settings > Archive before it auto-deletes.`
            : `Delete chat "${chatName}" from "${droneLabel}"?`,
        );
        if (!confirmed) return { ok: false, error: '' };
      }

      try {
        await requestJson<{ ok: true; deletedChat: string }>(
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}`,
          { method: 'DELETE' },
        );
        setSidebarChatOrderByDrone((prev) => {
          const currentOrder = prev[droneId];
          if (!currentOrder || !currentOrder.includes(chatName)) return prev;
          const next = { ...prev };
          const filtered = currentOrder.filter((entry) => entry !== chatName);
          if (filtered.length === 0) {
            delete next[droneId];
            return next;
          }
          next[droneId] = filtered;
          return next;
        });
        if (selectedDrone === droneId && selectedChat === chatName) {
          const remaining = chats.filter((chat) => chat !== chatName);
          const fallbackChat = remaining.includes('default') ? 'default' : remaining[0] ?? 'default';
          setSelectedChat(fallbackChat);
        }
        return { ok: true, deletedDrone: false, error: null };
      } catch (err: any) {
        return { ok: false, deletedDrone: false, error: err?.message ?? String(err) };
      }
    },
    [
      autoDelete,
      deleteActionSettingsState.deleteSettings,
      deleteDrone,
      drones,
      requestDeleteDrones,
      requestJson,
      selectedChat,
      selectedDrone,
      setSelectedChat,
      setSidebarChatOrderByDrone,
      sidebarSelectableDroneIdSet,
      uiDroneName,
    ],
  );
  const canvasDraftRepoLabel = React.useMemo(() => {
    const repoPath = String(chatHeaderRepoPath ?? '').trim();
    if (!repoPath) return '';
    return repoPath.split(/[\\/]/).filter(Boolean).pop() || repoPath;
  }, [chatHeaderRepoPath]);
  const orderedCanvasChatNodeIds = React.useMemo(() => {
    const droneById = new Map(drones.map((drone) => [drone.id, drone] as const));
    const out: string[] = [];
    for (const droneId of orderedDroneIds) {
      const drone = droneById.get(droneId);
      if (!drone) continue;
      const chats = orderSidebarEntries(
        normalizedDroneChats(drone, { includeDefaultWhenEmpty: true }),
        sidebarChatOrderByDrone[droneId] ?? [],
        (chatName) => chatName,
      );
      for (const chatName of chats) {
        if (!chatName) continue;
        const nodeId = createCanvasChatNodeId(droneId, chatName);
        if (!nodeId || out.includes(nodeId)) continue;
        out.push(nodeId);
      }
    }
    return out;
  }, [drones, orderedDroneIds, sidebarChatOrderByDrone]);
  const selectedCanvasChatNodeId = React.useMemo(() => {
    const droneId = String(selectedDrone ?? '').trim();
    if (!droneId) return null;
    const chatName = String(selectedChat ?? '').trim() || 'default';
    return createCanvasChatNodeId(droneId, chatName);
  }, [selectedChat, selectedDrone]);

  const renderRightPanelTabContent = React.useCallback(
    (drone: DroneSummary, tab: RightPanelTab, paneKey: PreviewPaneKey): React.ReactNode => {
      const terminalKey = terminalPaneStateKey(drone.id, paneKey);
      const terminalSessionsState = terminalKey
        ? terminalSessionsByPane[terminalKey] ?? createTerminalPaneSessionsState()
        : createTerminalPaneSessionsState();
      const lockedPreview = tab === 'preview' ? lockedPreviewByDrone[drone.id] ?? null : null;
      const previewDrone = lockedPreview?.drone ?? drone;
      const previewCurrentDroneId = lockedPreview?.currentDroneId ?? currentDrone?.id ?? null;
      const previewSelectedPort = lockedPreview?.selectedPreviewPort ?? selectedPreviewPort;
      const previewPortReachability = lockedPreview?.currentPortReachability ?? currentPortReachability;
      const previewPortsLoading = lockedPreview?.portsLoading ?? portsLoading;
      const previewPortsError = lockedPreview?.portsError ?? portsError;
      const previewPortsErrorUi = lockedPreview?.portsErrorUi ?? portsErrorUi;
      const previewPortsPane = lockedPreview?.portsPane ?? portsPane;
      const previewDefaultUrl = lockedPreview?.selectedPreviewDefaultUrl ?? selectedPreviewDefaultUrl;
      const previewUrlOverride = lockedPreview?.selectedPreviewUrlOverride ?? selectedPreviewUrlOverride;
      const previewSetUrlOverride = lockedPreview?.setSelectedPreviewUrlOverride ?? setSelectedPreviewUrlOverride;
      const previewPortRows = lockedPreview?.portRows ?? portRows;

      return (
        <RightPanelTabContent
          drone={previewDrone}
          tab={tab}
          paneKey={paneKey}
          selectedChat={selectedChat}
          orderedCanvasChatNodeIds={orderedCanvasChatNodeIds}
          droneById={droneById}
          droneNameById={droneNameById}
          droneRepoById={droneRepoById}
          fleetParentIdByDroneId={fleetParentIdByDroneId}
          fleetAssignedIdsByDroneId={fleetAssignedIdsByDroneId}
          draftRepoLabel={canvasDraftRepoLabel}
          chatNodeStateById={chatNodeStateById}
          onActivateChatFromCanvas={onActivateChatFromCanvas}
          onAssignCanvasDronesToOwner={async (ownerDroneId, targetDroneIds) => openDroneDropActionModal(ownerDroneId, targetDroneIds)}
          onSendCanvasPrompt={sendCanvasPrompt}
          onCreateCanvasDroneFromDraft={createCanvasDroneFromDraft}
          onRenameCanvasChat={renameCanvasChat}
          onDeleteCanvasChat={deleteCanvasChat}
          onCloneCanvasDrone={cloneDroneWithoutSelection}
          canvasSpawnAgentMenuEntries={spawnAgentMenuEntries}
          canvasSpawnAgentKey={spawnAgentKey}
          onCanvasSpawnAgentKeyChange={setSpawnAgentKey}
          onOpenCanvasCustomAgentModal={() => setCustomAgentModalOpen(true)}
          canvasSpawnAgentConfig={spawnAgentConfig}
          canvasSpawnModel={spawnModel}
          onCanvasSpawnModelChange={setSpawnModel}
          canvasCreateRepoMenuEntries={createRepoMenuEntries}
          canvasCreateRepoPath={chatHeaderRepoPath}
          onCanvasCreateRepoPathChange={setChatHeaderRepoPath}
          canvasCreateGroup={draftCreateGroup}
          onCanvasCreateGroupChange={setDraftCreateGroup}
          canvasPullHostBranchBeforeCreate={pullHostBranchBeforeCreate}
          onCanvasPullHostBranchBeforeCreateChange={setPullHostBranchBeforeCreate}
          currentDroneId={previewCurrentDroneId}
          currentCanvasChatNodeId={selectedCanvasChatNodeId}
          defaultFsPathForCurrentDrone={defaultFsPathForCurrentDrone}
          terminalSessionsState={terminalSessionsState}
          onEnsureTerminalSessions={ensureTerminalPaneSessions}
          onCreateTerminalSession={createTerminalPaneTab}
          onActivateTerminalSession={setActiveTerminalPaneTab}
          onResolveTerminalSessionName={setTerminalPaneTabSessionName}
          onCloseTerminalSession={closeTerminalPaneTab}
          uiDroneName={uiDroneName}
          currentFsPath={currentFsPath}
          fsEntries={fsEntries}
          fsLoading={fsLoading}
          fsError={fsError}
          fsErrorUi={fsErrorUi}
          filesPane={filesPane}
          setCurrentFsPath={setCurrentFsPath}
          refreshFsList={refreshFsList}
          selectedPreviewPort={previewSelectedPort}
          currentPortReachability={previewPortReachability}
          portsLoading={previewPortsLoading}
          portsError={previewPortsError}
          portsErrorUi={previewPortsErrorUi}
          portsPane={previewPortsPane}
          selectedPreviewDefaultUrl={previewDefaultUrl}
          selectedPreviewUrlOverride={previewUrlOverride}
          setSelectedPreviewUrlOverride={previewSetUrlOverride}
          previewLocked={Boolean(lockedPreview)}
          onTogglePreviewLocked={() => {
            if (lockedPreview) {
              setPreviewLockedForDrone(drone.id, false);
              return;
            }
            setPreviewLockedForDrone(drone.id, true, {
              drone,
              currentDroneId: currentDrone?.id ?? null,
              selectedPreviewPort,
              currentPortReachability,
              portsLoading,
              portsError,
              portsErrorUi,
              portsPane: { waiting: portsPane.waiting, timedOut: portsPane.timedOut },
              selectedPreviewDefaultUrl,
              selectedPreviewUrlOverride,
              setSelectedPreviewUrlOverride,
              portRows,
            });
          }}
          agentLabel={agentLabel}
          portRows={previewPortRows}
          onRefreshOpenedEditorFile={refreshOpenedFile}
          onReloadOpenedEditorFileFromDisk={reloadOpenedFileFromDisk}
          onOverwriteOpenedEditorFile={overwriteOpenedFile}
          onOpenFileInEditor={(entry) => {
            if (entry.kind !== 'file') return;
            openFileInFilesPane({ path: entry.path, name: entry.name });
          }}
          onOpenFileInPanel={(entry) => {
            if (entry.kind !== 'file') return false;
            return openFileInPanelFromFilesPane({ path: entry.path, name: entry.name });
          }}
          onOpenFileTargetInEditor={openFileInFilesPane}
          openedFile={{
            path: openedEditorFile?.path ?? null,
            name: openedEditorFile?.name ?? null,
            loading: openedEditorFileLoading,
            saving: openedEditorFileSaving,
            error: openedEditorFileError,
            kind: openedEditorFileKind,
            mime: openedEditorFileMime,
            size: openedEditorFileSize,
            content: openedEditorFileContent,
            dirty: openedEditorFileDirty,
            mtimeMs: openedEditorFileMtimeMs,
            revision: openedEditorFileRevision,
            externallyChanged: openedEditorFileExternallyChanged,
            canOverwriteExternalChange: openedEditorFileCanOverwriteExternalChange,
            targetLine: openedEditorFile?.targetLine ?? null,
            targetColumn: openedEditorFile?.targetColumn ?? null,
            navigationSeq: openedEditorFile?.navigationSeq ?? 0,
          }}
          quickOpen={{
            open: quickOpenOpen,
            query: quickOpenQuery,
            files: quickOpenFiles,
            recentFiles: openedEditorRecentFiles,
            loading: quickOpenLoading,
            error: quickOpenError,
            canGoBack: canGoBackLocation,
            canGoForward: canGoForwardLocation,
            onQueryChange: setQuickOpenQuery,
            onClose: closeQuickOpen,
            onOpenFile: (next) => {
              openFileInFilesPane(next);
              closeQuickOpen();
            },
            onGoBack: () => {
              const location = goBackLocation();
              if (location) revealEditorLocationParent(location.path);
            },
            onGoForward: () => {
              const location = goForwardLocation();
              if (location) revealEditorLocationParent(location.path);
            },
          }}
          openedFileTabs={openedEditorFileTabs}
          activeOpenedFileTabId={activeOpenedFileTabId}
          onOpenedEditorFileContentChange={setOpenedFileContent}
          onSaveOpenedEditorFile={saveOpenedFile}
          onCloseOpenedEditorFile={closeEditorFile}
          onConfirmCloseOpenedEditorFilesForPaths={confirmCloseOpenedFileTabsForPaths}
          onCloseOpenedEditorFilesForPaths={closeOpenedFileTabsForPaths}
          onRemapOpenedEditorFilesForPathChange={remapOpenedFileTabsForPathChange}
          onActivateOpenedEditorFileTab={setActiveOpenedFileTab}
          onReorderOpenedEditorFileTabs={reorderOpenedFileTabs}
          onRevealChangesFileInFiles={revealChangesFileInFiles}
          onOpenChangesFileInEditor={openChangesFileInEditor}
          onOpenPullRequest={(pane, _pullRequest) => {
            if (pane === 'bottom') {
              setRightPanelBottomTab('prs');
              setRightPanelOpen(true);
              return;
            }
            requestRightPanelTab('prs');
          }}
        />
      );
    },
    [
      agentLabel,
      currentDrone?.id,
      currentFsPath,
      currentPortReachability,
      createCanvasDroneFromDraft,
      renameCanvasChat,
      deleteCanvasChat,
      cloneDrone,
      canvasDraftRepoLabel,
      defaultFsPathForCurrentDrone,
      droneById,
      droneNameById,
      droneRepoById,
      fleetParentIdByDroneId,
      fleetAssignedIdsByDroneId,
      chatNodeStateById,
      onActivateChatFromCanvas,
      openDroneDropActionModal,
      orderedCanvasChatNodeIds,
      filesPane,
      fsEntries,
      fsError,
      fsErrorUi,
      fsLoading,
      lockedPreviewByDrone,
      terminalSessionsByPane,
      portRows,
      portsError,
      portsErrorUi,
      portsLoading,
      portsPane,
      revealChangesFileInFiles,
      refreshFsList,
      sendCanvasPrompt,
      createRepoMenuEntries,
      chatHeaderRepoPath,
      draftCreateGroup,
      pullHostBranchBeforeCreate,
      setChatHeaderRepoPath,
      setCustomAgentModalOpen,
      setDraftCreateGroup,
      ensureTerminalPaneSessions,
      createTerminalPaneTab,
      setActiveTerminalPaneTab,
      setTerminalPaneTabSessionName,
      closeTerminalPaneTab,
      setPullHostBranchBeforeCreate,
      setSpawnAgentKey,
      setSpawnModel,
      selectedChat,
      selectedCanvasChatNodeId,
      selectedPreviewDefaultUrl,
      selectedPreviewPort,
      selectedPreviewUrlOverride,
      setPreviewLockedForDrone,
      spawnAgentConfig,
      spawnAgentKey,
      spawnAgentMenuEntries,
      spawnModel,
      setCurrentFsPath,
      setRightPanelBottomTab,
      setRightPanelOpen,
      setRightPanelTab,
      setSelectedPreviewUrlOverride,
      uiDroneName,
      openChangesFileInEditor,
      openFileInFilesPane,
      openFileInPanelFromFilesPane,
      openedEditorRecentFiles,
      openedEditorFile,
      openedEditorFileContent,
      openedEditorFileDirty,
      openedEditorFileError,
      openedEditorFileKind,
      openedEditorFileLoading,
      openedEditorFileMime,
      openedEditorFileMtimeMs,
      openedEditorFileSaving,
      openedEditorFileSize,
      openedEditorFileTabs,
      activeOpenedFileTabId,
      quickOpenOpen,
      quickOpenQuery,
      quickOpenFiles,
      quickOpenLoading,
      quickOpenError,
      canGoBackLocation,
      canGoForwardLocation,
      closeQuickOpen,
      setQuickOpenQuery,
      goBackLocation,
      goForwardLocation,
      revealEditorLocationParent,
      setOpenedFileContent,
      refreshOpenedFile,
      saveOpenedFile,
      closeEditorFile,
      confirmCloseOpenedFileTabsForPaths,
      closeOpenedFileTabsForPaths,
      remapOpenedFileTabsForPathChange,
      setActiveOpenedFileTab,
      reorderOpenedFileTabs,
    ],
  );

  const renderPersistentPreviewContent = React.useCallback(
    (activeDroneId: string | null, previewVisible: boolean): React.ReactNode => {
      const sessionIds = new Set<string>();
      const sessionDrones: DroneSummary[] = [];
      if (previewVisible && currentDrone) {
        sessionIds.add(currentDrone.id);
        sessionDrones.push(currentDrone);
      }
      for (const snapshot of Object.values(lockedPreviewByDrone) as PreviewPaneSnapshot[]) {
        if (sessionIds.has(snapshot.drone.id)) continue;
        sessionIds.add(snapshot.drone.id);
        sessionDrones.push(snapshot.drone);
      }
      if (sessionDrones.length === 0) return null;
      return sessionDrones.map((sessionDrone) => {
        const visible = previewVisible && sessionDrone.id === activeDroneId;
        return (
          <div
            key={`preview-session:${sessionDrone.id}`}
            className={`absolute inset-0 min-h-0 overflow-hidden ${visible ? '' : 'opacity-0 pointer-events-none'}`}
            aria-hidden={!visible}
          >
            {renderRightPanelTabContent(sessionDrone, 'preview', 'single')}
          </div>
        );
      });
    },
    [currentDrone, lockedPreviewByDrone, renderRightPanelTabContent],
  );

  const handleAddCustomAgent = React.useCallback(() => {
    const label = newCustomAgentLabel.trim();
    const command = newCustomAgentCommand.trim();
    if (!label) {
      setCustomAgentError('Name is required.');
      return;
    }
    if (!command) {
      setCustomAgentError('Command is required.');
      return;
    }
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom';
    const rand = Math.random().toString(16).slice(2, 8);
    const id = `${base}-${rand}`;
    setCustomAgents((prev) => [{ id, label, command }, ...prev]);
    setCustomAgentError(null);
    setNewCustomAgentLabel('');
    setNewCustomAgentCommand('');
    setCustomAgentModalOpen(false);
  }, [newCustomAgentCommand, newCustomAgentLabel]);

  const sidebarDeletingDrones = React.useMemo(() => {
    const operationIds = Object.keys(droneDeleteOperationModeById);
    if (operationIds.length === 0) return deletingDrones;
    const next = { ...deletingDrones };
    for (const id of operationIds) next[id] = true;
    return next;
  }, [deletingDrones, droneDeleteOperationModeById]);

  const sidebarProps: DroneSidebarProps = useDroneHubSidebarProps({
    dronesError,
    groupMoveError,
    dronesLoading,
    sidebarDronesFilteredByRepo,
    sidebarVisibleDrones,
    sidebarDrones,
    pinnedDroneIds,
    sidebarOptimisticDroneIdSet,
    selectedDroneSet,
    highlightedDroneIds,
    busyChatNodeIdSet,
    unreadAgentMessageByChatNodeId,
    deletingDrones: sidebarDeletingDrones,
    deleteOperationModeById: droneDeleteOperationModeById,
    deleteMode: deleteActionSettingsState.deleteSettings?.deleteAction.mode ?? 'permanent',
    renamingDrones,
    settingBaseImages,
    movingDroneGroups,
    sidebarGroups,
    sidebarGroupCreatedAtByName: registryGroupCreatedAtByName,
    sidebarGroupIdByName: registryGroupIdByName,
    sidebarHiddenGroupCount,
    collapsedGroups,
    deletingGroups,
    renamingGroups,
    sidebarHasUngroupedGroup,
    repos,
    reposLoading,
    reposError,
    drones,
    droneCountByRepoPath,
    uiDroneName,
    draftSidebarPlaceholder,
    openDraftChatComposer,
    selectDroneCard,
    selectDroneChat,
    createDroneChat,
    renameCanvasChat,
    deleteCanvasChat,
    cloneDroneFromSidebar,
    renameDroneTo,
    setDroneBaseImage,
    setDronePinned,
    deleteDrone: requestDeleteDrone,
    reparentDronesToParent,
    openDroneErrorModal,
    moveDronesToGroup,
    createGroup: createSidebarGroup,
    createGroupAndMove,
    setCollapsedGroups,
    renameGroup,
    openGroupMultiChat,
    openSidebarVisibleMultiChat,
    deleteGroup,
    prepareSidebarDroneDragStart,
    setReposModalOpen,
    setRenderedSidebarNodeTree,
    setDroneSelectionFromSidebarFolder,
  });

  const overlaysProps: DroneHubOverlaysProps = useDroneHubOverlaysProps({
    activeRepoPath,
    setCustomAgentModalOpen,
    draftCreateOpen,
    draftCreateMode,
    setDraftCreateOpen,
    setDraftCreateMode,
    draftCreating,
    draftCreateError,
    draftCreateName,
    setDraftCreateName,
    draftCreateNameRef,
    draftNameSuggesting,
    draftSuggestedName,
    draftNameSuggestionError,
    draftCreateGroup,
    setDraftCreateGroup,
    createDroneFromDraft,
    customAgentModalOpen,
    customAgentError,
    customAgents,
    newCustomAgentLabel,
    setNewCustomAgentLabel,
    newCustomAgentCommand,
    setNewCustomAgentCommand,
    setCustomAgents,
    handleAddCustomAgent,
    nameSuggestToast,
    reposModalOpen,
    repos,
    reposError,
    reposLoading,
    deletingRepos,
    setReposModalOpen,
    setActiveRepoPath,
    deleteRepo,
    githubUrlForRepo,
    deleteMode: deleteActionSettingsState.deleteSettings?.deleteAction.mode ?? 'permanent',
    dirtyDroneApplyModal,
    closeDirtyDroneApplyModal,
    continueDirtyDroneApply,
    droneErrorModal,
    clearingDroneError,
    closeDroneErrorModal,
    clearDroneHubError,
    droneDeleteConfirm,
    droneDeleteConfirmError,
    closeDroneDeleteConfirm,
    confirmDroneDelete,
    renameDroneTarget,
    closeRenameDrone,
    clearRenameDroneError,
    confirmRenameDrone,
    renamingDrones,
    droneDropActionModal,
    closeDroneDropActionModal,
    droppedDroneTarget,
    droppedDroneTargetLabel,
    droppedDroneRows,
    assignDroppedDronesToTarget,
    setNameSuggestToast,
  });

  const workspaceContentProps: DroneHubWorkspaceContentProps = useDroneHubWorkspaceContentProps({
    appView,
    llmSettingsState,
    deleteActionSettingsState,
    setupStatusState,
    requestJson,
    hubLogsState,
    hubLogsTailLines: HUB_LOGS_TAIL_LINES,
    hubLogsMaxBytes: HUB_LOGS_MAX_BYTES,
    setAppView,
    onReplayOnboarding: requestGuidedOnboardingReplay,
    onResetOnboarding: resetGuidedOnboardingDismissals,
    draftChat,
    createRuntime,
    createAsDraft,
    createPersistVolume,
    pullHostBranchBeforeCreate,
    repoBranchSource,
    setRepoBranchSource,
    repoCreateRemoteBranch,
    setRepoCreateRemoteBranch,
    setCreateRuntime,
    setCreateAsDraft,
    setCreatePersistVolume,
    draftCreateMode,
    setDraftCreateMode,
    spawnAgentPermissionMode,
    setSpawnAgentPermissionMode,
    spawnApprovalPolicy,
    setSpawnApprovalPolicy,
    spawnAgentApprovalSupported,
    spawnAgentReadOnlySupported,
    spawnAgentMenuEntries,
    draftCreating,
    draftAutoRenaming,
    spawnAgentConfig,
    createRepoMenuEntries,
    draftCreateRepoPath: chatHeaderRepoPath,
    agentsMdLibraryFiles,
    agentsMdLibraryLoading,
    agentsMdLibraryError,
    draftAgentsMdLibraryFileId,
    setDraftAgentsMdLibraryFileId,
    draftAgentsMdOverrideEnabled,
    setDraftAgentsMdOverrideEnabled,
    draftAgentsMdOverride,
    setDraftAgentsMdOverride,
    draftRepoBranchOptions: repoBranchOptionsByPath[String(chatHeaderRepoPath ?? '').trim()] ?? null,
    setCustomAgentModalOpen,
    draftCreateName,
    draftCreateGroup,
    draftCreateParentDroneId,
    draftCreateError,
    queuedPromptsByDroneChat,
    setDraftChat,
    setDraftCreateOpen,
    setDraftCreateName,
    setDraftCreateGroup,
    setDraftCreateParentDroneId,
    setDraftAutoRenaming,
    startDraftPrompt,
    queueDraftPromptDuringCreate,
    createDroneFromDraft,
    enqueueQueuedPrompt,
    removeQueuedPrompt,
    setDraftCreateError,
    selectedGroupMultiChatData,
    groupBroadcastPromptError,
    groupBroadcastSending,
    sendGroupBroadcastPrompt,
    handleAutoRenameChatFromFirstPrompt,
    publishSelectedDraft,
    publishingDraft,
    uiDroneName,
    selectDroneCard,
    selectDroneChat,
    deleteDrone: requestDeleteDrone,
    deletingDrones,
    optimisticallyDeletedDrones,
    spawnDroneHubTaskFromAgentMessage,
    drones,
    dronesLoading,
    sidebarDrones,
    dronesError,
    unreadAgentMessageByChatNodeId,
    openDraftChatComposer,
    activeRepoPath,
    settingsActiveTab,
    registeredRepoPaths,
    registryGroupNames,
    setActiveRepoPath,
    setSettingsActiveTab,
    currentDrone,
    deleteMode: deleteActionSettingsState.deleteSettings?.deleteAction.mode ?? 'permanent',
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
    currentReasoning,
    setChatModelSettings,
    agentPermissionMode: effectiveChatInfo?.agentPermissionMode ?? 'full-access',
    setChatAgentPermissionMode,
    approvalPolicy: effectiveChatInfo?.approvalPolicy ?? 'ask',
    setChatApprovalPolicy,
    dockerSnapshotAfterAgentMessageEnabled: effectiveChatInfo?.dockerSnapshotAfterAgentMessageEnabled === true,
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
    openDroneDropActionModal,
    repoOp,
    headerOverflowRef,
    reseedRepo,
    terminalMenuRef,
    terminalLabel,
    terminalOptions,
    rightPanelOpen,
    setRightPanelOpen,
    requestRightPanelTab,
    setRightPanelSplitMode,
    rightPanelSplit,
    rightPanelTabs,
    rightPanelTab,
    setRightPanelTab,
    rightPanelTabLabels: RIGHT_PANEL_TAB_LABELS,
    transcripts,
    visiblePendingPromptsWithStartup,
    transcriptMessageId,
    outputScrollRef,
    updatePinned,
    startupSeedForCurrentDrone,
    clearStartupSeedForDrone,
    sessionText,
    pinnedToBottom,
    selectedDroneIdentity,
    promptError,
    sendingPrompt,
    sendPromptText,
    canStopResponse,
    requestStopResponse,
    stoppingResponse,
    stopResponseError,
    requestCancelPendingPrompt,
    cancellingPendingPromptById,
    cancelPendingPromptErrorById,
    onOpenMarkdownFileReference: openMarkdownFileReference,
    openedEditorFilePath: openedEditorFile?.path ?? null,
    openedEditorFileName: openedEditorFile?.name ?? null,
    openedEditorFileLoading,
    openedEditorFileSaving,
    openedEditorFileError,
    openedEditorFileOpenFailureMessage: openedEditorFileOpenFailure?.message ?? null,
    openedEditorFileOpenFailureAt: openedEditorFileOpenFailure?.at ?? null,
    openedEditorFileKind,
    openedEditorFileMime,
    openedEditorFileSize,
    openedEditorFileContent,
    openedEditorFileDirty,
    openedEditorFileMtimeMs,
    openedEditorFileTargetLine: openedEditorFile?.targetLine ?? null,
    openedEditorFileTargetColumn: openedEditorFile?.targetColumn ?? null,
    openedEditorFileNavigationSeq: openedEditorFile?.navigationSeq ?? 0,
    onOpenedEditorFileContentChange: setOpenedFileContent,
    onSaveOpenedEditorFile: saveOpenedFile,
    onCloseOpenedEditorFile: closeEditorFile,
    rightPanelBottomTab,
    rightPanelOpenRequestSeq,
    renderRightPanelTabContent,
    renderPersistentPreviewContent,
  });

  return {
    sidebarProps,
    overlaysProps,
    workspaceContentProps,
  };
}
