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
  migrateChatComposerShortcuts,
  migrateCompanionShortcut,
  migrateFormerPullRequestsShortcut,
  sanitizeSingleShortcutBinding,
  sanitizeShortcutBindings,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutBindingMap,
} from './shortcuts';
import { readLocalStorageItem } from './hooks';
import type { CustomAgentProfile } from '../types';
import type { AgentApprovalPolicy, AgentPermissionMode } from '../../domain';
import type { SettingsTabId } from './settings-tabs';
import type { RepoBranchSourceMode } from './drone-create-runtime';
import type { ReadingDensityMode, SidebarDensityMode } from './settings-types';
import { normalizeSidebarGroupOrder } from './sidebar-group-order';
import { mergeSeenModelIds, normalizeSeenModelIds } from './spawn-model-history';
import { profileStorageKey } from '../../profile-storage';
import {
  DEFAULT_DESKTOP_THEME_ID,
  normalizeDesktopThemeId,
  type DesktopThemeId,
} from '../../theme';

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
export type PinnedSidebarPlacement = 'top' | 'bottom';
type OutputView = 'screen' | 'log';
export type SpawnContextPreferences = {
  spawnAgentKey: string;
  spawnModel: string;
  spawnReasoning: string;
  spawnAgentPermissionMode: AgentPermissionMode;
  spawnApprovalPolicy: AgentApprovalPolicy;
  repoBranchSource: RepoBranchSourceMode;
  repoCreateRemoteBranch: string;
};
export type RepoChatSelection = {
  droneId: string;
  chatName: string;
};
const CHAT_INPUT_DRAFT_MAX_CHARS = 300_000;
const CHAT_INPUT_PERSISTED_MAX_KEYS = 80;
const CHAT_INPUT_DRAFTS_STORAGE_KEY = profileStorageKey('droneHub.chatInputDrafts');
const CHAT_INPUT_DRAFTS_PERSIST_DEBOUNCE_MS = 300;
const NO_REPO_SPAWN_CONTEXT_KEY = '__no_repo__';
const DEFAULT_SPAWN_CONTEXT_PREFERENCES: SpawnContextPreferences = {
  spawnAgentKey: 'builtin:cursor',
  spawnModel: '',
  spawnReasoning: '',
  spawnAgentPermissionMode: 'execute',
  spawnApprovalPolicy: 'ask',
  repoBranchSource: 'host',
  repoCreateRemoteBranch: '',
};

type DroneHubUiState = {
  themeId: DesktopThemeId;
  readingDensityMode: ReadingDensityMode;
  activeRepoPath: string;
  settingsActiveTab: SettingsTabId;
  chatHeaderRepoPath: string;
  sidebarReposCollapsed: boolean;
  sidebarAutoMinimize: boolean;
  showRecentDronesOnly: boolean;
  sidebarGroupingMode: SidebarGroupingMode;
  sidebarDensityMode: SidebarDensityMode;
  sidebarDockSide: SidebarDockSide;
  pinnedSidebarPlacement: PinnedSidebarPlacement;
  pinnedSidebarCollapsed: boolean;
  appView: AppView;
  collapsedGroups: Record<string, boolean>;
  collapsedDroneSections: Record<string, boolean>;
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  sidebarChatGroupPathsByDrone: Record<string, string[]>;
  sidebarChatGroupByChat: Record<string, string>;
  sidebarChatNodeOrderByParent: Record<string, string[]>;
  pinnedDroneIds: string[];
  mutedSidebarGroupIds: string[];
  mutedDroneIds: string[];
  mutedChatIds: string[];
  toDoDroneIds: string[];
  hiddenSidebarGroups: string[];
  showHiddenSidebarGroups: boolean;
  terminalEmulator: string;
  homeOpen: boolean;
  selectedDrone: string | null;
  selectedDroneIds: string[];
  selectedGroupMultiChat: string | null;
  groupBroadcastExpanded: boolean;
  groupMultiChatColumnWidth: number;
  groupMultiChatStatusSort: boolean;
  selectedChat: string;
  lastChatSelectionByRepoPath: Record<string, RepoChatSelection>;
  chatInputDrafts: Record<string, string>;
  chatInputEditorModes: Record<string, true>;
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
  spawnAgentPermissionMode: AgentPermissionMode;
  spawnApprovalPolicy: AgentApprovalPolicy;
  seenModelIds: string[];
  repoBranchSource: RepoBranchSourceMode;
  repoCreateRemoteBranch: string;
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
  setReadingDensityMode: (next: Updater<ReadingDensityMode>) => void;
  setActiveRepoPath: (next: Updater<string>) => void;
  setSettingsActiveTab: (next: Updater<SettingsTabId>) => void;
  setChatHeaderRepoPath: (next: Updater<string>) => void;
  setSidebarReposCollapsed: (next: Updater<boolean>) => void;
  setSidebarAutoMinimize: (next: Updater<boolean>) => void;
  setShowRecentDronesOnly: (next: Updater<boolean>) => void;
  setSidebarGroupingMode: (next: Updater<SidebarGroupingMode>) => void;
  setSidebarDensityMode: (next: Updater<SidebarDensityMode>) => void;
  setSidebarDockSide: (next: Updater<SidebarDockSide>) => void;
  setPinnedSidebarPlacement: (next: Updater<PinnedSidebarPlacement>) => void;
  setPinnedSidebarCollapsed: (next: Updater<boolean>) => void;
  setAppView: (next: Updater<AppView>) => void;
  setCollapsedGroups: (next: Updater<Record<string, boolean>>) => void;
  setCollapsedDroneSections: (next: Updater<Record<string, boolean>>) => void;
  setSidebarGroupOrder: (next: Updater<string[]>) => void;
  setSidebarDroneOrderByGroup: (next: Updater<Record<string, string[]>>) => void;
  setSidebarNodeOrderByParent: (next: Updater<Record<string, string[]>>) => void;
  setSidebarChatOrderByDrone: (next: Updater<Record<string, string[]>>) => void;
  setSidebarChatGroupPathsByDrone: (next: Updater<Record<string, string[]>>) => void;
  setSidebarChatGroupByChat: (next: Updater<Record<string, string>>) => void;
  setSidebarChatNodeOrderByParent: (next: Updater<Record<string, string[]>>) => void;
  setPinnedDroneIds: (next: Updater<string[]>) => void;
  setMutedSidebarGroupIds: (next: Updater<string[]>) => void;
  setMutedDroneIds: (next: Updater<string[]>) => void;
  setMutedChatIds: (next: Updater<string[]>) => void;
  setToDoDroneIds: (next: Updater<string[]>) => void;
  setHiddenSidebarGroups: (next: Updater<string[]>) => void;
  setShowHiddenSidebarGroups: (next: Updater<boolean>) => void;
  setTerminalEmulator: (next: Updater<string>) => void;
  setHomeOpen: (next: Updater<boolean>) => void;
  setSelectedDrone: (next: Updater<string | null>) => void;
  setSelectedDroneIds: (next: Updater<string[]>) => void;
  setSelectedGroupMultiChat: (next: Updater<string | null>) => void;
  setGroupBroadcastExpanded: (next: Updater<boolean>) => void;
  setGroupMultiChatColumnWidth: (next: Updater<number>) => void;
  setGroupMultiChatStatusSort: (next: Updater<boolean>) => void;
  setSelectedChat: (next: Updater<string>) => void;
  rememberRepoChatSelection: (repoPath: string, droneId: string, chatName: string) => void;
  setChatInputDraft: (draftKey: string, next: string) => void;
  setChatInputEditorMode: (draftKey: string, next: boolean) => void;
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
  setSpawnAgentPermissionMode: (next: Updater<AgentPermissionMode>) => void;
  setSpawnApprovalPolicy: (next: Updater<AgentApprovalPolicy>) => void;
  rememberSeenModels: (models: Iterable<string | null | undefined>) => void;
  setRepoBranchSource: (next: Updater<RepoBranchSourceMode>) => void;
  setRepoCreateRemoteBranch: (next: Updater<string>) => void;
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
  return normalized.slice(0, 200) || DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnAgentKey;
}

function normalizeRepoBranchSourceMode(value: unknown): RepoBranchSourceMode {
  return value === 'remote' ? 'remote' : 'host';
}

function normalizeSpawnAgentPermissionMode(value: unknown): AgentPermissionMode {
  return value === 'read' || value === 'write' ? value : 'execute';
}

function normalizeSpawnApprovalPolicy(value: unknown): AgentApprovalPolicy {
  return value === 'auto' || value === 'none' ? value : 'ask';
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
    spawnModel: normalizeTrimmedString(value?.spawnModel).slice(0, 200),
    spawnReasoning: normalizeTrimmedString(value?.spawnReasoning).slice(0, 200),
    spawnAgentPermissionMode: normalizeSpawnAgentPermissionMode(value?.spawnAgentPermissionMode),
    spawnApprovalPolicy: normalizeSpawnApprovalPolicy(value?.spawnApprovalPolicy),
    repoBranchSource: normalizeRepoBranchSourceMode(value?.repoBranchSource),
    repoCreateRemoteBranch: normalizeTrimmedString(value?.repoCreateRemoteBranch).slice(0, 400),
  };
}

export function normalizeSpawnContextByRepoKey(
  value: unknown,
): Record<string, SpawnContextPreferences> {
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
  return map[repoKey] ?? map[NO_REPO_SPAWN_CONTEXT_KEY] ?? DEFAULT_SPAWN_CONTEXT_PREFERENCES;
}

export function hasSpawnContextPreferencesForRepo(
  byRepoKey: Record<string, SpawnContextPreferences> | null | undefined,
  repoPathRaw: unknown,
): boolean {
  const map = byRepoKey ?? {};
  const repoKey = spawnContextRepoKeyForPath(repoPathRaw);
  return (
    Object.prototype.hasOwnProperty.call(map, repoKey) ||
    (repoKey !== NO_REPO_SPAWN_CONTEXT_KEY &&
      Object.prototype.hasOwnProperty.call(map, NO_REPO_SPAWN_CONTEXT_KEY))
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
    current.spawnAgentPermissionMode === merged.spawnAgentPermissionMode &&
    current.spawnApprovalPolicy === merged.spawnApprovalPolicy &&
    current.repoBranchSource === merged.repoBranchSource &&
    current.repoCreateRemoteBranch === merged.repoCreateRemoteBranch
  ) {
    return prev;
  }
  return { ...prev, [repoKey]: merged };
}

type DroneHubUiPersistedState = Pick<
  DroneHubUiState,
  | 'themeId'
  | 'readingDensityMode'
  | 'activeRepoPath'
  | 'settingsActiveTab'
  | 'chatHeaderRepoPath'
  | 'sidebarReposCollapsed'
  | 'sidebarAutoMinimize'
  | 'showRecentDronesOnly'
  | 'sidebarGroupingMode'
  | 'sidebarDensityMode'
  | 'sidebarDockSide'
  | 'pinnedSidebarPlacement'
  | 'pinnedSidebarCollapsed'
  | 'appView'
  | 'collapsedGroups'
  | 'collapsedDroneSections'
  | 'sidebarGroupOrder'
  | 'sidebarDroneOrderByGroup'
  | 'sidebarNodeOrderByParent'
  | 'sidebarChatOrderByDrone'
  | 'sidebarChatGroupPathsByDrone'
  | 'sidebarChatGroupByChat'
  | 'sidebarChatNodeOrderByParent'
  | 'pinnedDroneIds'
  | 'mutedSidebarGroupIds'
  | 'mutedDroneIds'
  | 'mutedChatIds'
  | 'toDoDroneIds'
  | 'hiddenSidebarGroups'
  | 'terminalEmulator'
  | 'selectedDrone'
  | 'selectedDroneIds'
  | 'selectedChat'
  | 'lastChatSelectionByRepoPath'
  | 'chatInputEditorModes'
  | 'groupMultiChatColumnWidth'
  | 'groupMultiChatStatusSort'
  | 'outputView'
  | 'showCanvasLastMessagePreviews'
  | 'spawnContextByRepoKey'
  | 'spawnAgentKey'
  | 'spawnModel'
  | 'spawnReasoning'
  | 'spawnAgentPermissionMode'
  | 'spawnApprovalPolicy'
  | 'seenModelIds'
  | 'repoBranchSource'
  | 'repoCreateRemoteBranch'
  | 'customAgents'
  | 'shortcutBindings'
>;

export function normalizeLastChatSelectionByRepoPath(
  value: unknown,
): Record<string, RepoChatSelection> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, RepoChatSelection> = {};
  for (const [repoPathRaw, selectionRaw] of Object.entries(value as Record<string, unknown>)) {
    const repoPath = String(repoPathRaw ?? '').trim();
    if (
      !repoPath ||
      !selectionRaw ||
      typeof selectionRaw !== 'object' ||
      Array.isArray(selectionRaw)
    ) {
      continue;
    }
    const selection = selectionRaw as Partial<RepoChatSelection>;
    const droneId = String(selection.droneId ?? '').trim();
    if (!droneId) continue;
    out[repoPath] = {
      droneId,
      chatName: String(selection.chatName ?? '').trim() || 'default',
    };
  }
  return out;
}

export function normalizeChatInputEditorModes(value: unknown): Record<string, true> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, true> = {};
  for (const [keyRaw, enabled] of entries) {
    const key = String(keyRaw ?? '').trim();
    if (!key || enabled !== true) continue;
    out[key] = true;
  }
  return trimOldestRecordEntries(out, CHAT_INPUT_PERSISTED_MAX_KEYS);
}

function rememberRepoChatSelection(
  current: Record<string, RepoChatSelection>,
  repoPathRaw: unknown,
  droneIdRaw: unknown,
  chatNameRaw: unknown,
): Record<string, RepoChatSelection> {
  const repoPath = String(repoPathRaw ?? '').trim();
  const droneId = String(droneIdRaw ?? '').trim();
  if (!repoPath || !droneId) return current;
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const previous = current[repoPath];
  if (previous?.droneId === droneId && previous.chatName === chatName) return current;
  return { ...current, [repoPath]: { droneId, chatName } };
}

export function resolveRepoChatSelectionTransition(
  state: Pick<
    DroneHubUiState,
    | 'activeRepoPath'
    | 'selectedDrone'
    | 'selectedDroneIds'
    | 'selectedChat'
    | 'lastChatSelectionByRepoPath'
  >,
  nextRepoPathRaw: unknown,
): Pick<
  DroneHubUiState,
  | 'activeRepoPath'
  | 'selectedDrone'
  | 'selectedDroneIds'
  | 'selectedChat'
  | 'lastChatSelectionByRepoPath'
> {
  const nextRepoPath = String(nextRepoPathRaw ?? '').trim();
  const lastChatSelectionByRepoPath = state.lastChatSelectionByRepoPath;
  if (!nextRepoPath) {
    return {
      activeRepoPath: '',
      selectedDrone: state.selectedDrone,
      selectedDroneIds: state.selectedDroneIds,
      selectedChat: state.selectedChat,
      lastChatSelectionByRepoPath,
    };
  }
  const remembered = nextRepoPath ? lastChatSelectionByRepoPath[nextRepoPath] : null;
  return {
    activeRepoPath: nextRepoPath,
    selectedDrone: remembered?.droneId ?? null,
    selectedDroneIds: remembered ? [remembered.droneId] : [],
    selectedChat: remembered?.chatName ?? 'default',
    lastChatSelectionByRepoPath,
  };
}

export function migrateDroneHubUiPersistedState(
  persistedState: unknown,
  _version?: number,
): Partial<DroneHubUiPersistedState> {
  if (!persistedState || typeof persistedState !== 'object' || Array.isArray(persistedState))
    return {};
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
  const normalizedLastChatSelections = normalizeLastChatSelectionByRepoPath(
    (migrated as any).lastChatSelectionByRepoPath,
  );
  const legacyActiveRepoPath = String(migrated.activeRepoPath ?? '').trim();
  const legacySelectedDrone = String(migrated.selectedDrone ?? '').trim();
  if (
    legacyActiveRepoPath &&
    legacySelectedDrone &&
    !normalizedLastChatSelections[legacyActiveRepoPath]
  ) {
    normalizedLastChatSelections[legacyActiveRepoPath] = {
      droneId: legacySelectedDrone,
      chatName: String(migrated.selectedChat ?? '').trim() || 'default',
    };
  }
  migrated.lastChatSelectionByRepoPath = normalizedLastChatSelections;
  migrated.chatInputEditorModes = normalizeChatInputEditorModes(
    (migrated as any).chatInputEditorModes,
  );
  if (Object.prototype.hasOwnProperty.call(migrated, 'themeId')) {
    migrated.themeId = normalizeDesktopThemeId(migrated.themeId);
  }
  if (Object.prototype.hasOwnProperty.call(migrated, 'readingDensityMode')) {
    migrated.readingDensityMode = normalizeReadingDensityMode(migrated.readingDensityMode);
  }
  delete (migrated as any).automations;
  delete (migrated as any).pullHostBranchBeforeCreate;
  delete (migrated as any).playbookRunsSelectionInitialized;
  delete (migrated as any).playbookRunsSelectedPlaybookId;
  delete (migrated as any).playbookRunsSelectedRepoPath;
  delete (migrated as any).autoDelete;
  delete (migrated as any).sidebarRepoScopedGroupByPath;
  if (Object.prototype.hasOwnProperty.call(migrated, 'sidebarDockSide')) {
    migrated.sidebarDockSide = normalizeSidebarDockSide(migrated.sidebarDockSide);
  }
  if (Object.prototype.hasOwnProperty.call(migrated, 'pinnedSidebarPlacement')) {
    migrated.pinnedSidebarPlacement = normalizePinnedSidebarPlacement(
      migrated.pinnedSidebarPlacement,
    );
  }
  if (Object.prototype.hasOwnProperty.call(migrated, 'pinnedSidebarCollapsed')) {
    migrated.pinnedSidebarCollapsed = normalizeBoolean(migrated.pinnedSidebarCollapsed);
  }
  delete (migrated as any).assistantThreadSidebarDockSide;
  const migratedShortcutBindings = migrateLegacyShortcutBindings(migrated.shortcutBindings);
  if (migratedShortcutBindings !== undefined) {
    migrated.shortcutBindings = migratedShortcutBindings as ShortcutBindingMap;
  }
  const normalizedContexts = normalizeSpawnContextByRepoKey(
    (migrated as any).spawnContextByRepoKey,
  );
  if (Object.keys(normalizedContexts).length > 0) {
    migrated.spawnContextByRepoKey = normalizedContexts;
  } else {
    const legacySpawnDefaults = normalizeSpawnContextPreferences({
      spawnAgentKey: migrated.spawnAgentKey,
      spawnModel: migrated.spawnModel,
      spawnReasoning: migrated.spawnReasoning,
      spawnAgentPermissionMode: migrated.spawnAgentPermissionMode,
      spawnApprovalPolicy: migrated.spawnApprovalPolicy,
      repoBranchSource: migrated.repoBranchSource,
      repoCreateRemoteBranch: migrated.repoCreateRemoteBranch,
    });
    migrated.spawnContextByRepoKey = {
      [NO_REPO_SPAWN_CONTEXT_KEY]: legacySpawnDefaults,
    };
  }
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

function sameOrderedStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameOrderedStringMap(
  left: Readonly<Record<string, readonly string[]>>,
  right: Readonly<Record<string, readonly string[]>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameOrderedStringList(left[key] ?? [], right[key] ?? []),
    )
  );
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [keyRaw, itemRaw] of Object.entries(value as Record<string, unknown>)) {
    const key = String(keyRaw ?? '').trim();
    const item = String(itemRaw ?? '').trim();
    if (key && item) out[key] = item;
  }
  return out;
}

function sameStringRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key]);
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

function normalizeReadingDensityMode(value: unknown): ReadingDensityMode {
  return value === 'comfortable' ? 'comfortable' : 'default';
}

function normalizeSidebarDockSide(value: unknown): SidebarDockSide {
  return value === 'right' ? 'right' : 'left';
}

function normalizePinnedSidebarPlacement(value: unknown): PinnedSidebarPlacement {
  return String(value ?? '')
    .trim()
    .toLowerCase() === 'top'
    ? 'top'
    : 'bottom';
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

function trimOldestRecordEntries<T>(value: Record<string, T>, maxKeys: number): Record<string, T> {
  const keys = Object.keys(value);
  if (keys.length <= maxKeys) return value;
  const trimmed = { ...value };
  for (const key of keys.slice(0, keys.length - maxKeys)) delete trimmed[key];
  return trimmed;
}

function setRecentRecordEntry<T>(
  value: Record<string, T>,
  key: string,
  entry: T,
  maxKeys: number,
): Record<string, T> {
  const recent = { ...value };
  delete recent[key];
  recent[key] = entry;
  return trimOldestRecordEntries(recent, maxKeys);
}

function normalizeChatInputDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    const textRaw = typeof v === 'string' ? v : String(v ?? '');
    if (!textRaw) continue;
    out[key] = textRaw.slice(0, CHAT_INPUT_DRAFT_MAX_CHARS);
  }
  return trimOldestRecordEntries(out, CHAT_INPUT_PERSISTED_MAX_KEYS);
}

function isExactShortcutBinding(value: unknown, expected: ShortcutBinding | null): boolean {
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
  const migratedPullRequestsShortcut = migrateFormerPullRequestsShortcut(value);
  const raw = migratedPullRequestsShortcut as Record<string, unknown>;
  const next = { ...raw };
  let changed = migratedPullRequestsShortcut !== value;
  const hasCreateDraftGroupBinding = Object.prototype.hasOwnProperty.call(raw, 'createDraftGroup');
  const usesLegacyToDoShortcut = isExactShortcutBinding(raw.toggleSelectedDronesToDo, {
    key: 'e',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  });
  if (!hasCreateDraftGroupBinding && usesLegacyToDoShortcut) {
    next.createDraftGroup = {
      key: 'e',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };
    next.toggleSelectedDronesToDo = null;
    changed = true;
  }
  const createDraftRaw = raw.createDraftDrone;
  if (createDraftRaw && typeof createDraftRaw === 'object' && !Array.isArray(createDraftRaw)) {
    const binding = createDraftRaw as Record<string, unknown>;
    const key = String(binding.key ?? '')
      .trim()
      .toLowerCase();
    const mod = binding.mod === true;
    const ctrl = binding.ctrl === true;
    const meta = binding.meta === true;
    const alt = binding.alt === true;
    const shift = binding.shift === true;
    const isLegacyDefaultCreateShortcut =
      key === 'enter' && !mod && !ctrl && !meta && !alt && !shift;
    if (isLegacyDefaultCreateShortcut) {
      next.createDraftDrone = {
        key: 'tab',
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      };
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
    next.markSelectedDronesUnread = {
      key: 'z',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };
    changed = true;
  }
  const hasCreateCurrentGroupDraftDroneBinding = Object.prototype.hasOwnProperty.call(
    next,
    'createDraftDroneInCurrentGroup',
  );
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
  if (
    !hasCreateCurrentGroupDraftDroneBinding &&
    usesLegacyCreateChatShortcut &&
    usesCurrentUnreadShortcut
  ) {
    next.createDraftDroneInCurrentGroup = {
      key: '2',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };
    next.createDroneChat = {
      key: 'w',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };
    changed = true;
  }
  if (
    !hasCreateCurrentGroupDraftDroneBinding &&
    isExactShortcutBinding(next.createChildDraftDrone, {
      key: '3',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    })
  ) {
    next.createDraftDroneInCurrentGroup = {
      key: '2',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    };
    changed = true;
  }
  const currentDefaultMigrations: Array<[keyof ShortcutBindingMap, string, string]> = [
    ['createDraftDrone', 'tab', '1'],
    ['createDroneChat', 'w', '2'],
    ['createDroneChat', '2', '3'],
  ];
  for (const [actionId, previousKey, nextKey] of currentDefaultMigrations) {
    if (
      !isExactShortcutBinding(next[actionId], {
        key: previousKey,
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
      })
    )
      continue;
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
  return migrateChatComposerShortcuts(migrateCompanionShortcut(changed ? next : value));
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
      readingDensityMode: 'default',
      activeRepoPath: '',
      settingsActiveTab: 'general',
      chatHeaderRepoPath: '',
      sidebarReposCollapsed: false,
      sidebarAutoMinimize: false,
      showRecentDronesOnly: false,
      sidebarGroupingMode: 'groups',
      sidebarDensityMode: 'default',
      sidebarDockSide: 'left',
      pinnedSidebarPlacement: 'bottom',
      pinnedSidebarCollapsed: false,
      appView: 'workspace',
      collapsedGroups: {},
      collapsedDroneSections: {},
      sidebarGroupOrder: [],
      sidebarDroneOrderByGroup: {},
      sidebarNodeOrderByParent: {},
      sidebarChatOrderByDrone: {},
      sidebarChatGroupPathsByDrone: {},
      sidebarChatGroupByChat: {},
      sidebarChatNodeOrderByParent: {},
      pinnedDroneIds: [],
      mutedSidebarGroupIds: [],
      mutedDroneIds: [],
      mutedChatIds: [],
      toDoDroneIds: [],
      hiddenSidebarGroups: [],
      showHiddenSidebarGroups: false,
      terminalEmulator: 'auto',
      homeOpen: false,
      selectedDrone: null,
      selectedDroneIds: [],
      selectedGroupMultiChat: null,
      groupBroadcastExpanded: false,
      groupMultiChatColumnWidth: GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
      groupMultiChatStatusSort: false,
      selectedChat: 'default',
      lastChatSelectionByRepoPath: {},
      chatInputDrafts: initialChatInputDrafts,
      chatInputEditorModes: {},
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
      spawnAgentPermissionMode: DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnAgentPermissionMode,
      spawnApprovalPolicy: DEFAULT_SPAWN_CONTEXT_PREFERENCES.spawnApprovalPolicy,
      seenModelIds: [],
      repoBranchSource: DEFAULT_SPAWN_CONTEXT_PREFERENCES.repoBranchSource,
      repoCreateRemoteBranch: DEFAULT_SPAWN_CONTEXT_PREFERENCES.repoCreateRemoteBranch,
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
      setReadingDensityMode: (next) =>
        set((s) => ({
          readingDensityMode: normalizeReadingDensityMode(
            resolveNext(s.readingDensityMode, next),
          ),
        })),
      setActiveRepoPath: (next) =>
        set((s) => {
          const nextRepoPath = resolveNext(s.activeRepoPath, next);
          if (String(nextRepoPath ?? '').trim() === String(s.activeRepoPath ?? '').trim()) {
            return s;
          }
          return resolveRepoChatSelectionTransition(s, nextRepoPath);
        }),
      setSettingsActiveTab: (next) =>
        set((s) => ({ settingsActiveTab: resolveNext(s.settingsActiveTab, next) })),
      setChatHeaderRepoPath: (next) =>
        set((s) => ({ chatHeaderRepoPath: resolveNext(s.chatHeaderRepoPath, next) })),
      setSidebarReposCollapsed: (next) =>
        set((s) => ({ sidebarReposCollapsed: resolveNext(s.sidebarReposCollapsed, next) })),
      setSidebarAutoMinimize: (next) =>
        set((s) => ({ sidebarAutoMinimize: resolveNext(s.sidebarAutoMinimize, next) })),
      setShowRecentDronesOnly: (next) =>
        set((s) => ({ showRecentDronesOnly: resolveNext(s.showRecentDronesOnly, next) })),
      setSidebarGroupingMode: (next) =>
        set((s) => ({ sidebarGroupingMode: resolveNext(s.sidebarGroupingMode, next) })),
      setSidebarDensityMode: (next) =>
        set((s) => ({
          sidebarDensityMode: normalizeSidebarDensityMode(resolveNext(s.sidebarDensityMode, next)),
        })),
      setSidebarDockSide: (next) =>
        set((s) => ({
          sidebarDockSide: normalizeSidebarDockSide(resolveNext(s.sidebarDockSide, next)),
        })),
      setPinnedSidebarPlacement: (next) =>
        set((s) => ({
          pinnedSidebarPlacement: normalizePinnedSidebarPlacement(
            resolveNext(s.pinnedSidebarPlacement, next),
          ),
        })),
      setPinnedSidebarCollapsed: (next) =>
        set((s) => ({
          pinnedSidebarCollapsed: normalizeBoolean(resolveNext(s.pinnedSidebarCollapsed, next)),
        })),
      setAppView: (next) => set((s) => ({ appView: resolveNext(s.appView, next) })),
      setCollapsedGroups: (next) =>
        set((s) => ({ collapsedGroups: resolveNext(s.collapsedGroups, next) })),
      setCollapsedDroneSections: (next) =>
        set((s) => ({
          collapsedDroneSections: normalizeCollapsedGroups(
            resolveNext(s.collapsedDroneSections, next),
          ),
        })),
      setSidebarGroupOrder: (next) =>
        set((s) => {
          const value = normalizeSidebarGroupOrder(resolveNext(s.sidebarGroupOrder, next));
          return sameOrderedStringList(s.sidebarGroupOrder, value)
            ? s
            : { sidebarGroupOrder: value };
        }),
      setSidebarDroneOrderByGroup: (next) =>
        set((s) => {
          const value = normalizeOrderedStringMap(resolveNext(s.sidebarDroneOrderByGroup, next));
          return sameOrderedStringMap(s.sidebarDroneOrderByGroup, value)
            ? s
            : { sidebarDroneOrderByGroup: value };
        }),
      setSidebarNodeOrderByParent: (next) =>
        set((s) => {
          const value = normalizeOrderedStringMap(resolveNext(s.sidebarNodeOrderByParent, next));
          return sameOrderedStringMap(s.sidebarNodeOrderByParent, value)
            ? s
            : { sidebarNodeOrderByParent: value };
        }),
      setSidebarChatOrderByDrone: (next) =>
        set((s) => {
          const value = normalizeOrderedStringMap(resolveNext(s.sidebarChatOrderByDrone, next));
          return sameOrderedStringMap(s.sidebarChatOrderByDrone, value)
            ? s
            : { sidebarChatOrderByDrone: value };
        }),
      setSidebarChatGroupPathsByDrone: (next) =>
        set((s) => {
          const value = normalizeOrderedStringMap(resolveNext(s.sidebarChatGroupPathsByDrone, next));
          return sameOrderedStringMap(s.sidebarChatGroupPathsByDrone, value)
            ? s
            : { sidebarChatGroupPathsByDrone: value };
        }),
      setSidebarChatGroupByChat: (next) =>
        set((s) => {
          const value = normalizeStringRecord(resolveNext(s.sidebarChatGroupByChat, next));
          return sameStringRecord(s.sidebarChatGroupByChat, value)
            ? s
            : { sidebarChatGroupByChat: value };
        }),
      setSidebarChatNodeOrderByParent: (next) =>
        set((s) => {
          const value = normalizeOrderedStringMap(resolveNext(s.sidebarChatNodeOrderByParent, next));
          return sameOrderedStringMap(s.sidebarChatNodeOrderByParent, value)
            ? s
            : { sidebarChatNodeOrderByParent: value };
        }),
      setPinnedDroneIds: (next) =>
        set((s) => {
          const value = normalizeSidebarGroupOrder(resolveNext(s.pinnedDroneIds, next));
          return sameOrderedStringList(s.pinnedDroneIds, value) ? s : { pinnedDroneIds: value };
        }),
      setMutedSidebarGroupIds: (next) =>
        set((s) => {
          const value = normalizeSidebarGroupOrder(resolveNext(s.mutedSidebarGroupIds, next));
          return sameOrderedStringList(s.mutedSidebarGroupIds, value)
            ? s
            : { mutedSidebarGroupIds: value };
        }),
      setMutedDroneIds: (next) =>
        set((s) => {
          const value = normalizeSidebarGroupOrder(resolveNext(s.mutedDroneIds, next));
          return sameOrderedStringList(s.mutedDroneIds, value) ? s : { mutedDroneIds: value };
        }),
      setMutedChatIds: (next) =>
        set((s) => {
          const value = normalizeSidebarGroupOrder(resolveNext(s.mutedChatIds, next));
          return sameOrderedStringList(s.mutedChatIds, value) ? s : { mutedChatIds: value };
        }),
      setToDoDroneIds: (next) =>
        set((s) => {
          const value = normalizeSidebarGroupOrder(resolveNext(s.toDoDroneIds, next));
          return sameOrderedStringList(s.toDoDroneIds, value) ? s : { toDoDroneIds: value };
        }),
      setHiddenSidebarGroups: (next) =>
        set((s) => {
          const value = normalizeSidebarGroupOrder(resolveNext(s.hiddenSidebarGroups, next));
          return sameOrderedStringList(s.hiddenSidebarGroups, value)
            ? s
            : { hiddenSidebarGroups: value };
        }),
      setShowHiddenSidebarGroups: (next) =>
        set((s) => ({ showHiddenSidebarGroups: resolveNext(s.showHiddenSidebarGroups, next) })),
      setTerminalEmulator: (next) =>
        set((s) => ({ terminalEmulator: resolveNext(s.terminalEmulator, next) })),
      setHomeOpen: (next) => set((s) => ({ homeOpen: resolveNext(s.homeOpen, next) })),
      setSelectedDrone: (next) =>
        set((s) => ({ selectedDrone: resolveNext(s.selectedDrone, next) })),
      setSelectedDroneIds: (next) =>
        set((s) => ({ selectedDroneIds: resolveNext(s.selectedDroneIds, next) })),
      setSelectedGroupMultiChat: (next) =>
        set((s) => ({ selectedGroupMultiChat: resolveNext(s.selectedGroupMultiChat, next) })),
      setGroupBroadcastExpanded: (next) =>
        set((s) => ({ groupBroadcastExpanded: resolveNext(s.groupBroadcastExpanded, next) })),
      setGroupMultiChatColumnWidth: (next) =>
        set((s) => ({
          groupMultiChatColumnWidth: clampGroupMultiChatColumnWidthPx(
            resolveNext(s.groupMultiChatColumnWidth, next),
          ),
        })),
      setGroupMultiChatStatusSort: (next) =>
        set((s) => ({
          groupMultiChatStatusSort: resolveNext(s.groupMultiChatStatusSort, next),
        })),
      setSelectedChat: (next) =>
        set((s) => ({
          selectedChat: String(resolveNext(s.selectedChat, next) ?? '').trim() || 'default',
        })),
      rememberRepoChatSelection: (repoPath, droneId, chatName) =>
        set((s) => {
          const next = rememberRepoChatSelection(
            s.lastChatSelectionByRepoPath,
            repoPath,
            droneId,
            chatName,
          );
          return next === s.lastChatSelectionByRepoPath ? s : { lastChatSelectionByRepoPath: next };
        }),
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
          const merged = setRecentRecordEntry(
            s.chatInputDrafts,
            draftKey,
            nextText,
            CHAT_INPUT_PERSISTED_MAX_KEYS,
          );
          schedulePersistChatInputDrafts(merged);
          return { chatInputDrafts: merged };
        }),
      setChatInputEditorMode: (draftKeyRaw, next) =>
        set((s) => {
          const draftKey = String(draftKeyRaw ?? '').trim();
          if (!draftKey) return s;
          if (!next) {
            if (!Object.prototype.hasOwnProperty.call(s.chatInputEditorModes, draftKey)) return s;
            const trimmed = { ...s.chatInputEditorModes };
            delete trimmed[draftKey];
            return { chatInputEditorModes: trimmed };
          }
          if (s.chatInputEditorModes[draftKey]) return s;
          const merged = setRecentRecordEntry<true>(
            s.chatInputEditorModes,
            draftKey,
            true,
            CHAT_INPUT_PERSISTED_MAX_KEYS,
          );
          return { chatInputEditorModes: merged };
        }),
      setDraftChat: (next) => set((s) => ({ draftChat: resolveNext(s.draftChat, next) })),
      setSidebarCollapsed: (next) =>
        set((s) => ({ sidebarCollapsed: resolveNext(s.sidebarCollapsed, next) })),
      setReposModalOpen: (next) =>
        set((s) => ({ reposModalOpen: resolveNext(s.reposModalOpen, next) })),
      setDroneErrorModal: (next) =>
        set((s) => ({ droneErrorModal: resolveNext(s.droneErrorModal, next) })),
      setClearingDroneError: (next) =>
        set((s) => ({ clearingDroneError: resolveNext(s.clearingDroneError, next) })),
      setHeaderOverflowOpen: (next) =>
        set((s) => ({ headerOverflowOpen: resolveNext(s.headerOverflowOpen, next) })),
      setOutputView: (next) => set((s) => ({ outputView: resolveNext(s.outputView, next) })),
      setShowCanvasLastMessagePreviews: (next) =>
        set((s) => ({
          showCanvasLastMessagePreviews: resolveNext(s.showCanvasLastMessagePreviews, next),
        })),
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
            spawnAgentPermissionMode: resolved.spawnAgentPermissionMode,
            spawnApprovalPolicy: resolved.spawnApprovalPolicy,
            repoBranchSource: resolved.repoBranchSource,
            repoCreateRemoteBranch: resolved.repoCreateRemoteBranch,
          };
        }),
      updateSpawnContextForRepo: (repoPathRaw, patch) =>
        set((s) => {
          const repoPath = normalizeSpawnContextRepoPath(repoPathRaw);
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            repoPath,
            patch,
          );
          if (nextByRepoKey === s.spawnContextByRepoKey) return s;
          if (
            spawnContextRepoKeyForPath(s.spawnContextRepoPath) !==
            spawnContextRepoKeyForPath(repoPath)
          ) {
            return { spawnContextByRepoKey: nextByRepoKey };
          }
          const resolved = resolveSpawnContextPreferencesForRepo(nextByRepoKey, repoPath);
          return {
            spawnContextByRepoKey: nextByRepoKey,
            spawnAgentKey: resolved.spawnAgentKey,
            spawnModel: resolved.spawnModel,
            spawnReasoning: resolved.spawnReasoning,
            spawnAgentPermissionMode: resolved.spawnAgentPermissionMode,
            spawnApprovalPolicy: resolved.spawnApprovalPolicy,
            repoBranchSource: resolved.repoBranchSource,
            repoCreateRemoteBranch: resolved.repoCreateRemoteBranch,
          };
        }),
      setSpawnAgentKey: (next) =>
        set((s) => {
          const spawnAgentKey = normalizeSpawnAgentKeyValue(resolveNext(s.spawnAgentKey, next));
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            s.spawnContextRepoPath,
            {
              spawnAgentKey,
            },
          );
          return {
            spawnAgentKey,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setSpawnModel: (next) =>
        set((s) => {
          const spawnModel = normalizeTrimmedString(resolveNext(s.spawnModel, next)).slice(0, 200);
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            s.spawnContextRepoPath,
            {
              spawnModel,
            },
          );
          return {
            spawnModel,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setSpawnReasoning: (next) =>
        set((s) => {
          const spawnReasoning = normalizeTrimmedString(resolveNext(s.spawnReasoning, next)).slice(
            0,
            200,
          );
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            s.spawnContextRepoPath,
            {
              spawnReasoning,
            },
          );
          return { spawnReasoning, spawnContextByRepoKey: nextByRepoKey };
        }),
      setSpawnAgentPermissionMode: (next) =>
        set((s) => {
          const spawnAgentPermissionMode = normalizeSpawnAgentPermissionMode(
            resolveNext(s.spawnAgentPermissionMode, next),
          );
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            s.spawnContextRepoPath,
            { spawnAgentPermissionMode },
          );
          return { spawnAgentPermissionMode, spawnContextByRepoKey: nextByRepoKey };
        }),
      setSpawnApprovalPolicy: (next) =>
        set((s) => {
          const spawnApprovalPolicy = normalizeSpawnApprovalPolicy(
            resolveNext(s.spawnApprovalPolicy, next),
          );
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            s.spawnContextRepoPath,
            { spawnApprovalPolicy },
          );
          return { spawnApprovalPolicy, spawnContextByRepoKey: nextByRepoKey };
        }),
      rememberSeenModels: (models) =>
        set((s) => {
          const next = mergeSeenModelIds(s.seenModelIds, models);
          if (
            next.length === s.seenModelIds.length &&
            next.every((id, index) => id === s.seenModelIds[index])
          ) {
            return s;
          }
          return { seenModelIds: next };
        }),
      setRepoBranchSource: (next) =>
        set((s) => {
          const repoBranchSource = normalizeRepoBranchSourceMode(
            resolveNext(s.repoBranchSource, next),
          );
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            s.spawnContextRepoPath,
            {
              repoBranchSource,
            },
          );
          return {
            repoBranchSource,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setRepoCreateRemoteBranch: (next) =>
        set((s) => {
          const repoCreateRemoteBranch = normalizeTrimmedString(
            resolveNext(s.repoCreateRemoteBranch, next),
          ).slice(0, 400);
          const nextByRepoKey = buildUpdatedSpawnContextByRepoKey(
            s.spawnContextByRepoKey,
            s.spawnContextRepoPath,
            {
              repoCreateRemoteBranch,
            },
          );
          return {
            repoCreateRemoteBranch,
            spawnContextByRepoKey: nextByRepoKey,
          };
        }),
      setCustomAgents: (next) => set((s) => ({ customAgents: resolveNext(s.customAgents, next) })),
      setCustomAgentModalOpen: (next) =>
        set((s) => ({ customAgentModalOpen: resolveNext(s.customAgentModalOpen, next) })),
      setNewCustomAgentLabel: (next) =>
        set((s) => ({ newCustomAgentLabel: resolveNext(s.newCustomAgentLabel, next) })),
      setNewCustomAgentCommand: (next) =>
        set((s) => ({ newCustomAgentCommand: resolveNext(s.newCustomAgentCommand, next) })),
      setCustomAgentError: (next) =>
        set((s) => ({ customAgentError: resolveNext(s.customAgentError, next) })),
      setNameSuggestToast: (next) =>
        set((s) => ({ nameSuggestToast: resolveNext(s.nameSuggestToast, next) })),
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
      setTerminalMenuOpen: (next) =>
        set((s) => ({ terminalMenuOpen: resolveNext(s.terminalMenuOpen, next) })),
      setAgentMenuOpen: (next) =>
        set((s) => ({ agentMenuOpen: resolveNext(s.agentMenuOpen, next) })),
    }),
    {
      name: profileStorageKey('droneHub.ui'),
      version: 20,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) =>
        migrateDroneHubUiPersistedState(persistedState, version),
      partialize: (state): DroneHubUiPersistedState => ({
        themeId: state.themeId,
        readingDensityMode: state.readingDensityMode,
        activeRepoPath: state.activeRepoPath,
        settingsActiveTab: state.settingsActiveTab,
        chatHeaderRepoPath: state.chatHeaderRepoPath,
        sidebarReposCollapsed: state.sidebarReposCollapsed,
        sidebarAutoMinimize: state.sidebarAutoMinimize,
        showRecentDronesOnly: state.showRecentDronesOnly,
        sidebarGroupingMode: state.sidebarGroupingMode,
        sidebarDensityMode: state.sidebarDensityMode,
        sidebarDockSide: state.sidebarDockSide,
        pinnedSidebarPlacement: state.pinnedSidebarPlacement,
        pinnedSidebarCollapsed: state.pinnedSidebarCollapsed,
        appView: state.appView,
        collapsedGroups: state.collapsedGroups,
        collapsedDroneSections: state.collapsedDroneSections,
        sidebarGroupOrder: state.sidebarGroupOrder,
        sidebarDroneOrderByGroup: state.sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent: state.sidebarNodeOrderByParent,
        sidebarChatOrderByDrone: state.sidebarChatOrderByDrone,
        sidebarChatGroupPathsByDrone: state.sidebarChatGroupPathsByDrone,
        sidebarChatGroupByChat: state.sidebarChatGroupByChat,
        sidebarChatNodeOrderByParent: state.sidebarChatNodeOrderByParent,
        pinnedDroneIds: state.pinnedDroneIds,
        mutedSidebarGroupIds: state.mutedSidebarGroupIds,
        mutedDroneIds: state.mutedDroneIds,
        mutedChatIds: state.mutedChatIds,
        hiddenSidebarGroups: state.hiddenSidebarGroups,
        terminalEmulator: state.terminalEmulator,
        selectedDrone: state.selectedDrone,
        selectedDroneIds: state.selectedDroneIds,
        toDoDroneIds: state.toDoDroneIds,
        selectedChat: state.selectedChat,
        lastChatSelectionByRepoPath: state.lastChatSelectionByRepoPath,
        chatInputEditorModes: state.chatInputEditorModes,
        groupMultiChatColumnWidth: state.groupMultiChatColumnWidth,
        groupMultiChatStatusSort: state.groupMultiChatStatusSort,
        outputView: state.outputView,
        showCanvasLastMessagePreviews: state.showCanvasLastMessagePreviews,
        spawnContextByRepoKey: state.spawnContextByRepoKey,
        spawnAgentKey: state.spawnAgentKey,
        spawnModel: state.spawnModel,
        spawnReasoning: state.spawnReasoning,
        spawnAgentPermissionMode: state.spawnAgentPermissionMode,
        spawnApprovalPolicy: state.spawnApprovalPolicy,
        seenModelIds: state.seenModelIds,
        repoBranchSource: state.repoBranchSource,
        repoCreateRemoteBranch: state.repoCreateRemoteBranch,
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
          readingDensityMode: normalizeReadingDensityMode(
            persisted.readingDensityMode ?? currentState.readingDensityMode,
          ),
          settingsActiveTab:
            persisted.settingsActiveTab === 'general' ||
            persisted.settingsActiveTab === 'companion' ||
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
          sidebarAutoMinimize: normalizeBoolean(
            persisted.sidebarAutoMinimize ?? currentState.sidebarAutoMinimize,
          ),
          showRecentDronesOnly: normalizeBoolean(
            persisted.showRecentDronesOnly ?? currentState.showRecentDronesOnly,
          ),
          sidebarGroupingMode: normalizeSidebarGroupingMode(
            persisted.sidebarGroupingMode ?? currentState.sidebarGroupingMode,
          ),
          sidebarDensityMode: normalizeSidebarDensityMode(
            persisted.sidebarDensityMode ?? currentState.sidebarDensityMode,
          ),
          sidebarDockSide: normalizeSidebarDockSide(
            persisted.sidebarDockSide ?? currentState.sidebarDockSide,
          ),
          pinnedSidebarPlacement: normalizePinnedSidebarPlacement(
            persisted.pinnedSidebarPlacement ?? currentState.pinnedSidebarPlacement,
          ),
          pinnedSidebarCollapsed: normalizeBoolean(
            persisted.pinnedSidebarCollapsed ?? currentState.pinnedSidebarCollapsed,
          ),
          collapsedGroups: normalizeCollapsedGroups(
            persisted.collapsedGroups ?? currentState.collapsedGroups,
          ),
          collapsedDroneSections: normalizeCollapsedGroups(
            persisted.collapsedDroneSections ?? currentState.collapsedDroneSections,
          ),
          sidebarGroupOrder: normalizeSidebarGroupOrder(
            persisted.sidebarGroupOrder ?? currentState.sidebarGroupOrder,
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
          sidebarChatGroupPathsByDrone: normalizeOrderedStringMap(
            persisted.sidebarChatGroupPathsByDrone ?? currentState.sidebarChatGroupPathsByDrone,
          ),
          sidebarChatGroupByChat: normalizeStringRecord(
            persisted.sidebarChatGroupByChat ?? currentState.sidebarChatGroupByChat,
          ),
          sidebarChatNodeOrderByParent: normalizeOrderedStringMap(
            persisted.sidebarChatNodeOrderByParent ?? currentState.sidebarChatNodeOrderByParent,
          ),
          pinnedDroneIds: normalizeSidebarGroupOrder(
            persisted.pinnedDroneIds ?? currentState.pinnedDroneIds,
          ),
          mutedSidebarGroupIds: normalizeSidebarGroupOrder(
            persisted.mutedSidebarGroupIds ?? currentState.mutedSidebarGroupIds,
          ),
          mutedDroneIds: normalizeSidebarGroupOrder(
            persisted.mutedDroneIds ?? currentState.mutedDroneIds,
          ),
          mutedChatIds: normalizeSidebarGroupOrder(
            persisted.mutedChatIds ?? currentState.mutedChatIds,
          ),
          hiddenSidebarGroups: normalizeSidebarGroupOrder(
            persisted.hiddenSidebarGroups ?? currentState.hiddenSidebarGroups,
          ),
          selectedDrone: normalizeTrimmedString(persisted.selectedDrone) || null,
          selectedDroneIds: normalizeSidebarGroupOrder(persisted.selectedDroneIds),
          toDoDroneIds: normalizeSidebarGroupOrder(persisted.toDoDroneIds),
          selectedChat: normalizeTrimmedString(persisted.selectedChat) || currentState.selectedChat,
          lastChatSelectionByRepoPath: normalizeLastChatSelectionByRepoPath(
            persisted.lastChatSelectionByRepoPath ?? currentState.lastChatSelectionByRepoPath,
          ),
          chatInputEditorModes: normalizeChatInputEditorModes(
            persisted.chatInputEditorModes ?? currentState.chatInputEditorModes,
          ),
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
          seenModelIds: normalizeSeenModelIds(persisted.seenModelIds ?? currentState.seenModelIds),
          repoBranchSource:
            persisted.repoBranchSource === 'remote' || persisted.repoBranchSource === 'host'
              ? persisted.repoBranchSource
              : currentState.repoBranchSource,
          repoCreateRemoteBranch: normalizeTrimmedString(
            persisted.repoCreateRemoteBranch ?? currentState.repoCreateRemoteBranch,
          ),
          customAgents: sanitizeCustomAgents(persisted.customAgents ?? currentState.customAgents),
          shortcutBindings: sanitizeShortcutBindings(
            migratedShortcutBindings ?? currentState.shortcutBindings,
          ),
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
      sidebarChatGroupPathsByDrone: s.sidebarChatGroupPathsByDrone,
      sidebarChatGroupByChat: s.sidebarChatGroupByChat,
      sidebarChatNodeOrderByParent: s.sidebarChatNodeOrderByParent,
      pinnedDroneIds: s.pinnedDroneIds,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      showHiddenSidebarGroups: s.showHiddenSidebarGroups,
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
      spawnAgentPermissionMode: s.spawnAgentPermissionMode,
      spawnApprovalPolicy: s.spawnApprovalPolicy,
      seenModelIds: s.seenModelIds,
      repoBranchSource: s.repoBranchSource,
      repoCreateRemoteBranch: s.repoCreateRemoteBranch,
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
      rememberRepoChatSelection: s.rememberRepoChatSelection,
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
      setSpawnAgentPermissionMode: s.setSpawnAgentPermissionMode,
      setSpawnApprovalPolicy: s.setSpawnApprovalPolicy,
      rememberSeenModels: s.rememberSeenModels,
      setRepoBranchSource: s.setRepoBranchSource,
      setRepoCreateRemoteBranch: s.setRepoCreateRemoteBranch,
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
      lastChatSelectionByRepoPath: s.lastChatSelectionByRepoPath,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      sidebarReposCollapsed: s.sidebarReposCollapsed,
      sidebarAutoMinimize: s.sidebarAutoMinimize,
      showRecentDronesOnly: s.showRecentDronesOnly,
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarDensityMode: s.sidebarDensityMode,
      sidebarDockSide: s.sidebarDockSide,
      pinnedSidebarPlacement: s.pinnedSidebarPlacement,
      pinnedSidebarCollapsed: s.pinnedSidebarCollapsed,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      sidebarChatGroupPathsByDrone: s.sidebarChatGroupPathsByDrone,
      sidebarChatGroupByChat: s.sidebarChatGroupByChat,
      sidebarChatNodeOrderByParent: s.sidebarChatNodeOrderByParent,
      mutedSidebarGroupIds: s.mutedSidebarGroupIds,
      mutedDroneIds: s.mutedDroneIds,
      mutedChatIds: s.mutedChatIds,
      pinnedDroneIds: s.pinnedDroneIds,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      showHiddenSidebarGroups: s.showHiddenSidebarGroups,
      setSettingsActiveTab: s.setSettingsActiveTab,
      setAppView: s.setAppView,
      setSidebarReposCollapsed: s.setSidebarReposCollapsed,
      setSidebarAutoMinimize: s.setSidebarAutoMinimize,
      setShowRecentDronesOnly: s.setShowRecentDronesOnly,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarDensityMode: s.setSidebarDensityMode,
      setSidebarDockSide: s.setSidebarDockSide,
      setPinnedSidebarPlacement: s.setPinnedSidebarPlacement,
      setPinnedSidebarCollapsed: s.setPinnedSidebarCollapsed,
      setCollapsedGroups: s.setCollapsedGroups,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setPinnedDroneIds: s.setPinnedDroneIds,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setShowHiddenSidebarGroups: s.setShowHiddenSidebarGroups,
      setSelectedDrone: s.setSelectedDrone,
      setSelectedDroneIds: s.setSelectedDroneIds,
      setSelectedChat: s.setSelectedChat,
      setSelectedGroupMultiChat: s.setSelectedGroupMultiChat,
      setDraftChat: s.setDraftChat,
      setActiveRepoPath: s.setActiveRepoPath,
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
