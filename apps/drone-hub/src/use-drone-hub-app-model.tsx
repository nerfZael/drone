import React from 'react';
import {
  type AgentPermissionMode,
  type ChatAgentConfig,
  isValidDroneNameDashCase,
  normalizeChatInfoPayload,
} from './domain';
import { requestJson } from './droneHub/http';
import { activeProfileStorageId, persistProfileStorageIdOverride } from './profile-storage';
import { requestGuidedOnboardingReplay, resetGuidedOnboardingDismissals } from './onboarding/control';
import { copyText } from './droneHub/app/clipboard';
import { isCanvasDraftNodeId, useDroneCanvasStore } from './droneHub/canvas/use-drone-canvas-store';
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
import type { DroneHubOverlaysProps } from './droneHub/app/DroneHubOverlays';
import type { DroneHubWorkspaceContentProps } from './droneHub/app/DroneHubWorkspaceContent';
import { RightPanelTabContent } from './droneHub/app/RightPanelTabContent';
import { dispatchFleetAssignmentUpdated } from './droneHub/app/fleet-assignment-events';
import { assignFleetTargets } from './droneHub/fleet/fleet-api';
import { useHubLogs } from './droneHub/app/use-hub-logs';
import { useCreateDroneRowsState } from './droneHub/app/use-create-drone-rows-state';
import { useCreateDraftWorkflowState } from './droneHub/app/use-create-draft-workflow-store';
import { useDroneCreationActions } from './droneHub/app/use-drone-creation-actions';
import { useChatRuntimeOrchestration } from './droneHub/app/use-chat-runtime-orchestration';
import { useDroneErrorModalActions } from './droneHub/app/use-drone-error-modal-actions';
import { useRepoBranchOptions } from './droneHub/app/use-repo-branch-options';
import { useDroneMutationActions } from './droneHub/app/use-drone-mutation-actions';
import { useFilesAndPortsPaneState } from './droneHub/app/use-files-and-ports-pane-state';
import { useFileEditorState } from './droneHub/app/use-file-editor-state';
import { useGroupBroadcast } from './droneHub/app/use-group-broadcast';
import { useGroupManagement } from './droneHub/app/use-group-management';
import { useJobsWorkflow } from './droneHub/app/use-jobs-workflow';
import { useLlmSettings } from './droneHub/app/use-llm-settings';
import { useKanbanBoardSettings } from './droneHub/app/use-kanban-board-settings';
import { useTaskPlaybookButtonSettings } from './droneHub/app/use-task-playbook-button-settings';
import { useUiPreferencesSettings } from './droneHub/app/use-ui-preferences-settings';
import { removeDroneIdsFromSidebarNodeOrderByParent } from './droneHub/app/sidebar-node-order';
import { useDeleteActionSettings } from './droneHub/app/use-delete-action-settings';
import { useSetupStatus } from './droneHub/app/use-setup-status';
import type { ProfileSettingsResponse } from './droneHub/app/settings-types';
import { shellTerminalPrewarmKey, shouldPrewarmShellTerminal } from './droneHub/app/terminal-prewarm';
import { useQueuedPromptsState } from './droneHub/app/use-queued-prompts-state';
import { useRightPanelLayout } from './droneHub/app/use-right-panel-layout';
import { type DroneSelectionClickOptions } from './droneHub/app/drone-selection-helpers';
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
import { useTranscriptTldrState } from './droneHub/app/use-transcript-tldr-state';
import { useAgentSuggestionState } from './droneHub/app/use-agent-suggestion-state';
import { useWorkspaceNavigationActions } from './droneHub/app/use-workspace-navigation-actions';
import { useWorkspaceActions } from './droneHub/app/use-workspace-actions';
import {
  resolveNewDroneContextFromCurrentSelection,
  shouldInheritNewDroneContextFromCurrentSelection,
} from './droneHub/app/new-drone-context';
import { busyChatNodeIdsForDrone, droneChatNodeIds, normalizedDroneChats } from './droneHub/app/chat-node-helpers';
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
import { buildDroneHubTaskQueueSpec, type DroneHubTaskSpawnMode } from './droneHub/chat/drone-hub-task-spawn';
import {
  buildSuggestedChatNameCandidate,
  isSuggestedChatRenameConflict,
  isSuggestedChatRenameRetriable,
} from './droneHub/app/chat-name-suggestions';
import {
  chatInputDraftKeyForDroneChat,
  droneHomePath,
  isDroneStartingOrSeeding,
  makeId,
  normalizeContainerPathInput,
  resolveChatNameForDrone,
  suggestNextDroneChatName,
} from './droneHub/app/helpers';
import { allocateUntitledDisplayName, droneNameHasWhitespace } from './droneHub/app/name-helpers';
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

export type DroneHubAppModel = {
  sidebarProps: DroneSidebarProps;
  overlaysProps: DroneHubOverlaysProps;
  workspaceContentProps: DroneHubWorkspaceContentProps;
};

export function useDroneHubAppModel(): DroneHubAppModel {
  const {
    optimisticallyDeletedDrones,
    startupSeedByDrone,
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
    settingsPlaybookFocusId,
    chatHeaderRepoPath,
    appView,
    viewMode,
    sidebarGroupingMode,
    showRecentDronesOnly,
    collapsedGroups,
    sidebarGroupOrder,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    hiddenSidebarGroups,
    showHiddenSidebarGroups,
    autoDelete,
    terminalEmulator,
    fleetDashboardOpen,
    selectedDrone,
    selectedDroneIds,
    selectedGroupMultiChat,
    kanbanBoardOpen,
    playbookRunsOpen,
    selectedChat,
    draftChat,
    reposModalOpen,
    droneErrorModal,
    clearingDroneError,
    headerOverflowOpen,
    outputView,
    fsExplorerView,
    spawnContextRepoPath,
    spawnContextByRepoKey,
    spawnAgentKey,
    spawnModel,
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
    setSettingsPlaybookFocusId,
    setChatHeaderRepoPath,
    setAppView,
    setCollapsedGroups,
    setSidebarGroupOrder,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setHiddenSidebarGroups,
    setFleetDashboardOpen,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
    setKanbanBoardOpen,
    setPlaybookRunsOpen,
    setGroupBroadcastExpanded,
    setSelectedChat,
    setDraftChat,
    setSidebarCollapsed,
    setReposModalOpen,
    setDroneErrorModal,
    setClearingDroneError,
    setHeaderOverflowOpen,
    setFsExplorerView,
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
  const {
    createOpen,
    creating,
    createMode,
    createRuntime,
    createPersistVolume,
    cloneSourceId,
    cloneIncludeChats,
    createError,
    createGroup,
    createRepoPath,
    createInitialMessage,
    createRepoMenuOpen,
    draftCreateOpen,
    draftCreateMode,
    draftCreateName,
    draftCreateGroup,
    draftCreateParentDroneId,
    draftCreateError,
    draftCreating,
    draftAutoRenaming,
    draftNameSuggesting,
    draftSuggestedName,
    draftNameSuggestionError,
    setCreateOpen,
    setCreating,
    setCreateMode,
    setCreateRuntime,
    setCreatePersistVolume,
    setCloneSourceId,
    setCloneIncludeChats,
    setCreateError,
    setCreateGroup,
    setCreateRepoPath,
    setCreateInitialMessage,
    setCreateRepoMenuOpen,
    setDraftCreateOpen,
    setDraftCreateMode,
    setDraftCreateName,
    setDraftCreateGroup,
    setDraftCreateParentDroneId,
    setDraftCreateError,
    setDraftCreating,
    setDraftAutoRenaming,
    setDraftNameSuggesting,
    setDraftSuggestedName,
    setDraftNameSuggestionError,
  } = useCreateDraftWorkflowState();
  const repoBranchOptionsByPath = useRepoBranchOptions({
    requestJson,
    repoPaths: [createRepoPath, chatHeaderRepoPath],
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
    viewMode,
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
    registeredRepoPaths,
  });
  const draftSidebarPlaceholder = React.useMemo(() => {
    if (!draftChat) return null;
    if (String(draftChat.droneId ?? '').trim()) return null;
    return {
      name: allocateUntitledDisplayName(sidebarDrones.map((drone) => String(drone?.name ?? '').trim())),
      repoPath: String(chatHeaderRepoPath ?? '').trim(),
      group: String(draftCreateGroup ?? '').trim() || null,
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
    setUnreadAgentMessageByChatNodeId((prev) => {
      const prevEntries = Object.entries(prev);
      if (prevEntries.length === 0) return prev;
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [nodeId, unread] of prevEntries) {
        if (!unread) {
          changed = true;
          continue;
        }
        if (!validChatNodeIdSet.has(nodeId)) {
          changed = true;
          continue;
        }
        next[nodeId] = true;
      }
      return changed ? next : prev;
    });
  }, [dronesError, dronesLoading, setUnreadAgentMessageByChatNodeId, validChatNodeIdSet]);
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
  const previousBusyChatNodeIdSetRef = React.useRef<Set<string>>(new Set());
  const droneIdentityByNameRef = React.useRef<Record<string, string>>({});
  const llmSettingsState = useLlmSettings(requestJson);
  const {
    board,
    boardLoading,
    boardSaving,
    boardError,
    boardUpdatedAt,
    reloadBoard,
    onBoardChange,
  } = useKanbanBoardSettings({
    enabled: kanbanBoardOpen,
    requestJson,
  });
  const {
    taskPlaybookButtons,
    taskPlaybookButtonsLoading,
    taskPlaybookButtonsSaving,
    taskPlaybookButtonsError,
    onTaskPlaybookButtonsChange,
  } = useTaskPlaybookButtonSettings({
    enabled: kanbanBoardOpen,
    requestJson,
  });
  useUiPreferencesSettings({ requestJson });
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

  const suggestKanbanCardTitleFromPaste = React.useCallback(
    async (descriptionRaw: string): Promise<string | null> => {
      const description = String(descriptionRaw ?? '').trim();
      if (!description) return null;
      const selectedProvider = llmSettings?.provider?.selected ?? 'openai';
      const selectedSettings = selectedProvider === 'gemini' ? llmSettings?.gemini : selectedProvider === 'codex' ? llmSettings?.codex : llmSettings?.openai;
      if (!selectedSettings?.hasKey) return null;
      const data = await requestJson<{ ok: true; title: string }>('/api/tasks/title-from-message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: description,
          source: 'kanban-paste-title',
        }),
      });
      const title = String((data as any)?.title ?? '').trim();
      return title || null;
    },
    [llmSettings, requestJson],
  );
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
    chatModelsSource,
    chatModelsDiscoveredAt,
    chatModelsError,
    loadingChatModels,
    setChatModelsRefreshNonce,
    manualChatModelInput,
    setManualChatModelInput,
    setChatAgent,
    setChatModel,
    setChatAgentPermissionMode,
    setAgentMessageAutoContinueEnabled,
    setAgentSuggestionEnabled,
    setDockerSnapshotAfterAgentMessageEnabled,
    setBlipClonesEnabled,
    handleSetAgentFailure,
  } = useChatConfigState({
    selectedDrone,
    selectedChat,
    droneById,
    requestJson,
  });

  const chatEndRef = React.useRef<HTMLDivElement | null>(null);
  const chatUiModeRef = React.useRef<'transcript' | 'cli'>('transcript');
  const {
    transcriptMessageId,
    tldrByMessageId,
    showTldrByMessageId,
    toggleTldrForAgentMessage,
    handleAgentMessageHover,
    toggleTldrFromShortcut,
  } = useTranscriptTldrState({
    transcripts,
    chatUiModeRef,
    requestJson,
  });
  const prevChatItemsLenRef = React.useRef(0);

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
  const spawnModelValue = React.useMemo(() => {
    const value = String(spawnModel ?? '').trim();
    return value || null;
  }, [spawnModel]);
  const spawnModelForSeed = spawnAgentConfig.kind === 'builtin' ? spawnModelValue : null;
  const [spawnAgentPermissionMode, setSpawnAgentPermissionMode] = React.useState<AgentPermissionMode>('full-access');
  const spawnAgentReadOnlySupported = spawnAgentConfig.kind === 'builtin' && (spawnAgentConfig.id === 'codex' || spawnAgentConfig.id === 'blip');
  React.useEffect(() => {
    if (!spawnAgentReadOnlySupported && spawnAgentPermissionMode === 'read-only') {
      setSpawnAgentPermissionMode('full-access');
    }
  }, [spawnAgentPermissionMode, spawnAgentReadOnlySupported]);

  const rememberStartupSeed = React.useCallback((
    drones: Array<{ id: string; name: string }>,
    opts: {
      runtime?: 'container' | 'host';
      agent: ChatAgentConfig | null;
      model?: string | null;
      agentPermissionMode?: 'full-access' | 'read-only';
      prompt: string;
      chatName?: string;
      group?: string | null;
      repoPath?: string | null;
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
    const agentPermissionMode = opts.agentPermissionMode === 'read-only' ? 'read-only' : 'full-access';
    const group = String(opts.group ?? '').trim() || null;
    const repoPath = String(opts.repoPath ?? '').trim() || null;
    if (!prompt && !opts.agent && !model && agentPermissionMode === 'full-access') return;
    const at = new Date().toISOString();
    setStartupSeedByDrone((prev) => {
      const next = { ...prev };
      for (const [id, droneName] of unique.entries()) {
        next[id] = {
          droneName,
          runtime,
          chatName,
          agent: opts.agent ?? null,
          model,
          agentPermissionMode,
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
    seedAgentPermissionMode?: 'full-access' | 'read-only';
    seedChat?: string;
    seedPrompt?: string;
    seedCwd?: string;
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

  const {
    parsingJobsByTurn,
    jobsModal,
    jobsModalError,
    spawningAllJobs,
    spawningJobById,
    spawnedJobById,
    spawnJobErrorById,
    detailsOpenByJobId,
    parseJobsFromAgentMessage,
    spawnOneFromJobsModal,
    spawnAllFromJobsModal,
    spawnJobFromModal,
    closeJobsModal,
    onChangeJobsGroup,
    onClearJobsGroup,
    onChangeJobsAgentKey,
    onChangeJobsPrefix,
    onClearJobsPrefix,
    onUpdateJobsModalJob,
    onToggleJobsModalDetails,
    dismissJobsModalError,
  } = useJobsWorkflow({
    drones,
    selectedDrone,
    spawnAgentKey,
    setSpawnAgentKey,
    spawnModelForSeed,
    resolveAgentKeyToConfig,
    queueDrones,
    rememberStartupSeed,
    rememberSeenModels,
  });

  const {
    createName,
    setCreateName,
    createNameRows,
    createNameEntries,
    createNameCounts,
    createMessageSuffixRows,
    setCreateMessageSuffixRows,
    updateCreateNameRow,
    appendCreateNameRow,
    removeCreateNameRow,
    updateCreateMessageSuffixRow,
  } = useCreateDroneRowsState();
  const createNameRef = React.useRef<HTMLInputElement | null>(null);
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
  const updateShortcutVoiceToast = React.useCallback(
    (id: string, voiceLevel: number, patch: { message?: string; title?: string; tone?: 'success' | 'error'; voiceActive?: boolean } = {}) => {
      setNameSuggestToast((current) => {
        if (!current || current.id !== id) return current;
        return {
          ...current,
          ...patch,
          voiceLevel: Math.max(0, Math.min(1, Number(voiceLevel) || 0)),
        };
      });
    },
    [setNameSuggestToast],
  );

  const { toggleVoiceClipboardRecording } = useVoiceClipboardRecorder({
    requestJson,
    showToast: showShortcutToast,
    updateVoiceToast: updateShortcutVoiceToast,
  });
  const {
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    deleteDrone: deleteDroneBase,
    renameDrone,
    renameDrones,
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
    async (droneIdRaw: string): Promise<boolean> => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return false;
      const deleted = await deleteDroneBase(droneId);
      if (!deleted) return false;
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

  const normalizeCreateRepoPath = React.useCallback(
    (candidate: string): string => {
      const p = String(candidate ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    },
    [registeredRepoPathSet],
  );
  const activeSpawnContextRepoPath = React.useMemo(
    () => normalizeCreateRepoPath(createOpen ? createRepoPath : chatHeaderRepoPath),
    [chatHeaderRepoPath, createOpen, createRepoPath, normalizeCreateRepoPath],
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

  const { openCreateModal: openCreateModalBase, openDraftChatComposer: openDraftChatComposerBase, openPlaybookRuns } =
    useWorkspaceNavigationActions({
      creating,
      createMode,
      activeRepoPath,
      deletingDrones,
      renamingDrones,
      normalizeCreateRepoPath,
      suggestCloneName,
      selectionAnchorRef,
      preferredSelectedDroneRef,
      preferredSelectedDroneHoldUntilRef,
      setAppView,
      setDraftChat,
      setCreateOpen,
      setCreateError,
      setDraftCreateOpen,
      setDraftCreateMode,
      setDraftCreateName,
      setDraftCreateGroup,
      setDraftCreateParentDroneId,
      setDraftCreateError,
      setDraftCreating,
      setDraftAutoRenaming,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setCreateMode,
      setCreateRuntime,
      setCreatePersistVolume,
      setCloneSourceId,
      setCreateName,
      setCreateGroup,
      setCreateRepoPath,
      setCreateInitialMessage,
      setCreateMessageSuffixRows,
      setCloneIncludeChats,
      setChatHeaderRepoPath,
      setFleetDashboardOpen,
      setSelectedDrone,
      setSelectedDroneIds,
      setKanbanBoardOpen,
      setPlaybookRunsOpen,
      setSelectedChat,
      resetDraftNameSuggestSeq: () => {
        draftNameSuggestSeqRef.current = 0;
      },
    });

  const closeDraftCreateSurface = React.useCallback(() => {
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftCreateError(null);
  }, [
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
  const openKanbanBoard = React.useCallback(() => {
    setAppView('workspace');
    setCreateOpen(false);
    setCreateError(null);
    closeDraftCreateSurface();
    setFleetDashboardOpen(false);
    setPlaybookRunsOpen(false);
    setSelectedGroupMultiChat(null);
    resetSidebarDroneSelection();
    setKanbanBoardOpen(true);
  }, [
    closeDraftCreateSurface,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    resetSidebarDroneSelection,
    selectionAnchorRef,
    setAppView,
    setCreateError,
    setCreateOpen,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
    setFleetDashboardOpen,
    setKanbanBoardOpen,
    setPlaybookRunsOpen,
    setSelectedChat,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
  ]);

  const openFleetDashboard = React.useCallback(() => {
    setAppView('workspace');
    setCreateOpen(false);
    setCreateError(null);
    closeDraftCreateSurface();
    setFleetDashboardOpen(true);
    setPlaybookRunsOpen(false);
    setSelectedGroupMultiChat(null);
    resetSidebarDroneSelection();
    setKanbanBoardOpen(false);
  }, [
    closeDraftCreateSurface,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    resetSidebarDroneSelection,
    selectionAnchorRef,
    setAppView,
    setCreateError,
    setCreateOpen,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
    setFleetDashboardOpen,
    setKanbanBoardOpen,
    setPlaybookRunsOpen,
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
      setKanbanBoardOpen(false);
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      setFleetDashboardOpen(false);
      setSelectedGroupMultiChat(group);
    },
    [setAppView, setDraftChat, setDraftCreateError, setDraftCreateOpen, setFleetDashboardOpen, setKanbanBoardOpen, setSelectedGroupMultiChat],
  );
  const openSidebarVisibleMultiChat = React.useCallback(() => {
    if (sidebarVisibleDrones.length === 0) return;
    setAppView('workspace');
    setKanbanBoardOpen(false);
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setFleetDashboardOpen(false);
    setSelectedGroupMultiChat(SIDEBAR_VISIBLE_MULTI_CHAT_GROUP);
  }, [
    setAppView,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
    setFleetDashboardOpen,
    setKanbanBoardOpen,
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
    prevChatItemsLenRef.current = -1;
    let triesRemaining = 4;
    const attempt = () => {
      requestAnimationFrame(() => {
        let didScroll = false;
        const transcriptEnd = chatEndRef.current;
        if (transcriptEnd) {
          transcriptEnd.scrollIntoView({ behavior: 'auto' });
          didScroll = true;
        }
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
  const { selectDroneCard: selectDroneCardBase, selectDroneChat: selectDroneChatBase } = useDroneSelectionState({
    orderedDroneIds,
    selectedDrone,
    selectedDroneIds,
    selectedChat,
    fleetDashboardOpen,
    kanbanBoardOpen,
    playbookRunsOpen,
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
    setFleetDashboardOpen,
    setDraftChat,
    setDraftCreateOpen,
    setDraftCreateError,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
    setKanbanBoardOpen,
    setPlaybookRunsOpen,
    setSelectedChat,
  });
  const selectDroneCard = React.useCallback(
    (droneIdRaw: string, opts?: DroneSelectionClickOptions) => {
      selectDroneCardBase(droneIdRaw, opts);
    },
    [selectDroneCardBase],
  );
  const selectDroneChat = React.useCallback(
    (droneIdRaw: string, chatNameRaw: string) => {
      selectDroneChatBase(droneIdRaw, chatNameRaw);
    },
    [selectDroneChatBase],
  );
  const {
    cloneDrone,
    cloneDroneWithoutSelection,
    createDrone,
    createDroneFromDraft,
    queueDraftPromptDuringCreate,
    startDraftPrompt,
    startDraftAutomation,
  } =
    useDroneCreationActions({
      drones,
      creating,
      createNameRows,
      createMessageSuffixRows,
      createGroup,
      createRepoPath,
      createInitialMessage,
      repoBranchSource,
      repoCreateRemoteBranch,
      pullHostBranchBeforeCreate,
      createMode,
      createRuntime,
      createPersistVolume,
      cloneSourceId,
      cloneIncludeChats,
      spawnAgentKey,
      spawnModelForSeed,
      spawnAgentPermissionMode,
      draftChat,
      draftCreateMode,
      draftCreateName,
      draftCreateGroup,
      draftCreateParentDroneId,
      draftCreateRepoPath: chatHeaderRepoPath,
      startupSeedMissingGraceMs: STARTUP_SEED_MISSING_GRACE_MS,
      suggestCloneName,
      resolveAgentKeyToConfig,
      queueDrones,
      enqueueQueuedPrompt,
      requestJson,
      suggestAndRenameDraftDrone,
      rememberStartupSeed,
      rememberSeenModels,
      setStartupSeedByDrone,
      isValidDroneName: isValidDroneNameDashCase,
      hasWhitespaceInNameRaw: droneNameHasWhitespace,
      setCreateError,
      setCreating,
      setCreateName,
      setCreateMessageSuffixRows,
      setCreateOpen,
      setCreateMode,
      setCreateRuntime,
      setCreatePersistVolume,
      setCloneSourceId,
      setCreateGroup,
      setCreateRepoPath,
      setCreateInitialMessage,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateName,
      setDraftCreateGroup,
      setDraftCreateParentDroneId,
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
  const openCloneModal = React.useCallback((source: DroneSummary) => {
    setCreatePersistVolume(source.persistVolume !== false);
    void cloneDrone(source);
  }, [cloneDrone, setCreatePersistVolume]);

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
  React.useEffect(() => {
    void fetch('/api/assistant/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activeDroneId: currentDrone?.id ?? null,
        activeDroneName: currentDrone?.name ?? null,
        activeChatName: currentDrone ? (String(selectedChat ?? '').trim() || 'default') : null,
        appView,
      }),
    }).catch(() => {
      // Context reporting is best effort; assistant chat still works without it.
    });
  }, [appView, currentDrone?.id, currentDrone?.name, selectedChat]);
  React.useEffect(() => {
    const selectedNodeId = createCanvasChatNodeId(String(selectedDrone ?? '').trim(), String(selectedChat ?? '').trim() || 'default');
    if (!selectedNodeId) return;
    clearChatsUnread([selectedNodeId]);
  }, [clearChatsUnread, selectedChat, selectedDrone]);
  React.useEffect(() => {
    const previousBusyChatNodeIdSet = previousBusyChatNodeIdSetRef.current;
    const nextBusyChatNodeIdSet = new Set<string>();
    const markUnreadChatNodeIds: string[] = [];
    const selectedNodeId = createCanvasChatNodeId(String(selectedDrone ?? '').trim(), String(selectedChat ?? '').trim() || 'default');
    for (const drone of drones) {
      if (isDroneStartingOrSeeding(drone.hubPhase)) continue;
      for (const nodeId of busyChatNodeIdsForDrone(drone)) nextBusyChatNodeIdSet.add(nodeId);
    }
    for (const nodeId of previousBusyChatNodeIdSet) {
      if (nextBusyChatNodeIdSet.has(nodeId) || nodeId === selectedNodeId) continue;
      if (!parseCanvasChatNodeId(nodeId)) continue;
      markUnreadChatNodeIds.push(nodeId);
    }
    previousBusyChatNodeIdSetRef.current = nextBusyChatNodeIdSet;
    if (markUnreadChatNodeIds.length > 0) {
      markChatsUnread(markUnreadChatNodeIds);
      for (const nodeId of markUnreadChatNodeIds) {
        const chatRef = parseCanvasChatNodeId(nodeId);
        if (!chatRef) continue;
        void (async () => {
          try {
            const data = await requestJson<{ ok: true; transcripts: Array<{ output?: string }> }>(
              `/api/drones/${encodeURIComponent(chatRef.droneId)}/chats/${encodeURIComponent(chatRef.chatName)}/transcript?turn=last`,
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
  }, [drones, markChatsUnread, requestJson, selectedChat, selectedDrone, setLastAgentSnippetByChatNodeId]);

  const selectedDroneIdentity = React.useMemo(() => {
    if (!selectedDrone) return '';
    const ids = droneIdentityByNameRef.current;
    if (!ids[selectedDrone]) ids[selectedDrone] = makeId();
    return ids[selectedDrone];
  }, [selectedDrone]);

  const {
    cancelPendingPromptErrorById,
    cancellingPendingPromptById,
    canStopResponse,
    chatUiMode,
    promptError,
    requestCancelPendingPrompt,
    requestStopResponse,
    requestUnstickPendingPrompt,
    selectedIsResponding,
    sendPromptText,
    sendingPrompt,
    stopResponseError,
    stoppingResponse,
    unstickingPendingPromptById,
    unstickPendingPromptErrorById,
    visiblePendingPromptsWithStartup,
  } = useChatRuntimeOrchestration({
    chatInfo,
    currentDrone,
    currentDroneLabel,
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
  });
  const [agentSuggestionPolicyFingerprint, setAgentSuggestionPolicyFingerprint] = React.useState('');
  const {
    latestAgentSuggestionTarget,
    latestAgentSuggestionState,
    requestAgentSuggestionForMessage,
  } = useAgentSuggestionState({
    transcripts,
    pendingPrompts: visiblePendingPromptsWithStartup,
    chatUiModeRef,
    requestJson,
    transcriptMessageId,
    enabled: chatInfo?.agentSuggestionEnabled === true,
    currentPolicyFingerprint: agentSuggestionPolicyFingerprint,
  });

  React.useEffect(() => {
    const next =
      latestAgentSuggestionState?.status === 'ready' || latestAgentSuggestionState?.status === 'suppressed'
        ? String(latestAgentSuggestionState.policyFingerprint ?? '').trim()
        : '';
    if (!next) return;
    setAgentSuggestionPolicyFingerprint((prev) => (prev === next ? prev : next));
  }, [latestAgentSuggestionState]);

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
    repoTransferPeers,
    pullRepoChangesFromDrone,
    applyRepoChangesToDrone,
    probeRepoChangesFromDrone,
    syncRepoChangesIntoDrone,
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
  const syncDroppedDroneIntoTarget = React.useCallback(
    async (sourceDroneIdRaw: string, targetDroneIdRaw: string) => {
      const sourceDroneId = String(sourceDroneIdRaw ?? '').trim();
      const targetDroneId = String(targetDroneIdRaw ?? '').trim();
      const result = await syncRepoChangesIntoDrone(sourceDroneId, targetDroneId);
      const errorMessage = String(result.error ?? '').trim();
      if (!result.ok && errorMessage) {
        const targetDrone = droneById[targetDroneId] ?? null;
        if (targetDrone) openDroneErrorModal(targetDrone, errorMessage, result.meta ?? null);
      }
      return result;
    },
    [droneById, openDroneErrorModal, syncRepoChangesIntoDrone],
  );
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
    const droneId = String(selectedDrone ?? '').trim();
    if (!droneId) return false;
    deleteDrone(droneId);
    return true;
  }, [deleteDrone, selectedDrone]);
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
    return markChatsUnread(targetChatNodeIds) > 0;
  }, [markChatsUnread, selectedChat, selectedDrone, selectedDroneIds]);
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
    saveOpenedFile,
  } = useFileEditorState({
    currentDrone,
    requestJson,
    onRefreshFsList: refreshFsList,
  });
  const startupSeedForCurrentDrone =
    currentDrone && (isDroneStartingOrSeeding(currentDrone.hubPhase))
      ? startupSeedByDrone[currentDrone.id] ?? null
      : null;
  const effectiveChatInfo = chatInfo
    ? chatInfo
    : currentDrone && startupSeedForCurrentDrone?.agent
      ? {
          name: currentDrone.name,
          chat: startupSeedForCurrentDrone.chatName || selectedChat || 'default',
          agent: startupSeedForCurrentDrone.agent,
          model: startupSeedForCurrentDrone.model ?? null,
          agentPermissionMode: startupSeedForCurrentDrone.agentPermissionMode ?? 'full-access',
          agentMessageAutoContinueEnabled: false,
          agentSuggestionEnabled: false,
          dockerSnapshotAfterAgentMessageEnabled: false,
          blipClonesEnabled: true,
          sessionName: `drone-hub-chat-${startupSeedForCurrentDrone.chatName || selectedChat || 'default'}`,
          createdAt: startupSeedForCurrentDrone.at || new Date().toISOString(),
        }
      : null;
  const builtinAgentOptions: Array<{ key: string; label: string; agent: ChatAgentConfig }> = BUILTIN_AGENT_OPTIONS;
  const currentAgent = effectiveChatInfo?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig);
  const currentModel = String(chatInfo?.model ?? effectiveChatInfo?.model ?? '').trim() || null;
  const currentAgentKey =
    currentAgent.kind === 'builtin'
      ? `builtin:${currentAgent.id}`
      : `custom:${currentAgent.id}`;
  const currentSelectionCreateSeed = React.useMemo(
    () => resolveNewDroneContextFromCurrentSelection(currentDrone),
    [currentDrone],
  );
  const currentSelectionSpawnModel = currentAgent.kind === 'builtin' ? String(currentModel ?? '') : '';
  const resolveCurrentSelectionDraftContext = React.useCallback(() => {
    if (!selectedDrone || !currentDrone) return null;
    const nextRepoPath = normalizeCreateRepoPath(currentSelectionCreateSeed.repoPath);
    setSpawnContextRepoPath(nextRepoPath);
    if (effectiveChatInfo) {
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
  const openCreateModal = React.useCallback(() => {
    openCreateModalBase();
    const selectionDraftContext = resolveCurrentSelectionDraftContext();
    if (!selectionDraftContext) return;
    setCreateRepoPath(selectionDraftContext.repoPath);
    setCreateGroup(selectionDraftContext.group);
  }, [
    openCreateModalBase,
    resolveCurrentSelectionDraftContext,
    setCreateGroup,
    setCreateRepoPath,
  ]);
  const openDraftChatComposer = React.useCallback(
    (opts?: { repoPath?: string | null; group?: string | null }) => {
      if (!shouldInheritNewDroneContextFromCurrentSelection(opts)) {
        openDraftChatComposerBase(opts);
        return;
      }
      const selectionDraftContext = resolveCurrentSelectionDraftContext();
      if (!selectionDraftContext) {
        openDraftChatComposerBase(opts);
        return;
      }
      openDraftChatComposerBase({
        repoPath: selectionDraftContext.repoPath,
        group: selectionDraftContext.group,
      });
    },
    [
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
      return true;
    },
    [
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
        seedModel = chatInfo.agent.kind === 'builtin' ? chatInfo.model : null;
      } catch {
        const selectedChatName = String(effectiveChatInfo?.chat ?? '').trim() || 'default';
        if (selectedDrone === sourceDroneId && effectiveChatInfo && selectedChatName === sourceChatName) {
          seedAgent = effectiveChatInfo.agent;
          seedModel = effectiveChatInfo.agent.kind === 'builtin' ? effectiveChatInfo.model : null;
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
        : `custom:${effectiveChatInfo.agent.id}`;
    const nextModel =
      effectiveChatInfo.agent.kind === 'builtin'
        ? String(effectiveChatInfo.model ?? '')
        : '';
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
  const currentDroneBusy =
    currentDrone && !isDroneStartingOrSeeding(currentDrone.hubPhase)
      ? Boolean(currentDrone.busy) || selectedIsResponding
      : false;
  const busyChatNodeIdSet = React.useMemo(() => {
    const out = new Set<string>();
    for (const drone of drones) {
      for (const nodeId of busyChatNodeIdsForDrone(drone)) out.add(nodeId);
    }
    const selectedNodeId = createCanvasChatNodeId(String(selectedDrone ?? '').trim(), String(selectedChat ?? '').trim() || 'default');
    if (selectedNodeId && selectedIsResponding) out.add(selectedNodeId);
    return out;
  }, [drones, selectedChat, selectedDrone, selectedIsResponding]);
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
  const agentDisabled =
    loadingChatInfo ||
    Boolean(openingTerminal) ||
    Boolean(openingEditor) ||
    isDroneStartingOrSeeding(currentDrone?.hubPhase);
  const modelControlEnabled = currentAgent.kind === 'builtin';
  const modelDisabled = agentDisabled || !modelControlEnabled;
  const {
    availableChatModels,
    modelMenuEntries,
    modelLabel,
    createRepoMenuEntries,
    spawnAgentMenuEntries,
    toolbarAgentMenuEntries,
    agentLabel,
    pickAgentValue,
    applyManualChatModel,
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
    modelDisabled,
    manualChatModelInput,
    setChatModel,
    setChatInfoError,
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
      const containerPath = String(next.path ?? '').trim();
      if (!containerPath) return;
      const slash = containerPath.lastIndexOf('/');
      const parentPath = slash > 0 ? containerPath.slice(0, slash) : '/';
      setCurrentFsPath(parentPath || '/');
      openEditorFile(next);
      focusEditorPane();
    },
    [focusEditorPane, openEditorFile, setCurrentFsPath],
  );
  const openFileInPanelFromFilesPane = React.useCallback(
    (next: { path: string; name: string; line?: number | null; column?: number | null }): boolean => {
      const droneId = String(currentDrone?.id ?? '').trim();
      const containerPath = String(next.path ?? '').trim();
      if (!droneId || !containerPath) return false;
      const slash = containerPath.lastIndexOf('/');
      const parentPath = slash > 0 ? containerPath.slice(0, slash) : '/';
      setCurrentFsPath(parentPath || '/');
      openEditorFile(next);
      focusEditorPane();
      return true;
    },
    [currentDrone?.id, focusEditorPane, openEditorFile, setCurrentFsPath],
  );

  const openQuickOpenFromShortcut = React.useCallback(() => {
    if (!currentDrone?.id) return false;
    focusEditorPane();
    openQuickOpen();
    return true;
  }, [currentDrone?.id, focusEditorPane, openQuickOpen]);

  const revealEditorLocationParent = React.useCallback(
    (pathRaw: string) => {
      const containerPath = String(pathRaw ?? '').trim();
      if (!containerPath) return;
      const slash = containerPath.lastIndexOf('/');
      const parentPath = slash > 0 ? containerPath.slice(0, slash) : '/';
      setCurrentFsPath(parentPath || '/');
      focusEditorPane();
    },
    [focusEditorPane, setCurrentFsPath],
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

  const [pendingPlaybookArtifact, setPendingPlaybookArtifact] = React.useState<{
    droneId: string;
    path: string;
    name: string;
  } | null>(null);
  React.useEffect(() => {
    if (!pendingPlaybookArtifact) return;
    if (String(currentDrone?.id ?? '') !== pendingPlaybookArtifact.droneId) return;
    openFileInFilesPane({
      path: pendingPlaybookArtifact.path,
      name: pendingPlaybookArtifact.name,
    });
    setPendingPlaybookArtifact(null);
  }, [currentDrone?.id, openFileInFilesPane, pendingPlaybookArtifact]);
  const openPlaybookRunArtifact = React.useCallback(
    (droneId: string, chatName: string, path: string, name: string) => {
      const filePath = String(path ?? '').trim();
      if (!filePath) return;
      setPlaybookRunsOpen(false);
      setPendingPlaybookArtifact({
        droneId,
        path: filePath,
        name: String(name ?? '').trim() || filePath.split('/').filter(Boolean).pop() || filePath,
      });
      selectDroneChat(droneId, chatName);
    },
    [selectDroneChat, setPlaybookRunsOpen],
  );
  const openMarkdownFileReference = React.useCallback(
    (ref: MarkdownFileReference) => {
      let rawPath = String(ref.path ?? '').trim().replace(/\\/g, '/');
      if (!rawPath) return;
      if (rawPath.startsWith('./')) rawPath = rawPath.slice(2);
      const collapsed = rawPath.replace(/\/+/g, '/');
      const normalized = collapsed.replace(/^\/+/, '');
      if (!collapsed || !normalized) return;
      const basePath = droneHomePath(currentDrone).replace(/\/+$/, '') || '/work/repo';
      const containerPath = collapsed.startsWith('/')
        ? collapsed
        : normalized.startsWith('work/repo/') || normalized.startsWith('dvm-data/home/')
          ? `/${normalized}`
          : `${basePath}/${normalized}`;
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
      if (!droneId || !sidebarSelectableDroneIdSet.has(droneId)) return;
      const chatName = String(chatNameRaw ?? '').trim() || 'default';
      selectDroneChat(droneId, chatName);
    },
    [selectDroneChat, sidebarSelectableDroneIdSet],
  );
  const assignCanvasDronesToOwner = React.useCallback(
    async (ownerDroneIdRaw: string, targetDroneIdsRaw: string[]): Promise<{ ok: boolean; error?: string | null }> => {
      const ownerDroneId = String(ownerDroneIdRaw ?? '').trim();
      if (!ownerDroneId) return { ok: false, error: 'Missing fleet owner.' };
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
          await requestJson<{ ok: true; accepted: true; promptId: string }>(
            `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(resolvedChat)}/prompt`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ prompt, attachments: [], submittedAt: new Date().toISOString() }),
            },
          );
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
        seedAgent.kind === 'builtin'
          ? String(overrides.model ?? spawnModel ?? '').trim() || null
          : null;
      const seedAgentPermissionMode: AgentPermissionMode = seedAgent ? spawnAgentPermissionMode : 'full-access';
      if (
        seedAgentPermissionMode === 'read-only' &&
        !(seedAgent.kind === 'builtin' && (seedAgent.id === 'codex' || seedAgent.id === 'blip'))
      ) {
        return { ok: false, error: 'Read-only mode is currently supported for Codex and Blip chats only.' };
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
          ...(seedAgentPermissionMode === 'read-only' ? { seedAgentPermissionMode } : {}),
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
      if (!droneId || !chatName || !prompt || chatName === 'default') return;
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
  const createDroneChat = React.useCallback(
    async (
      drone: DroneSummary,
      chatNameRaw: string,
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
          body: JSON.stringify({ name: chatName, ...(availableChats.length > 0 ? { copyFromChat } : {}) }),
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
  useDroneHubLifecycleEffects({
    normalizeCreateRepoPath,
    setCreateRepoPath,
    terminalMenuRef,
    terminalMenuOpen,
    setTerminalMenuOpen,
    headerOverflowRef,
    headerOverflowOpen,
    setHeaderOverflowOpen,
    droneErrorModal,
    setDroneErrorModal,
    openFleetDashboard,
    openDraftChatComposer,
    openChildDraftChatComposer,
    createDroneChatFromShortcut,
    openKanbanBoard,
    openGroupMultiChat,
    openSidebarVisibleMultiChat,
    toggleTldrFromShortcut,
    toggleVoiceClipboardRecording,
    createOpen,
    setCreateRepoMenuOpen,
    createNameRef,
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
    setRightPanelOpen,
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
    prevChatItemsLenRef,
    chatEndRef,
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
        const deletedDrone = await deleteDrone(droneId);
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
          fsExplorerView={fsExplorerView}
          setFsExplorerView={setFsExplorerView}
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
      fsExplorerView,
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
      setFsExplorerView,
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

  const sidebarProps: DroneSidebarProps = useDroneHubSidebarProps({
    dronesError,
    groupMoveError,
    dronesLoading,
    sidebarDronesFilteredByRepo,
    sidebarVisibleDrones,
    sidebarDrones,
    sidebarOptimisticDroneIdSet,
    selectedDroneSet,
    busyChatNodeIdSet,
    unreadAgentMessageByChatNodeId,
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    movingDroneGroups,
    sidebarGroups,
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
    openCreateModal,
    openKanbanBoard,
    openPlaybookRuns,
    selectDroneCard,
    selectDroneChat,
    createDroneChat,
    renameCanvasChat,
    deleteCanvasChat,
    openCloneModal,
    renameDrone,
    renameDrones,
    setDroneBaseImage,
    deleteDrone,
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
  });

  const overlaysProps: DroneHubOverlaysProps = useDroneHubOverlaysProps({
    createOpen,
    creating,
    createMode,
    createRuntime,
    createPersistVolume,
    setCreateRuntime,
    setCreatePersistVolume,
    cloneSourceId,
    createNameEntries,
    drones,
    createError,
    createGroup,
    setCreateGroup,
    createRepoPath,
    setCreateRepoPath,
    createRepoMenuEntries,
    createRepoBranchOptions: repoBranchOptionsByPath[String(createRepoPath ?? '').trim()] ?? null,
    createRepoMenuOpen,
    setCreateRepoMenuOpen,
    registeredRepoPaths,
    activeRepoPath,
    repoBranchSource,
    setRepoBranchSource,
    repoCreateRemoteBranch,
    setRepoCreateRemoteBranch,
    pullHostBranchBeforeCreate,
    setPullHostBranchBeforeCreate,
    cloneIncludeChats,
    setCloneIncludeChats,
    spawnAgentKey,
    setSpawnAgentKey,
    spawnAgentMenuEntries,
    setCustomAgentModalOpen,
    spawnModel,
    setSpawnModel,
    spawnAgentPermissionMode,
    setSpawnAgentPermissionMode,
    spawnAgentReadOnlySupported,
    spawnAgentConfig,
    createInitialMessage,
    setCreateInitialMessage,
    createNameRows,
    createMessageSuffixRows,
    createNameCounts,
    appendCreateNameRow,
    updateCreateNameRow,
    updateCreateMessageSuffixRow,
    removeCreateNameRow,
    createNameRef,
    createDrone,
    setCreateOpen,
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
    jobsModalError,
    jobsModal,
    builtInAgentOptions: BUILTIN_AGENT_OPTIONS,
    spawningAllJobs,
    spawningJobById,
    spawnedJobById,
    spawnJobErrorById,
    detailsOpenByJobId,
    isValidDroneName: isValidDroneNameDashCase,
    closeJobsModal,
    spawnAllFromJobsModal,
    spawnOneFromJobsModal,
    spawnJobFromModal,
    onChangeJobsGroup,
    onClearJobsGroup,
    onChangeJobsAgentKey,
    onChangeJobsPrefix,
    onClearJobsPrefix,
    onUpdateJobsModalJob,
    onToggleJobsModalDetails,
    dismissJobsModalError,
    reposModalOpen,
    repos,
    reposError,
    reposLoading,
    deletingRepos,
    setReposModalOpen,
    setActiveRepoPath,
    deleteRepo,
    githubUrlForRepo,
    dirtyDroneApplyModal,
    closeDirtyDroneApplyModal,
    continueDirtyDroneApply,
    droneErrorModal,
    clearingDroneError,
    closeDroneErrorModal,
    clearDroneHubError,
    droneDropActionModal,
    closeDroneDropActionModal,
    droppedDroneTarget,
    droppedDroneTargetLabel,
    droppedDroneRows,
    assignDroppedDronesToTarget,
    probeRepoChangesFromDrone,
    syncDroppedDroneIntoTarget,
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
    kanbanBoardOpen,
    kanbanBoard: board,
    onKanbanBoardChange: onBoardChange,
    taskPlaybookButtons,
    taskPlaybookButtonsLoading,
    taskPlaybookButtonsSaving,
    taskPlaybookButtonsError,
    onTaskPlaybookButtonsChange,
    boardLoading,
    boardSaving,
    boardError,
    boardUpdatedAt,
    reloadBoard,
    suggestKanbanCardTitleFromPaste,
    createRuntime,
    createPersistVolume,
    pullHostBranchBeforeCreate,
    repoBranchSource,
    setRepoBranchSource,
    repoCreateRemoteBranch,
    setRepoCreateRemoteBranch,
    setCreateRuntime,
    setCreatePersistVolume,
    draftCreateMode,
    setDraftCreateMode,
    spawnAgentMenuEntries,
    draftCreating,
    draftAutoRenaming,
    spawnAgentConfig,
    createRepoMenuEntries,
    draftCreateRepoPath: chatHeaderRepoPath,
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
    startDraftAutomation,
    queueDraftPromptDuringCreate,
    createDroneFromDraft,
    enqueueQueuedPrompt,
    removeQueuedPrompt,
    setDraftCreateError,
    selectedGroupMultiChatData,
    groupBroadcastPromptError,
    groupBroadcastSending,
    sendGroupBroadcastPrompt,
    uiDroneName,
    selectDroneCard,
    selectDroneChat,
    deleteDrone,
    deletingDrones,
    optimisticallyDeletedDrones,
    parseJobsFromAgentMessage,
    spawnDroneHubTaskFromAgentMessage,
    drones,
    dronesLoading,
    sidebarDrones,
    dronesError,
    unreadAgentMessageByChatNodeId,
    openDraftChatComposer,
    openCreateModal,
    openKanbanBoard,
    openPlaybookRuns,
    openPlaybookRunArtifact,
    activeRepoPath,
    settingsActiveTab,
    settingsPlaybookFocusId,
    registeredRepoPaths,
    registryGroupNames,
    setActiveRepoPath,
    setSettingsActiveTab,
    setSettingsPlaybookFocusId,
    playbookRunsOpen,
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
    agentDisabled,
    agentLabel,
    modelControlEnabled,
    availableChatModels,
    currentModel,
    setChatModel,
    agentPermissionMode: effectiveChatInfo?.agentPermissionMode ?? 'full-access',
    setChatAgentPermissionMode,
    agentMessageAutoContinueEnabled: effectiveChatInfo?.agentMessageAutoContinueEnabled === true,
    setAgentMessageAutoContinueEnabled,
    agentSuggestionEnabled: effectiveChatInfo?.agentSuggestionEnabled === true,
    setAgentSuggestionEnabled,
    dockerSnapshotAfterAgentMessageEnabled: effectiveChatInfo?.dockerSnapshotAfterAgentMessageEnabled === true,
    setDockerSnapshotAfterAgentMessageEnabled,
    blipClonesEnabled: effectiveChatInfo?.blipClonesEnabled !== false,
    setBlipClonesEnabled,
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
    openDroneTerminal,
    openingTerminal,
    openDroneEditor,
    openingEditor,
    pullRepoChanges,
    pushRepoChanges,
    repoTransferPeers,
    pullRepoChangesFromDrone,
    applyRepoChangesToDrone,
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
    parsingJobsByTurn,
    tldrByMessageId,
    showTldrByMessageId,
    toggleTldrForAgentMessage,
    handleAgentMessageHover,
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
    canStopResponse,
    requestStopResponse,
    stoppingResponse,
    stopResponseError,
    requestCancelPendingPrompt,
    requestUnstickPendingPrompt,
    cancellingPendingPromptById,
    cancelPendingPromptErrorById,
    unstickingPendingPromptById,
    unstickPendingPromptErrorById,
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
    setKanbanBoardOpen,
    setPlaybookRunsOpen,
  });

  return {
    sidebarProps,
    overlaysProps,
    workspaceContentProps,
  };
}
