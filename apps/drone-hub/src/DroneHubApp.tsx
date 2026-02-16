import React from 'react';
import {
  type ChatAgentConfig,
  isUngroupedGroupName,
  isValidDroneNameDashCase,
} from './domain';
import { requestJson } from './droneHub/http';
import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { requestGuidedOnboardingReplay, resetGuidedOnboardingDismissals } from './onboarding/control';
import { copyText } from './droneHub/app/clipboard';
import {
  BUILTIN_AGENT_OPTIONS,
  FS_EXPLORER_VIEW_STORAGE_KEY,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY,
  HUB_LOGS_MAX_BYTES,
  HUB_LOGS_TAIL_LINES,
  RIGHT_PANEL_MIN_WIDTH_PX,
  RIGHT_PANEL_TAB_LABELS,
  RIGHT_PANEL_TABS,
  SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY,
  STARTUP_SEED_MISSING_GRACE_MS,
  isStartupSeedFresh,
  type RightPanelTab,
} from './droneHub/app/app-config';
import { DroneSidebar } from './droneHub/app/DroneSidebar';
import { DroneHubOverlays } from './droneHub/app/DroneHubOverlays';
import { DroneHubWorkspaceContent } from './droneHub/app/DroneHubWorkspaceContent';
import { RightPanelTabContent } from './droneHub/app/RightPanelTabContent';
import type {
  ChatModelOption,
  StartupSeedState,
} from './droneHub/app/app-types';
import { useHubLogs } from './droneHub/app/use-hub-logs';
import { useCreateDroneRowsState } from './droneHub/app/use-create-drone-rows-state';
import { useCreateDraftWorkflowState } from './droneHub/app/use-create-draft-workflow-store';
import { useDroneCreationActions } from './droneHub/app/use-drone-creation-actions';
import { useChatRuntimeOrchestration } from './droneHub/app/use-chat-runtime-orchestration';
import { useDroneGroupDnd } from './droneHub/app/use-drone-group-dnd';
import { useDroneErrorModalActions } from './droneHub/app/use-drone-error-modal-actions';
import { useDroneMutationActions } from './droneHub/app/use-drone-mutation-actions';
import { useFilesAndPortsPaneState } from './droneHub/app/use-files-and-ports-pane-state';
import { useGroupBroadcast } from './droneHub/app/use-group-broadcast';
import { useGroupManagement } from './droneHub/app/use-group-management';
import { useJobsWorkflow } from './droneHub/app/use-jobs-workflow';
import { useLlmSettings } from './droneHub/app/use-llm-settings';
import { useQueuedPromptsState } from './droneHub/app/use-queued-prompts-state';
import { useRightPanelLayout } from './droneHub/app/use-right-panel-layout';
import { useDroneSelectionState } from './droneHub/app/use-drone-selection-state';
import { useSidebarViewModel } from './droneHub/app/use-sidebar-view-model';
import { useChatConfigState } from './droneHub/app/use-chat-config-state';
import { useDroneHubUiState } from './droneHub/app/use-drone-hub-ui-store';
import { useTranscriptTldrState } from './droneHub/app/use-transcript-tldr-state';
import { useWorkspaceNavigationActions } from './droneHub/app/use-workspace-navigation-actions';
import { useWorkspaceActions } from './droneHub/app/use-workspace-actions';
import {
  fetchJson,
  usePersistedLocalStorageItem,
  usePoll,
} from './droneHub/app/hooks';
import {
  compareDronesByNewestFirst,
  isDroneStartingOrSeeding,
  makeId,
} from './droneHub/app/helpers';
import { droneNameHasWhitespace } from './droneHub/app/name-helpers';
import { cn } from './ui/cn';
import { useDropdownDismiss } from './ui/dropdown';
import type {
  DroneSummary,
  PendingPrompt,
  RepoSummary,
  TranscriptItem,
} from './droneHub/types';

export default function DroneHubApp() {
  const { value: dronesResp, error: dronesError, loading: dronesLoading } = usePoll<{ ok: true; drones: DroneSummary[] }>(
    () => fetchJson('/api/drones'),
    2000,
    [],
  );
  const polledDrones = dronesResp?.drones ?? [];
  const [optimisticallyDeletedDrones, setOptimisticallyDeletedDrones] = React.useState<Record<string, boolean>>({});
  const drones = React.useMemo(() => {
    const hiddenNames = Object.keys(optimisticallyDeletedDrones);
    if (hiddenNames.length === 0) return polledDrones;
    return polledDrones.filter((d) => !optimisticallyDeletedDrones[d.id]);
  }, [optimisticallyDeletedDrones, polledDrones]);

  React.useEffect(() => {
    if (Object.keys(optimisticallyDeletedDrones).length === 0) return;
    const liveIds = new Set(polledDrones.map((d) => d.id));
    setOptimisticallyDeletedDrones((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const name of Object.keys(prev)) {
        if (liveIds.has(name)) {
          next[name] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [optimisticallyDeletedDrones, polledDrones]);

  const { value: reposResp, error: reposError, loading: reposLoading } = usePoll<{ ok: true; repos: RepoSummary[] }>(
    () => fetchJson('/api/repos'),
    5000,
    [],
  );
  const repos = reposResp?.repos ?? [];
  const registeredRepoPaths = React.useMemo(
    () =>
      repos
        .map((r) => String(r?.path ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [repos],
  );
  const registeredRepoPathSet = React.useMemo(() => new Set(registeredRepoPaths), [registeredRepoPaths]);

  const { value: groupsResp } = usePoll<{ ok: true; groups: Array<{ name: string }> }>(() => fetchJson('/api/groups'), 5000, []);
  const registryGroupNames = React.useMemo(() => {
    const out = new Set<string>();
    for (const g of groupsResp?.groups ?? []) {
      const name = String((g as any)?.name ?? '').trim();
      if (!name) continue;
      if (isUngroupedGroupName(name)) continue;
      out.add(name);
    }
    return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
  }, [groupsResp]);
  const {
    activeRepoPath,
    chatHeaderRepoPath,
    sidebarReposCollapsed,
    appView,
    viewMode,
    collapsedGroups,
    autoDelete,
    terminalEmulator,
    selectedDrone,
    selectedDroneIds,
    selectedGroupMultiChat,
    groupBroadcastExpanded,
    groupMultiChatColumnWidth,
    selectedChat,
    draftChat,
    sidebarCollapsed,
    reposModalOpen,
    droneErrorModal,
    clearingDroneError,
    headerOverflowOpen,
    outputView,
    fsExplorerView,
    spawnAgentKey,
    spawnModel,
    customAgents,
    customAgentModalOpen,
    newCustomAgentLabel,
    newCustomAgentCommand,
    customAgentError,
    nameSuggestToast,
    terminalMenuOpen,
    agentMenuOpen,
    setActiveRepoPath,
    setChatHeaderRepoPath,
    setSidebarReposCollapsed,
    setAppView,
    setViewMode,
    setCollapsedGroups,
    setAutoDelete,
    setTerminalEmulator,
    setSelectedDrone,
    setSelectedDroneIds,
    setSelectedGroupMultiChat,
    setGroupBroadcastExpanded,
    setGroupMultiChatColumnWidth,
    setSelectedChat,
    setDraftChat,
    setSidebarCollapsed,
    setReposModalOpen,
    setDroneErrorModal,
    setClearingDroneError,
    setHeaderOverflowOpen,
    setOutputView,
    setFsExplorerView,
    setSpawnAgentKey,
    setSpawnModel,
    setCustomAgents,
    setCustomAgentModalOpen,
    setNewCustomAgentLabel,
    setNewCustomAgentCommand,
    setCustomAgentError,
    setNameSuggestToast,
    setTerminalMenuOpen,
    setAgentMenuOpen,
  } = useDroneHubUiState();
  usePersistedLocalStorageItem('droneHub.activeRepoPath', activeRepoPath || '');

  React.useEffect(() => {
    if (!activeRepoPath) return;
    const exists = repos.some((r) => String(r?.path ?? '').trim() === activeRepoPath);
    if (!exists) setActiveRepoPath('');
  }, [repos, activeRepoPath]);
  usePersistedLocalStorageItem('droneHub.chatHeaderRepoPath', chatHeaderRepoPath || '');

  React.useEffect(() => {
    // If a previously-saved repo path was removed from the registry, drop back to "No repo".
    setChatHeaderRepoPath((prev) => {
      const p = String(prev ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    });
  }, [registeredRepoPathSet]);
  usePersistedLocalStorageItem(SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY, sidebarReposCollapsed ? '1' : '0');
  usePersistedLocalStorageItem('droneHub.appView', appView);
  usePersistedLocalStorageItem('droneHub.viewMode', viewMode);
  usePersistedLocalStorageItem('droneHub.collapsedGroups', JSON.stringify(collapsedGroups));
  usePersistedLocalStorageItem('droneHub.autoDelete', autoDelete ? '1' : '0');
  usePersistedLocalStorageItem('droneHub.terminalEmulator', terminalEmulator);

  const dronesFilteredByRepo = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return drones;
    return drones.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, drones]);

  const droneCountByRepoPath = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of drones) {
      const p = String(d?.repoPath ?? '').trim();
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return counts;
  }, [drones]);

  const groups = React.useMemo(() => {
    const m = new Map<string, DroneSummary[]>();
    for (const rawName of registryGroupNames) {
      const g = String(rawName ?? '').trim();
      if (!g || isUngroupedGroupName(g)) continue;
      if (!m.has(g)) m.set(g, []);
    }
    for (const d of dronesFilteredByRepo) {
      const raw = (d.group ?? '').trim();
      const g = !raw || isUngroupedGroupName(raw) ? 'Ungrouped' : raw;
      const arr = m.get(g) ?? [];
      arr.push(d);
      m.set(g, arr);
    }
    const out = Array.from(m.entries()).map(([group, items]) => {
      items.sort(compareDronesByNewestFirst);
      return { group, items };
    });
    out.sort((a, b) => {
      if (isUngroupedGroupName(a.group) && !isUngroupedGroupName(b.group)) return -1;
      if (!isUngroupedGroupName(a.group) && isUngroupedGroupName(b.group)) return 1;
      return a.group.localeCompare(b.group);
    });
    return out;
  }, [dronesFilteredByRepo, registryGroupNames]);
  // NOTE: selection is keyed by stable drone id (not display name).
  usePersistedLocalStorageItem(GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY, String(groupMultiChatColumnWidth));
  // Keyed by drone id.
  const [startupSeedByDrone, setStartupSeedByDrone] = React.useState<Record<string, StartupSeedState>>({});
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
    queuedPromptsByDroneChatRef,
    flushingQueuedKeysRef,
    enqueueQueuedPrompt,
    patchQueuedPrompt,
    removeQueuedPrompt,
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
    sidebarGroups,
    sidebarHasUngroupedGroup,
  } = useSidebarViewModel({
    selectedDroneIds,
    viewMode,
    drones,
    dronesFilteredByRepo,
    groups,
    startupSeedByDrone,
    optimisticallyDeletedDrones,
    activeRepoPath,
    registryGroupNames,
  });

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

  const [transcripts, setTranscripts] = React.useState<TranscriptItem[] | null>(null);
  const [transcriptError, setTranscriptError] = React.useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = React.useState(false);
  const chatEndRef = React.useRef<HTMLDivElement | null>(null);
  const [optimisticPendingPrompts, setOptimisticPendingPrompts] = React.useState<PendingPrompt[]>([]);
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

  const [sessionText, setSessionText] = React.useState<string>('');
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [loadingSession, setLoadingSession] = React.useState(false);

  React.useEffect(() => {
    const ids = droneIdentityByNameRef.current;
    for (const d of drones) {
      const name = String(d?.name ?? '').trim();
      if (!name) continue;
      if (!ids[name]) ids[name] = makeId();
    }
  }, [drones]);

  usePersistedLocalStorageItem('droneHub.outputView', outputView);
  usePersistedLocalStorageItem(FS_EXPLORER_VIEW_STORAGE_KEY, fsExplorerView);
  usePersistedLocalStorageItem('droneHub.customAgents', JSON.stringify(customAgents));
  usePersistedLocalStorageItem('droneHub.spawnAgent', spawnAgentKey);
  usePersistedLocalStorageItem('droneHub.spawnModel', spawnModel);

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

  const rememberStartupSeed = React.useCallback((drones: Array<{ id: string; name: string }>, opts: { agent: ChatAgentConfig | null; model?: string | null; prompt: string; chatName?: string }) => {
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
      body: JSON.stringify({ drones: list }),
    });
  }, []);

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
    createGroupDraft,
    setCreateGroupDraft,
    createGroupError,
    setCreateGroupError,
    creatingGroup,
    createGroupFromDraft,
    renameGroup,
    deleteGroup,
    moveDronesToGroup,
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
    const msg = String((error as any)?.message ?? error ?? '').trim();
    const id = makeId();
    setNameSuggestToast({ id, message: msg || 'Name suggestion failed.' });
    window.setTimeout(() => {
      setNameSuggestToast((cur) => (cur?.id === id ? null : cur));
    }, 6000);
  }, []);
  const {
    deletingDrones,
    renamingDrones,
    deleteDrone,
    renameDrone,
    renameDroneTo,
    suggestAndRenameDraftDrone,
  } = useDroneMutationActions({
    drones,
    autoDelete,
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

  React.useEffect(() => {
    setCreateRepoPath((prev) => {
      const next = normalizeCreateRepoPath(prev);
      return next === prev ? prev : next;
    });
  }, [normalizeCreateRepoPath]);

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

  useDropdownDismiss(terminalMenuRef, terminalMenuOpen, setTerminalMenuOpen);
  useDropdownDismiss(headerOverflowRef, headerOverflowOpen, setHeaderOverflowOpen);

  React.useEffect(() => {
    if (!droneErrorModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDroneErrorModal(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [droneErrorModal]);

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (isEditableTarget(e.target)) return;

      // Keep existing power-user shortcut for opening the bulk create modal.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'n') {
        e.preventDefault();
        openCreateModal();
        return;
      }

      // Letter shortcuts only apply for plain key presses.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (key === 'w') {
        e.preventDefault();
        toggleTldrFromShortcut();
        return;
      }
      if (key === 'a') {
        e.preventDefault();
        openDraftChatComposer();
        return;
      }
      if (key === 's') {
        e.preventDefault();
        openCreateModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openCreateModal, openDraftChatComposer, toggleTldrFromShortcut]);

  React.useEffect(() => {
    if (!createOpen) {
      setCreateRepoMenuOpen(false);
      return;
    }
    setCreateRepoMenuOpen(false);
    const id = requestAnimationFrame(() => {
      const el = createNameRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [createOpen]);

  React.useEffect(() => {
    if (!draftCreateOpen) return;
    const id = requestAnimationFrame(() => {
      const el = draftCreateNameRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [draftCreateOpen]);

  React.useEffect(() => {
    if (draftChat) return;
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setDraftCreating(false);
    setDraftCreateName('');
    setDraftCreateGroup('');
    setDraftNameSuggesting(false);
    setDraftSuggestedName('');
    setDraftNameSuggestionError(null);
    draftNameSuggestSeqRef.current = 0;
  }, [draftChat]);

  React.useEffect(() => {
    if (!draftCreateOpen) return;
    const prompt = String(draftChat?.prompt?.prompt ?? '').trim();
    if (!prompt) return;
    const selectedProvider = llmSettings?.provider?.selected ?? 'openai';
    const selectedSettings = selectedProvider === 'gemini' ? llmSettings?.gemini : llmSettings?.openai;
    if (!selectedSettings?.hasKey) return;
    let mounted = true;
    const seq = draftNameSuggestSeqRef.current + 1;
    draftNameSuggestSeqRef.current = seq;
    setDraftNameSuggesting(true);
    setDraftSuggestedName('');
    setDraftNameSuggestionError(null);
    void requestJson<{ ok: true; name: string }>('/api/drones/name-from-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: prompt }),
    })
      .then((data) => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        const suggested = String(data?.name ?? '').trim();
        if (!suggested) return;
        setDraftSuggestedName(suggested);
      })
      .catch((e: any) => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        console.error('[DroneHub] draft name suggestion failed', {
          provider: llmSettings?.provider?.selected ?? 'openai',
          error: e?.message ?? String(e),
        });
        setDraftNameSuggestionError(e?.message ?? String(e));
        showNameSuggestionFailureToast(e);
      })
      .finally(() => {
        if (!mounted) return;
        if (draftNameSuggestSeqRef.current !== seq) return;
        setDraftNameSuggesting(false);
      });
    return () => {
      mounted = false;
    };
  }, [draftChat?.prompt?.prompt, draftCreateOpen, llmSettings, showNameSuggestionFailureToast]);

  const outputScrollRef = React.useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = React.useRef(true);
  const [pinnedToBottom, setPinnedToBottom] = React.useState(true);
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
      createMode,
      cloneSourceId,
      cloneIncludeChats,
      spawnAgentKey,
      spawnModelForSeed,
      draftChat,
      draftCreateName,
      draftCreateGroup,
      chatHeaderRepoPath,
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

  const { chatUiMode, nowMs, promptError, selectedIsResponding, sendPromptText, sendingPrompt, visiblePendingPromptsWithStartup } =
    useChatRuntimeOrchestration({
      chatInfo,
      currentDrone,
      currentDroneLabel,
      drones,
      outputView,
      optimisticPendingPrompts,
      queuedPromptsByDroneChat,
      queuedPromptsByDroneChatRef,
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
    chatUiModeRef.current = chatUiMode;
  }, [chatUiMode]);

  React.useEffect(() => {
    setStartupSeedByDrone((prev) => {
      const next = { ...prev };
      let changed = false;
      const byId = new Map(drones.map((d) => [d.id, d]));
      const nowMs = Date.now();
      for (const [id, seed] of Object.entries(next)) {
        const summary = byId.get(id);
        if (!summary) {
          if (!isStartupSeedFresh(seed, nowMs)) {
            delete next[id];
            changed = true;
          }
          continue;
        }
        const isStarting = isDroneStartingOrSeeding(summary.hubPhase);
        if (!isStarting && !summary.busy) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [drones]);

  // Auto-scroll on new transcript turns.
  React.useEffect(() => {
    if (chatUiMode !== 'transcript') return;
    const len = (transcripts?.length ?? 0) + visiblePendingPromptsWithStartup.length;
    if (len > 0 && len !== prevChatItemsLenRef.current) {
      prevChatItemsLenRef.current = len;
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [chatUiMode, transcripts, visiblePendingPromptsWithStartup.length]);


  // Auto-scroll on new output.
  React.useEffect(() => {
    if (chatUiMode !== 'cli') return;
    const len = sessionText.length;
    if (len > 0 && len !== prevOutputLenRef.current) {
      prevOutputLenRef.current = len;
      if (pinnedToBottomRef.current) {
        requestAnimationFrame(() => {
          const el = outputScrollRef.current;
          if (!el) return;
          el.scrollTop = el.scrollHeight;
          updatePinned(el);
        });
      }
    }
  }, [sessionText]);

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
    selectedChat,
    requestJson,
    setSelectedGroupMultiChat,
    setGroupBroadcastExpanded,
  });
  const currentDroneRepoAttached = Boolean(currentDrone?.repoAttached ?? Boolean(String(currentDrone?.repoPath ?? '').trim()));
  const currentDroneRepoPath = String(currentDrone?.repoPath ?? '').trim();
  React.useEffect(() => {
    const pending = draftChat?.prompt ?? null;
    const prompt = String(pending?.prompt ?? '').trim();
    if (!pending || !prompt || draftCreating || draftAutoRenaming) return;
    if (!selectedDrone || !currentDrone) return;
    if (chatUiMode === 'cli') {
      setDraftChat(null);
      return;
    }
    const promptInTranscript = Boolean(transcripts?.some((item) => String(item?.prompt ?? '').trim() === prompt));
    const promptInPending = visiblePendingPromptsWithStartup.some((item) => String(item?.prompt ?? '').trim() === prompt);
    if (!promptInTranscript && !promptInPending) return;
    setDraftChat(null);
  }, [
    chatUiMode,
    currentDrone,
    draftAutoRenaming,
    draftChat?.prompt,
    draftCreating,
    selectedDrone,
    transcripts,
    visiblePendingPromptsWithStartup,
  ]);
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
    currentDrone && currentDrone.hubPhase !== 'starting' && currentDrone.hubPhase !== 'seeding'
      ? Boolean(currentDrone.busy) || selectedIsResponding
      : false;
  const showRespondingAsStatusInHeader =
    Boolean(currentDroneBusy) && Boolean(currentDrone?.statusOk) && currentDrone?.hubPhase !== 'error';
  const currentCustomAgentMissing = currentAgent.kind === 'custom' && !customAgents.some((a) => a.id === currentAgent.id);
  const agentDisabled =
    loadingChatInfo ||
    Boolean(openingTerminal) ||
    Boolean(openingEditor) ||
    currentDrone?.hubPhase === 'starting' ||
    currentDrone?.hubPhase === 'seeding';
  const modelControlEnabled = currentAgent.kind === 'builtin';
  const modelDisabled = agentDisabled || !modelControlEnabled;
  const availableChatModels = React.useMemo(() => {
    const map = new Map<string, ChatModelOption>();
    for (const m of chatModels) {
      const id = String(m.id ?? '').trim();
      if (!id) continue;
      map.set(id, m);
    }
    if (currentModel && !map.has(currentModel)) {
      map.set(currentModel, { id: currentModel, label: `${currentModel} (custom)` });
    }
    return Array.from(map.values());
  }, [chatModels, currentModel]);
  const modelMenuEntries = React.useMemo(
    () => [
      { value: '', label: 'Default model' },
      ...availableChatModels.map((m) => ({
        value: m.id,
        label: `${m.label}${m.isDefault ? ' (default)' : ''}${m.isCurrent ? ' (current)' : ''}`,
      })),
    ],
    [availableChatModels]
  );
  const modelLabel = React.useMemo(() => {
    const active = modelMenuEntries.find((entry) => entry.value === (currentModel ?? ''));
    return String(active?.label ?? 'Default model');
  }, [currentModel, modelMenuEntries]);
  const createRepoMenuEntries = React.useMemo(
    () => [
      { value: '', label: 'No repo' },
      ...registeredRepoPaths.map((path) => ({ value: path, label: path, title: path, className: 'font-mono truncate' })),
    ],
    [registeredRepoPaths]
  );
  const spawnAgentMenuEntries = React.useMemo(
    () => [
      ...BUILTIN_AGENT_OPTIONS.map((o) => ({ value: o.key, label: o.label })),
      ...(customAgents.length > 0
        ? [
            { kind: 'separator' as const },
            ...customAgents.map((a) => ({ value: `custom:${a.id}`, label: `Custom: ${a.label}` })),
          ]
        : []),
    ],
    [customAgents]
  );
  const spawnAgentLabel = React.useMemo(() => {
    const builtin = BUILTIN_AGENT_OPTIONS.find((o) => o.key === spawnAgentKey);
    if (builtin) return builtin.label;
    if (spawnAgentKey.startsWith('custom:')) {
      const id = spawnAgentKey.slice('custom:'.length);
      const custom = customAgents.find((a) => a.id === id);
      if (custom) return `Custom: ${custom.label}`;
    }
    return 'Agent';
  }, [customAgents, spawnAgentKey]);
  const toolbarAgentMenuEntries = React.useMemo(() => {
    const entries: Array<
      | { value: string; label: string; title?: string; inactiveClassName?: string }
      | { kind: 'separator' }
    > = [...builtinAgentOptions.map((o) => ({ value: o.key, label: o.label }))];
    entries.push({ kind: 'separator' });
    if (currentCustomAgentMissing && currentAgent.kind === 'custom') {
      entries.push({
        value: `custom:${currentAgent.id}`,
        label: `Custom: ${currentAgent.label}`,
        title: 'This custom agent is configured on the drone but not saved locally.',
      });
    }
    for (const a of customAgents) {
      entries.push({ value: `custom:${a.id}`, label: `Custom: ${a.label}` });
    }
    entries.push({ kind: 'separator' });
    entries.push({
      value: '__add_custom__',
      label: 'Add custom...',
      inactiveClassName: 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]',
    });
    return entries;
  }, [builtinAgentOptions, currentAgent, currentCustomAgentMissing, customAgents]);
  const agentLabel = (() => {
    const builtin = builtinAgentOptions.find((o) => o.key === currentAgentKey);
    if (builtin) return builtin.label;
    if (currentAgent.kind === 'custom') return `Custom: ${currentAgent.label}`;
    return currentAgentKey;
  })();

  function pickAgentValue(v: string) {
    if (v === '__add_custom__') {
      setCustomAgentError(null);
      setNewCustomAgentLabel('');
      setNewCustomAgentCommand('');
      setCustomAgentModalOpen(true);
      return;
    }
    const builtin = builtinAgentOptions.find((o) => o.key === v);
    if (builtin) {
      void setChatAgent(builtin.agent).catch((err: any) => handleSetAgentFailure('[DroneHub] set agent failed', err));
      return;
    }
    if (v.startsWith('custom:')) {
      const id = v.slice('custom:'.length);
      const local = customAgents.find((a) => a.id === id) ?? null;
      const fallback = currentAgent?.kind === 'custom' && currentAgent.id === id ? currentAgent : null;
      const agent: ChatAgentConfig | null = local
        ? { kind: 'custom', id: local.id, label: local.label, command: local.command }
        : fallback
          ? fallback
          : null;
      if (agent) {
        void setChatAgent(agent).catch((err: any) => handleSetAgentFailure('[DroneHub] set custom agent failed', err));
      }
    }
  }

  function applyManualChatModel() {
    if (modelDisabled) return;
    const next = String(manualChatModelInput ?? '').trim();
    void setChatModel(next || null).catch((err: any) => {
      const msg = err?.message ?? String(err);
      setChatInfoError(msg);
    });
  }

  const renderRightPanelTabContent = React.useCallback(
    (drone: DroneSummary, tab: RightPanelTab, paneKey: 'top' | 'bottom' | 'single'): React.ReactNode => (
      <RightPanelTabContent
        drone={drone}
        tab={tab}
        paneKey={paneKey}
        selectedChat={selectedChat}
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
      />
    ),
    [
      agentLabel,
      currentDrone?.id,
      currentFsPath,
      currentPortReachability,
      defaultFsPathForCurrentDrone,
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
      setSelectedPreviewPort,
      setSelectedPreviewUrlOverride,
      uiDroneName,
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

  return (
    <div className="flex h-screen overflow-hidden fixed inset-0">
      <DroneSidebar
        dronesError={dronesError}
        groupMoveError={groupMoveError}
        dronesLoading={dronesLoading}
        sidebarDronesFilteredByRepo={sidebarDronesFilteredByRepo}
        sidebarDrones={sidebarDrones}
        sidebarOptimisticDroneIdSet={sidebarOptimisticDroneIdSet}
        selectedDroneSet={selectedDroneSet}
        selectedIsResponding={selectedIsResponding}
        deletingDrones={deletingDrones}
        renamingDrones={renamingDrones}
        movingDroneGroups={movingDroneGroups}
        createGroupDraft={createGroupDraft}
        createGroupError={createGroupError}
        creatingGroup={creatingGroup}
        sidebarGroups={sidebarGroups}
        collapsedGroups={collapsedGroups}
        deletingGroups={deletingGroups}
        renamingGroups={renamingGroups}
        dragOverGroup={dragOverGroup}
        sidebarHasUngroupedGroup={sidebarHasUngroupedGroup}
        draggingDroneNames={draggingDroneNames}
        dragOverUngrouped={dragOverUngrouped}
        repos={repos}
        reposLoading={reposLoading}
        reposError={reposError}
        dronesCount={drones.length}
        droneCountByRepoPath={droneCountByRepoPath}
        uiDroneName={uiDroneName}
        onOpenDraftChatComposer={openDraftChatComposer}
        onOpenCreateModal={openCreateModal}
        onSelectDroneCard={selectDroneCard}
        onOpenCloneModal={openCloneModal}
        onRenameDrone={renameDrone}
        onDeleteDrone={deleteDrone}
        onOpenDroneErrorModal={openDroneErrorModal}
        onUngroupedDragOver={onUngroupedDragOver}
        onUngroupedDragLeave={onUngroupedDragLeave}
        onUngroupedDrop={onUngroupedDrop}
        onCreateGroupFromDraft={() => {
          void createGroupFromDraft();
        }}
        onCreateGroupDraftChange={(value) => {
          setCreateGroupDraft(value);
          if (createGroupError) setCreateGroupError(null);
        }}
        onGroupDragOver={onGroupDragOver}
        onGroupDragLeave={onGroupDragLeave}
        onGroupDrop={onGroupDrop}
        onToggleGroupCollapsed={(group) =>
          setCollapsedGroups((prev) => ({
            ...prev,
            [group]: !prev[group],
          }))
        }
        onRenameGroup={(group) => {
          void renameGroup(group);
        }}
        onOpenGroupMultiChat={(group) => {
          setAppView('workspace');
          setDraftChat(null);
          setDraftCreateOpen(false);
          setDraftCreateError(null);
          setSelectedGroupMultiChat(group);
        }}
        onDeleteGroup={(group, count) => {
          void deleteGroup(group, count);
        }}
        onDroneDragStart={onDroneDragStart}
        onDroneDragEnd={onDroneDragEnd}
        onOpenReposModal={() => setReposModalOpen(true)}
      />
      <DroneHubOverlays
        createDronesModalProps={{
          open: createOpen,
          creating,
          createMode,
          cloneSourceId,
          createNameEntries,
          drones,
          createError,
          createGroup,
          onCreateGroupChange: setCreateGroup,
          onClearCreateGroup: () => setCreateGroup(''),
          createRepoPath,
          onCreateRepoPathChange: setCreateRepoPath,
          onClearCreateRepoPath: () => setCreateRepoPath(''),
          createRepoMenuEntries,
          createRepoMenuOpen,
          onCreateRepoMenuOpenChange: setCreateRepoMenuOpen,
          registeredRepoPaths,
          activeRepoPath,
          cloneIncludeChats,
          onCloneIncludeChatsChange: setCloneIncludeChats,
          spawnAgentKey,
          onSpawnAgentKeyChange: setSpawnAgentKey,
          spawnAgentMenuEntries,
          onOpenCustomAgentModal: () => setCustomAgentModalOpen(true),
          spawnModel,
          onSpawnModelChange: setSpawnModel,
          onClearSpawnModel: () => setSpawnModel(''),
          spawnAgentConfig,
          createInitialMessage,
          onCreateInitialMessageChange: setCreateInitialMessage,
          onClearCreateInitialMessage: () => setCreateInitialMessage(''),
          createNameRows,
          createMessageSuffixRows,
          createNameCounts,
          onAppendCreateNameRow: appendCreateNameRow,
          onUpdateCreateNameRow: updateCreateNameRow,
          onUpdateCreateMessageSuffixRow: updateCreateMessageSuffixRow,
          onRemoveCreateNameRow: removeCreateNameRow,
          createNameRef,
          onSubmitCreate: () => {
            void createDrone();
          },
          onRequestClose: () => {
            setCreateOpen(false);
          },
        }}
        draftCreateDroneModalProps={{
          open: draftCreateOpen,
          draftCreating,
          draftCreateError,
          draftCreateName,
          onDraftCreateNameChange: setDraftCreateName,
          draftCreateNameRef,
          draftNameSuggesting,
          draftSuggestedName,
          onUseSuggestedName: () => setDraftCreateName(draftSuggestedName),
          draftNameSuggestionError,
          draftCreateGroup,
          onDraftCreateGroupChange: setDraftCreateGroup,
          onSubmit: () => {
            void createDroneFromDraft();
          },
          onRequestClose: () => setDraftCreateOpen(false),
        }}
        customAgentsModalProps={{
          open: customAgentModalOpen,
          customAgentError,
          customAgents,
          newCustomAgentLabel,
          onNewCustomAgentLabelChange: setNewCustomAgentLabel,
          newCustomAgentCommand,
          onNewCustomAgentCommandChange: setNewCustomAgentCommand,
          onDeleteCustomAgent: (id) => setCustomAgents((prev) => prev.filter((x) => x.id !== id)),
          onAddCustomAgent: handleAddCustomAgent,
          onRequestClose: () => setCustomAgentModalOpen(false),
        }}
        hubTransientToastsProps={{
          nameSuggestToast,
          jobsModalError,
          jobsModalOpen: Boolean(jobsModal),
          onDismissNameSuggestToast: () => setNameSuggestToast(null),
        }}
        createFromAgentMessageModalProps={{
          jobsModal,
          builtinAgentOptions: BUILTIN_AGENT_OPTIONS,
          customAgents,
          spawningAllJobs,
          spawningJobById,
          spawnedJobById,
          spawnJobErrorById,
          detailsOpenByJobId,
          isValidDroneName: isValidDroneNameDashCase,
          onClose: closeJobsModal,
          onSpawnAll: spawnAllFromJobsModal,
          onSpawnOne: spawnOneFromJobsModal,
          onSpawnJob: spawnJobFromModal,
          onOpenCustomAgents: () => setCustomAgentModalOpen(true),
          onChangeGroup: onChangeJobsGroup,
          onClearGroup: onClearJobsGroup,
          onChangeAgentKey: onChangeJobsAgentKey,
          onChangePrefix: onChangeJobsPrefix,
          onClearPrefix: onClearJobsPrefix,
          onUpdateJob: onUpdateJobsModalJob,
          onToggleDetails: onToggleJobsModalDetails,
        }}
        reposModalProps={
          reposModalOpen
            ? {
                repos,
                reposError,
                reposLoading,
                activeRepoPath,
                deletingRepos,
                onClose: () => setReposModalOpen(false),
                onToggleActiveRepoPath: (path) => setActiveRepoPath((prev) => (prev === path ? '' : path)),
                onDeleteRepo: (path) => {
                  void deleteRepo(path);
                },
                getGithubUrlForRepo: githubUrlForRepo,
              }
            : null
        }
        droneErrorModalProps={
          droneErrorModal
            ? {
                droneErrorModal,
                clearingDroneError,
                onClose: closeDroneErrorModal,
                onClearDroneHubError: (droneId) => {
                  void clearDroneHubError(droneId);
                },
              }
            : null
        }
      />

      <DroneHubWorkspaceContent
        appView={appView}
        settingsViewProps={{
          llm: llmSettingsState,
          hubLogsState,
          hubLogsTailLines: HUB_LOGS_TAIL_LINES,
          hubLogsMaxBytes: HUB_LOGS_MAX_BYTES,
          onBackToWorkspace: () => setAppView('workspace'),
          onReplayOnboarding: () => {
            setAppView('workspace');
            requestGuidedOnboardingReplay();
          },
          onResetOnboarding: () => {
            resetGuidedOnboardingDismissals();
          },
        }}
        draftChatWorkspaceProps={
          draftChat
            ? {
                draftChat,
                nowMs,
                spawnAgentMenuEntries,
                draftCreating,
                draftAutoRenaming,
                spawnAgentConfig,
                createRepoMenuEntries,
                draftCreateError,
                queuedPromptsByDroneChat,
                onCancel: () => {
                  setDraftChat(null);
                  setDraftCreateOpen(false);
                  setDraftCreateError(null);
                  setDraftAutoRenaming(false);
                },
                onStartDraftPrompt: startDraftPrompt,
                onEnqueueQueuedPrompt: enqueueQueuedPrompt,
                onSetDraftCreateError: setDraftCreateError,
              }
            : null
        }
        groupMultiChatWorkspaceProps={
          selectedGroupMultiChatData
            ? {
                selectedGroupMultiChatData,
                groupBroadcastPromptError,
                groupBroadcastSending,
                onSendGroupBroadcastPrompt: sendGroupBroadcastPrompt,
                nowMs,
                uiDroneName,
                onSelectDroneCard: selectDroneCard,
                onParseJobsFromAgentMessage: parseJobsFromAgentMessage,
              }
            : null
        }
        noDroneSelectedStateProps={{
          dronesLoading,
          sidebarDroneCount: sidebarDrones.length,
          dronesError,
          onOpenDraftChatComposer: openDraftChatComposer,
          onOpenCreateModal: openCreateModal,
        }}
        selectedDroneWorkspaceProps={
          currentDrone
            ? {
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
                rightPanelWidth,
                rightPanelWidthMax,
                rightPanelMinWidth: RIGHT_PANEL_MIN_WIDTH_PX,
                rightPanelResizing,
                rightPanelBottomTab,
                setRightPanelBottomTab,
                startRightPanelResize,
                renderRightPanelTabContent,
              }
            : null
        }
      />
      <GuidedOnboarding />
    </div>
  );
}
