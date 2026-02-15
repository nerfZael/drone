import React from 'react';
import {
  type ChatAgentConfig,
  type ChatInfo,
  isUngroupedGroupName,
  isValidDroneNameDashCase,
  normalizeChatInfoPayload,
  stripAnsi,
} from './domain';
import {
  ChatInput,
  type ChatSendPayload,
  EmptyState,
} from './droneHub/chat';
import { requestJson } from './droneHub/http';
import { GuidedOnboarding } from './onboarding/GuidedOnboarding';
import { requestGuidedOnboardingReplay, resetGuidedOnboardingDismissals } from './onboarding/control';
import { usePaneReadiness } from './droneHub/panes/usePaneReadiness';
import { copyText } from './droneHub/app/clipboard';
import {
  BUILTIN_AGENT_OPTIONS,
  FS_EXPLORER_VIEW_STORAGE_KEY,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY,
  HUB_LOGS_MAX_BYTES,
  HUB_LOGS_TAIL_LINES,
  PORT_PREVIEW_STORAGE_KEY,
  PORT_STATUS_POLL_INTERVAL_MS,
  PORT_STATUS_TIMEOUT_MS,
  PREVIEW_URL_STORAGE_KEY,
  RIGHT_PANEL_MIN_WIDTH_PX,
  RIGHT_PANEL_TAB_LABELS,
  RIGHT_PANEL_TABS,
  SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY,
  STARTUP_SEED_MISSING_GRACE_MS,
  clampGroupMultiChatColumnWidthPx,
  isStartupSeedFresh,
  type RightPanelTab,
} from './droneHub/app/app-config';
import { DroneSidebar } from './droneHub/app/DroneSidebar';
import { DroneHubOverlays } from './droneHub/app/DroneHubOverlays';
import { DroneHubWorkspaceContent } from './droneHub/app/DroneHubWorkspaceContent';
import { RightPanelTabContent } from './droneHub/app/RightPanelTabContent';
import type {
  AppView,
  ChatModelOption,
  DraftChatState,
  DroneErrorModalState,
  StartupSeedState,
  TldrState,
} from './droneHub/app/app-types';
import { useHubLogs } from './droneHub/app/use-hub-logs';
import { useCreateDroneRowsState } from './droneHub/app/use-create-drone-rows-state';
import { useCreateDraftWorkflowState } from './droneHub/app/use-create-draft-workflow-store';
import { useChatRuntimeOrchestration } from './droneHub/app/use-chat-runtime-orchestration';
import { useDroneGroupDnd } from './droneHub/app/use-drone-group-dnd';
import { useGroupManagement } from './droneHub/app/use-group-management';
import { useJobsWorkflow } from './droneHub/app/use-jobs-workflow';
import { useLlmSettings } from './droneHub/app/use-llm-settings';
import { useQueuedPromptsState } from './droneHub/app/use-queued-prompts-state';
import { useRightPanelLayout } from './droneHub/app/use-right-panel-layout';
import { useSidebarViewModel } from './droneHub/app/use-sidebar-view-model';
import { useWorkspaceActions } from './droneHub/app/use-workspace-actions';
import {
  fetchJson,
  isNotFoundError,
  probeLocalhostPort,
  readLocalStorageItem,
  usePersistedLocalStorageItem,
  usePoll,
} from './droneHub/app/hooks';
import {
  buildContainerPreviewUrl,
  compareDronesByNewestFirst,
  droneHomePath,
  isDroneStartingOrSeeding,
  makeId,
  normalizeContainerPathInput,
  normalizePortRows,
  normalizePreviewUrl,
  parseRepoPullConflict,
  readPortPreviewByDrone,
  readPreviewUrlByDrone,
  resolveChatNameForDrone,
  rewriteLoopbackUrlToContainerPreview,
  sameReachabilityMap,
  type RepoOpErrorMeta,
} from './droneHub/app/helpers';
import { droneNameHasWhitespace, normalizeDraftDroneName } from './droneHub/app/name-helpers';
import { cn } from './ui/cn';
import { useDropdownDismiss } from './ui/dropdown';
import type {
  CustomAgentProfile,
  DroneFsEntry,
  DroneFsListPayload,
  DronePortMapping,
  DronePortsPayload,
  DroneSummary,
  PendingPrompt,
  PortPreviewByDrone,
  PortReachabilityByDrone,
  PortReachabilityByHostPort,
  PreviewUrlByDrone,
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

  const [activeRepoPath, setActiveRepoPath] = React.useState<string>(() => readLocalStorageItem('droneHub.activeRepoPath') || '');
  usePersistedLocalStorageItem('droneHub.activeRepoPath', activeRepoPath || '');

  React.useEffect(() => {
    if (!activeRepoPath) return;
    const exists = repos.some((r) => String(r?.path ?? '').trim() === activeRepoPath);
    if (!exists) setActiveRepoPath('');
  }, [repos, activeRepoPath]);

  const [chatHeaderRepoPath, setChatHeaderRepoPath] = React.useState<string>(() => {
    const saved = String(readLocalStorageItem('droneHub.chatHeaderRepoPath') ?? '').trim();
    if (saved) return saved;
    const fallback = String(activeRepoPath ?? '').trim();
    return fallback || '';
  });
  usePersistedLocalStorageItem('droneHub.chatHeaderRepoPath', chatHeaderRepoPath || '');

  React.useEffect(() => {
    // If a previously-saved repo path was removed from the registry, drop back to "No repo".
    setChatHeaderRepoPath((prev) => {
      const p = String(prev ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    });
  }, [registeredRepoPathSet]);

  const [sidebarReposCollapsed, setSidebarReposCollapsed] = React.useState<boolean>(() => readLocalStorageItem(SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY) === '1');
  usePersistedLocalStorageItem(SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY, sidebarReposCollapsed ? '1' : '0');

  const [appView, setAppView] = React.useState<AppView>(() => (readLocalStorageItem('droneHub.appView') === 'settings' ? 'settings' : 'workspace'));
  usePersistedLocalStorageItem('droneHub.appView', appView);

  const [viewMode, setViewMode] = React.useState<'grouped' | 'flat'>(() => (readLocalStorageItem('droneHub.viewMode') === 'flat' ? 'flat' : 'grouped'));

  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>(() => {
    const raw = readLocalStorageItem('droneHub.collapsedGroups');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });

  const [autoDelete, setAutoDelete] = React.useState<boolean>(() => readLocalStorageItem('droneHub.autoDelete') === '1');

  const [terminalEmulator, setTerminalEmulator] = React.useState<string>(() => readLocalStorageItem('droneHub.terminalEmulator') || 'auto');
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
  const [selectedDrone, setSelectedDrone] = React.useState<string | null>(null);
  const [selectedDroneIds, setSelectedDroneIds] = React.useState<string[]>([]);
  const [selectedGroupMultiChat, setSelectedGroupMultiChat] = React.useState<string | null>(null);
  const [groupBroadcastPromptError, setGroupBroadcastPromptError] = React.useState<string | null>(null);
  const [groupBroadcastSendingCount, setGroupBroadcastSendingCount] = React.useState(0);
  const groupBroadcastSending = groupBroadcastSendingCount > 0;
  const [groupBroadcastExpanded, setGroupBroadcastExpanded] = React.useState(false);
  const [groupMultiChatColumnWidth, setGroupMultiChatColumnWidth] = React.useState<number>(() => {
    const saved = Number(readLocalStorageItem(GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) return clampGroupMultiChatColumnWidthPx(saved);
    return GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX;
  });
  usePersistedLocalStorageItem(GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY, String(groupMultiChatColumnWidth));
  const [selectedChat, setSelectedChat] = React.useState<string>('default');
  // Keyed by drone id.
  const [startupSeedByDrone, setStartupSeedByDrone] = React.useState<Record<string, StartupSeedState>>({});
  const [draftChat, setDraftChat] = React.useState<DraftChatState | null>(null);
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
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
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
  const [reposModalOpen, setReposModalOpen] = React.useState(false);
  const [droneErrorModal, setDroneErrorModal] = React.useState<DroneErrorModalState | null>(null);
  const [clearingDroneError, setClearingDroneError] = React.useState(false);
  const [headerOverflowOpen, setHeaderOverflowOpen] = React.useState(false);
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

  const [chatInfo, setChatInfo] = React.useState<ChatInfo | null>(null);
  const [chatInfoError, setChatInfoError] = React.useState<string | null>(null);
  const [loadingChatInfo, setLoadingChatInfo] = React.useState(false);
  const [chatModels, setChatModels] = React.useState<ChatModelOption[]>([]);
  const [chatModelsSource, setChatModelsSource] = React.useState<'live' | 'cache' | 'none'>('none');
  const [chatModelsDiscoveredAt, setChatModelsDiscoveredAt] = React.useState<string | null>(null);
  const [chatModelsError, setChatModelsError] = React.useState<string | null>(null);
  const [loadingChatModels, setLoadingChatModels] = React.useState(false);
  const [chatModelsRefreshNonce, setChatModelsRefreshNonce] = React.useState(0);
  const chatModelsRefreshHandledRef = React.useRef(0);
  const [manualChatModelInput, setManualChatModelInput] = React.useState('');
  const chatModelDiscoveryAgentId: 'cursor' | 'codex' | 'claude' | 'opencode' | null =
    chatInfo?.agent?.kind === 'builtin' ? chatInfo.agent.id : null;

  const [customAgents, setCustomAgents] = React.useState<CustomAgentProfile[]>(() => {
    const raw = readLocalStorageItem('droneHub.customAgents');
    try {
      const parsed = raw ? (JSON.parse(raw) as any) : [];
      return Array.isArray(parsed)
        ? parsed
            .map((x) => ({
              id: String(x?.id ?? '').trim(),
              label: String(x?.label ?? '').trim(),
              command: String(x?.command ?? '').trim(),
            }))
            .filter((x) => x.id && x.label && x.command)
        : [];
    } catch {
      return [];
    }
  });
  const [customAgentModalOpen, setCustomAgentModalOpen] = React.useState(false);
  const [newCustomAgentLabel, setNewCustomAgentLabel] = React.useState('');
  const [newCustomAgentCommand, setNewCustomAgentCommand] = React.useState('');
  const [customAgentError, setCustomAgentError] = React.useState<string | null>(null);

  const [transcripts, setTranscripts] = React.useState<TranscriptItem[] | null>(null);
  const [transcriptError, setTranscriptError] = React.useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = React.useState(false);
  const transcriptsRef = React.useRef<TranscriptItem[] | null>(null);
  const transcriptErrorRef = React.useRef<string | null>(null);
  const chatEndRef = React.useRef<HTMLDivElement | null>(null);
  const [optimisticPendingPrompts, setOptimisticPendingPrompts] = React.useState<PendingPrompt[]>([]);

  const [tldrByMessageId, setTldrByMessageId] = React.useState<Record<string, TldrState>>({});
  const tldrByMessageIdRef = React.useRef<Record<string, TldrState>>({});
  const [showTldrByMessageId, setShowTldrByMessageId] = React.useState<Record<string, boolean>>({});
  const showTldrByMessageIdRef = React.useRef<Record<string, boolean>>({});
  const [hoveredAgentMessageId, setHoveredAgentMessageId] = React.useState<string | null>(null);
  const hoveredAgentMessageIdRef = React.useRef<string | null>(null);
  const chatUiModeRef = React.useRef<'transcript' | 'cli'>('transcript');
  const prevChatItemsLenRef = React.useRef(0);

  const [sessionText, setSessionText] = React.useState<string>('');
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [loadingSession, setLoadingSession] = React.useState(false);
  const [outputView, setOutputView] = React.useState<'screen' | 'log'>(() => (readLocalStorageItem('droneHub.outputView') === 'log' ? 'log' : 'screen'));
  const [fsExplorerView, setFsExplorerView] = React.useState<'list' | 'thumb'>(() => (readLocalStorageItem(FS_EXPLORER_VIEW_STORAGE_KEY) === 'thumb' ? 'thumb' : 'list'));
  const [fsPathByDrone, setFsPathByDrone] = React.useState<Record<string, string>>({});
  const [fsRefreshNonce, setFsRefreshNonce] = React.useState(0);

  React.useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  React.useEffect(() => {
    transcriptErrorRef.current = transcriptError;
  }, [transcriptError]);

  React.useEffect(() => {
    tldrByMessageIdRef.current = tldrByMessageId;
  }, [tldrByMessageId]);

  React.useEffect(() => {
    showTldrByMessageIdRef.current = showTldrByMessageId;
  }, [showTldrByMessageId]);

  React.useEffect(() => {
    hoveredAgentMessageIdRef.current = hoveredAgentMessageId;
  }, [hoveredAgentMessageId]);

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

  const [spawnAgentKey, setSpawnAgentKey] = React.useState<string>(() => readLocalStorageItem('droneHub.spawnAgent') || 'builtin:cursor');
  usePersistedLocalStorageItem('droneHub.spawnAgent', spawnAgentKey);

  const [spawnModel, setSpawnModel] = React.useState<string>(() => readLocalStorageItem('droneHub.spawnModel') || '');
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

  const transcriptMessageId = React.useCallback((t: TranscriptItem): string => {
    const explicit = typeof t?.id === 'string' ? t.id.trim() : '';
    if (explicit) return explicit;
    const session = String(t?.session ?? '').trim() || 'session';
    const turn = String(t?.turn ?? '');
    const iso = String(t?.completedAt ?? t?.at ?? '').trim() || 'at';
    return `${session}:${turn}:${iso}`;
  }, []);

  const cleanedAgentTextForTldr = React.useCallback((t: TranscriptItem): string => {
    return stripAnsi(t.ok ? t.output : t.error || 'failed');
  }, []);

  const cleanedPromptTextForTldr = React.useCallback((t: TranscriptItem): string => {
    return stripAnsi(t.prompt ?? '');
  }, []);

  const requestTldrForAgentMessage = React.useCallback(
    async (target: TranscriptItem) => {
      const messageId = transcriptMessageId(target);
      const existing = tldrByMessageIdRef.current?.[messageId] ?? null;
      if (existing?.status === 'loading' || existing?.status === 'ready') return;

      const clip = (s: string, max: number) => {
        const text = String(s ?? '').trim();
        if (!text) return '';
        return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
      };

      const list = transcriptsRef.current ?? [];
      let idx = list.findIndex((x) => transcriptMessageId(x) === messageId);
      if (idx < 0) idx = list.findIndex((x) => x.session === target.session && x.turn === target.turn);
      const end = idx >= 0 ? idx + 1 : list.length;
      const start = Math.max(0, end - 3);
      const slice = list.length > 0 ? list.slice(start, end) : [target];

      const context = slice.map((t) => ({
        turn: t.turn,
        prompt: clip(cleanedPromptTextForTldr(t), 2200),
        response: clip(cleanedAgentTextForTldr(t), 5200),
      }));

      setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'loading' } }));
      try {
        const data = await requestJson<{ ok: true; tldr: string }>(`/api/tldr/from-message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: clip(cleanedPromptTextForTldr(target), 6000),
            response: clip(cleanedAgentTextForTldr(target), 14_000),
            context,
          }),
        });
        const tldr = String((data as any)?.tldr ?? '').trim();
        if (!tldr) throw new Error('Empty TLDR response.');
        setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'ready', summary: tldr } }));
      } catch (e: any) {
        setTldrByMessageId((prev) => ({ ...prev, [messageId]: { status: 'error', error: e?.message ?? String(e) } }));
      }
    },
    [cleanedAgentTextForTldr, cleanedPromptTextForTldr, transcriptMessageId],
  );

  const toggleTldrForAgentMessage = React.useCallback(
    (target: TranscriptItem) => {
      const messageId = transcriptMessageId(target);
      const cur = Boolean(showTldrByMessageIdRef.current?.[messageId]);
      const next = !cur;
      setShowTldrByMessageId((prev) => ({ ...prev, [messageId]: next }));
      if (next) void requestTldrForAgentMessage(target);
    },
    [requestTldrForAgentMessage, transcriptMessageId],
  );

  const handleAgentMessageHover = React.useCallback(
    (t: TranscriptItem | null) => {
      setHoveredAgentMessageId(t ? transcriptMessageId(t) : null);
    },
    [transcriptMessageId],
  );

  const toggleTldrFromShortcut = React.useCallback(() => {
    if (chatUiModeRef.current !== 'transcript') return;
    const list = transcriptsRef.current ?? [];
    if (list.length === 0) return;
    const hoveredId = hoveredAgentMessageIdRef.current;
    const target = hoveredId ? list.find((t) => transcriptMessageId(t) === hoveredId) ?? null : null;
    const chosen = target ?? list[list.length - 1];
    toggleTldrForAgentMessage(chosen);
  }, [toggleTldrForAgentMessage, transcriptMessageId]);

  React.useEffect(() => {
    if (!selectedDrone || !selectedChat) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    const summary = drones.find((d) => d.id === selectedDrone) ?? null;
    if (isDroneStartingOrSeeding(summary?.hubPhase)) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    // Avoid 404 spam: don't fetch chat info until the chat exists on this drone.
    if (summary && Array.isArray(summary.chats) && !summary.chats.includes(selectedChat)) {
      setChatInfo(null);
      setChatInfoError(null);
      setLoadingChatInfo(false);
      return;
    }
    let mounted = true;
    setLoadingChatInfo(true);
    setChatInfoError(null);
    fetchJson<any>(`/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}`)
      .then((data) => {
        if (!mounted) return;
        setChatInfo(normalizeChatInfoPayload(data));
        setChatInfoError(null);
      })
      .catch((e: any) => {
        if (!mounted) return;
        const msg = e?.message ?? String(e);
        setChatInfo(null);
        setChatInfoError(isNotFoundError(e) ? null : msg);
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingChatInfo(false);
      });
    return () => {
      mounted = false;
    };
  }, [drones, selectedDrone, selectedChat]);

  React.useEffect(() => {
    setManualChatModelInput(chatInfo?.model ?? '');
  }, [chatInfo?.model, selectedDrone, selectedChat]);

  React.useEffect(() => {
    if (!selectedDrone || !selectedChat || !chatModelDiscoveryAgentId) {
      setChatModels([]);
      setChatModelsSource('none');
      setChatModelsDiscoveredAt(null);
      setChatModelsError(null);
      setLoadingChatModels(false);
      return;
    }

    let mounted = true;
    const forceRefresh = chatModelsRefreshNonce > chatModelsRefreshHandledRef.current;
    if (forceRefresh) chatModelsRefreshHandledRef.current = chatModelsRefreshNonce;
    setLoadingChatModels(true);
    setChatModelsError(null);
    fetchJson<any>(
      `/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(selectedChat)}/models?refresh=${
        forceRefresh ? '1' : '0'
      }`,
    )
      .then((data) => {
        if (!mounted) return;
        const listRaw = Array.isArray(data?.models) ? data.models : [];
        const list: ChatModelOption[] = listRaw
          .map((x: any): ChatModelOption => ({
            id: String(x?.id ?? '').trim(),
            label: String(x?.label ?? '').trim() || String(x?.id ?? '').trim(),
            ...(x?.isDefault ? { isDefault: true } : {}),
            ...(x?.isCurrent ? { isCurrent: true } : {}),
          }))
          .filter((x: ChatModelOption) => x.id);
        setChatModels(list);
        const source = String(data?.source ?? 'none').toLowerCase();
        setChatModelsSource(source === 'live' || source === 'cache' ? source : 'none');
        const discoveredAt = String(data?.discoveredAt ?? '').trim();
        setChatModelsDiscoveredAt(discoveredAt || null);
        const discoveredError = String(data?.error ?? '').trim();
        setChatModelsError(discoveredError || null);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setChatModels([]);
        setChatModelsSource('none');
        setChatModelsDiscoveredAt(null);
        setChatModelsError(e?.message ?? String(e));
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingChatModels(false);
      });
    return () => {
      mounted = false;
    };
  }, [chatModelDiscoveryAgentId, chatModelsRefreshNonce, selectedChat, selectedDrone]);

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
  const [deletingDrones, setDeletingDrones] = React.useState<Record<string, boolean>>({});
  const [renamingDrones, setRenamingDrones] = React.useState<Record<string, boolean>>({});
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
  const [nameSuggestToast, setNameSuggestToast] = React.useState<null | { id: string; message: string }>(null);
  const [terminalMenuOpen, setTerminalMenuOpen] = React.useState(false);
  const terminalMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = React.useState(false);

  const showNameSuggestionFailureToast = React.useCallback((error: unknown) => {
    const msg = String((error as any)?.message ?? error ?? '').trim();
    const id = makeId();
    setNameSuggestToast({ id, message: msg || 'Name suggestion failed.' });
    window.setTimeout(() => {
      setNameSuggestToast((cur) => (cur?.id === id ? null : cur));
    }, 6000);
  }, []);

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

  function uniqueDraftDroneName(baseRaw: string, opts?: { exclude?: string; extraTaken?: Iterable<string> }): string {
    const exclude = String(opts?.exclude ?? '').trim().toLowerCase();
    const taken = new Set<string>();
    for (const d of drones) {
      const name = String(d?.name ?? '').trim().toLowerCase();
      if (!name || name === exclude) continue;
      taken.add(name);
    }
    for (const nameRaw of Object.keys(startupSeedByDrone)) {
      const name = String(nameRaw ?? '').trim().toLowerCase();
      if (!name || name === exclude) continue;
      taken.add(name);
    }
    if (opts?.extraTaken) {
      for (const raw of opts.extraTaken) {
        const name = String(raw ?? '').trim().toLowerCase();
        if (!name || name === exclude) continue;
        taken.add(name);
      }
    }
    const base = normalizeDraftDroneName(baseRaw) || 'untitled';
    if (!taken.has(base)) return base;
    let i = 2;
    while (i < 10_000) {
      const suffix = `-${i}`;
      const maxBaseLen = Math.max(1, 48 - suffix.length);
      const prefix = (base.slice(0, maxBaseLen).replace(/-+$/g, '') || 'untitled').slice(0, maxBaseLen);
      const candidate = `${prefix}${suffix}`;
      if (!taken.has(candidate)) return candidate;
      i += 1;
    }
    return `untitled-${Date.now().toString(36).slice(-6)}`;
  }

  const openCreateModal = React.useCallback(() => {
    if (creating) return;
    setAppView('workspace');
    setDraftChat(null);
    setDraftCreateOpen(false);
    setDraftCreateError(null);
    setCreateError(null);
    if (createMode === 'clone') {
      setCreateName('');
      setCreateGroup('');
      setCreateRepoPath('');
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
      setCloneIncludeChats(true);
    }
    setCreateMode('create');
    setCloneSourceId(null);
    setCreateRepoPath(normalizeCreateRepoPath(activeRepoPath || ''));
    setCreateInitialMessage('');
    setCreateMessageSuffixRows(['']);
    setCreateOpen(true);
  }, [activeRepoPath, createMode, creating, normalizeCreateRepoPath]);

  const openDraftChatComposer = React.useCallback(() => {
    const activeRepo = String(activeRepoPath ?? '').trim();
    if (activeRepo) setChatHeaderRepoPath(activeRepo);
    setAppView('workspace');
    setCreateOpen(false);
    setCreateError(null);
    setDraftCreateOpen(false);
    setDraftCreateName('');
    setDraftCreateGroup('');
    setDraftCreateError(null);
    setDraftAutoRenaming(false);
    setDraftNameSuggestionError(null);
    setDraftNameSuggesting(false);
    draftNameSuggestSeqRef.current = 0;
    setDraftChat({ droneId: '', droneName: '', prompt: null });
    setSelectedDrone(null);
    setSelectedDroneIds([]);
    selectionAnchorRef.current = null;
    preferredSelectedDroneRef.current = null;
    preferredSelectedDroneHoldUntilRef.current = 0;
    setSelectedChat('default');
  }, [activeRepoPath]);

  const openCloneModal = React.useCallback(
    (source: DroneSummary) => {
      if (creating || deletingDrones[source.id] || renamingDrones[source.id]) return;
      setAppView('workspace');
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      setCreateError(null);
      setCreateMode('clone');
      setCloneSourceId(source.id);
      setCreateName(suggestCloneName(source.name));
      setCreateGroup(source.group ?? '');
      setCreateRepoPath(
        normalizeCreateRepoPath(
          source && (source.repoAttached ?? Boolean(String(source.repoPath ?? '').trim())) ? source.repoPath : '',
        ),
      );
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
      setCloneIncludeChats(true);
      setCreateOpen(true);
    },
    [creating, deletingDrones, normalizeCreateRepoPath, renamingDrones, suggestCloneName],
  );

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

  function shouldConfirmDelete(): boolean {
    return !autoDelete;
  }

  function closeDroneErrorModal() {
    setDroneErrorModal(null);
  }

  function openDroneErrorModal(drone: Pick<DroneSummary, 'id' | 'name'>, message: string, meta?: Partial<RepoOpErrorMeta> | null) {
    const droneId = String((drone as any)?.id ?? '').trim();
    const droneName = String(drone?.name ?? '').trim();
    const text = String(message ?? '').trim();
    if (!droneId || !droneName || !text) return;
    setDroneErrorModal({
      droneId,
      droneName,
      message: text,
      conflict: parseRepoPullConflict(text, meta),
    });
  }

  async function clearDroneHubError(droneIdRaw: string, opts?: { closeModal?: boolean }) {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    setClearingDroneError(true);
    try {
      await requestJson<{ ok: true; id: string; name: string; cleared: boolean }>(
        `/api/drones/${encodeURIComponent(droneId)}/hub/error/clear`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      if (currentDrone?.id === droneId) {
        clearRepoOperationError();
      }
      if (opts?.closeModal !== false) closeDroneErrorModal();
    } catch (e: any) {
      setRepoOperationError(e?.message ?? String(e));
    } finally {
      setClearingDroneError(false);
    }
  }

  async function deleteDrone(droneIdRaw: string) {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    const droneName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim() || droneId;
    if (deletingDrones[droneId] || renamingDrones[droneId] || optimisticallyDeletedDrones[droneId]) return;
    if (shouldConfirmDelete()) {
      const ok = window.confirm(
        `Are you sure you want to delete drone "${droneName}"?\n\nThis will remove the container and remove it from your registry.`
      );
      if (!ok) return;
    }
    setOptimisticallyDeletedDrones((prev) => ({ ...prev, [droneId]: true }));
    setDeletingDrones((prev) => ({ ...prev, [droneId]: true }));
    try {
      await requestJson(`/api/drones/${encodeURIComponent(droneId)}`, { method: 'DELETE' });
    } catch (e: any) {
      console.error('[DroneHub] delete drone failed', { id: droneId, error: e });
      setOptimisticallyDeletedDrones((prev) => {
        if (!prev[droneId]) return prev;
        const next = { ...prev };
        delete next[droneId];
        return next;
      });
    } finally {
      setDeletingDrones((prev) => {
        if (!prev[droneId]) return prev;
        const next = { ...prev };
        delete next[droneId];
        return next;
      });
    }
  }

  async function renameDrone(droneIdRaw: string) {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    if (deletingDrones[droneId] || renamingDrones[droneId]) return;
    const currentName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim() || droneId;
    const suggested = String(window.prompt(`Rename drone "${currentName}" to:`, currentName) ?? '').trim();
    if (!suggested || suggested === currentName) return;
    const renamed = await renameDroneTo(droneId, suggested, { showAlert: true });
    if (!renamed.ok) return;
  }

  async function renameDroneTo(
    droneIdRaw: string,
    newNameRaw: string,
    opts?: { showAlert?: boolean; migrateVolumeName?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const droneId = String(droneIdRaw ?? '').trim();
    const newName = String(newNameRaw ?? '').trim();
    const current = drones.find((d) => d.id === droneId) ?? null;
    const currentName = String(current?.name ?? '').trim() || droneId;
    if (!droneId || !newName || newName === currentName) return { ok: false, error: 'no-op rename' };
    if (deletingDrones[droneId] || renamingDrones[droneId]) return { ok: false, error: 'rename busy' };
    if (newName.length > 80 || /[\r\n]/.test(newName)) {
      if (opts?.showAlert) window.alert('Invalid drone name. Must be 1-80 chars and cannot contain newlines.');
      return { ok: false, error: 'invalid new name' };
    }
    if (drones.some((d) => d.name === newName && d.id !== droneId)) {
      if (opts?.showAlert) window.alert(`A drone named "${newName}" already exists.`);
      return { ok: false, error: 'name already exists' };
    }

    setRenamingDrones((prev) => ({ ...prev, [droneId]: true }));
    try {
      await requestJson<{ ok: true; id: string; oldName: string; newName: string }>(`/api/drones/${encodeURIComponent(droneId)}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newName,
          ...(opts?.migrateVolumeName ? { migrateVolumeName: true } : {}),
        }),
      });
      setStartupSeedByDrone((prev) => {
        const existing = prev[droneId];
        if (!existing) return prev;
        if (existing.droneName === newName) return prev;
        return { ...prev, [droneId]: { ...existing, droneName: newName } };
      });
      return { ok: true };
    } catch (e: any) {
      console.error('[DroneHub] rename drone failed', { id: droneId, newName, error: e });
      if (opts?.showAlert) {
        window.alert(`Rename failed: ${e?.message ?? String(e)}`);
      }
      return { ok: false, error: e?.message ?? String(e) };
    } finally {
      setRenamingDrones((prev) => {
        if (!prev[droneId]) return prev;
        const next = { ...prev };
        delete next[droneId];
        return next;
      });
    }
  }

  async function suggestAndRenameDraftDrone(droneIdRaw: string, promptRaw: string): Promise<void> {
    const droneId = String(droneIdRaw ?? '').trim();
    const prompt = String(promptRaw ?? '').trim();
    if (!droneId || !prompt) return;
    try {
      const data = await requestJson<{ ok: true; name: string }>('/api/drones/name-from-message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
      });
      const base = String((data as any)?.name ?? '').trim();
      if (!base) return;

      const currentName = String(drones.find((d) => d.id === droneId)?.name ?? '').trim();
      if (currentName && base === currentName) return;

      const makeCandidate = (n: number) => {
        const suffix = n <= 1 ? '' : ` (${n})`;
        const raw = `${base}${suffix}`.trim();
        if (!raw) return '';
        if (raw.length > 80) return raw.slice(0, 80).trim();
        return raw;
      };

      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const candidate = makeCandidate(attempt);
        if (!candidate) return;
        if (candidate.length > 80 || /[\r\n]/.test(candidate)) return;
        const renamed = await renameDroneTo(droneId, candidate);
        if (renamed.ok) return;
        const msg = String(renamed.error ?? '').toLowerCase();
        const nameConflict = msg.includes('already exists') || msg.includes('pending') || msg.includes('cannot rename');
        if (nameConflict) continue;
        const retriable = msg.includes('still starting') || msg.includes('unknown drone') || msg.includes('rename busy');
        if (!retriable) return;
        await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(1800, 240 + attempt * 140)));
      }
    } catch (e: any) {
      console.error('[DroneHub] draft auto-rename skipped', { id: droneId, error: e?.message ?? String(e) });
      showNameSuggestionFailureToast(e);
    }
  }

  const selectDroneCard = React.useCallback(
    (droneIdRaw: string, opts?: { toggle?: boolean; range?: boolean }) => {
      const id = String(droneIdRaw ?? '').trim();
      if (!id) return;
      setAppView('workspace');
      setSelectedGroupMultiChat(null);
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      if (opts?.range && orderedDroneIds.length > 0) {
        const anchor =
          (selectionAnchorRef.current && orderedDroneIds.includes(selectionAnchorRef.current) && selectionAnchorRef.current) ||
          (selectedDrone && orderedDroneIds.includes(selectedDrone) ? selectedDrone : id);
        const anchorIdx = orderedDroneIds.indexOf(anchor);
        const selectedIdx = orderedDroneIds.indexOf(id);
        if (anchorIdx >= 0 && selectedIdx >= 0) {
          const start = Math.min(anchorIdx, selectedIdx);
          const end = Math.max(anchorIdx, selectedIdx);
          setSelectedDroneIds(orderedDroneIds.slice(start, end + 1));
          setSelectedDrone(id);
          selectionAnchorRef.current = anchor;
          scrollChatToBottom();
          return;
        }
      }
      if (opts?.toggle) {
        setSelectedDroneIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedDrone(id);
        selectionAnchorRef.current = id;
        scrollChatToBottom();
        return;
      }
      setSelectedDroneIds([id]);
      setSelectedDrone(id);
      selectionAnchorRef.current = id;
      scrollChatToBottom();
    },
    [orderedDroneIds, selectedDrone],
  );

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

  async function createDrone() {
    const rowSpecs = createNameRows.map((nameRaw, idx) => ({
      nameRaw: String(nameRaw ?? ''),
      name: String(nameRaw ?? '').trim(),
      messageSuffix: String(createMessageSuffixRows[idx] ?? ''),
    }));
    const namedRows = rowSpecs.filter((row) => row.name);
    const names = namedRows.map((row) => row.name);
    const group = createGroup.trim();
    const repoPath = createRepoPath.trim();
    const seedPrompt = createInitialMessage.trim();
    const isClone = createMode === 'clone' && Boolean(cloneSourceId);
    // If we're cloning chats, preserve the source chat agent config(s) by not seeding a new default agent.
    const seedAgent = isClone && cloneIncludeChats ? null : resolveAgentKeyToConfig(spawnAgentKey);
    const seedModel = isClone && cloneIncludeChats ? null : spawnModelForSeed;
    if (names.length === 0) {
      setCreateError('At least one name is required.');
      return;
    }

    const invalid = Array.from(new Set(namedRows.filter((row) => droneNameHasWhitespace(row.nameRaw) || !isValidDroneNameDashCase(row.name)).map((row) => row.name)));
    if (invalid.length > 0) {
      const preview = invalid.slice(0, 4).join(', ');
      const extra = invalid.length > 4 ? ` (+${invalid.length - 4} more)` : '';
      setCreateError(`Invalid name(s): ${preview}${extra}. Use dash-case (letters/numbers and single hyphens), no spaces, max 48 chars.`);
      return;
    }

    const nameCounts = new Map<string, number>();
    for (const name of names) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    const duplicates = Array.from(nameCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);
    if (duplicates.length > 0) {
      const preview = duplicates.slice(0, 4).join(', ');
      const extra = duplicates.length > 4 ? ` (+${duplicates.length - 4} more)` : '';
      setCreateError(`Duplicate name(s) in list: ${preview}${extra}.`);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const resp = await queueDrones(
        namedRows.map(({ name, messageSuffix }) => {
          const suffix = messageSuffix.trim();
          const combinedSeedPrompt = [seedPrompt || null, suffix || null]
            .filter((part) => typeof part === 'string' && part.trim().length > 0)
            .join('\n\n');
          return {
            name,
            ...(group ? { group } : {}),
            ...(repoPath ? { repoPath } : {}),
            ...(isClone && cloneSourceId ? { cloneFrom: cloneSourceId, cloneChats: Boolean(cloneIncludeChats) } : {}),
            seedChat: 'default',
            ...(seedAgent ? { seedAgent } : {}),
            ...(seedModel ? { seedModel } : {}),
            ...(combinedSeedPrompt ? { seedPrompt: combinedSeedPrompt } : {}),
          };
        }),
      );

      const acceptedList = Array.isArray(resp?.accepted) ? resp.accepted : [];
      const acceptedByName = new Map<string, { id: string; name: string }>();
      const acceptedNames = new Set<string>();
      for (const a of acceptedList) {
        const id = String((a as any)?.id ?? '').trim();
        const name = String((a as any)?.name ?? '').trim();
        if (!id || !name) continue;
        acceptedByName.set(name, { id, name });
        acceptedNames.add(name);
      }
      const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];

      if (acceptedByName.size > 0) {
        rememberStartupSeed(Array.from(acceptedByName.values()), { agent: seedAgent, model: seedModel, prompt: seedPrompt, chatName: 'default' });
      }

      const firstAccepted = acceptedList.length > 0 ? acceptedList[0] : null;
      const firstAcceptedId = String((firstAccepted as any)?.id ?? '').trim();
      if (firstAcceptedId) {
        preferredSelectedDroneRef.current = firstAcceptedId;
        preferredSelectedDroneHoldUntilRef.current = Date.now() + STARTUP_SEED_MISSING_GRACE_MS;
        setSelectedDrone(firstAcceptedId);
        setSelectedDroneIds([firstAcceptedId]);
        selectionAnchorRef.current = firstAcceptedId;
      }

      if (rejected.length > 0) {
        const byName = new Map<string, string>();
        for (const r of rejected) {
          const name = String((r as any)?.name ?? '').trim();
          if (!name) continue;
          byName.set(name, String((r as any)?.error ?? 'Failed to queue drone.'));
        }
        const pendingRows = namedRows.filter((row) => !acceptedNames.has(row.name));
        setCreateName(pendingRows.map((row) => row.name).join('\n'));
        setCreateMessageSuffixRows(pendingRows.map((row) => row.messageSuffix));

        const pendingNames = pendingRows.map((row) => row.name);
        const topErrors = pendingNames
          .slice(0, 4)
          .map((name) => `${name}: ${byName.get(name) ?? 'Failed to queue drone.'}`)
          .join('\n');
        const hiddenCount = Math.max(0, pendingNames.length - 4);
        const moreText = hiddenCount > 0 ? `\n(+${hiddenCount} more)` : '';
        const queuedText = acceptedNames.size > 0 ? `${acceptedNames.size} queued. ` : '';
        setCreateError(`${queuedText}${pendingNames.length} failed:\n${topErrors}${moreText}`);
        return;
      }

      setCreateOpen(false);
      setCreateMode('create');
      setCloneSourceId(null);
      setCreateName('');
      setCreateGroup('');
      setCreateRepoPath('');
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
    } catch (e: any) {
      setCreateError(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  async function startDraftPrompt(payload: ChatSendPayload): Promise<boolean> {
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
    if (attachments.length > 0) {
      setDraftCreateError('Image attachments are only supported after the drone is created.');
      return false;
    }
    const prompt = String(payload?.prompt ?? '').trim();
    if (!prompt) return false;
    setDraftChat({
      droneId: '',
      droneName: '',
      prompt: {
        id: `draft-${makeId()}`,
        at: new Date().toISOString(),
        prompt,
        state: 'sending',
      },
    });
    setDraftCreateError(null);
    setDraftCreateName('');
    setDraftCreateGroup('');
    setDraftSuggestedName('');
    setDraftNameSuggesting(false);
    setDraftNameSuggestionError(null);
    setDraftAutoRenaming(false);
    setDraftCreateOpen(false);

    return await createDroneFromDraft({ prompt, group: '', autoRename: true });
  }

  async function createDroneFromDraft(opts?: { prompt?: string; name?: string; group?: string; autoRename?: boolean }): Promise<boolean> {
    const pending = draftChat?.prompt ?? null;
    const prompt = String(opts?.prompt ?? pending?.prompt ?? '').trim();
    const nameRaw = String(opts?.name ?? draftCreateName ?? '');
    const name = nameRaw.trim();
    const group = String(opts?.group ?? draftCreateGroup ?? '').trim();
    const repoPath = String(chatHeaderRepoPath ?? '').trim();
    if (!prompt) {
      setDraftCreateError('Send a first message before creating a drone.');
      return false;
    }
    if (name && (name.length > 80 || /[\r\n]/.test(name))) {
      setDraftCreateError('Invalid name. Must be 1-80 chars and cannot contain newlines.');
      return false;
    }
    if (name && drones.some((d) => d.name === name)) {
      setDraftCreateError(`A drone named "${name}" already exists.`);
      return false;
    }

    setDraftCreating(true);
    setDraftCreateError(null);
    const seedAgent = resolveAgentKeyToConfig(spawnAgentKey);
    const seedModel = spawnModelForSeed;
    try {
      const body: any = {
        ...(name ? { name } : {}),
        ...(group ? { group } : {}),
        ...(repoPath ? { repoPath } : {}),
        seedChat: 'default',
        ...(seedAgent ? { seedAgent } : {}),
        ...(seedModel ? { seedModel } : {}),
        ...(prompt ? { seedPrompt: prompt } : {}),
      };
      const data = await requestJson<{ ok: true; id: string; name: string; phase: 'starting' }>(`/api/drones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const droneId = String((data as any)?.id ?? '').trim();
      const createdName = String((data as any)?.name ?? name ?? '').trim() || droneId;
      if (!droneId) throw new Error('create drone did not return an id');

      rememberStartupSeed([{ id: droneId, name: createdName }], { agent: seedAgent, model: seedModel, prompt, chatName: 'default' });
      preferredSelectedDroneRef.current = droneId;
      preferredSelectedDroneHoldUntilRef.current = Date.now() + STARTUP_SEED_MISSING_GRACE_MS;
      setSelectedDrone(droneId);
      setSelectedDroneIds([droneId]);
      selectionAnchorRef.current = droneId;
      setSelectedChat('default');

      setDraftChat((prev) => {
        if (!prev?.prompt) return prev;
        return {
          droneId,
          droneName: createdName,
          prompt: {
            ...prev.prompt,
            state: 'sent',
            updatedAt: new Date().toISOString(),
          },
        };
      });

      if (opts?.autoRename) {
        setDraftAutoRenaming(true);
        void suggestAndRenameDraftDrone(droneId, prompt).finally(() => setDraftAutoRenaming(false));
      }

      setDraftCreateOpen(false);
      setDraftCreateName('');
      setDraftCreateGroup('');
      setDraftCreateError(null);
      setDraftNameSuggestionError(null);
      setDraftNameSuggesting(false);
      return true;
    } catch (e: any) {
      const err = e?.message ?? String(e);
      setDraftChat((prev) => {
        if (!prev?.prompt) return prev;
        return {
          ...(prev ?? { droneId: '', droneName: '' }),
          prompt: { ...prev.prompt, state: 'failed', error: err, updatedAt: new Date().toISOString() },
        };
      });
      setDraftCreateError(err);
      return false;
    } finally {
      setDraftCreating(false);
    }
  }

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

  async function setChatAgent(agent: ChatAgentConfig) {
    if (!selectedDrone) return;
    const chat = selectedChat || 'default';
    await requestJson(`/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    setChatInfo((prev) => ({
      name: selectedDrone,
      chat,
      agent,
      model: prev?.model ?? null,
      sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    }));
    setChatInfoError(null);
  }

  async function setChatModel(model: string | null) {
    if (!selectedDrone) return;
    const chat = selectedChat || 'default';
    const normalized = String(model ?? '').trim() || null;
    await requestJson(`/api/drones/${encodeURIComponent(selectedDrone)}/chats/${encodeURIComponent(chat)}/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: normalized }),
    });
    setChatInfo((prev) => ({
      name: selectedDrone,
      chat,
      agent: prev?.agent ?? ({ kind: 'builtin', id: 'cursor' } as ChatAgentConfig),
      model: normalized,
      sessionName: prev?.sessionName ?? `drone-hub-chat-${chat}`,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    }));
    setManualChatModelInput(normalized ?? '');
    setChatInfoError(null);
  }

  function handleSetAgentFailure(prefix: string, err: any) {
    const msg = err?.message ?? String(err);
    console.error(prefix, err);
    setChatInfoError(msg);
  }

  React.useEffect(() => {
    const valid = new Set(sidebarDronesFilteredByRepo.map((d) => d.id));
    setSelectedDroneIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      if (selectedDrone && valid.has(selectedDrone) && !next.includes(selectedDrone)) {
        next.push(selectedDrone);
      }
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev;
      return next;
    });
  }, [selectedDrone, sidebarDronesFilteredByRepo]);

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

  // Auto-select first drone (and recover from deletions).
  React.useEffect(() => {
    if (draftChat) {
      if (!draftChat.prompt) {
        if (selectedDrone) setSelectedDrone(null);
        setSelectedDroneIds((prev) => (prev.length === 0 ? prev : []));
        selectionAnchorRef.current = null;
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      }
      return;
    }
    if (dronesFilteredByRepo.length === 0) {
      if (selectedDrone) setSelectedDrone(null);
      setSelectedDroneIds([]);
      resetGroupDndState();
      setGroupMoveError(null);
      selectionAnchorRef.current = null;
      preferredSelectedDroneRef.current = null;
      preferredSelectedDroneHoldUntilRef.current = 0;
      return;
    }
    const preferred = preferredSelectedDroneRef.current;
    if (preferred) {
      const preferredExists = dronesFilteredByRepo.some((d) => d.id === preferred);
      if (preferredExists) {
        if (selectedDrone !== preferred) {
          setSelectedDrone(preferred);
          setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === preferred ? prev : [preferred]));
          selectionAnchorRef.current = preferred;
          return;
        }
        // Preferred selection is only a temporary "land on this drone" hint.
        // Clear it once satisfied so manual navigation can switch away.
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      }
      const holdActive = Date.now() < preferredSelectedDroneHoldUntilRef.current;
      const seed = startupSeedByDrone[preferred] ?? null;
      if (!holdActive && !isStartupSeedFresh(seed)) {
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      } else if (!selectedDrone || !dronesFilteredByRepo.some((d) => d.id === selectedDrone)) {
        // Keep current state while waiting for preferred startup/rename to appear.
        return;
      }
    }
    if (!selectedDrone || !dronesFilteredByRepo.some((d) => d.id === selectedDrone)) {
      const first = dronesFilteredByRepo[0].id;
      setSelectedDrone(first);
      setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === first ? prev : [first]));
      selectionAnchorRef.current = first;
    }
  }, [
    activeRepoPath,
    draftChat,
    dronesFilteredByRepo,
    resetGroupDndState,
    selectedDrone,
    setGroupMoveError,
    startupSeedByDrone,
  ]);

  // Fall back if selected chat disappears.
  React.useEffect(() => {
    if (!selectedDrone) return;
    const d = drones.find((x) => x.id === selectedDrone);
    const chats = d?.chats ?? [];
    if (chats.length === 0) return;
    if (selectedChat && chats.includes(selectedChat)) return;
    setSelectedChat(chats.includes('default') ? 'default' : chats[0]);
  }, [drones, selectedDrone, selectedChat]);

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
  const selectedGroupMultiChatData = React.useMemo(
    () => (selectedGroupMultiChat ? sidebarGroups.find((g) => g.group === selectedGroupMultiChat) ?? null : null),
    [selectedGroupMultiChat, sidebarGroups],
  );
  React.useEffect(() => {
    if (!selectedGroupMultiChat) return;
    if (selectedGroupMultiChatData) return;
    setSelectedGroupMultiChat(null);
  }, [selectedGroupMultiChat, selectedGroupMultiChatData]);
  React.useEffect(() => {
    setGroupBroadcastPromptError(null);
  }, [selectedGroupMultiChat]);
  React.useEffect(() => {
    setGroupBroadcastExpanded(false);
  }, [selectedGroupMultiChat]);

  const sendGroupBroadcastPrompt = React.useCallback(
    async (payload: ChatSendPayload): Promise<boolean> => {
      const prompt = String(payload?.prompt ?? '').trim();
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (!prompt && attachments.length === 0) return false;
      const targets = selectedGroupMultiChatData?.items ?? [];
      if (targets.length === 0) {
        setGroupBroadcastPromptError('No drones available in this group.');
        return false;
      }

      setGroupBroadcastSendingCount((c) => c + 1);
      setGroupBroadcastPromptError(null);
      try {
        const preferredChat = selectedChat || 'default';
        const results = await Promise.allSettled(
          targets.map(async (d) => {
            if (isDroneStartingOrSeeding(d.hubPhase)) {
              throw new Error(`"${d.name}" is still starting.`);
            }
            const chatName = resolveChatNameForDrone(d, preferredChat);
            await requestJson<{ ok: true; accepted: true; promptId: string }>(
              `/api/drones/${encodeURIComponent(d.id)}/chats/${encodeURIComponent(chatName)}/prompt`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt, attachments }),
              },
            );
            return d.name;
          }),
        );

        const failed: string[] = [];
        for (let i = 0; i < results.length; i += 1) {
          if (results[i].status === 'rejected') failed.push(targets[i].name);
        }
        if (failed.length === 0) return true;
        if (failed.length === targets.length) {
          setGroupBroadcastPromptError(`Failed to send to all ${targets.length} drones.`);
          return false;
        }
        const preview = failed.slice(0, 3).join(', ');
        const more = failed.length > 3 ? ` +${failed.length - 3} more` : '';
        setGroupBroadcastPromptError(`Sent to ${targets.length - failed.length}/${targets.length}. Failed: ${preview}${more}.`);
        return true;
      } catch (err: any) {
        setGroupBroadcastPromptError(err?.message ?? String(err));
        return false;
      } finally {
        setGroupBroadcastSendingCount((c) => Math.max(0, c - 1));
      }
    },
    [selectedChat, selectedGroupMultiChatData],
  );
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
  const defaultFsPathForCurrentDrone = React.useMemo(() => {
    if (!currentDrone) return '/dvm-data/home';
    return droneHomePath(currentDrone);
  }, [currentDrone?.name, currentDrone?.repoAttached, currentDrone?.repoPath]);
  const currentFsPath = React.useMemo(() => {
    const droneId = String(currentDrone?.id ?? '').trim();
    if (!droneId) return '/dvm-data/home';
    const saved = fsPathByDrone[droneId];
    return normalizeContainerPathInput(saved || defaultFsPathForCurrentDrone);
  }, [currentDrone?.id, defaultFsPathForCurrentDrone, fsPathByDrone]);
  const setCurrentFsPath = React.useCallback(
    (nextPath: string) => {
      const droneId = String(currentDrone?.id ?? '').trim();
      if (!droneId) return;
      const normalized = normalizeContainerPathInput(nextPath);
      setFsPathByDrone((prev) => {
        if ((prev[droneId] ?? '') === normalized) return prev;
        return { ...prev, [droneId]: normalized };
      });
    },
    [currentDrone?.id],
  );
  const refreshFsList = React.useCallback(() => {
    setFsRefreshNonce((n) => n + 1);
  }, []);
  const fsPollIntervalMs = currentDrone ? 8000 : 60000;
  const {
    value: fsResp,
    error: fsError,
    loading: fsLoading,
  } = usePoll<DroneFsListPayload>(
    () =>
      currentDrone
        ? requestJson(`/api/drones/${encodeURIComponent(currentDrone.id)}/fs/list?path=${encodeURIComponent(currentFsPath)}`)
        : Promise.resolve({ ok: true, id: '', name: '', path: '/', entries: [] }),
    fsPollIntervalMs,
    [currentDrone?.id, currentFsPath, fsRefreshNonce],
  );
  const fsPayloadError =
    fsResp && (fsResp as any).ok === false ? String((fsResp as any)?.error ?? 'filesystem request failed') : null;
  const fsErrorCombined = fsError ?? fsPayloadError;
  const fsEntries = fsResp && (fsResp as any).ok === true ? (((fsResp as any).entries as DroneFsEntry[]) ?? []) : [];

  const filesPane = usePaneReadiness({
    hubPhase: currentDrone?.hubPhase,
    resetKey: `${currentDrone?.id ?? ''}\u0000files`,
    timeoutMs: 18_000,
  });
  const fsOkForCurrentDrone = Boolean(
    currentDrone &&
      (fsResp as any)?.ok === true &&
      String((fsResp as any)?.id ?? '').trim() === String(currentDrone.id ?? '').trim(),
  );
  React.useEffect(() => {
    if (fsOkForCurrentDrone) filesPane.markReady();
  }, [fsOkForCurrentDrone, filesPane.markReady]);
  const fsErrorUi = filesPane.suppressErrors ? null : fsErrorCombined;

  const portsPollIntervalMs = currentDrone ? 5000 : 60000;
  const {
    value: portsResp,
    error: portsError,
    loading: portsLoading,
  } = usePoll<DronePortsPayload>(
    () =>
      currentDrone
        ? fetchJson(`/api/drones/${encodeURIComponent(currentDrone.id)}/ports`)
        : Promise.resolve({ ok: true, id: '', name: '', ports: [] }),
    portsPollIntervalMs,
    [currentDrone?.id],
  );
  const ports = portsResp && (portsResp as any).ok === true ? ((portsResp as any).ports as DronePortMapping[]) : null;
  const portsPayloadError =
    portsResp && (portsResp as any).ok === false ? String((portsResp as any)?.error ?? 'ports request failed') : null;
  const portsErrorCombined = portsError ?? portsPayloadError;

  const portsPane = usePaneReadiness({
    hubPhase: currentDrone?.hubPhase,
    resetKey: `${currentDrone?.id ?? ''}\u0000ports`,
    timeoutMs: 18_000,
  });
  const portsOkForCurrentDrone = Boolean(
    currentDrone &&
      (portsResp as any)?.ok === true &&
      String((portsResp as any)?.id ?? '').trim() === String(currentDrone.id ?? '').trim(),
  );
  React.useEffect(() => {
    if (portsOkForCurrentDrone) portsPane.markReady();
  }, [portsOkForCurrentDrone, portsPane.markReady]);
  const portsErrorUi = portsPane.suppressErrors ? null : portsErrorCombined;
  const portRows = React.useMemo(
    () =>
      normalizePortRows(
        ports,
        typeof currentDrone?.hostPort === 'number' && Number.isFinite(currentDrone.hostPort) ? currentDrone.hostPort : null,
        typeof currentDrone?.containerPort === 'number' && Number.isFinite(currentDrone.containerPort) ? currentDrone.containerPort : null,
      ),
    [ports, currentDrone?.hostPort, currentDrone?.containerPort],
  );
  const [portPreviewByDrone, setPortPreviewByDrone] = React.useState<PortPreviewByDrone>(() =>
    readPortPreviewByDrone(readLocalStorageItem(PORT_PREVIEW_STORAGE_KEY)),
  );
  const [previewUrlByDrone, setPreviewUrlByDrone] = React.useState<PreviewUrlByDrone>(() =>
    readPreviewUrlByDrone(readLocalStorageItem(PREVIEW_URL_STORAGE_KEY)),
  );
  const [portReachabilityByDrone, setPortReachabilityByDrone] = React.useState<PortReachabilityByDrone>({});
  usePersistedLocalStorageItem(PORT_PREVIEW_STORAGE_KEY, JSON.stringify(portPreviewByDrone));
  usePersistedLocalStorageItem(PREVIEW_URL_STORAGE_KEY, JSON.stringify(previewUrlByDrone));

  const selectedPreviewPort = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return null;
    const saved = portPreviewByDrone[droneName];
    if (!saved) return null;
    return (
      portRows.find((p) => p.containerPort === saved.containerPort && p.hostPort === saved.hostPort) ??
      portRows.find((p) => p.containerPort === saved.containerPort) ??
      portRows.find((p) => p.hostPort === saved.hostPort) ??
      null
    );
  }, [currentDrone?.name, portPreviewByDrone, portRows]);
  const portRowsSignature = React.useMemo(
    () => portRows.map((p) => `${p.containerPort}:${p.hostPort}`).join(','),
    [portRows],
  );

  const setSelectedPreviewPort = React.useCallback(
    (port: DronePortMapping | null) => {
      const droneName = String(currentDrone?.name ?? '').trim();
      if (!droneName) return;
      if (port) {
        // Selecting a port should make preview follow that port URL.
        setPreviewUrlByDrone((prev) => {
          if (!prev[droneName]) return prev;
          const next = { ...prev };
          delete next[droneName];
          return next;
        });
      }
      setPortPreviewByDrone((prev) => {
        const next = { ...prev };
        if (!port) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        const prevSel = next[droneName];
        if (prevSel && prevSel.hostPort === port.hostPort && prevSel.containerPort === port.containerPort) return prev;
        next[droneName] = { hostPort: port.hostPort, containerPort: port.containerPort };
        return next;
      });
    },
    [currentDrone?.name],
  );
  const selectedPreviewDefaultUrl = React.useMemo(
    () =>
      selectedPreviewPort && currentDrone?.name
        ? buildContainerPreviewUrl(currentDrone.name, selectedPreviewPort.containerPort)
        : null,
    [currentDrone?.name, selectedPreviewPort],
  );
  const selectedPreviewUrlOverride = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return null;
    return previewUrlByDrone[droneName] ?? null;
  }, [currentDrone?.name, previewUrlByDrone]);
  const setSelectedPreviewUrlOverride = React.useCallback(
    (nextUrl: string | null) => {
      const droneName = String(currentDrone?.name ?? '').trim();
      if (!droneName) return;
      setPreviewUrlByDrone((prev) => {
        const next = { ...prev };
        const normalized = nextUrl ? normalizePreviewUrl(nextUrl) : null;
        if (!normalized) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        const rewritten = rewriteLoopbackUrlToContainerPreview(normalized, droneName, portRows);
        const finalUrl = normalizePreviewUrl(rewritten || normalized) ?? (rewritten || normalized);
        const defaultUrl = selectedPreviewDefaultUrl
          ? normalizePreviewUrl(selectedPreviewDefaultUrl) ?? selectedPreviewDefaultUrl
          : null;
        if (defaultUrl && finalUrl === defaultUrl) {
          if (!next[droneName]) return prev;
          delete next[droneName];
          return next;
        }
        if (next[droneName] === finalUrl) return prev;
        next[droneName] = finalUrl;
        return next;
      });
    },
    [currentDrone?.name, portRows, selectedPreviewDefaultUrl],
  );

  React.useEffect(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return;
    const currentOverride = previewUrlByDrone[droneName];
    if (!currentOverride) return;
    const rewritten = rewriteLoopbackUrlToContainerPreview(currentOverride, droneName, portRows);
    if (!rewritten) return;
    const rewrittenNormalized = normalizePreviewUrl(rewritten) ?? rewritten;
    const defaultUrl = selectedPreviewDefaultUrl
      ? normalizePreviewUrl(selectedPreviewDefaultUrl) ?? selectedPreviewDefaultUrl
      : null;
    const nextValue = defaultUrl && rewrittenNormalized === defaultUrl ? null : rewrittenNormalized;
    setPreviewUrlByDrone((prev) => {
      if (prev[droneName] !== currentOverride) return prev;
      const next = { ...prev };
      if (!nextValue) {
        delete next[droneName];
      } else {
        next[droneName] = nextValue;
      }
      return next;
    });
  }, [currentDrone?.name, portRows, previewUrlByDrone, selectedPreviewDefaultUrl]);

  React.useEffect(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName || portRows.length === 0) return;
    let mounted = true;
    let timer: any = null;

    const warmStatuses = () => {
      setPortReachabilityByDrone((prev) => {
        const current = prev[droneName] ?? {};
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const p of portRows) {
          const key = String(p.hostPort);
          nextForDrone[key] = current[key] ?? 'checking';
        }
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneName]: nextForDrone };
      });
    };

    const probe = async () => {
      const checks = await Promise.all(
        portRows.map(async (p) => ({
          hostPort: p.hostPort,
          state: (await probeLocalhostPort(p.hostPort, PORT_STATUS_TIMEOUT_MS)) ? ('up' as const) : ('down' as const),
        })),
      );
      if (!mounted) return;
      setPortReachabilityByDrone((prev) => {
        const current = prev[droneName] ?? {};
        const nextForDrone: PortReachabilityByHostPort = {};
        for (const c of checks) nextForDrone[String(c.hostPort)] = c.state;
        if (sameReachabilityMap(current, nextForDrone)) return prev;
        return { ...prev, [droneName]: nextForDrone };
      });
    };

    warmStatuses();
    void probe();
    timer = setInterval(() => {
      void probe();
    }, PORT_STATUS_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [currentDrone?.name, portRowsSignature]);

  const currentPortReachability = React.useMemo(() => {
    const droneName = String(currentDrone?.name ?? '').trim();
    if (!droneName) return {};
    return portReachabilityByDrone[droneName] ?? {};
  }, [currentDrone?.name, portReachabilityByDrone]);
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
        sidebarCollapsed={sidebarCollapsed}
        selectedDroneIds={selectedDroneIds}
        draftChat={draftChat}
        appView={appView}
        viewMode={viewMode}
        dronesError={dronesError}
        groupMoveError={groupMoveError}
        dronesLoading={dronesLoading}
        sidebarDronesFilteredByRepo={sidebarDronesFilteredByRepo}
        sidebarDrones={sidebarDrones}
        activeRepoPath={activeRepoPath}
        sidebarOptimisticDroneIdSet={sidebarOptimisticDroneIdSet}
        selectedDroneSet={selectedDroneSet}
        selectedDrone={selectedDrone}
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
        selectedGroupMultiChat={selectedGroupMultiChat}
        sidebarHasUngroupedGroup={sidebarHasUngroupedGroup}
        draggingDroneNames={draggingDroneNames}
        dragOverUngrouped={dragOverUngrouped}
        sidebarReposCollapsed={sidebarReposCollapsed}
        repos={repos}
        reposLoading={reposLoading}
        reposError={reposError}
        dronesCount={drones.length}
        droneCountByRepoPath={droneCountByRepoPath}
        autoDelete={autoDelete}
        uiDroneName={uiDroneName}
        onOpenDraftChatComposer={openDraftChatComposer}
        onOpenCreateModal={openCreateModal}
        onToggleSettingsView={() => setAppView(appView === 'settings' ? 'workspace' : 'settings')}
        onToggleViewMode={() => setViewMode(viewMode === 'grouped' ? 'flat' : 'grouped')}
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
        onToggleSidebarReposCollapsed={() => setSidebarReposCollapsed((v) => !v)}
        onOpenReposModal={() => setReposModalOpen(true)}
        onClearActiveRepoPath={() => setActiveRepoPath('')}
        onToggleActiveRepoPath={(path) => setActiveRepoPath((prev) => (prev === path ? '' : path))}
        onAutoDeleteChange={setAutoDelete}
        onSetSidebarCollapsed={setSidebarCollapsed}
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
                spawnAgentKey,
                onSpawnAgentKeyChange: setSpawnAgentKey,
                spawnAgentMenuEntries,
                draftCreating,
                draftAutoRenaming,
                onOpenCustomAgentModal: () => setCustomAgentModalOpen(true),
                spawnAgentConfig,
                spawnModel,
                onSpawnModelChange: setSpawnModel,
                onClearSpawnModel: () => setSpawnModel(''),
                chatHeaderRepoPath,
                onChatHeaderRepoPathChange: setChatHeaderRepoPath,
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
                selectedChat,
                groupMultiChatColumnWidth,
                onGroupMultiChatColumnWidthChange: setGroupMultiChatColumnWidth,
                groupBroadcastExpanded,
                onToggleGroupBroadcastExpanded: () => setGroupBroadcastExpanded((v) => !v),
                onClose: () => setSelectedGroupMultiChat(null),
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
                sidebarCollapsed,
                setSidebarCollapsed,
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
                agentMenuOpen,
                setAgentMenuOpen,
                setTerminalMenuOpen,
                setHeaderOverflowOpen,
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
                outputView,
                setOutputView,
                selectedChat,
                setSelectedChat,
                openDroneTerminal,
                openingTerminal,
                openDroneEditor,
                openingEditor,
                pullRepoChanges,
                repoOp,
                headerOverflowRef,
                headerOverflowOpen,
                reseedRepo,
                terminalMenuRef,
                terminalMenuOpen,
                terminalLabel,
                terminalOptions,
                terminalEmulator,
                setTerminalEmulator,
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
