import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { AppView, DraftChatState, DroneErrorModalState } from './app-types';
import {
  FS_EXPLORER_VIEW_STORAGE_KEY,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY,
  SIDEBAR_AUTO_MINIMIZE_STORAGE_KEY,
  SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY,
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

type Updater<T> = T | ((prev: T) => T);

type NameSuggestToast = null | { id: string; message: string };
type ViewMode = 'grouped' | 'flat';
type SidebarGroupingMode = 'groups' | 'repos';
type FsExplorerView = 'list' | 'thumb';
type OutputView = 'screen' | 'log';

type DroneHubUiState = {
  activeRepoPath: string;
  chatHeaderRepoPath: string;
  sidebarReposCollapsed: boolean;
  sidebarAutoMinimize: boolean;
  sidebarGroupingMode: SidebarGroupingMode;
  appView: AppView;
  viewMode: ViewMode;
  collapsedGroups: Record<string, boolean>;
  autoDelete: boolean;
  terminalEmulator: string;
  selectedDrone: string | null;
  selectedDroneIds: string[];
  selectedGroupMultiChat: string | null;
  groupBroadcastExpanded: boolean;
  groupMultiChatColumnWidth: number;
  selectedChat: string;
  draftChat: DraftChatState | null;
  sidebarCollapsed: boolean;
  reposModalOpen: boolean;
  droneErrorModal: DroneErrorModalState | null;
  clearingDroneError: boolean;
  headerOverflowOpen: boolean;
  outputView: OutputView;
  fsExplorerView: FsExplorerView;
  spawnAgentKey: string;
  spawnModel: string;
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
  setChatHeaderRepoPath: (next: Updater<string>) => void;
  setSidebarReposCollapsed: (next: Updater<boolean>) => void;
  setSidebarAutoMinimize: (next: Updater<boolean>) => void;
  setSidebarGroupingMode: (next: Updater<SidebarGroupingMode>) => void;
  setAppView: (next: Updater<AppView>) => void;
  setViewMode: (next: Updater<ViewMode>) => void;
  setCollapsedGroups: (next: Updater<Record<string, boolean>>) => void;
  setAutoDelete: (next: Updater<boolean>) => void;
  setTerminalEmulator: (next: Updater<string>) => void;
  setSelectedDrone: (next: Updater<string | null>) => void;
  setSelectedDroneIds: (next: Updater<string[]>) => void;
  setSelectedGroupMultiChat: (next: Updater<string | null>) => void;
  setGroupBroadcastExpanded: (next: Updater<boolean>) => void;
  setGroupMultiChatColumnWidth: (next: Updater<number>) => void;
  setSelectedChat: (next: Updater<string>) => void;
  setDraftChat: (next: Updater<DraftChatState | null>) => void;
  setSidebarCollapsed: (next: Updater<boolean>) => void;
  setReposModalOpen: (next: Updater<boolean>) => void;
  setDroneErrorModal: (next: Updater<DroneErrorModalState | null>) => void;
  setClearingDroneError: (next: Updater<boolean>) => void;
  setHeaderOverflowOpen: (next: Updater<boolean>) => void;
  setOutputView: (next: Updater<OutputView>) => void;
  setFsExplorerView: (next: Updater<FsExplorerView>) => void;
  setSpawnAgentKey: (next: Updater<string>) => void;
  setSpawnModel: (next: Updater<string>) => void;
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

type DroneHubUiPersistedState = Pick<
  DroneHubUiState,
  | 'activeRepoPath'
  | 'chatHeaderRepoPath'
  | 'sidebarReposCollapsed'
  | 'sidebarAutoMinimize'
  | 'sidebarGroupingMode'
  | 'appView'
  | 'viewMode'
  | 'collapsedGroups'
  | 'autoDelete'
  | 'terminalEmulator'
  | 'groupMultiChatColumnWidth'
  | 'outputView'
  | 'fsExplorerView'
  | 'spawnAgentKey'
  | 'spawnModel'
  | 'customAgents'
  | 'shortcutBindings'
>;

function readCustomAgents(): CustomAgentProfile[] {
  return sanitizeCustomAgents(readLocalStorageItem('droneHub.customAgents'));
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

function readLegacyCollapsedGroups(): Record<string, boolean> {
  const raw = readLocalStorageItem('droneHub.collapsedGroups');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeCollapsedGroups(parsed);
  } catch {
    return {};
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

function normalizeAppView(value: unknown): AppView {
  return value === 'settings' ? 'settings' : 'workspace';
}

function normalizeViewMode(value: unknown): ViewMode {
  return value === 'flat' ? 'flat' : 'grouped';
}

function normalizeSidebarGroupingMode(value: unknown): SidebarGroupingMode {
  return value === 'repos' ? 'repos' : 'groups';
}

function normalizeOutputView(value: unknown): OutputView {
  return value === 'log' ? 'log' : 'screen';
}

function normalizeFsExplorerView(value: unknown): FsExplorerView {
  return value === 'thumb' ? 'thumb' : 'list';
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function readLegacyPersistedDefaults(): DroneHubUiPersistedState {
  const savedWidth = Number(readLocalStorageItem(GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY));
  return {
    activeRepoPath: readLocalStorageItem('droneHub.activeRepoPath') || '',
    chatHeaderRepoPath: String(readLocalStorageItem('droneHub.chatHeaderRepoPath') ?? '').trim(),
    sidebarReposCollapsed: readLocalStorageItem(SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY) === '1',
    sidebarAutoMinimize: readLocalStorageItem(SIDEBAR_AUTO_MINIMIZE_STORAGE_KEY) === '1',
    sidebarGroupingMode: normalizeSidebarGroupingMode(readLocalStorageItem('droneHub.sidebarGroupingMode')),
    appView: normalizeAppView(readLocalStorageItem('droneHub.appView')),
    viewMode: normalizeViewMode(readLocalStorageItem('droneHub.viewMode')),
    collapsedGroups: readLegacyCollapsedGroups(),
    autoDelete: readLocalStorageItem('droneHub.autoDelete') === '1',
    terminalEmulator: readLocalStorageItem('droneHub.terminalEmulator') || 'auto',
    groupMultiChatColumnWidth:
      Number.isFinite(savedWidth) && savedWidth > 0
        ? clampGroupMultiChatColumnWidthPx(savedWidth)
        : GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
    outputView: normalizeOutputView(readLocalStorageItem('droneHub.outputView')),
    fsExplorerView: normalizeFsExplorerView(readLocalStorageItem(FS_EXPLORER_VIEW_STORAGE_KEY)),
    spawnAgentKey: readLocalStorageItem('droneHub.spawnAgent') || 'builtin:cursor',
    spawnModel: readLocalStorageItem('droneHub.spawnModel') || '',
    customAgents: readCustomAgents(),
    shortcutBindings: cloneDefaultShortcutBindings(),
  };
}

const legacyDefaults = readLegacyPersistedDefaults();

export const useDroneHubUiStore = create<DroneHubUiState>()(
  persist(
    (set) => ({
      activeRepoPath: legacyDefaults.activeRepoPath,
      chatHeaderRepoPath: legacyDefaults.chatHeaderRepoPath,
      sidebarReposCollapsed: legacyDefaults.sidebarReposCollapsed,
      sidebarAutoMinimize: legacyDefaults.sidebarAutoMinimize,
      sidebarGroupingMode: legacyDefaults.sidebarGroupingMode,
      appView: legacyDefaults.appView,
      viewMode: legacyDefaults.viewMode,
      collapsedGroups: legacyDefaults.collapsedGroups,
      autoDelete: legacyDefaults.autoDelete,
      terminalEmulator: legacyDefaults.terminalEmulator,
      selectedDrone: null,
      selectedDroneIds: [],
      selectedGroupMultiChat: null,
      groupBroadcastExpanded: false,
      groupMultiChatColumnWidth: legacyDefaults.groupMultiChatColumnWidth,
      selectedChat: 'default',
      draftChat: null,
      sidebarCollapsed: false,
      reposModalOpen: false,
      droneErrorModal: null,
      clearingDroneError: false,
      headerOverflowOpen: false,
      outputView: legacyDefaults.outputView,
      fsExplorerView: legacyDefaults.fsExplorerView,
      spawnAgentKey: legacyDefaults.spawnAgentKey,
      spawnModel: legacyDefaults.spawnModel,
      customAgents: legacyDefaults.customAgents,
      customAgentModalOpen: false,
      newCustomAgentLabel: '',
      newCustomAgentCommand: '',
      customAgentError: null,
      nameSuggestToast: null,
      shortcutBindings: cloneDefaultShortcutBindings(),
      terminalMenuOpen: false,
      agentMenuOpen: false,
      setActiveRepoPath: (next) => set((s) => ({ activeRepoPath: resolveNext(s.activeRepoPath, next) })),
      setChatHeaderRepoPath: (next) => set((s) => ({ chatHeaderRepoPath: resolveNext(s.chatHeaderRepoPath, next) })),
      setSidebarReposCollapsed: (next) => set((s) => ({ sidebarReposCollapsed: resolveNext(s.sidebarReposCollapsed, next) })),
      setSidebarAutoMinimize: (next) => set((s) => ({ sidebarAutoMinimize: resolveNext(s.sidebarAutoMinimize, next) })),
      setSidebarGroupingMode: (next) => set((s) => ({ sidebarGroupingMode: resolveNext(s.sidebarGroupingMode, next) })),
      setAppView: (next) => set((s) => ({ appView: resolveNext(s.appView, next) })),
      setViewMode: (next) => set((s) => ({ viewMode: resolveNext(s.viewMode, next) })),
      setCollapsedGroups: (next) => set((s) => ({ collapsedGroups: resolveNext(s.collapsedGroups, next) })),
      setAutoDelete: (next) => set((s) => ({ autoDelete: resolveNext(s.autoDelete, next) })),
      setTerminalEmulator: (next) => set((s) => ({ terminalEmulator: resolveNext(s.terminalEmulator, next) })),
      setSelectedDrone: (next) => set((s) => ({ selectedDrone: resolveNext(s.selectedDrone, next) })),
      setSelectedDroneIds: (next) => set((s) => ({ selectedDroneIds: resolveNext(s.selectedDroneIds, next) })),
      setSelectedGroupMultiChat: (next) => set((s) => ({ selectedGroupMultiChat: resolveNext(s.selectedGroupMultiChat, next) })),
      setGroupBroadcastExpanded: (next) => set((s) => ({ groupBroadcastExpanded: resolveNext(s.groupBroadcastExpanded, next) })),
      setGroupMultiChatColumnWidth: (next) =>
        set((s) => ({
          groupMultiChatColumnWidth: clampGroupMultiChatColumnWidthPx(resolveNext(s.groupMultiChatColumnWidth, next)),
        })),
      setSelectedChat: (next) => set((s) => ({ selectedChat: resolveNext(s.selectedChat, next) })),
      setDraftChat: (next) => set((s) => ({ draftChat: resolveNext(s.draftChat, next) })),
      setSidebarCollapsed: (next) => set((s) => ({ sidebarCollapsed: resolveNext(s.sidebarCollapsed, next) })),
      setReposModalOpen: (next) => set((s) => ({ reposModalOpen: resolveNext(s.reposModalOpen, next) })),
      setDroneErrorModal: (next) => set((s) => ({ droneErrorModal: resolveNext(s.droneErrorModal, next) })),
      setClearingDroneError: (next) => set((s) => ({ clearingDroneError: resolveNext(s.clearingDroneError, next) })),
      setHeaderOverflowOpen: (next) => set((s) => ({ headerOverflowOpen: resolveNext(s.headerOverflowOpen, next) })),
      setOutputView: (next) => set((s) => ({ outputView: resolveNext(s.outputView, next) })),
      setFsExplorerView: (next) => set((s) => ({ fsExplorerView: resolveNext(s.fsExplorerView, next) })),
      setSpawnAgentKey: (next) => set((s) => ({ spawnAgentKey: resolveNext(s.spawnAgentKey, next) })),
      setSpawnModel: (next) => set((s) => ({ spawnModel: resolveNext(s.spawnModel, next) })),
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
      name: 'droneHub.ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): DroneHubUiPersistedState => ({
        activeRepoPath: state.activeRepoPath,
        chatHeaderRepoPath: state.chatHeaderRepoPath,
        sidebarReposCollapsed: state.sidebarReposCollapsed,
        sidebarAutoMinimize: state.sidebarAutoMinimize,
        sidebarGroupingMode: state.sidebarGroupingMode,
        appView: state.appView,
        viewMode: state.viewMode,
        collapsedGroups: state.collapsedGroups,
        autoDelete: state.autoDelete,
        terminalEmulator: state.terminalEmulator,
        groupMultiChatColumnWidth: state.groupMultiChatColumnWidth,
        outputView: state.outputView,
        fsExplorerView: state.fsExplorerView,
        spawnAgentKey: state.spawnAgentKey,
        spawnModel: state.spawnModel,
        customAgents: state.customAgents,
        shortcutBindings: state.shortcutBindings,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<DroneHubUiPersistedState>) ?? {};
        return {
          ...currentState,
          ...persisted,
          appView: normalizeAppView(persisted.appView ?? currentState.appView),
          sidebarAutoMinimize: normalizeBoolean(persisted.sidebarAutoMinimize ?? currentState.sidebarAutoMinimize),
          sidebarGroupingMode: normalizeSidebarGroupingMode(
            persisted.sidebarGroupingMode ?? currentState.sidebarGroupingMode,
          ),
          viewMode: normalizeViewMode(persisted.viewMode ?? currentState.viewMode),
          collapsedGroups: normalizeCollapsedGroups(persisted.collapsedGroups ?? currentState.collapsedGroups),
          groupMultiChatColumnWidth: clampGroupMultiChatColumnWidthPx(
            Number(persisted.groupMultiChatColumnWidth ?? currentState.groupMultiChatColumnWidth),
          ),
          outputView: normalizeOutputView(persisted.outputView ?? currentState.outputView),
          fsExplorerView: normalizeFsExplorerView(persisted.fsExplorerView ?? currentState.fsExplorerView),
          customAgents: sanitizeCustomAgents(persisted.customAgents ?? currentState.customAgents),
          shortcutBindings: sanitizeShortcutBindings(persisted.shortcutBindings ?? currentState.shortcutBindings),
        };
      },
    },
  ),
);

export function useDroneHubAppModelUiState() {
  return useDroneHubUiStore(
    useShallow((s) => ({
      activeRepoPath: s.activeRepoPath,
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      appView: s.appView,
      viewMode: s.viewMode,
      sidebarGroupingMode: s.sidebarGroupingMode,
      collapsedGroups: s.collapsedGroups,
      autoDelete: s.autoDelete,
      terminalEmulator: s.terminalEmulator,
      selectedDrone: s.selectedDrone,
      selectedDroneIds: s.selectedDroneIds,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      selectedChat: s.selectedChat,
      draftChat: s.draftChat,
      reposModalOpen: s.reposModalOpen,
      droneErrorModal: s.droneErrorModal,
      clearingDroneError: s.clearingDroneError,
      headerOverflowOpen: s.headerOverflowOpen,
      outputView: s.outputView,
      fsExplorerView: s.fsExplorerView,
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      customAgents: s.customAgents,
      customAgentModalOpen: s.customAgentModalOpen,
      newCustomAgentLabel: s.newCustomAgentLabel,
      newCustomAgentCommand: s.newCustomAgentCommand,
      customAgentError: s.customAgentError,
      nameSuggestToast: s.nameSuggestToast,
      shortcutBindings: s.shortcutBindings,
      terminalMenuOpen: s.terminalMenuOpen,
      setActiveRepoPath: s.setActiveRepoPath,
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
      setAppView: s.setAppView,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setCollapsedGroups: s.setCollapsedGroups,
      setSelectedDrone: s.setSelectedDrone,
      setSelectedDroneIds: s.setSelectedDroneIds,
      setSelectedGroupMultiChat: s.setSelectedGroupMultiChat,
      setGroupBroadcastExpanded: s.setGroupBroadcastExpanded,
      setSelectedChat: s.setSelectedChat,
      setDraftChat: s.setDraftChat,
      setReposModalOpen: s.setReposModalOpen,
      setDroneErrorModal: s.setDroneErrorModal,
      setClearingDroneError: s.setClearingDroneError,
      setHeaderOverflowOpen: s.setHeaderOverflowOpen,
      setOutputView: s.setOutputView,
      setFsExplorerView: s.setFsExplorerView,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
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
      selectedDrone: s.selectedDrone,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      sidebarReposCollapsed: s.sidebarReposCollapsed,
      sidebarAutoMinimize: s.sidebarAutoMinimize,
      sidebarGroupingMode: s.sidebarGroupingMode,
      autoDelete: s.autoDelete,
      setAppView: s.setAppView,
      setViewMode: s.setViewMode,
      setSidebarReposCollapsed: s.setSidebarReposCollapsed,
      setSidebarAutoMinimize: s.setSidebarAutoMinimize,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setActiveRepoPath: s.setActiveRepoPath,
      setAutoDelete: s.setAutoDelete,
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
