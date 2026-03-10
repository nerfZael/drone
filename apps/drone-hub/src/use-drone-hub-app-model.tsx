import React from 'react';
import {
  type ChatAgentConfig,
  isValidDroneNameDashCase,
} from './domain';
import { requestJson } from './droneHub/http';
import { requestGuidedOnboardingReplay, resetGuidedOnboardingDismissals } from './onboarding/control';
import { copyText } from './droneHub/app/clipboard';
import { isCanvasDraftNodeId, useDroneCanvasStore } from './droneHub/canvas/use-drone-canvas-store';
import {
  BUILTIN_AGENT_OPTIONS,
  HUB_LOGS_MAX_BYTES,
  HUB_LOGS_TAIL_LINES,
  RIGHT_PANEL_MIN_WIDTH_PX,
  RIGHT_PANEL_TAB_LABELS,
  rightPanelTabsForRuntime,
  STARTUP_SEED_MISSING_GRACE_MS,
  createCanvasChatNodeId,
  type RightPanelTab,
} from './droneHub/app/app-config';
import type { DroneSidebarProps } from './droneHub/app/DroneSidebar';
import type { DroneHubOverlaysProps } from './droneHub/app/DroneHubOverlays';
import type { DroneHubWorkspaceContentProps } from './droneHub/app/DroneHubWorkspaceContent';
import { RightPanelTabContent } from './droneHub/app/RightPanelTabContent';
import { useHubLogs } from './droneHub/app/use-hub-logs';
import { useCreateDroneRowsState } from './droneHub/app/use-create-drone-rows-state';
import { useCreateDraftWorkflowState } from './droneHub/app/use-create-draft-workflow-store';
import { useDroneCreationActions } from './droneHub/app/use-drone-creation-actions';
import { useChatRuntimeOrchestration } from './droneHub/app/use-chat-runtime-orchestration';
import { useDroneGroupDnd } from './droneHub/app/use-drone-group-dnd';
import { useDroneErrorModalActions } from './droneHub/app/use-drone-error-modal-actions';
import { useDroneMutationActions } from './droneHub/app/use-drone-mutation-actions';
import { useFilesAndPortsPaneState } from './droneHub/app/use-files-and-ports-pane-state';
import { useFileEditorState } from './droneHub/app/use-file-editor-state';
import { useGroupBroadcast } from './droneHub/app/use-group-broadcast';
import { useGroupManagement } from './droneHub/app/use-group-management';
import { useJobsWorkflow } from './droneHub/app/use-jobs-workflow';
import { useLlmSettings } from './droneHub/app/use-llm-settings';
import { useDeleteActionSettings } from './droneHub/app/use-delete-action-settings';
import { useFilesystemSettings } from './droneHub/app/use-filesystem-settings';
import { useQueuedPromptsState } from './droneHub/app/use-queued-prompts-state';
import { useRightPanelLayout } from './droneHub/app/use-right-panel-layout';
import { useDroneSelectionState } from './droneHub/app/use-drone-selection-state';
import { SIDEBAR_VISIBLE_MULTI_CHAT_GROUP, useSidebarViewModel } from './droneHub/app/use-sidebar-view-model';
import { useChatConfigState } from './droneHub/app/use-chat-config-state';
import { useDroneHubAppModelUiState } from './droneHub/app/use-drone-hub-ui-store';
import { useDroneHubRuntimeState } from './droneHub/app/use-drone-hub-runtime-store';
import { useDroneHubLifecycleEffects } from './droneHub/app/use-drone-hub-lifecycle-effects';
import { useDroneHubRegistryData } from './droneHub/app/use-drone-hub-registry-data';
import { useDroneHubToolbarMenuState } from './droneHub/app/use-drone-hub-toolbar-menu-state';
import { useTranscriptTldrState } from './droneHub/app/use-transcript-tldr-state';
import { useWorkspaceNavigationActions } from './droneHub/app/use-workspace-navigation-actions';
import { useWorkspaceActions } from './droneHub/app/use-workspace-actions';
import {
  useDroneHubSidebarProps,
  useDroneHubOverlaysProps,
  useDroneHubWorkspaceContentProps,
} from './droneHub/app/use-drone-hub-view-props';
import type { MarkdownFileReference } from './droneHub/chat/MarkdownMessage';
import {
  droneHomePath,
  isDroneStartingOrSeeding,
  makeId,
  normalizeContainerPathInput,
  resolveChatNameForDrone,
} from './droneHub/app/helpers';
import { allocateUntitledDisplayName, droneNameHasWhitespace } from './droneHub/app/name-helpers';
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

export type DroneHubAppModel = {
  sidebarProps: DroneSidebarProps;
  overlaysProps: DroneHubOverlaysProps;
  workspaceContentProps: DroneHubWorkspaceContentProps;
};

export function useDroneHubAppModel(): DroneHubAppModel {
  const {
    optimisticallyDeletedDrones,
    startupSeedByDrone,
    unreadAgentMessageByDroneId,
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
    setUnreadAgentMessageByDroneId,
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
    chatHeaderRepoPath,
    appView,
    viewMode,
    sidebarGroupingMode,
    collapsedGroups,
    autoDelete,
    terminalEmulator,
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
    fsExplorerView,
    spawnAgentKey,
    spawnModel,
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
    setChatHeaderRepoPath,
    setAppView,
    setCollapsedGroups,
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
    setFsExplorerView,
    setSpawnAgentKey,
    setSpawnModel,
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
    dronesError,
    dronesLoading,
    repos,
    reposError,
    reposLoading,
    registeredRepoPaths,
    registeredRepoPathSet,
    registryGroupNames,
    dronesFilteredByRepo,
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
    setDraftCreateError,
    setDraftCreating,
    setDraftAutoRenaming,
    setDraftNameSuggesting,
    setDraftSuggestedName,
    setDraftNameSuggestionError,
  } = useCreateDraftWorkflowState();
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
    sidebarHasUngroupedGroup,
  } = useSidebarViewModel({
    selectedDroneIds,
    viewMode,
    sidebarGroupingMode,
    collapsedGroups,
    drones,
    startupSeedByDrone,
    optimisticallyDeletedDrones,
    activeRepoPath,
    registryGroupNames,
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
  const validDroneIdSet = React.useMemo(() => {
    const out = new Set<string>();
    for (const drone of drones) {
      const id = String(drone?.id ?? '').trim();
      if (!id) continue;
      out.add(id);
    }
    return out;
  }, [drones]);
  const markDronesUnread = React.useMemo(
    () => (droneIdsRaw: string[]): number => {
      const targetIds: string[] = [];
      for (const raw of Array.isArray(droneIdsRaw) ? droneIdsRaw : []) {
        const id = String(raw ?? '').trim();
        if (!id || targetIds.includes(id) || !validDroneIdSet.has(id)) continue;
        targetIds.push(id);
      }
      if (targetIds.length === 0) return 0;
      setUnreadAgentMessageByDroneId((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of targetIds) {
          if (next[id]) continue;
          next[id] = true;
          changed = true;
        }
        return changed ? next : prev;
      });
      return targetIds.length;
    },
    [setUnreadAgentMessageByDroneId, validDroneIdSet],
  );
  const clearDronesUnread = React.useCallback(
    (droneIdsRaw: string[]): number => {
      const targetIds: string[] = [];
      for (const raw of Array.isArray(droneIdsRaw) ? droneIdsRaw : []) {
        const id = String(raw ?? '').trim();
        if (!id || targetIds.includes(id)) continue;
        targetIds.push(id);
      }
      if (targetIds.length === 0) return 0;
      setUnreadAgentMessageByDroneId((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of targetIds) {
          if (!next[id]) continue;
          delete next[id];
          changed = true;
        }
        return changed ? next : prev;
      });
      return targetIds.length;
    },
    [setUnreadAgentMessageByDroneId],
  );
  React.useEffect(() => {
    if (dronesLoading || dronesError) return;
    setUnreadAgentMessageByDroneId((prev) => {
      const prevEntries = Object.entries(prev);
      if (prevEntries.length === 0) return prev;
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [id, unread] of prevEntries) {
        if (!unread) {
          changed = true;
          continue;
        }
        if (!validDroneIdSet.has(id)) {
          changed = true;
          continue;
        }
        next[id] = true;
      }
      return changed ? next : prev;
    });
  }, [dronesError, dronesLoading, setUnreadAgentMessageByDroneId, validDroneIdSet]);
  const sidebarSelectableDroneIdSet = React.useMemo(
    () => new Set(sidebarDronesFilteredByRepo.map((drone) => drone.id)),
    [sidebarDronesFilteredByRepo],
  );

  /* ── Layout state ── */
  const {
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelWidth,
    rightPanelWidthMode,
    setRightPanelWidth,
    rightPanelResizing,
    rightPanelTab,
    setRightPanelTab,
    rightPanelSplit,
    setRightPanelSplitMode,
    rightPanelBottomTab,
    setRightPanelBottomTab,
    resetRightPanelWidth,
    startRightPanelResize,
    rightPanelWidthIsDefault,
    rightPanelWidthMax,
  } = useRightPanelLayout();
  const headerOverflowRef = React.useRef<HTMLDivElement | null>(null);
  const preferredSelectedDroneRef = React.useRef<string | null>(null);
  const preferredSelectedDroneHoldUntilRef = React.useRef<number>(0);
  const lastSyncedCanvasRepoContextRef = React.useRef<string>('');
  const lastSyncedCanvasAgentModelContextRef = React.useRef<string>('');
  const previousBusyByDroneIdRef = React.useRef<Record<string, boolean>>({});
  const droneIdentityByNameRef = React.useRef<Record<string, string>>({});
  const llmSettingsState = useLlmSettings(requestJson);
  const deleteActionSettingsState = useDeleteActionSettings(requestJson);
  const filesystemSettingsState = useFilesystemSettings(requestJson);
  const { llmSettings } = llmSettingsState;
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
    handleSetAgentFailure,
  } = useChatConfigState({
    selectedDrone,
    selectedChat,
    drones,
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

  const rememberStartupSeed = React.useCallback((
    drones: Array<{ id: string; name: string }>,
    opts: {
      agent: ChatAgentConfig | null;
      model?: string | null;
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
    const model = String(opts.model ?? '').trim() || null;
    const group = String(opts.group ?? '').trim() || null;
    const repoPath = String(opts.repoPath ?? '').trim() || null;
    if (!prompt && !opts.agent && !model) return;
    const at = new Date().toISOString();
    setStartupSeedByDrone((prev) => {
      const next = { ...prev };
      for (const [id, droneName] of unique.entries()) {
        next[id] = {
          droneName,
          chatName,
          agent: opts.agent ?? null,
          model,
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
    seedAgent?: ChatAgentConfig;
    seedModel?: string | null;
    seedChat?: string;
    seedPrompt?: string;
    seedCwd?: string;
  };

  const queueDrones = React.useCallback(async (list: DroneQueueSpec[]) => {
    return await requestJson<{
      ok: true;
      accepted: Array<{ id: string; name: string; phase: 'starting' }>;
      rejected: Array<{ id?: string; name: string; error: string; status?: number }>;
      total: number;
    }>(`/api/drones/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drones: list, pullHostBranchBeforeCreate }),
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
  const {
    groupMoveError,
    setGroupMoveError,
    movingDroneGroups,
    deletingGroups,
    renamingGroups,
    renameGroup,
    deleteGroup,
    moveDronesToGroup,
    createGroupAndMove,
  } = useGroupManagement({
    autoDelete,
    drones,
    polledDrones,
    optimisticallyDeletedDrones,
    setOptimisticallyDeletedDrones,
    setCollapsedGroups,
  });
  const terminalMenuRef = React.useRef<HTMLDivElement | null>(null);

  const showNameSuggestionFailureToast = React.useCallback((error: unknown) => {
    const msg = String(error instanceof Error ? error.message : error ?? '').trim();
    const id = makeId();
    setNameSuggestToast({ id, message: msg || 'Name suggestion failed.' });
    window.setTimeout(() => {
      setNameSuggestToast((cur) => (cur?.id === id ? null : cur));
    }, 6000);
  }, []);
  const {
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    deleteDrone,
    renameDrone,
    setDroneBaseImage,
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

  const normalizeCreateRepoPath = React.useCallback(
    (candidate: string): string => {
      const p = String(candidate ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    },
    [registeredRepoPathSet],
  );

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

  const { openCreateModal, openDraftChatComposer, openCloneModal } =
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
      setDraftCreateError,
      setDraftCreating,
      setDraftAutoRenaming,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setCreateMode,
      setCreateRuntime,
      setCloneSourceId,
      setCreateName,
      setCreateGroup,
      setCreateRepoPath,
      setCreateInitialMessage,
      setCreateMessageSuffixRows,
      setCloneIncludeChats,
      setChatHeaderRepoPath,
      setSelectedDrone,
      setSelectedDroneIds,
      setSelectedChat,
      resetDraftNameSuggestSeq: () => {
        draftNameSuggestSeqRef.current = 0;
      },
    });

  const openGroupMultiChat = React.useCallback(
    (groupRaw: string) => {
      const group = String(groupRaw ?? '').trim();
      if (!group) return;
      setAppView('workspace');
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      setSelectedGroupMultiChat(group);
    },
    [setAppView, setDraftChat, setDraftCreateError, setDraftCreateOpen, setSelectedGroupMultiChat],
  );
  const openSidebarVisibleMultiChat = React.useCallback(() => {
    if (sidebarVisibleDrones.length === 0) return;
    setAppView('workspace');
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setSelectedGroupMultiChat(SIDEBAR_VISIBLE_MULTI_CHAT_GROUP);
  }, [
    setAppView,
    setDraftChat,
    setDraftCreateError,
    setDraftCreateOpen,
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

  const {
    draggingDroneNames,
    dragOverGroup,
    dragOverUngrouped,
    onDroneDragStart,
    onDroneDragEnd,
    onGroupDragOver,
    onGroupDragLeave,
    onGroupDrop,
    onUngroupedDragOver,
    onUngroupedDragLeave,
    onUngroupedDrop,
    resetGroupDndState,
  } = useDroneGroupDnd({
    movingDroneGroups,
    hasUngroupedGroup: sidebarHasUngroupedGroup,
    selectedDroneIds,
    selectedDroneSet,
    selectionAnchorRef,
    setSelectedDrone,
    setSelectedDroneIds,
    onPrepareDragStart: () => {
      setDraftChat(null);
    },
    onClearGroupMoveError: () => {
      setGroupMoveError(null);
    },
    moveDronesToGroup,
  });
  const { selectDroneCard: selectDroneCardBase, selectDroneChat: selectDroneChatBase } = useDroneSelectionState({
    orderedDroneIds,
    selectedDrone,
    selectedDroneIds,
    selectedChat,
    draftChat,
    drones,
    dronesFilteredByRepo,
    startupSeedByDrone,
    selectionAnchorRef,
    preferredSelectedDroneRef,
    preferredSelectedDroneHoldUntilRef,
    scrollChatToBottom,
    resetGroupDndState,
    setGroupMoveError,
    setAppView,
    setDraftChat,
    setDraftCreateOpen,
    setDraftCreateError,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
    setSelectedChat,
  });
  const selectDroneCard = React.useCallback(
    (droneIdRaw: string, opts?: { toggle?: boolean; range?: boolean }) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (droneId) clearDronesUnread([droneId]);
      selectDroneCardBase(droneIdRaw, opts);
    },
    [clearDronesUnread, selectDroneCardBase],
  );
  const selectDroneChat = React.useCallback(
    (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (droneId) clearDronesUnread([droneId]);
      selectDroneChatBase(droneIdRaw, chatNameRaw);
    },
    [clearDronesUnread, selectDroneChatBase],
  );
  const { createDrone, createDroneFromDraft, startDraftPrompt, startDraftAutomation } =
    useDroneCreationActions({
      drones,
      createNameRows,
      createMessageSuffixRows,
      createGroup,
      createRepoPath,
      createInitialMessage,
      pullHostBranchBeforeCreate,
      createMode,
      createRuntime,
      cloneSourceId,
      cloneIncludeChats,
      spawnAgentKey,
      spawnModelForSeed,
      draftChat,
      draftCreateMode,
      draftCreateName,
      draftCreateGroup,
      draftCreateRepoPath: chatHeaderRepoPath,
      startupSeedMissingGraceMs: STARTUP_SEED_MISSING_GRACE_MS,
      resolveAgentKeyToConfig,
      queueDrones,
      requestJson,
      suggestAndRenameDraftDrone,
      rememberStartupSeed,
      isValidDroneName: isValidDroneNameDashCase,
      hasWhitespaceInNameRaw: droneNameHasWhitespace,
      setCreateError,
      setCreating,
      setCreateName,
      setCreateMessageSuffixRows,
      setCreateOpen,
      setCreateMode,
      setCreateRuntime,
      setCloneSourceId,
      setCreateGroup,
      setCreateRepoPath,
      setCreateInitialMessage,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateName,
      setDraftCreateGroup,
      setDraftSuggestedName,
      setDraftNameSuggesting,
      setDraftNameSuggestionError,
      setDraftAutoRenaming,
      setDraftCreateOpen,
      setDraftCreating,
      setSelectedDrone,
      setSelectedDroneIds,
      setSelectedChat,
      selectionAnchorRef,
      preferredSelectedDroneRef,
      preferredSelectedDroneHoldUntilRef,
    });

  const currentDrone = selectedDrone ? drones.find((d) => d.id === selectedDrone) ?? null : null;
  const currentDroneLabel = currentDrone ? uiDroneName(currentDrone.name) : '';
  React.useEffect(() => {
    const selectedDroneId = String(selectedDrone ?? '').trim();
    if (!selectedDroneId) return;
    clearDronesUnread([selectedDroneId]);
  }, [clearDronesUnread, selectedDrone]);
  React.useEffect(() => {
    const previousBusyByDroneId = previousBusyByDroneIdRef.current;
    const nextBusyByDroneId: Record<string, boolean> = {};
    const markUnreadDroneIds: string[] = [];
    const selectedDroneId = String(selectedDrone ?? '').trim();
    for (const drone of drones) {
      const id = String(drone?.id ?? '').trim();
      if (!id) continue;
      const busyNow = !isDroneStartingOrSeeding(drone.hubPhase) && Boolean(drone.busy);
      nextBusyByDroneId[id] = busyNow;
      if (previousBusyByDroneId[id] && !busyNow && id !== selectedDroneId) {
        markUnreadDroneIds.push(id);
      }
    }
    previousBusyByDroneIdRef.current = nextBusyByDroneId;
    if (markUnreadDroneIds.length > 0) {
      markDronesUnread(markUnreadDroneIds);
    }
  }, [drones, markDronesUnread, selectedDrone]);

  const selectedDroneIdentity = React.useMemo(() => {
    if (!selectedDrone) return '';
    const ids = droneIdentityByNameRef.current;
    if (!ids[selectedDrone]) ids[selectedDrone] = makeId();
    return ids[selectedDrone];
  }, [selectedDrone]);

  const {
    cancelPendingPromptErrorById,
    cancellingPendingPromptById,
    chatUiMode,
    nowMs,
    promptError,
    requestCancelPendingPrompt,
    requestUnstickPendingPrompt,
    selectedIsResponding,
    sendPromptText,
    sendingPrompt,
    unstickingPendingPromptById,
    unstickPendingPromptErrorById,
    visiblePendingPromptsWithStartup,
  } = useChatRuntimeOrchestration({
    chatInfo,
    currentDrone,
    currentDroneLabel,
    drones,
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
    clearRepoOperationError,
    setRepoOperationError,
    githubUrlForRepo,
    deleteRepo,
    openDroneTerminal,
    openDroneEditor,
    pullRepoChanges,
    pushRepoChanges,
    reseedRepo,
  } = useWorkspaceActions({
    autoDelete,
    currentDrone,
    selectedChat,
    terminalEmulator,
    activeRepoPath,
    setActiveRepoPath,
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
    const targetDroneIds: string[] = [];
    const activeElement = document.activeElement;
    const canvasFocused =
      activeElement instanceof HTMLElement &&
      Boolean(activeElement.closest('[data-drone-canvas-viewport="1"]'));
    if (canvasFocused) {
      const canvasSelectedDroneIds = useDroneCanvasStore
        .getState()
        .selectedDroneIds.filter((id) => !isCanvasDraftNodeId(id));
      targetDroneIds.push(...canvasSelectedDroneIds);
    }
    if (targetDroneIds.length === 0 && selectedDroneIds.length > 0) {
      targetDroneIds.push(...selectedDroneIds);
    }
    if (targetDroneIds.length === 0) {
      const droneId = String(selectedDrone ?? '').trim();
      if (droneId) targetDroneIds.push(droneId);
    }
    return markDronesUnread(targetDroneIds) > 0;
  }, [markDronesUnread, selectedDrone, selectedDroneIds]);
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
    openDraftChatComposer,
    openGroupMultiChat,
    openSidebarVisibleMultiChat,
    toggleTldrFromShortcut,
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
    setDraftNameSuggesting,
    setDraftSuggestedName,
    setDraftNameSuggestionError,
    draftNameSuggestSeqRef,
    rightPanelOpen,
    rightPanelTab,
    rightPanelSplit,
    rightPanelBottomTab,
    setRightPanelOpen,
    rightPanelWidth,
    rightPanelWidthMode,
    rightPanelWidthMax,
    setRightPanelWidth,
    setRightPanelTab,
    setRightPanelBottomTab,
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
  const currentGroup = currentDrone?.group ? groups.find((g) => g.group === currentDrone.group) ?? null : null;
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
  } = useFilesAndPortsPaneState({ currentDrone, requestJson });
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
    openEditorFile,
    closeEditorFile,
    setOpenedFileContent,
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
    setSpawnAgentKey((prev) => (prev === nextAgentKey ? prev : nextAgentKey));
    setSpawnModel((prev) => (prev === nextModel ? prev : nextModel));
    lastSyncedCanvasAgentModelContextRef.current = contextKey;
  }, [
    currentDrone?.name,
    effectiveChatInfo,
    selectedChat,
    selectedDrone,
    setSpawnAgentKey,
    setSpawnModel,
  ]);
  const currentDroneBusy =
    currentDrone && !isDroneStartingOrSeeding(currentDrone.hubPhase)
      ? Boolean(currentDrone.busy) || selectedIsResponding
      : false;
  const busyChatNodeIdSet = React.useMemo(() => {
    const out = new Set<string>();
    for (const drone of drones) {
      const droneId = String(drone?.id ?? '').trim();
      if (!droneId) continue;
      const rawBusyChats = Array.isArray(drone?.busyChats) ? drone.busyChats : [];
      for (const rawChatName of rawBusyChats) {
        const chatName = String(rawChatName ?? '').trim() || 'default';
        const nodeId = createCanvasChatNodeId(droneId, chatName);
        if (nodeId) out.add(nodeId);
      }
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
        hubPhase?: DroneSummary['hubPhase'];
        hubMessage?: DroneSummary['hubMessage'];
        busy: boolean;
        unreadAgentMessage: boolean;
      }
    > = {};
    for (const drone of drones) {
      const droneId = String(drone?.id ?? '').trim();
      if (!droneId) continue;
      const chats = Array.isArray(drone?.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
      for (const rawChatName of chats) {
        const chatName = String(rawChatName ?? '').trim() || 'default';
        const nodeId = createCanvasChatNodeId(droneId, chatName);
        if (!nodeId) continue;
        out[nodeId] = {
          statusOk: Boolean(drone.statusOk),
          statusError: drone.statusError ?? null,
          hubPhase: drone.hubPhase,
          hubMessage: drone.hubMessage,
          busy: busyChatNodeIdSet.has(nodeId),
          unreadAgentMessage: unreadAgentMessageByDroneId[droneId] === true && chatName === 'default',
        };
      }
    }
    return out;
  }, [busyChatNodeIdSet, drones, unreadAgentMessageByDroneId]);
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
      openEditorFile({
        path: containerPath,
        name,
        line: ref.line,
        column: ref.column,
      });
    },
    [currentDrone, openEditorFile],
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
      openEditorFile({ path: containerPath, name });
    },
    [openEditorFile, resolveCurrentDroneRepoFilePath],
  );
  const revealChangesFileInFiles = React.useCallback(
    (pane: 'top' | 'bottom' | 'single', repoRelativePath: string) => {
      const containerPath = resolveCurrentDroneRepoFilePath(repoRelativePath);
      if (!containerPath) return;
      const slash = containerPath.lastIndexOf('/');
      const parentPath = slash > 0 ? containerPath.slice(0, slash) : '/';
      setCurrentFsPath(parentPath);
      setRightPanelOpen(true);
      if (pane === 'bottom') setRightPanelBottomTab('files');
      else setRightPanelTab('files');
    },
    [resolveCurrentDroneRepoFilePath, setCurrentFsPath, setRightPanelBottomTab, setRightPanelOpen, setRightPanelTab],
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
              body: JSON.stringify({ prompt, attachments: [] }),
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
      const repoPath = String(overrides.repoPath ?? chatHeaderRepoPath ?? '').trim();
      const group = String(overrides.group ?? draftCreateGroup ?? '').trim();
      const shouldPullHostBranchBeforeCreate =
        overrides.pullHostBranchBeforeCreate === true ||
        (overrides.pullHostBranchBeforeCreate !== false && pullHostBranchBeforeCreate);

      try {
        const body: any = {
          ...(group ? { group } : {}),
          ...(repoPath ? { repoPath } : {}),
          pullHostBranchBeforeCreate: shouldPullHostBranchBeforeCreate,
          seedChat: 'default',
          ...(seedAgent ? { seedAgent } : {}),
          ...(seedModel ? { seedModel } : {}),
          seedPrompt: prompt,
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

        rememberStartupSeed([{ id: droneId, name: droneName }], {
          agent: seedAgent,
          model: seedModel,
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
      resolveAgentKeyToConfig,
      spawnAgentKey,
      spawnModel,
      preferredSelectedDroneHoldUntilRef,
      preferredSelectedDroneRef,
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
        if (selectedDrone === droneId && selectedChat === chatName) {
          setSelectedChat(newName);
        }
        return { ok: true, chatName: newName, error: null };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    },
    [drones, requestJson, selectedChat, selectedDrone, setSelectedChat, sidebarSelectableDroneIdSet],
  );
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
        const confirmed = window.confirm(`Delete chat "${chatName}" from "${droneLabel}"?`);
        if (!confirmed) return { ok: false, error: '' };
      }

      try {
        await requestJson<{ ok: true; deletedChat: string }>(
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}`,
          { method: 'DELETE' },
        );
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
      deleteDrone,
      drones,
      requestJson,
      selectedChat,
      selectedDrone,
      setSelectedChat,
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
      const chats = Array.isArray(drone.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
      for (const chatNameRaw of chats) {
        const chatName = String(chatNameRaw ?? '').trim();
        if (!chatName) continue;
        const nodeId = createCanvasChatNodeId(droneId, chatName);
        if (!nodeId || out.includes(nodeId)) continue;
        out.push(nodeId);
      }
    }
    return out;
  }, [drones, orderedDroneIds]);
  const selectedCanvasChatNodeId = React.useMemo(() => {
    const droneId = String(selectedDrone ?? '').trim();
    if (!droneId) return null;
    const chatName = String(selectedChat ?? '').trim() || 'default';
    return createCanvasChatNodeId(droneId, chatName);
  }, [selectedChat, selectedDrone]);

  const renderRightPanelTabContent = React.useCallback(
    (drone: DroneSummary, tab: RightPanelTab, paneKey: PreviewPaneKey): React.ReactNode => {
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
          droneNameById={droneNameById}
          droneRepoById={droneRepoById}
          draftRepoLabel={canvasDraftRepoLabel}
          chatNodeStateById={chatNodeStateById}
          onActivateChatFromCanvas={onActivateChatFromCanvas}
          onSendCanvasPrompt={sendCanvasPrompt}
          onCreateCanvasDroneFromDraft={createCanvasDroneFromDraft}
          onRenameCanvasChat={renameCanvasChat}
          onDeleteCanvasChat={deleteCanvasChat}
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
          onOpenFileInEditor={(entry) => {
            if (entry.kind !== 'file') return;
            openEditorFile({ path: entry.path, name: entry.name });
          }}
          onRevealChangesFileInFiles={revealChangesFileInFiles}
          onOpenChangesFileInEditor={openChangesFileInEditor}
          onOpenPullRequestInChanges={(pane, _pullRequest) => {
            setRightPanelOpen(true);
            if (pane === 'bottom') setRightPanelBottomTab('changes');
            else setRightPanelTab('changes');
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
      canvasDraftRepoLabel,
      defaultFsPathForCurrentDrone,
      droneNameById,
      droneRepoById,
      chatNodeStateById,
      onActivateChatFromCanvas,
      orderedCanvasChatNodeIds,
      filesPane,
      fsEntries,
      fsError,
      fsErrorUi,
      fsExplorerView,
      fsLoading,
      lockedPreviewByDrone,
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
      openEditorFile,
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
    unreadAgentMessageByDroneId,
    deletingDrones,
    renamingDrones,
    settingBaseImages,
    movingDroneGroups,
    sidebarGroups,
    collapsedGroups,
    deletingGroups,
    renamingGroups,
    dragOverGroup,
    sidebarHasUngroupedGroup,
    draggingDroneNames,
    dragOverUngrouped,
    repos,
    reposLoading,
    reposError,
    drones,
    droneCountByRepoPath,
    uiDroneName,
    draftSidebarPlaceholder,
    openDraftChatComposer,
    openCreateModal,
    selectDroneCard,
    selectDroneChat,
    openCloneModal,
    renameDrone,
    setDroneBaseImage,
    deleteDrone,
    openDroneErrorModal,
    onUngroupedDragOver,
    onUngroupedDragLeave,
    onUngroupedDrop,
    onGroupDragOver,
    onGroupDragLeave,
    onGroupDrop,
    createGroupAndMove,
    setCollapsedGroups,
    renameGroup,
    openGroupMultiChat,
    openSidebarVisibleMultiChat,
    deleteGroup,
    onDroneDragStart,
    onDroneDragEnd,
    setReposModalOpen,
  });

  const overlaysProps: DroneHubOverlaysProps = useDroneHubOverlaysProps({
    createOpen,
    creating,
    createMode,
    createRuntime,
    setCreateRuntime,
    cloneSourceId,
    createNameEntries,
    drones,
    createError,
    createGroup,
    setCreateGroup,
    createRepoPath,
    setCreateRepoPath,
    createRepoMenuEntries,
    createRepoMenuOpen,
    setCreateRepoMenuOpen,
    registeredRepoPaths,
    activeRepoPath,
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
    droneErrorModal,
    clearingDroneError,
    closeDroneErrorModal,
    clearDroneHubError,
    setNameSuggestToast,
  });

  const workspaceContentProps: DroneHubWorkspaceContentProps = useDroneHubWorkspaceContentProps({
    appView,
    llmSettingsState,
    deleteActionSettingsState,
    filesystemSettingsState,
    hubLogsState,
    hubLogsTailLines: HUB_LOGS_TAIL_LINES,
    hubLogsMaxBytes: HUB_LOGS_MAX_BYTES,
    setAppView,
    onReplayOnboarding: requestGuidedOnboardingReplay,
    onResetOnboarding: resetGuidedOnboardingDismissals,
    draftChat,
    nowMs,
    createRuntime,
    setCreateRuntime,
    draftCreateMode,
    setDraftCreateMode,
    spawnAgentMenuEntries,
    draftCreating,
    draftAutoRenaming,
    spawnAgentConfig,
    createRepoMenuEntries,
    draftCreateName,
    draftCreateGroup,
    draftCreateError,
    queuedPromptsByDroneChat,
    setDraftChat,
    setDraftCreateOpen,
    setDraftCreateName,
    setDraftCreateGroup,
    setDraftAutoRenaming,
    startDraftPrompt,
    startDraftAutomation,
    createDroneFromDraft,
    enqueueQueuedPrompt,
    setDraftCreateError,
    selectedGroupMultiChatData,
    groupBroadcastPromptError,
    groupBroadcastSending,
    sendGroupBroadcastPrompt,
    uiDroneName,
    selectDroneCard,
    deleteDrone,
    deletingDrones,
    parseJobsFromAgentMessage,
    dronesLoading,
    sidebarDrones,
    dronesError,
    openDraftChatComposer,
    openCreateModal,
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
    rightPanelTabLabels: RIGHT_PANEL_TAB_LABELS,
    resetRightPanelWidth,
    rightPanelWidthIsDefault,
    transcripts,
    visiblePendingPromptsWithStartup,
    transcriptMessageId,
    parsingJobsByTurn,
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
    rightPanelWidth,
    rightPanelWidthMode,
    rightPanelWidthMax,
    rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH_PX,
    rightPanelResizing,
    rightPanelBottomTab,
    setRightPanelBottomTab,
    startRightPanelResize,
    renderRightPanelTabContent,
    renderPersistentPreviewContent,
  });

  return {
    sidebarProps,
    overlaysProps,
    workspaceContentProps,
  };
}
