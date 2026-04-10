import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { AppView, DraftChatState, DroneErrorModalState } from './app-types';
import {
  GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
  clampGroupMultiChatColumnWidthPx,
} from './app-config';
import {
  cloneDefaultShortcutBindings,
  sanitizeSingleShortcutBinding,
  sanitizeShortcutBindings,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutBindingMap,
} from './shortcuts';
import { readLocalStorageItem } from './hooks';
import type { CustomAgentProfile } from '../types';
import type { SettingsTabId } from './settings-tabs';
import type { RepoBranchSourceMode } from './drone-create-runtime';
import type { KanbanTaskScopeType } from './kanban-board-state';
import type { SidebarDensityMode } from './settings-types';
import {
  automationConfigsEqual,
  createAutomationConfig,
  normalizeAutomationConfigs,
  patchAutomationConfig,
  type AutomationConfig,
} from './automation-config';
import { normalizeSidebarRepoScopedGroupMap } from './sidebar-repo-scoped-groups';
import { normalizeSidebarGroupOrder } from './sidebar-group-order';
import { mergeSeenModelIds, normalizeSeenModelIds } from './spawn-model-history';
import { profileStorageKey } from '../../profile-storage';

type Updater<T> = T | ((prev: T) => T);

type NameSuggestToast = null | { id: string; title?: string; message: string; tone?: 'success' | 'error' };
type ViewMode = 'grouped' | 'flat';
type SidebarGroupingMode = 'groups' | 'repos';
type FsExplorerView = 'list' | 'thumb';
type OutputView = 'screen' | 'log';
type KanbanBoardViewMode = 'board' | 'table';
type KanbanBoardScopeType = KanbanTaskScopeType;
type SpawnContextPreferences = {
  spawnAgentKey: string;
  spawnModel: string;
  repoBranchSource: RepoBranchSourceMode;
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
};
const CHAT_INPUT_DRAFT_MAX_CHARS = 4_000;
const CHAT_INPUT_DRAFT_MAX_KEYS = 80;
const CHAT_INPUT_DRAFTS_STORAGE_KEY = profileStorageKey('droneHub.chatInputDrafts');
const CHAT_INPUT_DRAFTS_PERSIST_DEBOUNCE_MS = 300;
const NO_REPO_SPAWN_CONTEXT_KEY = '__no_repo__';
const DEFAULT_SPAWN_CONTEXT_PREFERENCES: SpawnContextPreferences = {
  spawnAgentKey: 'builtin:cursor',
  spawnModel: '',
  repoBranchSource: 'host',
  repoCreateRemoteBranch: '',
  pullHostBranchBeforeCreate: true,
};

type DroneHubUiState = {
  activeRepoPath: string;
  settingsActiveTab: SettingsTabId;
  settingsPlaybookFocusId: string | null;
  playbookRunsSelectionInitialized: boolean;
  playbookRunsSelectedPlaybookId: string;
  playbookRunsSelectedRepoPath: string;
  kanbanBoardSelectionInitialized: boolean;
  kanbanBoardScopeType: KanbanBoardScopeType;
  kanbanBoardScopeValue: string;
  kanbanBoardSelectedRepoPath: string;
  kanbanBoardViewMode: KanbanBoardViewMode;
  chatHeaderRepoPath: string;
  sidebarReposCollapsed: boolean;
  sidebarAutoMinimize: boolean;
  sidebarGroupingMode: SidebarGroupingMode;
  sidebarDensityMode: SidebarDensityMode;
  appView: AppView;
  viewMode: ViewMode;
  collapsedGroups: Record<string, boolean>;
  sidebarGroupOrder: string[];
  sidebarRepoScopedGroupByPath: Record<string, string>;
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  hiddenSidebarGroups: string[];
  showHiddenSidebarGroups: boolean;
  autoDelete: boolean;
  terminalEmulator: string;
  fleetDashboardOpen: boolean;
  selectedDrone: string | null;
  selectedDroneIds: string[];
  selectedGroupMultiChat: string | null;
  kanbanBoardOpen: boolean;
  playbookRunsOpen: boolean;
  groupBroadcastExpanded: boolean;
  groupMultiChatColumnWidth: number;
  groupMultiChatStatusSort: boolean;
  selectedChat: string;
  chatInputDrafts: Record<string, string>;
  draftChat: DraftChatState | null;
  sidebarCollapsed: boolean;
  reposModalOpen: boolean;
  droneErrorModal: DroneErrorModalState | null;
  clearingDroneError: boolean;
  headerOverflowOpen: boolean;
  outputView: OutputView;
  fsExplorerView: FsExplorerView;
  transcriptInlineImages: boolean;
  showCanvasLastMessagePreviews: boolean;
  automations: AutomationConfig[];
  transcriptInlineImageOverrides: Record<string, boolean>;
  spawnContextRepoPath: string;
  spawnContextByRepoKey: Record<string, SpawnContextPreferences>;
  spawnAgentKey: string;
  spawnModel: string;
  seenModelIds: string[];
  repoBranchSource: RepoBranchSourceMode;
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
  customAgents: CustomAgentProfile[];
  customAgentModalOpen: boolean;
  newCustomAgentLabel: string;
  newCustomAgentCommand: string;
  customAgentError: string | null;
  nameSuggestToast: NameSuggestToast;
  shortcutBindings: ShortcutBindingMap;
  terminalMenuOpen: boolean;
  agentMenuOpen: boolean;
  setActiveRepoPath: (next: Updater<string>) => void;
  setSettingsActiveTab: (next: Updater<SettingsTabId>) => void;
  setSettingsPlaybookFocusId: (next: Updater<string | null>) => void;
  setPlaybookRunsSelectionInitialized: (next: Updater<boolean>) => void;
  setPlaybookRunsSelectedPlaybookId: (next: Updater<string>) => void;
  setPlaybookRunsSelectedRepoPath: (next: Updater<string>) => void;
  setKanbanBoardSelectionInitialized: (next: Updater<boolean>) => void;
  setKanbanBoardScopeType: (next: Updater<KanbanBoardScopeType>) => void;
  setKanbanBoardScopeValue: (next: Updater<string>) => void;
  setKanbanBoardSelectedRepoPath: (next: Updater<string>) => void;
  setKanbanBoardViewMode: (next: Updater<KanbanBoardViewMode>) => void;
  setChatHeaderRepoPath: (next: Updater<string>) => void;
  setSidebarReposCollapsed: (next: Updater<boolean>) => void;
  setSidebarAutoMinimize: (next: Updater<boolean>) => void;
  setSidebarGroupingMode: (next: Updater<SidebarGroupingMode>) => void;
  setSidebarDensityMode: (next: Updater<SidebarDensityMode>) => void;
  setAppView: (next: Updater<AppView>) => void;
  setViewMode: (next: Updater<ViewMode>) => void;
  setCollapsedGroups: (next: Updater<Record<string, boolean>>) => void;
  setSidebarGroupOrder: (next: Updater<string[]>) => void;
  setSidebarRepoScopedGroupByPath: (next: Updater<Record<string, string>>) => void;
  setSidebarDroneOrderByGroup: (next: Updater<Record<string, string[]>>) => void;
  setSidebarNodeOrderByParent: (next: Updater<Record<string, string[]>>) => void;
  setSidebarChatOrderByDrone: (next: Updater<Record<string, string[]>>) => void;
  setHiddenSidebarGroups: (next: Updater<string[]>) => void;
  setShowHiddenSidebarGroups: (next: Updater<boolean>) => void;
  setAutoDelete: (next: Updater<boolean>) => void;
  setTerminalEmulator: (next: Updater<string>) => void;
  setFleetDashboardOpen: (next: Updater<boolean>) => void;
  setSelectedDrone: (next: Updater<string | null>) => void;
  setSelectedDroneIds: (next: Updater<string[]>) => void;
  setSelectedGroupMultiChat: (next: Updater<string | null>) => void;
  setKanbanBoardOpen: (next: Updater<boolean>) => void;
  setPlaybookRunsOpen: (next: Updater<boolean>) => void;
  setGroupBroadcastExpanded: (next: Updater<boolean>) => void;
  setGroupMultiChatColumnWidth: (next: Updater<number>) => void;
  setGroupMultiChatStatusSort: (next: Updater<boolean>) => void;
  setSelectedChat: (next: Updater<string>) => void;
  setChatInputDraft: (draftKey: string, next: string) => void;
  setDraftChat: (next: Updater<DraftChatState | null>) => void;
  setSidebarCollapsed: (next: Updater<boolean>) => void;
  setReposModalOpen: (next: Updater<boolean>) => void;
  setDroneErrorModal: (next: Updater<DroneErrorModalState | null>) => void;
  setClearingDroneError: (next: Updater<boolean>) => void;
  setHeaderOverflowOpen: (next: Updater<boolean>) => void;
  setOutputView: (next: Updater<OutputView>) => void;
  setFsExplorerView: (next: Updater<FsExplorerView>) => void;
  setTranscriptInlineImages: (next: Updater<boolean>) => void;
  setShowCanvasLastMessagePreviews: (next: Updater<boolean>) => void;
  setAutomations: (next: Updater<AutomationConfig[]>) => void;
  addAutomation: (seed?: Partial<AutomationConfig>) => string;
  updateAutomation: (id: string, patch: Partial<AutomationConfig>) => void;
  removeAutomation: (id: string) => void;
  clearAutomations: () => void;
  setTranscriptInlineImageOverride: (messageId: string, next: boolean | null) => void;
  setSpawnContextRepoPath: (next: Updater<string>) => void;
  updateSpawnContextForRepo: (repoPath: string, next: Partial<SpawnContextPreferences>) => void;
  setSpawnAgentKey: (next: Updater<string>) => void;
  setSpawnModel: (next: Updater<string>) => void;
  rememberSeenModels: (models: Iterable<string | null | undefined>) => void;
  setRepoBranchSource: (next: Updater<RepoBranchSourceMode>) => void;
  setRepoCreateRemoteBranch: (next: Updater<string>) => void;
  setPullHostBranchBeforeCreate: (next: Updater<boolean>) => void;
  setCustomAgents: (next: Updater<CustomAgentProfile[]>) => void;
  setCustomAgentModalOpen: (next: Updater<boolean>) => void;
  setNewCustomAgentLabel: (next: Updater<string>) => void;
  setNewCustomAgentCommand: (next: Updater<string>) => void;
  setCustomAgentError: (next: Updater<string | null>) => void;
  setNameSuggestToast: (next: Updater<NameSuggestToast>) => void;
  setShortcutBindings: (next: Updater<ShortcutBindingMap>) => void;
  setShortcutBinding: (id: ShortcutActionId, binding: ShortcutBinding | null) => void;
  resetShortcutBindings: () => void;
  setTerminalMenuOpen: (next: Updater<boolean>) => void;
  setAgentMenuOpen: (next: Updater<boolean>) => void;
};

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

function normalizeSpawnAgentKeyValue(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return normalized || DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnAgentKey;
}

function normalizeRepoBranchSourceMode(value: unknown): RepoBranchSourceMode {
  return value === 'remote' ? 'remote' : 'host';
}

function normalizeSpawnContextRepoPath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function spawnContextRepoKeyForPath(repoPathRaw: unknown): string {
  const repoPath = normalizeSpawnContextRepoPath(repoPathRaw);
  return repoPath || NO_REPO_SPAWN_CONTEXT_KEY;
}

function normalizeSpawnContextPreferences(
  value: Partial<SpawnContextPreferences> | null | undefined,
): SpawnContextPreferences {
  return {
    spawnAgentKey: normalizeSpawnAgentKeyValue(value?.spawnAgentKey),
    spawnModel: normalizeTrimmedString(value?.spawnModel),
    repoBranchSource: normalizeRepoBranchSourceMode(value?.repoBranchSource),
    repoCreateRemoteBranch: normalizeTrimmedString(value?.repoCreateRemoteBranch),
    pullHostBranchBeforeCreate: normalizeBoolean(value?.pullHostBranchBeforeCreate),
  };
}

export function normalizeSpawnContextByRepoKey(value: unknown): Record<string, SpawnContextPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, SpawnContextPreferences> = {};
  for (const [keyRaw, entryRaw] of Object.entries(value as Record<string, unknown>)) {
    const key = String(keyRaw ?? '').trim();
    if (!key) continue;
    out[key] = normalizeSpawnContextPreferences(entryRaw as Partial<SpawnContextPreferences>);
  }
  return out;
}

export function resolveSpawnContextPreferencesForRepo(
  byRepoKey: Record<string, SpawnContextPreferences> | null | undefined,
  repoPathRaw: unknown,
): SpawnContextPreferences {
  const map = byRepoKey ?? {};
  const repoKey = spawnContextRepoKeyForPath(repoPathRaw);
  return (
    map[repoKey] ??
    map[NO_REPO_SPAWN_CONTEXT_KEY] ??
    DEFAULT_SPAWN_CONTEXT_PREFERENCES
  );
}

function buildUpdatedSpawnContextByRepoKey(
  prev: Record<string, SpawnContextPreferences>,
  repoPathRaw: unknown,
  patch: Partial<SpawnContextPreferences>,
): Record<string, SpawnContextPreferences> {
  const repoKey = spawnContextRepoKeyForPath(repoPathRaw);
  const merged = normalizeSpawnContextPreferences({
    ...resolveSpawnContextPreferencesForRepo(prev, repoPathRaw),
    ...patch,
  });
  const current = prev[repoKey];
  if (
    current &&
    current.spawnAgentKey === merged.spawnAgentKey &&
    current.spawnModel === merged.spawnModel &&
    current.repoBranchSource === merged.repoBranchSource &&
    current.repoCreateRemoteBranch === merged.repoCreateRemoteBranch &&
    current.pullHostBranchBeforeCreate === merged.pullHostBranchBeforeCreate
  ) {
    return prev;
  }
  return { ...prev, [repoKey]: merged };
}

type DroneHubUiPersistedState = Pick<
  DroneHubUiState,
  | 'activeRepoPath'
  | 'settingsActiveTab'
  | 'playbookRunsSelectionInitialized'
  | 'playbookRunsSelectedPlaybookId'
  | 'playbookRunsSelectedRepoPath'
  | 'kanbanBoardSelectionInitialized'
  | 'kanbanBoardScopeType'
  | 'kanbanBoardScopeValue'
  | 'kanbanBoardSelectedRepoPath'
  | 'kanbanBoardViewMode'
  | 'chatHeaderRepoPath'
  | 'sidebarReposCollapsed'
  | 'sidebarAutoMinimize'
  | 'sidebarGroupingMode'
  | 'sidebarDensityMode'
  | 'appView'
  | 'viewMode'
  | 'collapsedGroups'
  | 'sidebarGroupOrder'
  | 'sidebarRepoScopedGroupByPath'
  | 'sidebarDroneOrderByGroup'
  | 'sidebarNodeOrderByParent'
  | 'sidebarChatOrderByDrone'
  | 'hiddenSidebarGroups'
  | 'autoDelete'
  | 'terminalEmulator'
  | 'groupMultiChatColumnWidth'
  | 'groupMultiChatStatusSort'
  | 'outputView'
  | 'fsExplorerView'
  | 'transcriptInlineImages'
  | 'showCanvasLastMessagePreviews'
  | 'automations'
  | 'spawnContextByRepoKey'
  | 'spawnAgentKey'
  | 'spawnModel'
  | 'seenModelIds'
  | 'repoBranchSource'
  | 'repoCreateRemoteBranch'
  | 'pullHostBranchBeforeCreate'
  | 'customAgents'
  | 'shortcutBindings'
>;

export function migrateDroneHubUiPersistedState(
  persistedState: unknown,
  _version?: number,
): Partial<DroneHubUiPersistedState> {
  if (!persistedState || typeof persistedState !== 'object' || Array.isArray(persistedState)) return {};
  const migrated = { ...(persistedState as Partial<DroneHubUiPersistedState>) };
  const normalizedContexts = normalizeSpawnContextByRepoKey((migrated as any).spawnContextByRepoKey);
  if (Object.keys(normalizedContexts).length > 0) {
    migrated.spawnContextByRepoKey = normalizedContexts;
    return migrated;
  }
  const legacySpawnDefaults = normalizeSpawnContextPreferences({
    spawnAgentKey: migrated.spawnAgentKey,
    spawnModel: migrated.spawnModel,
    repoBranchSource: migrated.repoBranchSource,
    repoCreateRemoteBranch: migrated.repoCreateRemoteBranch,
    pullHostBranchBeforeCreate: migrated.pullHostBranchBeforeCreate,
  });
  migrated.spawnContextByRepoKey = {
    [NO_REPO_SPAWN_CONTEXT_KEY]: legacySpawnDefaults,
  };
  return migrated;
}

function sanitizeCustomAgents(value: unknown): CustomAgentProfile[] {
  try {
    const parsed = typeof value === 'string' ? (value ? (JSON.parse(value) as any) : []) : value;
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
}

function normalizeCollapsedGroups(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    out[key] = Boolean(v);
  }
  return out;
}

function normalizeOrderedStringMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    const list = normalizeSidebarGroupOrder(v);
    if (list.length === 0) continue;
    out[key] = list;
  }
  return out;
}

function normalizeAppView(value: unknown): AppView {
  return value === 'settings' ? 'settings' : 'workspace';
}

function normalizeViewMode(value: unknown): ViewMode {
  return value === 'flat' ? 'flat' : 'grouped';
}

function normalizeSidebarGroupingMode(value: unknown): SidebarGroupingMode {
  return value === 'groups' ? 'groups' : 'repos';
}

function normalizeSidebarDensityMode(value: unknown): SidebarDensityMode {
  return value === 'compact' || value === 'comfortable' ? value : 'default';
}

function normalizeOutputView(value: unknown): OutputView {
  return value === 'log' ? 'log' : 'screen';
}

function normalizeFsExplorerView(value: unknown): FsExplorerView {
  return value === 'thumb' ? 'thumb' : 'list';
}

function normalizeKanbanBoardViewMode(value: unknown): KanbanBoardViewMode {
  return value === 'table' ? 'table' : 'board';
}

function normalizeKanbanBoardScopeType(value: unknown): KanbanBoardScopeType {
  return value === 'repo' || value === 'group' || value === 'drone' ? value : 'global';
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeChatInputDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return {};
  const out: Record<string, string> = {};
  const trimmed = entries.slice(Math.max(0, entries.length - CHAT_INPUT_DRAFT_MAX_KEYS));
  for (const [k, v] of trimmed) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    const textRaw = typeof v === 'string' ? v : String(v ?? '');
    if (!textRaw) continue;
    out[key] = textRaw.slice(0, CHAT_INPUT_DRAFT_MAX_CHARS);
  }
  return out;
}

function isExactShortcutBinding(
  value: unknown,
  expected: ShortcutBinding | null,
): boolean {
  const normalized = sanitizeSingleShortcutBinding(value, null);
  if (!normalized || !expected) return normalized === expected;
  return (
    normalized.key === expected.key &&
    normalized.mod === expected.mod &&
    normalized.ctrl === expected.ctrl &&
    normalized.meta === expected.meta &&
    normalized.alt === expected.alt &&
    normalized.shift === expected.shift
  );
}

function migrateLegacyShortcutBindings(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const next = { ...raw };
  let changed = false;
  const createDraftRaw = raw.createDraftDrone;
  if (createDraftRaw && typeof createDraftRaw === 'object' && !Array.isArray(createDraftRaw)) {
    const binding = createDraftRaw as Record<string, unknown>;
    const key = String(binding.key ?? '').trim().toLowerCase();
    const mod = binding.mod === true;
    const ctrl = binding.ctrl === true;
    const meta = binding.meta === true;
    const alt = binding.alt === true;
    const shift = binding.shift === true;
    const isLegacyDefaultCreateShortcut = key === 'enter' && !mod && !ctrl && !meta && !alt && !shift;
    if (isLegacyDefaultCreateShortcut) {
      next.createDraftDrone = { key: 'tab', mod: false, ctrl: false, meta: false, alt: false, shift: false };
      changed = true;
    }
  }
  const hasCreateDroneChatBinding = Object.prototype.hasOwnProperty.call(raw, 'createDroneChat');
  const usesLegacyUnreadShortcut = isExactShortcutBinding(raw.markSelectedDronesUnread, {
    key: 'q',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  });
  const usesLegacyTldrShortcut = isExactShortcutBinding(raw.toggleTldr, {
    key: 'w',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  });
  if (!hasCreateDroneChatBinding && usesLegacyUnreadShortcut && usesLegacyTldrShortcut) {
    next.createDroneChat = { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    next.markSelectedDronesUnread = { key: 'z', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    next.toggleTldr = null;
    changed = true;
  }
  return changed ? next : value;
}

let pendingChatInputDraftsPersist: Record<string, string> | null = null;
let pendingChatInputDraftsTimer: ReturnType<typeof setTimeout> | null = null;

function readPersistedChatInputDrafts(): Record<string, string> {
  const directRaw = readLocalStorageItem(CHAT_INPUT_DRAFTS_STORAGE_KEY);
  if (directRaw) {
    try {
      return normalizeChatInputDrafts(JSON.parse(directRaw));
    } catch {
      // ignore
    }
  }
  return {};
}

function readPersistedDroneHubUiSelections(): Pick<
  DroneHubUiState,
  | 'playbookRunsSelectionInitialized'
  | 'playbookRunsSelectedPlaybookId'
  | 'playbookRunsSelectedRepoPath'
  | 'kanbanBoardSelectionInitialized'
  | 'kanbanBoardScopeType'
  | 'kanbanBoardScopeValue'
  | 'kanbanBoardSelectedRepoPath'
  | 'kanbanBoardViewMode'
> {
  const storageRaw = readLocalStorageItem(profileStorageKey('droneHub.ui'));
  if (!storageRaw) {
    return {
      playbookRunsSelectionInitialized: false,
      playbookRunsSelectedPlaybookId: '',
      playbookRunsSelectedRepoPath: '',
      kanbanBoardSelectionInitialized: false,
      kanbanBoardScopeType: 'global',
      kanbanBoardScopeValue: '',
      kanbanBoardSelectedRepoPath: '',
      kanbanBoardViewMode: 'board',
    };
  }
  try {
    const parsed = JSON.parse(storageRaw) as any;
    const persistedState =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'state')
        ? parsed.state
        : parsed;
    return {
      playbookRunsSelectionInitialized: normalizeBoolean(persistedState?.playbookRunsSelectionInitialized),
      playbookRunsSelectedPlaybookId: normalizeTrimmedString(persistedState?.playbookRunsSelectedPlaybookId),
      playbookRunsSelectedRepoPath: normalizeTrimmedString(persistedState?.playbookRunsSelectedRepoPath),
      kanbanBoardSelectionInitialized: normalizeBoolean(persistedState?.kanbanBoardSelectionInitialized),
      kanbanBoardScopeType: normalizeKanbanBoardScopeType(persistedState?.kanbanBoardScopeType),
      kanbanBoardScopeValue: normalizeTrimmedString(persistedState?.kanbanBoardScopeValue),
      kanbanBoardSelectedRepoPath: normalizeTrimmedString(persistedState?.kanbanBoardSelectedRepoPath),
      kanbanBoardViewMode: normalizeKanbanBoardViewMode(persistedState?.kanbanBoardViewMode),
    };
  } catch {
    return {
      playbookRunsSelectionInitialized: false,
      playbookRunsSelectedPlaybookId: '',
      playbookRunsSelectedRepoPath: '',
      kanbanBoardSelectionInitialized: false,
      kanbanBoardScopeType: 'global',
      kanbanBoardScopeValue: '',
      kanbanBoardSelectedRepoPath: '',
      kanbanBoardViewMode: 'board',
    };
  }
}

function writePersistedChatInputDrafts(value: Record<string, string>): void {
  try {
    if (Object.keys(value).length === 0) {
      localStorage.removeItem(CHAT_INPUT_DRAFTS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CHAT_INPUT_DRAFTS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function schedulePersistChatInputDrafts(value: Record<string, string>): void {
  pendingChatInputDraftsPersist = { ...value };
  if (pendingChatInputDraftsTimer) return;
  pendingChatInputDraftsTimer = setTimeout(() => {
    pendingChatInputDraftsTimer = null;
    const snapshot = pendingChatInputDraftsPersist;
    pendingChatInputDraftsPersist = null;
    writePersistedChatInputDrafts(snapshot ?? {});
  }, CHAT_INPUT_DRAFTS_PERSIST_DEBOUNCE_MS);
}

const initialChatInputDrafts = readPersistedChatInputDrafts();
const initialPlaybookRunsSelections = readPersistedDroneHubUiSelections();

export const useDroneHubUiStore = create<DroneHubUiState>()(
  persist(
    (set) => ({
      activeRepoPath: '',
      settingsActiveTab: 'general',
      settingsPlaybookFocusId: null,
      playbookRunsSelectionInitialized: initialPlaybookRunsSelections.playbookRunsSelectionInitialized,
      playbookRunsSelectedPlaybookId: initialPlaybookRunsSelections.playbookRunsSelectedPlaybookId,
      playbookRunsSelectedRepoPath: initialPlaybookRunsSelections.playbookRunsSelectedRepoPath,
      kanbanBoardSelectionInitialized: initialPlaybookRunsSelections.kanbanBoardSelectionInitialized,
      kanbanBoardScopeType: initialPlaybookRunsSelections.kanbanBoardScopeType,
      kanbanBoardScopeValue: initialPlaybookRunsSelections.kanbanBoardScopeValue,
      kanbanBoardSelectedRepoPath: initialPlaybookRunsSelections.kanbanBoardSelectedRepoPath,
      kanbanBoardViewMode: initialPlaybookRunsSelections.kanbanBoardViewMode,
      chatHeaderRepoPath: '',
      sidebarReposCollapsed: false,
      sidebarAutoMinimize: false,
      sidebarGroupingMode: 'repos',
      sidebarDensityMode: 'default',
      appView: 'workspace',
      viewMode: 'grouped',
      collapsedGroups: {},
      sidebarGroupOrder: [],
      sidebarRepoScopedGroupByPath: {},
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
      sidebarChatOrderByDrone: {},
      hiddenSidebarGroups: [],
      showHiddenSidebarGroups: false,
      autoDelete: false,
      terminalEmulator: 'auto',
      fleetDashboardOpen: false,
      selectedDrone: null,
      selectedDroneIds: [],
      selectedGroupMultiChat: null,
      kanbanBoardOpen: false,
      playbookRunsOpen: false,
      groupBroadcastExpanded: false,
      groupMultiChatColumnWidth: GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
      groupMultiChatStatusSort: false,
      selectedChat: 'default',
      chatInputDrafts: initialChatInputDrafts,
      draftChat: null,
      sidebarCollapsed: false,
      reposModalOpen: false,
      droneErrorModal: null,
      clearingDroneError: false,
      headerOverflowOpen: false,
      outputView: 'screen',
      fsExplorerView: 'list',
      transcriptInlineImages: false,
      showCanvasLastMessagePreviews: false,
      automations: [],
      transcriptInlineImageOverrides: {},
      spawnContextRepoPath: '',
      spawnContextByRepoKey: {
        [NO_REPO_SPAWN_CONTEXT_KEY]: { ...DEFAULT_SPAWN_CONTEXT_PREFERENCES },
      },
      spawnAgentKey: DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnAgentKey,
      spawnModel: DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnModel,
      seenModelIds: [],
      repoBranchSource: DEFAULT_SPAWN_CONTEXT_PREFERENCES.repoBranchSource,
      repoCreateRemoteBranch: DEFAULT_SPAWN_CONTEXT_PREFERENCES.repoCreateRemoteBranch,
      pullHostBranchBeforeCreate: DEFAULT_SPAWN_CONTEXT_PREFERENCES.pullHostBranchBeforeCreate,
      customAgents: [],
      customAgentModalOpen: false,
      newCustomAgentLabel: '',
      newCustomAgentCommand: '',
      customAgentError: null,
      nameSuggestToast: null,
      shortcutBindings: cloneDefaultShortcutBindings(),
      terminalMenuOpen: false,
      agentMenuOpen: false,
      setActiveRepoPath: (next) => set((s) => ({ activeRepoPath: resolveNext(s.activeRepoPath, next) })),
      setSettingsActiveTab: (next) => set((s) => ({ settingsActiveTab: resolveNext(s.settingsActiveTab, next) })),
      setSettingsPlaybookFocusId: (next) =>
        set((s) => ({ settingsPlaybookFocusId: resolveNext(s.settingsPlaybookFocusId, next) })),
      setPlaybookRunsSelectionInitialized: (next) =>
        set((s) => ({ playbookRunsSelectionInitialized: resolveNext(s.playbookRunsSelectionInitialized, next) })),
      setPlaybookRunsSelectedPlaybookId: (next) =>
        set((s) => ({ playbookRunsSelectedPlaybookId: normalizeTrimmedString(resolveNext(s.playbookRunsSelectedPlaybookId, next)) })),
      setPlaybookRunsSelectedRepoPath: (next) =>
        set((s) => ({ playbookRunsSelectedRepoPath: normalizeTrimmedString(resolveNext(s.playbookRunsSelectedRepoPath, next)) })),
      setKanbanBoardSelectionInitialized: (next) =>
        set((s) => ({ kanbanBoardSelectionInitialized: resolveNext(s.kanbanBoardSelectionInitialized, next) })),
      setKanbanBoardScopeType: (next) =>
        set((s) => ({ kanbanBoardScopeType: normalizeKanbanBoardScopeType(resolveNext(s.kanbanBoardScopeType, next)) })),
      setKanbanBoardScopeValue: (next) =>
        set((s) => ({ kanbanBoardScopeValue: normalizeTrimmedString(resolveNext(s.kanbanBoardScopeValue, next)) })),
      setKanbanBoardSelectedRepoPath: (next) =>
        set((s) => ({ kanbanBoardSelectedRepoPath: normalizeTrimmedString(resolveNext(s.kanbanBoardSelectedRepoPath, next)) })),
      setKanbanBoardViewMode: (next) =>
        set((s) => ({ kanbanBoardViewMode: normalizeKanbanBoardViewMode(resolveNext(s.kanbanBoardViewMode, next)) })),
      setChatHeaderRepoPath: (next) => set((s) => ({ chatHeaderRepoPath: resolveNext(s.chatHeaderRepoPath, next) })),
      setSidebarReposCollapsed: (next) => set((s) => ({ sidebarReposCollapsed: resolveNext(s.sidebarReposCollapsed, next) })),
      setSidebarAutoMinimize: (next) => set((s) => ({ sidebarAutoMinimize: resolveNext(s.sidebarAutoMinimize, next) })),
      setSidebarGroupingMode: (next) => set((s) => ({ sidebarGroupingMode: resolveNext(s.sidebarGroupingMode, next) })),
      setSidebarDensityMode: (next) =>
        set((s) => ({ sidebarDensityMode: normalizeSidebarDensityMode(resolveNext(s.sidebarDensityMode, next)) })),
      setAppView: (next) => set((s) => ({ appView: resolveNext(s.appView, next) })),
      setViewMode: (next) => set((s) => ({ viewMode: resolveNext(s.viewMode, next) })),
      setCollapsedGroups: (next) => set((s) => ({ collapsedGroups: resolveNext(s.collapsedGroups, next) })),
      setSidebarGroupOrder: (next) =>
        set((s) => ({ sidebarGroupOrder: normalizeSidebarGroupOrder(resolveNext(s.sidebarGroupOrder, next)) })),
      setSidebarRepoScopedGroupByPath: (next) =>
        set((s) => ({
          sidebarRepoScopedGroupByPath: normalizeSidebarRepoScopedGroupMap(
            resolveNext(s.sidebarRepoScopedGroupByPath, next),
          ),
        })),
      setSidebarDroneOrderByGroup: (next) =>
        set((s) => ({
          sidebarDroneOrderByGroup: normalizeOrderedStringMap(resolveNext(s.sidebarDroneOrderByGroup, next)),
        })),
      setSidebarNodeOrderByParent: (next) =>
        set((s) => ({
          sidebarNodeOrderByParent: normalizeOrderedStringMap(resolveNext(s.sidebarNodeOrderByParent, next)),
        })),
      setSidebarChatOrderByDrone: (next) =>
        set((s) => ({
          sidebarChatOrderByDrone: normalizeOrderedStringMap(resolveNext(s.sidebarChatOrderByDrone, next)),
        })),
      setHiddenSidebarGroups: (next) =>
        set((s) => ({ hiddenSidebarGroups: normalizeSidebarGroupOrder(resolveNext(s.hiddenSidebarGroups, next)) })),
      setShowHiddenSidebarGroups: (next) =>
        set((s) => ({ showHiddenSidebarGroups: resolveNext(s.showHiddenSidebarGroups, next) })),
      setAutoDelete: (next) => set((s) => ({ autoDelete: resolveNext(s.autoDelete, next) })),
      setTerminalEmulator: (next) => set((s) => ({ terminalEmulator: resolveNext(s.terminalEmulator, next) })),
      setFleetDashboardOpen: (next) => set((s) => ({ fleetDashboardOpen: resolveNext(s.fleetDashboardOpen, next) })),
      setSelectedDrone: (next) => set((s) => ({ selectedDrone: resolveNext(s.selectedDrone, next) })),
      setSelectedDroneIds: (next) => set((s) => ({ selectedDroneIds: resolveNext(s.selectedDroneIds, next) })),
      setSelectedGroupMultiChat: (next) => set((s) => ({ selectedGroupMultiChat: resolveNext(s.selectedGroupMultiChat, next) })),
      setKanbanBoardOpen: (next) => set((s) => ({ kanbanBoardOpen: resolveNext(s.kanbanBoardOpen, next) })),
      setPlaybookRunsOpen: (next) => set((s) => ({ playbookRunsOpen: resolveNext(s.playbookRunsOpen, next) })),
      setGroupBroadcastExpanded: (next) => set((s) => ({ groupBroadcastExpanded: resolveNext(s.groupBroadcastExpanded, next) })),
      setGroupMultiChatColumnWidth: (next) =>
        set((s) => ({
          groupMultiChatColumnWidth: clampGroupMultiChatColumnWidthPx(resolveNext(s.groupMultiChatColumnWidth, next)),
        })),
      setGroupMultiChatStatusSort: (next) =>
        set((s) => ({
          groupMultiChatStatusSort: resolveNext(s.groupMultiChatStatusSort, next),
        })),
      setSelectedChat: (next) => set((s) => ({ selectedChat: resolveNext(s.selectedChat, next) })),
      setChatInputDraft: (draftKeyRaw, nextRaw) =>
        set((s) => {
          const draftKey = String(draftKeyRaw ?? '').trim();
          if (!draftKey) return s;
          const nextText = String(nextRaw ?? '').slice(0, CHAT_INPUT_DRAFT_MAX_CHARS);
          if (!nextText) {
            if (!Object.prototype.hasOwnProperty.call(s.chatInputDrafts, draftKey)) return s;
            const trimmed = { ...s.chatInputDrafts };
            delete trimmed[draftKey];
            schedulePersistChatInputDrafts(trimmed);
            return { chatInputDrafts: trimmed };
          }
          if (s.chatInputDrafts[draftKey] === nextText) return s;
          const merged = { ...s.chatInputDrafts, [draftKey]: nextText };
          const keys = Object.keys(merged);
          if (keys.length > CHAT_INPUT_DRAFT_MAX_KEYS) {
            const overflow = keys.length - CHAT_INPUT_DRAFT_MAX_KEYS;
            for (const oldKey of keys.slice(0, overflow)) {
              delete merged[oldKey];
            }
          }
          schedulePersistChatInputDrafts(merged);
          return { chatInputDrafts: merged };
        }),
      setDraftChat: (next) => set((s) => ({ draftChat: resolveNext(s.draftChat, next) })),
      setSidebarCollapsed: (next) => set((s) => ({ sidebarCollapsed: resolveNext(s.sidebarCollapsed, next) })),
      setReposModalOpen: (next) => set((s) => ({ reposModalOpen: resolveNext(s.reposModalOpen, next) })),
      setDroneErrorModal: (next) => set((s) => ({ droneErrorModal: resolveNext(s.droneErrorModal, next) })),
      setClearingDroneError: (next) => set((s) => ({ clearingDroneError: resolveNext(s.clearingDroneError, next) })),
      setHeaderOverflowOpen: (next) => set((s) => ({ headerOverflowOpen: resolveNext(s.headerOverflowOpen, next) })),
      setOutputView: (next) => set((s) => ({ outputView: resolveNext(s.outputView, next) })),
      setFsExplorerView: (next) => set((s) => ({ fsExplorerView: resolveNext(s.fsExplorerView, next) })),
      setTranscriptInlineImages: (next) =>
        set((s) => ({ transcriptInlineImages: resolveNext(s.transcriptInlineImages, next) })),
      setShowCanvasLastMessagePreviews: (next) =>
        set((s) => ({ showCanvasLastMessagePreviews: resolveNext(s.showCanvasLastMessagePreviews, next) })),
      setAutomations: (next) =>
        set((s) => ({
          automations: normalizeAutomationConfigs(resolveNext(s.automations, next)),
        })),
      addAutomation: (seed) => {
        const created = createAutomationConfig(seed);
        set((s) => {
          if (s.automations.some((item) => item.id === created.id)) return s;
          return { automations: normalizeAutomationConfigs([...s.automations, created]) };
        });
        return created.id;
      },
      updateAutomation: (idRaw, patch) =>
        set((s) => {
          const id = String(idRaw ?? '').trim();
          if (!id) return s;
          const idx = s.automations.findIndex((item) => item.id === id);
          if (idx < 0) return s;
          const cur = s.automations[idx];
          const next = patchAutomationConfig(cur, patch);
          if (automationConfigsEqual(next, cur)) return s;
          const merged = s.automations.slice();
          merged[idx] = next;
          return { automations: merged };
        }),
      removeAutomation: (idRaw) =>
        set((s) => {
          const id = String(idRaw ?? '').trim();
          if (!id) return s;
          const next = s.automations.filter((item) => item.id !== id);
          if (next.length === s.automations.length) return s;
          return { automations: next };
        }),
      clearAutomations: () => set((s) => (s.automations.length ? { automations: [] } : s)),
      setTranscriptInlineImageOverride: (messageIdRaw, next) =>
        set((s) => {
          const messageId = String(messageIdRaw ?? '').trim();
          if (!messageId) return s;
          const current = s.transcriptInlineImageOverrides;
          if (next == null) {
            if (!Object.prototype.hasOwnProperty.call(current, messageId)) return s;
            const trimmed = { ...current };
            delete trimmed[messageId];
            return { transcriptInlineImageOverrides: trimmed };
          }
          const nextValue = Boolean(next);
          if (current[messageId] === nextValue) return s;
          const merged = { ...current, [messageId]: nextValue };
          const keys = Object.keys(merged);
          if (keys.length > 600) {
            for (const oldKey of keys.slice(0, keys.length - 600)) {
              delete merged[oldKey];
            }
          }
          return { transcriptInlineImageOverrides: merged };
        }),
      setSpawnContextRepoPath: (next) =>
        set((s) => {
          const repoPath = normalizeSpawnContextRepoPath(resolveNext(s.spawnContextRepoPath, next));
          if (repoPath === s.spawnContextRepoPath) return s;
          const resolved = resolveSpawnContextPreferencesForRepo(s.spawnContextByRepoKey, repoPath);
          return {
            spawnContextRepoPath: repoPath,
            spawnAgentKey: resolved.spawnAgentKey,
            spawnModel: resolved.spawnModel,
            repoBranchSource: resolved.repoBranchSource,
            repoCreateRemoteBranch: resolved.repoCreateRemoteBranch,
            pullHostBranchBeforeCreate: resolved.pullHostBranchBeforeCreate,
          };
        }),
      updateSpawnContextForRepo: (repoPathRaw, patch) =>
        set((s) => {
          const repoPath = normalizeSpawnContextRepoPath(repoPathRaw);
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(s.spawnContextByRepoKey, repoPath, patch);
          if (nextByRepoKey === s.spawnContextByRepoKey) return s;
          if (spawnContextRepoKeyForPath(s.spawnContextRepoPath) !== spawnContextRepoKeyForPath(repoPath)) {
            return { spawnContextByRepoKey: nextByRepoKey };
          }
          const resolved = resolveSpawnContextPreferencesForRepo(nextByRepoKey, repoPath);
          return {
            spawnContextByRepoKey: nextByRepoKey,
            spawnAgentKey: resolved.spawnAgentKey,
            spawnModel: resolved.spawnModel,
            repoBranchSource: resolved.repoBranchSource,
            repoCreateRemoteBranch: resolved.repoCreateRemoteBranch,
            pullHostBranchBeforeCreate: resolved.pullHostBranchBeforeCreate,
          };
        }),
      setSpawnAgentKey: (next) =>
        set((s) => {
          const spawnAgentKey = normalizeSpawnAgentKeyValue(resolveNext(s.spawnAgentKey, next));
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(s.spawnContextByRepoKey, s.spawnContextRepoPath, {
            spawnAgentKey,
          });
          return {
            spawnAgentKey,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setSpawnModel: (next) =>
        set((s) => {
          const spawnModel = normalizeTrimmedString(resolveNext(s.spawnModel, next));
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(s.spawnContextByRepoKey, s.spawnContextRepoPath, {
            spawnModel,
          });
          return {
            spawnModel,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      rememberSeenModels: (models) =>
        set((s) => {
          const next = mergeSeenModelIds(s.seenModelIds, models);
          if (next.length === s.seenModelIds.length && next.every((id, index) => id === s.seenModelIds[index])) {
            return s;
          }
          return { seenModelIds: next };
        }),
      setRepoBranchSource: (next) =>
        set((s) => {
          const repoBranchSource = normalizeRepoBranchSourceMode(resolveNext(s.repoBranchSource, next));
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(s.spawnContextByRepoKey, s.spawnContextRepoPath, {
            repoBranchSource,
          });
          return {
            repoBranchSource,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setRepoCreateRemoteBranch: (next) =>
        set((s) => {
          const repoCreateRemoteBranch = normalizeTrimmedString(resolveNext(s.repoCreateRemoteBranch, next));
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(s.spawnContextByRepoKey, s.spawnContextRepoPath, {
            repoCreateRemoteBranch,
          });
          return {
            repoCreateRemoteBranch,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setPullHostBranchBeforeCreate: (next) =>
        set((s) => {
          const pullHostBranchBeforeCreate = resolveNext(s.pullHostBranchBeforeCreate, next) === true;
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(s.spawnContextByRepoKey, s.spawnContextRepoPath, {
            pullHostBranchBeforeCreate,
          });
          return {
            pullHostBranchBeforeCreate,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setCustomAgents: (next) => set((s) => ({ customAgents: resolveNext(s.customAgents, next) })),
      setCustomAgentModalOpen: (next) => set((s) => ({ customAgentModalOpen: resolveNext(s.customAgentModalOpen, next) })),
      setNewCustomAgentLabel: (next) => set((s) => ({ newCustomAgentLabel: resolveNext(s.newCustomAgentLabel, next) })),
      setNewCustomAgentCommand: (next) => set((s) => ({ newCustomAgentCommand: resolveNext(s.newCustomAgentCommand, next) })),
      setCustomAgentError: (next) => set((s) => ({ customAgentError: resolveNext(s.customAgentError, next) })),
      setNameSuggestToast: (next) => set((s) => ({ nameSuggestToast: resolveNext(s.nameSuggestToast, next) })),
      setShortcutBindings: (next) =>
        set((s) => ({
          shortcutBindings: sanitizeShortcutBindings(resolveNext(s.shortcutBindings, next)),
        })),
      setShortcutBinding: (id, binding) =>
        set((s) => ({
          shortcutBindings: {
            ...s.shortcutBindings,
            [id]: sanitizeSingleShortcutBinding(binding, s.shortcutBindings[id]),
          },
        })),
      resetShortcutBindings: () => set({ shortcutBindings: cloneDefaultShortcutBindings() }),
      setTerminalMenuOpen: (next) => set((s) => ({ terminalMenuOpen: resolveNext(s.terminalMenuOpen, next) })),
      setAgentMenuOpen: (next) => set((s) => ({ agentMenuOpen: resolveNext(s.agentMenuOpen, next) })),
    }),
    {
      name: profileStorageKey('droneHub.ui'),
      version: 13,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => migrateDroneHubUiPersistedState(persistedState, version),
      partialize: (state): DroneHubUiPersistedState => ({
        activeRepoPath: state.activeRepoPath,
        settingsActiveTab: state.settingsActiveTab,
        playbookRunsSelectionInitialized: state.playbookRunsSelectionInitialized,
        playbookRunsSelectedPlaybookId: state.playbookRunsSelectedPlaybookId,
        playbookRunsSelectedRepoPath: state.playbookRunsSelectedRepoPath,
        kanbanBoardSelectionInitialized: state.kanbanBoardSelectionInitialized,
        kanbanBoardScopeType: state.kanbanBoardScopeType,
        kanbanBoardScopeValue: state.kanbanBoardScopeValue,
        kanbanBoardSelectedRepoPath: state.kanbanBoardSelectedRepoPath,
        kanbanBoardViewMode: state.kanbanBoardViewMode,
        chatHeaderRepoPath: state.chatHeaderRepoPath,
        sidebarReposCollapsed: state.sidebarReposCollapsed,
        sidebarAutoMinimize: state.sidebarAutoMinimize,
        sidebarGroupingMode: state.sidebarGroupingMode,
        sidebarDensityMode: state.sidebarDensityMode,
        appView: state.appView,
        viewMode: state.viewMode,
        collapsedGroups: state.collapsedGroups,
        sidebarGroupOrder: state.sidebarGroupOrder,
        sidebarRepoScopedGroupByPath: state.sidebarRepoScopedGroupByPath,
        sidebarDroneOrderByGroup: state.sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent: state.sidebarNodeOrderByParent,
        sidebarChatOrderByDrone: state.sidebarChatOrderByDrone,
        hiddenSidebarGroups: state.hiddenSidebarGroups,
        autoDelete: state.autoDelete,
        terminalEmulator: state.terminalEmulator,
        groupMultiChatColumnWidth: state.groupMultiChatColumnWidth,
        groupMultiChatStatusSort: state.groupMultiChatStatusSort,
        outputView: state.outputView,
        fsExplorerView: state.fsExplorerView,
        transcriptInlineImages: state.transcriptInlineImages,
        showCanvasLastMessagePreviews: state.showCanvasLastMessagePreviews,
        automations: state.automations,
        spawnContextByRepoKey: state.spawnContextByRepoKey,
        spawnAgentKey: state.spawnAgentKey,
        spawnModel: state.spawnModel,
        seenModelIds: state.seenModelIds,
        repoBranchSource: state.repoBranchSource,
        repoCreateRemoteBranch: state.repoCreateRemoteBranch,
        pullHostBranchBeforeCreate: state.pullHostBranchBeforeCreate,
        customAgents: state.customAgents,
        shortcutBindings: state.shortcutBindings,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<DroneHubUiPersistedState>) ?? {};
        const { kanbanBoard: _ignoredKanbanBoard, ...persistedRest } = persisted as Partial<
          DroneHubUiPersistedState & { kanbanBoard?: unknown }
        >;
        const migratedShortcutBindings = migrateLegacyShortcutBindings(persisted.shortcutBindings);
        return {
          ...currentState,
          ...persistedRest,
          settingsActiveTab:
            persisted.settingsActiveTab === 'general' ||
            persisted.settingsActiveTab === 'sync' ||
            persisted.settingsActiveTab === 'profiles' ||
            persisted.settingsActiveTab === 'trash' ||
            persisted.settingsActiveTab === 'archive' ||
            persisted.settingsActiveTab === 'shortcuts' ||
            persisted.settingsActiveTab === 'automations' ||
            persisted.settingsActiveTab === 'playbooks' ||
            persisted.settingsActiveTab === 'skills' ||
            persisted.settingsActiveTab === 'agents' ||
            persisted.settingsActiveTab === 'system'
              ? persisted.settingsActiveTab
              : currentState.settingsActiveTab,
          playbookRunsSelectionInitialized: normalizeBoolean(
            persisted.playbookRunsSelectionInitialized ?? currentState.playbookRunsSelectionInitialized,
          ),
          playbookRunsSelectedPlaybookId: normalizeTrimmedString(
            persisted.playbookRunsSelectedPlaybookId ?? currentState.playbookRunsSelectedPlaybookId,
          ),
          playbookRunsSelectedRepoPath: normalizeTrimmedString(
            persisted.playbookRunsSelectedRepoPath ?? currentState.playbookRunsSelectedRepoPath,
          ),
          kanbanBoardSelectionInitialized: normalizeBoolean(
            persisted.kanbanBoardSelectionInitialized ?? currentState.kanbanBoardSelectionInitialized,
          ),
          kanbanBoardScopeType: normalizeKanbanBoardScopeType(
            persisted.kanbanBoardScopeType ?? currentState.kanbanBoardScopeType,
          ),
          kanbanBoardScopeValue: normalizeTrimmedString(
            persisted.kanbanBoardScopeValue ?? currentState.kanbanBoardScopeValue,
          ),
          kanbanBoardSelectedRepoPath: normalizeTrimmedString(
            persisted.kanbanBoardSelectedRepoPath ?? currentState.kanbanBoardSelectedRepoPath,
          ),
          kanbanBoardViewMode: normalizeKanbanBoardViewMode(
            persisted.kanbanBoardViewMode ?? currentState.kanbanBoardViewMode,
          ),
          appView: normalizeAppView(persisted.appView ?? currentState.appView),
          sidebarAutoMinimize: normalizeBoolean(persisted.sidebarAutoMinimize ?? currentState.sidebarAutoMinimize),
          sidebarGroupingMode: normalizeSidebarGroupingMode(
            persisted.sidebarGroupingMode ?? currentState.sidebarGroupingMode,
          ),
          sidebarDensityMode: normalizeSidebarDensityMode(
            persisted.sidebarDensityMode ?? currentState.sidebarDensityMode,
          ),
          viewMode: normalizeViewMode(persisted.viewMode ?? currentState.viewMode),
          collapsedGroups: normalizeCollapsedGroups(persisted.collapsedGroups ?? currentState.collapsedGroups),
          sidebarGroupOrder: normalizeSidebarGroupOrder(
            persisted.sidebarGroupOrder ?? currentState.sidebarGroupOrder,
          ),
          sidebarRepoScopedGroupByPath: normalizeSidebarRepoScopedGroupMap(
            (persisted as any).sidebarRepoScopedGroupByPath ?? currentState.sidebarRepoScopedGroupByPath,
          ),
          sidebarDroneOrderByGroup: normalizeOrderedStringMap(
            persisted.sidebarDroneOrderByGroup ?? currentState.sidebarDroneOrderByGroup,
          ),
          sidebarNodeOrderByParent: normalizeOrderedStringMap(
            (persisted as any).sidebarNodeOrderByParent ?? currentState.sidebarNodeOrderByParent,
          ),
          sidebarChatOrderByDrone: normalizeOrderedStringMap(
            persisted.sidebarChatOrderByDrone ?? currentState.sidebarChatOrderByDrone,
          ),
          hiddenSidebarGroups: normalizeSidebarGroupOrder(
            persisted.hiddenSidebarGroups ?? currentState.hiddenSidebarGroups,
          ),
          groupMultiChatColumnWidth: clampGroupMultiChatColumnWidthPx(
            Number(persisted.groupMultiChatColumnWidth ?? currentState.groupMultiChatColumnWidth),
          ),
          groupMultiChatStatusSort: normalizeBoolean(
            persisted.groupMultiChatStatusSort ?? currentState.groupMultiChatStatusSort,
          ),
          outputView: normalizeOutputView(persisted.outputView ?? currentState.outputView),
          fsExplorerView: normalizeFsExplorerView(persisted.fsExplorerView ?? currentState.fsExplorerView),
          transcriptInlineImages: normalizeBoolean(
            persisted.transcriptInlineImages ?? currentState.transcriptInlineImages,
          ),
          showCanvasLastMessagePreviews: normalizeBoolean(
            persisted.showCanvasLastMessagePreviews ?? currentState.showCanvasLastMessagePreviews,
          ),
          automations: normalizeAutomationConfigs(
            (persisted as any).automations ?? currentState.automations,
          ),
          spawnContextByRepoKey: normalizeSpawnContextByRepoKey(
            (persisted as any).spawnContextByRepoKey ?? currentState.spawnContextByRepoKey,
          ),
          seenModelIds: normalizeSeenModelIds(
            persisted.seenModelIds ?? currentState.seenModelIds,
          ),
          repoBranchSource:
            persisted.repoBranchSource === 'remote' || persisted.repoBranchSource === 'host'
              ? persisted.repoBranchSource
              : currentState.repoBranchSource,
          repoCreateRemoteBranch: normalizeTrimmedString(
            persisted.repoCreateRemoteBranch ?? currentState.repoCreateRemoteBranch,
          ),
          pullHostBranchBeforeCreate: normalizeBoolean(
            persisted.pullHostBranchBeforeCreate ?? currentState.pullHostBranchBeforeCreate,
          ),
          customAgents: sanitizeCustomAgents(persisted.customAgents ?? currentState.customAgents),
          shortcutBindings: sanitizeShortcutBindings(migratedShortcutBindings ?? currentState.shortcutBindings),
        };
      },
    },
  ),
);

export function useDroneHubAppModelUiState() {
  return useDroneHubUiStore(
    useShallow((s) => ({
      activeRepoPath: s.activeRepoPath,
      settingsActiveTab: s.settingsActiveTab,
      settingsPlaybookFocusId: s.settingsPlaybookFocusId,
      playbookRunsSelectionInitialized: s.playbookRunsSelectionInitialized,
      playbookRunsSelectedPlaybookId: s.playbookRunsSelectedPlaybookId,
      playbookRunsSelectedRepoPath: s.playbookRunsSelectedRepoPath,
      kanbanBoardSelectionInitialized: s.kanbanBoardSelectionInitialized,
      kanbanBoardScopeType: s.kanbanBoardScopeType,
      kanbanBoardScopeValue: s.kanbanBoardScopeValue,
      kanbanBoardSelectedRepoPath: s.kanbanBoardSelectedRepoPath,
      kanbanBoardViewMode: s.kanbanBoardViewMode,
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      appView: s.appView,
      viewMode: s.viewMode,
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarDensityMode: s.sidebarDensityMode,
      collapsedGroups: s.collapsedGroups,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      showHiddenSidebarGroups: s.showHiddenSidebarGroups,
      autoDelete: s.autoDelete,
      terminalEmulator: s.terminalEmulator,
      fleetDashboardOpen: s.fleetDashboardOpen,
      selectedDrone: s.selectedDrone,
      selectedDroneIds: s.selectedDroneIds,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      kanbanBoardOpen: s.kanbanBoardOpen,
      playbookRunsOpen: s.playbookRunsOpen,
      selectedChat: s.selectedChat,
      draftChat: s.draftChat,
      sidebarCollapsed: s.sidebarCollapsed,
      reposModalOpen: s.reposModalOpen,
      droneErrorModal: s.droneErrorModal,
      clearingDroneError: s.clearingDroneError,
      headerOverflowOpen: s.headerOverflowOpen,
      outputView: s.outputView,
      fsExplorerView: s.fsExplorerView,
      showCanvasLastMessagePreviews: s.showCanvasLastMessagePreviews,
      spawnContextRepoPath: s.spawnContextRepoPath,
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      seenModelIds: s.seenModelIds,
      repoBranchSource: s.repoBranchSource,
      repoCreateRemoteBranch: s.repoCreateRemoteBranch,
      pullHostBranchBeforeCreate: s.pullHostBranchBeforeCreate,
      customAgents: s.customAgents,
      customAgentModalOpen: s.customAgentModalOpen,
      newCustomAgentLabel: s.newCustomAgentLabel,
      newCustomAgentCommand: s.newCustomAgentCommand,
      customAgentError: s.customAgentError,
      nameSuggestToast: s.nameSuggestToast,
      shortcutBindings: s.shortcutBindings,
      terminalMenuOpen: s.terminalMenuOpen,
      setActiveRepoPath: s.setActiveRepoPath,
      setSettingsActiveTab: s.setSettingsActiveTab,
      setSettingsPlaybookFocusId: s.setSettingsPlaybookFocusId,
      setPlaybookRunsSelectionInitialized: s.setPlaybookRunsSelectionInitialized,
      setPlaybookRunsSelectedPlaybookId: s.setPlaybookRunsSelectedPlaybookId,
      setPlaybookRunsSelectedRepoPath: s.setPlaybookRunsSelectedRepoPath,
      setKanbanBoardSelectionInitialized: s.setKanbanBoardSelectionInitialized,
      setKanbanBoardScopeType: s.setKanbanBoardScopeType,
      setKanbanBoardScopeValue: s.setKanbanBoardScopeValue,
      setKanbanBoardSelectedRepoPath: s.setKanbanBoardSelectedRepoPath,
      setKanbanBoardViewMode: s.setKanbanBoardViewMode,
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
      setAppView: s.setAppView,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarDensityMode: s.setSidebarDensityMode,
      setCollapsedGroups: s.setCollapsedGroups,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setShowHiddenSidebarGroups: s.setShowHiddenSidebarGroups,
      setFleetDashboardOpen: s.setFleetDashboardOpen,
      setSelectedDrone: s.setSelectedDrone,
      setSelectedDroneIds: s.setSelectedDroneIds,
      setSelectedGroupMultiChat: s.setSelectedGroupMultiChat,
      setKanbanBoardOpen: s.setKanbanBoardOpen,
      setPlaybookRunsOpen: s.setPlaybookRunsOpen,
      setGroupBroadcastExpanded: s.setGroupBroadcastExpanded,
      setSelectedChat: s.setSelectedChat,
      setDraftChat: s.setDraftChat,
      setSidebarCollapsed: s.setSidebarCollapsed,
      setReposModalOpen: s.setReposModalOpen,
      setDroneErrorModal: s.setDroneErrorModal,
      setClearingDroneError: s.setClearingDroneError,
      setHeaderOverflowOpen: s.setHeaderOverflowOpen,
      setOutputView: s.setOutputView,
      setFsExplorerView: s.setFsExplorerView,
      setShowCanvasLastMessagePreviews: s.setShowCanvasLastMessagePreviews,
      setSpawnContextRepoPath: s.setSpawnContextRepoPath,
      updateSpawnContextForRepo: s.updateSpawnContextForRepo,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      rememberSeenModels: s.rememberSeenModels,
      setRepoBranchSource: s.setRepoBranchSource,
      setRepoCreateRemoteBranch: s.setRepoCreateRemoteBranch,
      setPullHostBranchBeforeCreate: s.setPullHostBranchBeforeCreate,
      setCustomAgents: s.setCustomAgents,
      setCustomAgentModalOpen: s.setCustomAgentModalOpen,
      setNewCustomAgentLabel: s.setNewCustomAgentLabel,
      setNewCustomAgentCommand: s.setNewCustomAgentCommand,
      setCustomAgentError: s.setCustomAgentError,
      setNameSuggestToast: s.setNameSuggestToast,
      setShortcutBindings: s.setShortcutBindings,
      setShortcutBinding: s.setShortcutBinding,
      resetShortcutBindings: s.resetShortcutBindings,
      setTerminalMenuOpen: s.setTerminalMenuOpen,
    })),
  );
}

export function useDroneSidebarUiState() {
  return useDroneHubUiStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebarCollapsed,
      selectedDroneIds: s.selectedDroneIds,
      draftChat: s.draftChat,
      appView: s.appView,
      viewMode: s.viewMode,
      activeRepoPath: s.activeRepoPath,
      fleetDashboardOpen: s.fleetDashboardOpen,
      selectedDrone: s.selectedDrone,
      selectedChat: s.selectedChat,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      kanbanBoardOpen: s.kanbanBoardOpen,
      playbookRunsOpen: s.playbookRunsOpen,
      sidebarReposCollapsed: s.sidebarReposCollapsed,
      sidebarAutoMinimize: s.sidebarAutoMinimize,
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarDensityMode: s.sidebarDensityMode,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarRepoScopedGroupByPath: s.sidebarRepoScopedGroupByPath,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      showHiddenSidebarGroups: s.showHiddenSidebarGroups,
      autoDelete: s.autoDelete,
      setAppView: s.setAppView,
      setViewMode: s.setViewMode,
      setSidebarReposCollapsed: s.setSidebarReposCollapsed,
      setSidebarAutoMinimize: s.setSidebarAutoMinimize,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarDensityMode: s.setSidebarDensityMode,
      setCollapsedGroups: s.setCollapsedGroups,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarRepoScopedGroupByPath: s.setSidebarRepoScopedGroupByPath,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setShowHiddenSidebarGroups: s.setShowHiddenSidebarGroups,
      setActiveRepoPath: s.setActiveRepoPath,
      setAutoDelete: s.setAutoDelete,
      setFleetDashboardOpen: s.setFleetDashboardOpen,
      setKanbanBoardOpen: s.setKanbanBoardOpen,
      setPlaybookRunsOpen: s.setPlaybookRunsOpen,
      setSidebarCollapsed: s.setSidebarCollapsed,
    })),
  );
}

export function useSelectedDroneWorkspaceUiState() {
  return useDroneHubUiStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebarCollapsed,
      agentMenuOpen: s.agentMenuOpen,
      terminalMenuOpen: s.terminalMenuOpen,
      headerOverflowOpen: s.headerOverflowOpen,
      outputView: s.outputView,
      selectedChat: s.selectedChat,
      terminalEmulator: s.terminalEmulator,
      setSidebarCollapsed: s.setSidebarCollapsed,
      setAgentMenuOpen: s.setAgentMenuOpen,
      setTerminalMenuOpen: s.setTerminalMenuOpen,
      setHeaderOverflowOpen: s.setHeaderOverflowOpen,
      setOutputView: s.setOutputView,
      setSelectedChat: s.setSelectedChat,
      setTerminalEmulator: s.setTerminalEmulator,
    })),
  );
}
