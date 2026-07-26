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
import type { SidebarDensityMode } from './settings-types';
import { normalizeSidebarRepoScopedGroupMap } from './sidebar-repo-scoped-groups';
import { normalizeSidebarGroupOrder } from './sidebar-group-order';
import { mergeSeenModelIds, normalizeSeenModelIds } from './spawn-model-history';
import { profileStorageKey } from '../../profile-storage';
import { DEFAULT_DESKTOP_THEME_ID, normalizeDesktopThemeId, type DesktopThemeId } from '../../theme';

type Updater<T> = T | ((prev: T) => T);

type NameSuggestToast = null | {
  id: string;
  title?: string;
  message: string;
  tone?: 'success' | 'error';
  voiceLevel?: number;
  voiceActive?: boolean;
};
type SidebarGroupingMode = 'groups' | 'repos';
export type SidebarDockSide = 'left' | 'right';
type OutputView = 'screen' | 'log';
type SpawnContextPreferences = {
  spawnAgentKey: string;
  spawnModel: string;
  spawnReasoning: string;
  repoBranchSource: RepoBranchSourceMode;
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
};
const CHAT_INPUT_DRAFT_MAX_CHARS = 300_000;
const CHAT_INPUT_DRAFT_MAX_KEYS = 80;
const CHAT_INPUT_DRAFTS_STORAGE_KEY = profileStorageKey('droneHub.chatInputDrafts');
const CHAT_INPUT_DRAFTS_PERSIST_DEBOUNCE_MS = 300;
const NO_REPO_SPAWN_CONTEXT_KEY = '__no_repo__';
const DEFAULT_SPAWN_CONTEXT_PREFERENCES: SpawnContextPreferences = {
  spawnAgentKey: 'builtin:cursor',
  spawnModel: '',
  spawnReasoning: '',
  repoBranchSource: 'host',
  repoCreateRemoteBranch: '',
  pullHostBranchBeforeCreate: true,
};

type DroneHubUiState = {
  themeId: DesktopThemeId;
  activeRepoPath: string;
  settingsActiveTab: SettingsTabId;
  chatHeaderRepoPath: string;
  sidebarReposCollapsed: boolean;
  sidebarAutoMinimize: boolean;
  showRecentDronesOnly: boolean;
  sidebarGroupingMode: SidebarGroupingMode;
  sidebarDensityMode: SidebarDensityMode;
  sidebarDockSide: SidebarDockSide;
  appView: AppView;
  collapsedGroups: Record<string, boolean>;
  sidebarGroupOrder: string[];
  sidebarRepoScopedGroupByPath: Record<string, string>;
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  pinnedDroneIds: string[];
  hiddenSidebarGroups: string[];
  showHiddenSidebarGroups: boolean;
  autoDelete: boolean;
  terminalEmulator: string;
  homeOpen: boolean;
  selectedDrone: string | null;
  selectedDroneIds: string[];
  selectedGroupMultiChat: string | null;
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
  showCanvasLastMessagePreviews: boolean;
  transcriptInlineImageOverrides: Record<string, boolean>;
  spawnContextRepoPath: string;
  spawnContextByRepoKey: Record<string, SpawnContextPreferences>;
  spawnAgentKey: string;
  spawnModel: string;
  spawnReasoning: string;
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
  setThemeId: (next: Updater<DesktopThemeId>) => void;
  setActiveRepoPath: (next: Updater<string>) => void;
  setSettingsActiveTab: (next: Updater<SettingsTabId>) => void;
  setChatHeaderRepoPath: (next: Updater<string>) => void;
  setSidebarReposCollapsed: (next: Updater<boolean>) => void;
  setSidebarAutoMinimize: (next: Updater<boolean>) => void;
  setShowRecentDronesOnly: (next: Updater<boolean>) => void;
  setSidebarGroupingMode: (next: Updater<SidebarGroupingMode>) => void;
  setSidebarDensityMode: (next: Updater<SidebarDensityMode>) => void;
  setSidebarDockSide: (next: Updater<SidebarDockSide>) => void;
  setAppView: (next: Updater<AppView>) => void;
  setCollapsedGroups: (next: Updater<Record<string, boolean>>) => void;
  setSidebarGroupOrder: (next: Updater<string[]>) => void;
  setSidebarRepoScopedGroupByPath: (next: Updater<Record<string, string>>) => void;
  setSidebarDroneOrderByGroup: (next: Updater<Record<string, string[]>>) => void;
  setSidebarNodeOrderByParent: (next: Updater<Record<string, string[]>>) => void;
  setSidebarChatOrderByDrone: (next: Updater<Record<string, string[]>>) => void;
  setPinnedDroneIds: (next: Updater<string[]>) => void;
  setHiddenSidebarGroups: (next: Updater<string[]>) => void;
  setShowHiddenSidebarGroups: (next: Updater<boolean>) => void;
  setAutoDelete: (next: Updater<boolean>) => void;
  setTerminalEmulator: (next: Updater<string>) => void;
  setHomeOpen: (next: Updater<boolean>) => void;
  setSelectedDrone: (next: Updater<string | null>) => void;
  setSelectedDroneIds: (next: Updater<string[]>) => void;
  setSelectedGroupMultiChat: (next: Updater<string | null>) => void;
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
  setShowCanvasLastMessagePreviews: (next: Updater<boolean>) => void;
  setTranscriptInlineImageOverride: (messageId: string, next: boolean | null) => void;
  setSpawnContextRepoPath: (next: Updater<string>) => void;
  updateSpawnContextForRepo: (repoPath: string, next: Partial<SpawnContextPreferences>) => void;
  setSpawnAgentKey: (next: Updater<string>) => void;
  setSpawnModel: (next: Updater<string>) => void;
  setSpawnReasoning: (next: Updater<string>) => void;
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

function normalizePullHostBranchBeforeCreate(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SPAWN_CONTEXT_PREFERENCES.pullHostBranchBeforeCreate;
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
    spawnReasoning: normalizeTrimmedString(value?.spawnReasoning),
    repoBranchSource: normalizeRepoBranchSourceMode(value?.repoBranchSource),
    repoCreateRemoteBranch: normalizeTrimmedString(value?.repoCreateRemoteBranch),
    pullHostBranchBeforeCreate: normalizePullHostBranchBeforeCreate(value?.pullHostBranchBeforeCreate),
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
    current.spawnReasoning === merged.spawnReasoning &&
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
  | 'themeId'
  | 'activeRepoPath'
  | 'settingsActiveTab'
  | 'chatHeaderRepoPath'
  | 'sidebarReposCollapsed'
  | 'sidebarAutoMinimize'
  | 'showRecentDronesOnly'
  | 'sidebarGroupingMode'
  | 'sidebarDensityMode'
  | 'sidebarDockSide'
  | 'appView'
  | 'collapsedGroups'
  | 'sidebarGroupOrder'
  | 'sidebarRepoScopedGroupByPath'
  | 'sidebarDroneOrderByGroup'
  | 'sidebarNodeOrderByParent'
  | 'sidebarChatOrderByDrone'
  | 'pinnedDroneIds'
  | 'hiddenSidebarGroups'
  | 'autoDelete'
  | 'terminalEmulator'
  | 'selectedDrone'
  | 'selectedDroneIds'
  | 'selectedChat'
  | 'groupMultiChatColumnWidth'
  | 'groupMultiChatStatusSort'
  | 'outputView'
  | 'showCanvasLastMessagePreviews'
  | 'spawnContextByRepoKey'
  | 'spawnAgentKey'
  | 'spawnModel'
  | 'spawnReasoning'
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
  const {
    fsExplorerView: _ignoredFsExplorerView,
    transcriptInlineImages: _ignoredTranscriptInlineImages,
    viewMode: _ignoredViewMode,
    ...persisted
  } = persistedState as Partial<DroneHubUiPersistedState> & {
    fsExplorerView?: unknown;
    transcriptInlineImages?: unknown;
    viewMode?: unknown;
  };
  const migrated = { ...persisted };
  if (Object.prototype.hasOwnProperty.call(migrated, 'themeId')) {
    migrated.themeId = normalizeDesktopThemeId(migrated.themeId);
  }
  delete (migrated as any).automations;
  delete (migrated as any).playbookRunsSelectionInitialized;
  delete (migrated as any).playbookRunsSelectedPlaybookId;
  delete (migrated as any).playbookRunsSelectedRepoPath;
  if (Object.prototype.hasOwnProperty.call(migrated, 'sidebarDockSide')) {
    migrated.sidebarDockSide = normalizeSidebarDockSide(migrated.sidebarDockSide);
  }
  delete (migrated as any).assistantThreadSidebarDockSide;
  const migratedShortcutBindings = migrateLegacyShortcutBindings(migrated.shortcutBindings);
  if (migratedShortcutBindings !== undefined) {
    migrated.shortcutBindings = migratedShortcutBindings as ShortcutBindingMap;
  }
  const normalizedContexts = normalizeSpawnContextByRepoKey((migrated as any).spawnContextByRepoKey);
  if (Object.keys(normalizedContexts).length > 0) {
    migrated.spawnContextByRepoKey = normalizedContexts;
    return migrated;
  }
  const legacySpawnDefaults = normalizeSpawnContextPreferences({
    spawnAgentKey: migrated.spawnAgentKey,
    spawnModel: migrated.spawnModel,
    spawnReasoning: migrated.spawnReasoning,
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

function normalizeSidebarGroupingMode(value: unknown): SidebarGroupingMode {
  return value === 'groups' ? 'groups' : 'repos';
}

function normalizeSidebarDensityMode(value: unknown): SidebarDensityMode {
  return value === 'compact' || value === 'comfortable' ? value : 'default';
}

function normalizeSidebarDockSide(value: unknown): SidebarDockSide {
  return value === 'right' ? 'right' : 'left';
}

function normalizeOutputView(value: unknown): OutputView {
  return value === 'log' ? 'log' : 'screen';
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
  if (!hasCreateDroneChatBinding && usesLegacyUnreadShortcut) {
    next.markSelectedDronesUnread = { key: 'z', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    changed = true;
  }
  const hasCreateChildDraftDroneBinding = Object.prototype.hasOwnProperty.call(next, 'createChildDraftDrone');
  const usesLegacyCreateChatShortcut = isExactShortcutBinding(next.createDroneChat, {
    key: 'q',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  });
  const usesCurrentUnreadShortcut = isExactShortcutBinding(next.markSelectedDronesUnread, {
    key: 'z',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  });
  if (!hasCreateChildDraftDroneBinding && usesLegacyCreateChatShortcut && usesCurrentUnreadShortcut) {
    next.createChildDraftDrone = { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    next.createDroneChat = { key: 'w', mod: false, ctrl: false, meta: false, alt: false, shift: false };
    changed = true;
  }
  const currentDefaultMigrations: Array<[keyof ShortcutBindingMap, string, string]> = [
    ['createDraftDrone', 'tab', '1'],
    ['createChildDraftDrone', 'q', '3'],
    ['createDroneChat', 'w', '2'],
  ];
  for (const [actionId, previousKey, nextKey] of currentDefaultMigrations) {
    if (!isExactShortcutBinding(next[actionId], {
      key: previousKey,
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    })) continue;
    next[actionId] = {
      key: nextKey,
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };
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

export const useDroneHubUiStore = create<DroneHubUiState>()(
  persist(
    (set) => ({
      themeId: DEFAULT_DESKTOP_THEME_ID,
      activeRepoPath: '',
      settingsActiveTab: 'general',
      chatHeaderRepoPath: '',
      sidebarReposCollapsed: false,
      sidebarAutoMinimize: false,
      showRecentDronesOnly: false,
      sidebarGroupingMode: 'repos',
      sidebarDensityMode: 'default',
      sidebarDockSide: 'left',
      appView: 'workspace',
      collapsedGroups: {},
      sidebarGroupOrder: [],
      sidebarRepoScopedGroupByPath: {},
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
      sidebarChatOrderByDrone: {},
      pinnedDroneIds: [],
      hiddenSidebarGroups: [],
      showHiddenSidebarGroups: false,
      autoDelete: false,
      terminalEmulator: 'auto',
      homeOpen: false,
      selectedDrone: null,
      selectedDroneIds: [],
      selectedGroupMultiChat: null,
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
      showCanvasLastMessagePreviews: false,
      transcriptInlineImageOverrides: {},
      spawnContextRepoPath: '',
      spawnContextByRepoKey: {
        [NO_REPO_SPAWN_CONTEXT_KEY]: { ...DEFAULT_SPAWN_CONTEXT_PREFERENCES },
      },
      spawnAgentKey: DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnAgentKey,
      spawnModel: DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnModel,
      spawnReasoning: '',
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
      setThemeId: (next) =>
        set((s) => ({ themeId: normalizeDesktopThemeId(resolveNext(s.themeId, next)) })),
      setActiveRepoPath: (next) => set((s) => ({ activeRepoPath: resolveNext(s.activeRepoPath, next) })),
      setSettingsActiveTab: (next) => set((s) => ({ settingsActiveTab: resolveNext(s.settingsActiveTab, next) })),
      setChatHeaderRepoPath: (next) => set((s) => ({ chatHeaderRepoPath: resolveNext(s.chatHeaderRepoPath, next) })),
      setSidebarReposCollapsed: (next) => set((s) => ({ sidebarReposCollapsed: resolveNext(s.sidebarReposCollapsed, next) })),
      setSidebarAutoMinimize: (next) => set((s) => ({ sidebarAutoMinimize: resolveNext(s.sidebarAutoMinimize, next) })),
      setShowRecentDronesOnly: (next) =>
        set((s) => ({ showRecentDronesOnly: resolveNext(s.showRecentDronesOnly, next) })),
      setSidebarGroupingMode: (next) => set((s) => ({ sidebarGroupingMode: resolveNext(s.sidebarGroupingMode, next) })),
      setSidebarDensityMode: (next) =>
        set((s) => ({ sidebarDensityMode: normalizeSidebarDensityMode(resolveNext(s.sidebarDensityMode, next)) })),
      setSidebarDockSide: (next) =>
        set((s) => ({ sidebarDockSide: normalizeSidebarDockSide(resolveNext(s.sidebarDockSide, next)) })),
      setAppView: (next) => set((s) => ({ appView: resolveNext(s.appView, next) })),
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
      setPinnedDroneIds: (next) =>
        set((s) => ({ pinnedDroneIds: normalizeSidebarGroupOrder(resolveNext(s.pinnedDroneIds, next)) })),
      setHiddenSidebarGroups: (next) =>
        set((s) => ({ hiddenSidebarGroups: normalizeSidebarGroupOrder(resolveNext(s.hiddenSidebarGroups, next)) })),
      setShowHiddenSidebarGroups: (next) =>
        set((s) => ({ showHiddenSidebarGroups: resolveNext(s.showHiddenSidebarGroups, next) })),
      setAutoDelete: (next) => set((s) => ({ autoDelete: resolveNext(s.autoDelete, next) })),
      setTerminalEmulator: (next) => set((s) => ({ terminalEmulator: resolveNext(s.terminalEmulator, next) })),
      setHomeOpen: (next) => set((s) => ({ homeOpen: resolveNext(s.homeOpen, next) })),
      setSelectedDrone: (next) => set((s) => ({ selectedDrone: resolveNext(s.selectedDrone, next) })),
      setSelectedDroneIds: (next) => set((s) => ({ selectedDroneIds: resolveNext(s.selectedDroneIds, next) })),
      setSelectedGroupMultiChat: (next) => set((s) => ({ selectedGroupMultiChat: resolveNext(s.selectedGroupMultiChat, next) })),
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
      setShowCanvasLastMessagePreviews: (next) =>
        set((s) => ({ showCanvasLastMessagePreviews: resolveNext(s.showCanvasLastMessagePreviews, next) })),
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
            spawnReasoning: resolved.spawnReasoning,
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
            spawnReasoning: resolved.spawnReasoning,
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
      setSpawnReasoning: (next) =>
        set((s) => {
          const spawnReasoning = normalizeTrimmedString(resolveNext(s.spawnReasoning, next));
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(s.spawnContextByRepoKey, s.spawnContextRepoPath, {
            spawnReasoning,
          });
          return { spawnReasoning, spawnContextByRepoKey: nextByRepoKey };
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
      version: 15,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => migrateDroneHubUiPersistedState(persistedState, version),
      partialize: (state): DroneHubUiPersistedState => ({
        themeId: state.themeId,
        activeRepoPath: state.activeRepoPath,
        settingsActiveTab: state.settingsActiveTab,
        chatHeaderRepoPath: state.chatHeaderRepoPath,
        sidebarReposCollapsed: state.sidebarReposCollapsed,
        sidebarAutoMinimize: state.sidebarAutoMinimize,
        showRecentDronesOnly: state.showRecentDronesOnly,
        sidebarGroupingMode: state.sidebarGroupingMode,
        sidebarDensityMode: state.sidebarDensityMode,
        sidebarDockSide: state.sidebarDockSide,
        appView: state.appView,
        collapsedGroups: state.collapsedGroups,
        sidebarGroupOrder: state.sidebarGroupOrder,
        sidebarRepoScopedGroupByPath: state.sidebarRepoScopedGroupByPath,
        sidebarDroneOrderByGroup: state.sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent: state.sidebarNodeOrderByParent,
        sidebarChatOrderByDrone: state.sidebarChatOrderByDrone,
        pinnedDroneIds: state.pinnedDroneIds,
        hiddenSidebarGroups: state.hiddenSidebarGroups,
        autoDelete: state.autoDelete,
        terminalEmulator: state.terminalEmulator,
        selectedDrone: state.selectedDrone,
        selectedDroneIds: state.selectedDroneIds,
        selectedChat: state.selectedChat,
        groupMultiChatColumnWidth: state.groupMultiChatColumnWidth,
        groupMultiChatStatusSort: state.groupMultiChatStatusSort,
        outputView: state.outputView,
        showCanvasLastMessagePreviews: state.showCanvasLastMessagePreviews,
        spawnContextByRepoKey: state.spawnContextByRepoKey,
        spawnAgentKey: state.spawnAgentKey,
        spawnModel: state.spawnModel,
        spawnReasoning: state.spawnReasoning,
        seenModelIds: state.seenModelIds,
        repoBranchSource: state.repoBranchSource,
        repoCreateRemoteBranch: state.repoCreateRemoteBranch,
        pullHostBranchBeforeCreate: state.pullHostBranchBeforeCreate,
        customAgents: state.customAgents,
        shortcutBindings: state.shortcutBindings,
      }),
      merge: (persistedState, currentState) => {
        const persisted = migrateDroneHubUiPersistedState(persistedState);
        const persistedRest = persisted;
        const migratedShortcutBindings = migrateLegacyShortcutBindings(persisted.shortcutBindings);
        return {
          ...currentState,
          ...persistedRest,
          themeId: normalizeDesktopThemeId(persisted.themeId ?? currentState.themeId),
          settingsActiveTab:
            persisted.settingsActiveTab === 'general' ||
            persisted.settingsActiveTab === 'devices' ||
            persisted.settingsActiveTab === 'sync' ||
            persisted.settingsActiveTab === 'backups' ||
            persisted.settingsActiveTab === 'profiles' ||
            persisted.settingsActiveTab === 'trash' ||
            persisted.settingsActiveTab === 'archive' ||
            persisted.settingsActiveTab === 'shortcuts' ||
            persisted.settingsActiveTab === 'skills' ||
            persisted.settingsActiveTab === 'mcp' ||
            persisted.settingsActiveTab === 'agents' ||
            persisted.settingsActiveTab === 'components' ||
            persisted.settingsActiveTab === 'system'
              ? persisted.settingsActiveTab
              : currentState.settingsActiveTab,
          appView: normalizeAppView(persisted.appView ?? currentState.appView),
          sidebarAutoMinimize: normalizeBoolean(persisted.sidebarAutoMinimize ?? currentState.sidebarAutoMinimize),
          showRecentDronesOnly: normalizeBoolean(
            persisted.showRecentDronesOnly ?? currentState.showRecentDronesOnly,
          ),
          sidebarGroupingMode: normalizeSidebarGroupingMode(
            persisted.sidebarGroupingMode ?? currentState.sidebarGroupingMode,
          ),
          sidebarDensityMode: normalizeSidebarDensityMode(
            persisted.sidebarDensityMode ?? currentState.sidebarDensityMode,
          ),
          sidebarDockSide: normalizeSidebarDockSide(persisted.sidebarDockSide ?? currentState.sidebarDockSide),
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
          pinnedDroneIds: normalizeSidebarGroupOrder(
            persisted.pinnedDroneIds ?? currentState.pinnedDroneIds,
          ),
          hiddenSidebarGroups: normalizeSidebarGroupOrder(
            persisted.hiddenSidebarGroups ?? currentState.hiddenSidebarGroups,
          ),
          selectedDrone: normalizeTrimmedString(persisted.selectedDrone) || null,
          selectedDroneIds: normalizeSidebarGroupOrder(persisted.selectedDroneIds),
          selectedChat: normalizeTrimmedString(persisted.selectedChat) || currentState.selectedChat,
          groupMultiChatColumnWidth: clampGroupMultiChatColumnWidthPx(
            Number(persisted.groupMultiChatColumnWidth ?? currentState.groupMultiChatColumnWidth),
          ),
          groupMultiChatStatusSort: normalizeBoolean(
            persisted.groupMultiChatStatusSort ?? currentState.groupMultiChatStatusSort,
          ),
          outputView: normalizeOutputView(persisted.outputView ?? currentState.outputView),
          showCanvasLastMessagePreviews: normalizeBoolean(
            persisted.showCanvasLastMessagePreviews ?? currentState.showCanvasLastMessagePreviews,
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
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      appView: s.appView,
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarDensityMode: s.sidebarDensityMode,
      sidebarDockSide: s.sidebarDockSide,
      showRecentDronesOnly: s.showRecentDronesOnly,
      collapsedGroups: s.collapsedGroups,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      pinnedDroneIds: s.pinnedDroneIds,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      showHiddenSidebarGroups: s.showHiddenSidebarGroups,
      autoDelete: s.autoDelete,
      terminalEmulator: s.terminalEmulator,
      homeOpen: s.homeOpen,
      selectedDrone: s.selectedDrone,
      selectedDroneIds: s.selectedDroneIds,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      selectedChat: s.selectedChat,
      draftChat: s.draftChat,
      sidebarCollapsed: s.sidebarCollapsed,
      reposModalOpen: s.reposModalOpen,
      droneErrorModal: s.droneErrorModal,
      clearingDroneError: s.clearingDroneError,
      headerOverflowOpen: s.headerOverflowOpen,
      outputView: s.outputView,
      showCanvasLastMessagePreviews: s.showCanvasLastMessagePreviews,
      spawnContextRepoPath: s.spawnContextRepoPath,
      spawnContextByRepoKey: s.spawnContextByRepoKey,
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      spawnReasoning: s.spawnReasoning,
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
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
      setAppView: s.setAppView,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarDensityMode: s.setSidebarDensityMode,
      setSidebarDockSide: s.setSidebarDockSide,
      setShowRecentDronesOnly: s.setShowRecentDronesOnly,
      setCollapsedGroups: s.setCollapsedGroups,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setPinnedDroneIds: s.setPinnedDroneIds,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setShowHiddenSidebarGroups: s.setShowHiddenSidebarGroups,
      setHomeOpen: s.setHomeOpen,
      setSelectedDrone: s.setSelectedDrone,
      setSelectedDroneIds: s.setSelectedDroneIds,
      setSelectedGroupMultiChat: s.setSelectedGroupMultiChat,
      setGroupBroadcastExpanded: s.setGroupBroadcastExpanded,
      setSelectedChat: s.setSelectedChat,
      setDraftChat: s.setDraftChat,
      setSidebarCollapsed: s.setSidebarCollapsed,
      setReposModalOpen: s.setReposModalOpen,
      setDroneErrorModal: s.setDroneErrorModal,
      setClearingDroneError: s.setClearingDroneError,
      setHeaderOverflowOpen: s.setHeaderOverflowOpen,
      setOutputView: s.setOutputView,
      setShowCanvasLastMessagePreviews: s.setShowCanvasLastMessagePreviews,
      setSpawnContextRepoPath: s.setSpawnContextRepoPath,
      updateSpawnContextForRepo: s.updateSpawnContextForRepo,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      setSpawnReasoning: s.setSpawnReasoning,
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
      settingsActiveTab: s.settingsActiveTab,
      appView: s.appView,
      activeRepoPath: s.activeRepoPath,
      homeOpen: s.homeOpen,
      selectedDrone: s.selectedDrone,
      selectedChat: s.selectedChat,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      sidebarReposCollapsed: s.sidebarReposCollapsed,
      sidebarAutoMinimize: s.sidebarAutoMinimize,
      showRecentDronesOnly: s.showRecentDronesOnly,
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarDensityMode: s.sidebarDensityMode,
      sidebarDockSide: s.sidebarDockSide,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarRepoScopedGroupByPath: s.sidebarRepoScopedGroupByPath,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      pinnedDroneIds: s.pinnedDroneIds,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      showHiddenSidebarGroups: s.showHiddenSidebarGroups,
      autoDelete: s.autoDelete,
      setSettingsActiveTab: s.setSettingsActiveTab,
      setAppView: s.setAppView,
      setSidebarReposCollapsed: s.setSidebarReposCollapsed,
      setSidebarAutoMinimize: s.setSidebarAutoMinimize,
      setShowRecentDronesOnly: s.setShowRecentDronesOnly,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarDensityMode: s.setSidebarDensityMode,
      setSidebarDockSide: s.setSidebarDockSide,
      setCollapsedGroups: s.setCollapsedGroups,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarRepoScopedGroupByPath: s.setSidebarRepoScopedGroupByPath,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setPinnedDroneIds: s.setPinnedDroneIds,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setShowHiddenSidebarGroups: s.setShowHiddenSidebarGroups,
      setSelectedDrone: s.setSelectedDrone,
      setSelectedDroneIds: s.setSelectedDroneIds,
      setSelectedChat: s.setSelectedChat,
      setActiveRepoPath: s.setActiveRepoPath,
      setAutoDelete: s.setAutoDelete,
      setHomeOpen: s.setHomeOpen,
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
