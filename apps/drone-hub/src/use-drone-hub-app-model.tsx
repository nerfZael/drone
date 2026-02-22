import React from 'react';
import {
  type ChatAgentConfig,
  isValidDroneNameDashCase,
} from './domain';
import { requestJson } from './droneHub/http';
import { requestGuidedOnboardingReplay, resetGuidedOnboardingDismissals } from './onboarding/control';
import { copyText } from './droneHub/app/clipboard';
import {
  BUILTIN_AGENT_OPTIONS,
  HUB_LOGS_MAX_BYTES,
  HUB_LOGS_TAIL_LINES,
  RIGHT_PANEL_MIN_WIDTH_PX,
  RIGHT_PANEL_TAB_LABELS,
  RIGHT_PANEL_TABS,
  STARTUP_SEED_MISSING_GRACE_MS,
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
  isDroneStartingOrSeeding,
  makeId,
} from './droneHub/app/helpers';
import { droneNameHasWhitespace } from './droneHub/app/name-helpers';
import type { DroneSummary } from './droneHub/types';

export type DroneHubAppModel = {
  sidebarProps: DroneSidebarProps;
  overlaysProps: DroneHubOverlaysProps;
  workspaceContentProps: DroneHubWorkspaceContentProps;
};

export function useDroneHubAppModel(): DroneHubAppModel {
  const {
    optimisticallyDeletedDrones,
    startupSeedByDrone,
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
    cloneSourceId,
    cloneIncludeChats,
    createError,
    createGroup,
    createRepoPath,
    createInitialMessage,
    createRepoMenuOpen,
    draftCreateOpen,
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
    setCloneSourceId,
    setCloneIncludeChats,
    setCreateError,
    setCreateGroup,
    setCreateRepoPath,
    setCreateInitialMessage,
    setCreateRepoMenuOpen,
    setDraftCreateOpen,
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
  const droneStateById = React.useMemo(() => {
    const out: Record<
      string,
      {
        statusOk: boolean;
        statusError: string | null;
        hubPhase?: DroneSummary['hubPhase'];
        hubMessage?: DroneSummary['hubMessage'];
        busy: boolean;
      }
    > = {};
    for (const drone of drones) {
      const id = String(drone?.id ?? '').trim();
      if (!id) continue;
      out[id] = {
        statusOk: Boolean(drone.statusOk),
        statusError: drone.statusError ?? null,
        hubPhase: drone.hubPhase,
        hubMessage: drone.hubMessage,
        busy: Boolean(drone.busy),
      };
    }
    return out;
  }, [drones]);
  const sidebarSelectableDroneIdSet = React.useMemo(
    () => new Set(sidebarDronesFilteredByRepo.map((drone) => drone.id)),
    [sidebarDronesFilteredByRepo],
  );

  /* ── Layout state ── */
  const {
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelWidth,
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
  const droneIdentityByNameRef = React.useRef<Record<string, string>>({});
  const llmSettingsState = useLlmSettings(requestJson);
  const deleteActionSettingsState = useDeleteActionSettings(requestJson);
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
      setDraftCreateName,
      setDraftCreateGroup,
      setDraftCreateError,
      setDraftCreating,
      setDraftAutoRenaming,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setCreateMode,
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

  function updatePinned(el: HTMLDivElement | null) {
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = gap < 80;
    pinnedToBottomRef.current = pinned;
    setPinnedToBottom(pinned);
  }

  function scrollChatToBottom() {
    // Force-follow on selection change so newly loaded content lands at the bottom.
    pinnedToBottomRef.current = true;
    setPinnedToBottom(true);
    prevOutputLenRef.current = -1;
    prevChatItemsLenRef.current = -1;
    requestAnimationFrame(() => {
      const transcriptEnd = chatEndRef.current;
      if (transcriptEnd) {
        transcriptEnd.scrollIntoView({ behavior: 'auto' });
      }
      const el = outputScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      updatePinned(el);
    });
  }

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
  const { selectDroneCard } = useDroneSelectionState({
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
  const { createDrone, createDroneFromDraft, startDraftPrompt } =
    useDroneCreationActions({
      drones,
      createNameRows,
      createMessageSuffixRows,
      createGroup,
      createRepoPath,
      createInitialMessage,
      pullHostBranchBeforeCreate,
      createMode,
      cloneSourceId,
      cloneIncludeChats,
      spawnAgentKey,
      spawnModelForSeed,
      draftChat,
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

  const selectedDroneIdentity = React.useMemo(() => {
    if (!selectedDrone) return '';
    const ids = droneIdentityByNameRef.current;
    if (!ids[selectedDrone]) ids[selectedDrone] = makeId();
    return ids[selectedDrone];
  }, [selectedDrone]);

  const {
    chatUiMode,
    nowMs,
    promptError,
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
    openCreateModal,
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
    rightPanelSplit,
    setRightPanelOpen,
    setRightPanelTab,
    setRightPanelBottomTab,
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
    draftCreating,
    draftAutoRenaming,
    setDraftChat,
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
    setSelectedPreviewPort,
  } = useFilesAndPortsPaneState({ currentDrone, requestJson });
  const {
    openedFile: openedEditorFile,
    loading: openedEditorFileLoading,
    saving: openedEditorFileSaving,
    error: openedEditorFileError,
    openFailure: openedEditorFileOpenFailure,
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
  const currentDroneBusy =
    currentDrone && !isDroneStartingOrSeeding(currentDrone.hubPhase)
      ? Boolean(currentDrone.busy) || selectedIsResponding
      : false;
  const showRespondingAsStatusInHeader =
    Boolean(currentDroneBusy) && Boolean(currentDrone?.statusOk) && currentDrone?.hubPhase !== 'error';
  const currentCustomAgentMissing = currentAgent.kind === 'custom' && !customAgents.some((a) => a.id === currentAgent.id);
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
      const normalized = rawPath.replace(/\/+/g, '/').replace(/^\/+/, '');
      if (!normalized) return;
      const containerPath =
        rawPath.startsWith('/work/repo/') || rawPath === '/work/repo'
          ? rawPath
          : normalized.startsWith('work/repo/')
            ? `/${normalized}`
            : `/work/repo/${normalized}`;
      const name = containerPath.split('/').filter(Boolean).pop() || containerPath;
      openEditorFile({
        path: containerPath,
        name,
        line: ref.line,
        column: ref.column,
      });
    },
    [openEditorFile],
  );
  const onActivateDroneFromCanvas = React.useCallback(
    (droneIdRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId || !sidebarSelectableDroneIdSet.has(droneId)) return;
      selectDroneCard(droneId);
    },
    [selectDroneCard, sidebarSelectableDroneIdSet],
  );

  const renderRightPanelTabContent = React.useCallback(
    (drone: DroneSummary, tab: RightPanelTab, paneKey: 'top' | 'bottom' | 'single'): React.ReactNode => (
      <RightPanelTabContent
        drone={drone}
        tab={tab}
        paneKey={paneKey}
        selectedChat={selectedChat}
        droneNameById={droneNameById}
        droneRepoById={droneRepoById}
        droneStateById={droneStateById}
        onActivateDroneFromCanvas={onActivateDroneFromCanvas}
        currentDroneId={currentDrone?.id ?? null}
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
        selectedPreviewPort={selectedPreviewPort}
        currentPortReachability={currentPortReachability}
        portsLoading={portsLoading}
        portsError={portsError}
        portsErrorUi={portsErrorUi}
        portsPane={portsPane}
        selectedPreviewDefaultUrl={selectedPreviewDefaultUrl}
        selectedPreviewUrlOverride={selectedPreviewUrlOverride}
        setSelectedPreviewUrlOverride={setSelectedPreviewUrlOverride}
        agentLabel={agentLabel}
        portRows={portRows}
        setSelectedPreviewPort={setSelectedPreviewPort}
        onOpenFileInEditor={(entry) => {
          if (entry.kind !== 'file' || entry.isImage) return;
          openEditorFile({ path: entry.path, name: entry.name });
        }}
        onOpenPullRequestInChanges={(pane, _pullRequest) => {
          setRightPanelOpen(true);
          if (pane === 'bottom') setRightPanelBottomTab('changes');
          else setRightPanelTab('changes');
        }}
      />
    ),
    [
      agentLabel,
      currentDrone?.id,
      currentFsPath,
      currentPortReachability,
      defaultFsPathForCurrentDrone,
      droneNameById,
      droneRepoById,
      droneStateById,
      onActivateDroneFromCanvas,
      filesPane,
      fsEntries,
      fsError,
      fsErrorUi,
      fsExplorerView,
      fsLoading,
      portRows,
      portsError,
      portsErrorUi,
      portsLoading,
      portsPane,
      refreshFsList,
      selectedChat,
      selectedPreviewDefaultUrl,
      selectedPreviewPort,
      selectedPreviewUrlOverride,
      setCurrentFsPath,
      setFsExplorerView,
      setRightPanelBottomTab,
      setRightPanelOpen,
      setRightPanelTab,
      setSelectedPreviewPort,
      setSelectedPreviewUrlOverride,
      uiDroneName,
      openEditorFile,
    ],
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
    selectedIsResponding,
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
    openDraftChatComposer,
    openCreateModal,
    selectDroneCard,
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
    setDraftCreateOpen,
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
    hubLogsState,
    hubLogsTailLines: HUB_LOGS_TAIL_LINES,
    hubLogsMaxBytes: HUB_LOGS_MAX_BYTES,
    setAppView,
    onReplayOnboarding: requestGuidedOnboardingReplay,
    onResetOnboarding: resetGuidedOnboardingDismissals,
    draftChat,
    nowMs,
    spawnAgentMenuEntries,
    draftCreating,
    draftAutoRenaming,
    spawnAgentConfig,
    createRepoMenuEntries,
    draftCreateGroup,
    draftCreateError,
    queuedPromptsByDroneChat,
    setDraftChat,
    setDraftCreateOpen,
    setDraftCreateGroup,
    setDraftAutoRenaming,
    startDraftPrompt,
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
    rightPanelTabs: RIGHT_PANEL_TABS,
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
    requestUnstickPendingPrompt,
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
    rightPanelWidthMax,
    rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH_PX,
    rightPanelResizing,
    rightPanelBottomTab,
    setRightPanelBottomTab,
    startRightPanelResize,
    renderRightPanelTabContent,
  });

  return {
    sidebarProps,
    overlaysProps,
    workspaceContentProps,
  };
}
