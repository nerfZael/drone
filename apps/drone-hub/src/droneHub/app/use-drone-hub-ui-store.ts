import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { AppView, DraftChatState, DroneErrorModalState } from './app-types';
import {
  FS_EXPLORER_VIEW_STORAGE_KEY,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY,
  SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY,
  clampGroupMultiChatColumnWidthPx,
} from './app-config';
import { readLocalStorageItem } from './hooks';
import type { CustomAgentProfile } from '../types';

type Updater<T> = T | ((prev: T) => T);

type NameSuggestToast = null | { id: string; message: string };

type DroneHubUiState = {
  activeRepoPath: string;
  chatHeaderRepoPath: string;
  sidebarReposCollapsed: boolean;
  appView: AppView;
  viewMode: 'grouped' | 'flat';
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
  outputView: 'screen' | 'log';
  fsExplorerView: 'list' | 'thumb';
  spawnAgentKey: string;
  spawnModel: string;
  customAgents: CustomAgentProfile[];
  customAgentModalOpen: boolean;
  newCustomAgentLabel: string;
  newCustomAgentCommand: string;
  customAgentError: string | null;
  nameSuggestToast: NameSuggestToast;
  terminalMenuOpen: boolean;
  agentMenuOpen: boolean;
  setActiveRepoPath: (next: Updater<string>) => void;
  setChatHeaderRepoPath: (next: Updater<string>) => void;
  setSidebarReposCollapsed: (next: Updater<boolean>) => void;
  setAppView: (next: Updater<AppView>) => void;
  setViewMode: (next: Updater<'grouped' | 'flat'>) => void;
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
  setOutputView: (next: Updater<'screen' | 'log'>) => void;
  setFsExplorerView: (next: Updater<'list' | 'thumb'>) => void;
  setSpawnAgentKey: (next: Updater<string>) => void;
  setSpawnModel: (next: Updater<string>) => void;
  setCustomAgents: (next: Updater<CustomAgentProfile[]>) => void;
  setCustomAgentModalOpen: (next: Updater<boolean>) => void;
  setNewCustomAgentLabel: (next: Updater<string>) => void;
  setNewCustomAgentCommand: (next: Updater<string>) => void;
  setCustomAgentError: (next: Updater<string | null>) => void;
  setNameSuggestToast: (next: Updater<NameSuggestToast>) => void;
  setTerminalMenuOpen: (next: Updater<boolean>) => void;
  setAgentMenuOpen: (next: Updater<boolean>) => void;
};

function resolveNext<T>(prev: T, next: Updater<T>): T {
  return typeof next === 'function' ? (next as (current: T) => T)(prev) : next;
}

function readCustomAgents(): CustomAgentProfile[] {
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
}

export const useDroneHubUiStore = create<DroneHubUiState>((set) => ({
  activeRepoPath: readLocalStorageItem('droneHub.activeRepoPath') || '',
  chatHeaderRepoPath: String(readLocalStorageItem('droneHub.chatHeaderRepoPath') ?? '').trim(),
  sidebarReposCollapsed: readLocalStorageItem(SIDEBAR_REPOS_COLLAPSED_STORAGE_KEY) === '1',
  appView: readLocalStorageItem('droneHub.appView') === 'settings' ? 'settings' : 'workspace',
  viewMode: readLocalStorageItem('droneHub.viewMode') === 'flat' ? 'flat' : 'grouped',
  collapsedGroups: (() => {
    const raw = readLocalStorageItem('droneHub.collapsedGroups');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  })(),
  autoDelete: readLocalStorageItem('droneHub.autoDelete') === '1',
  terminalEmulator: readLocalStorageItem('droneHub.terminalEmulator') || 'auto',
  selectedDrone: null,
  selectedDroneIds: [],
  selectedGroupMultiChat: null,
  groupBroadcastExpanded: false,
  groupMultiChatColumnWidth: (() => {
    const saved = Number(readLocalStorageItem(GROUP_MULTI_CHAT_COLUMN_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) return clampGroupMultiChatColumnWidthPx(saved);
    return GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX;
  })(),
  selectedChat: 'default',
  draftChat: null,
  sidebarCollapsed: false,
  reposModalOpen: false,
  droneErrorModal: null,
  clearingDroneError: false,
  headerOverflowOpen: false,
  outputView: readLocalStorageItem('droneHub.outputView') === 'log' ? 'log' : 'screen',
  fsExplorerView: readLocalStorageItem(FS_EXPLORER_VIEW_STORAGE_KEY) === 'thumb' ? 'thumb' : 'list',
  spawnAgentKey: readLocalStorageItem('droneHub.spawnAgent') || 'builtin:cursor',
  spawnModel: readLocalStorageItem('droneHub.spawnModel') || '',
  customAgents: readCustomAgents(),
  customAgentModalOpen: false,
  newCustomAgentLabel: '',
  newCustomAgentCommand: '',
  customAgentError: null,
  nameSuggestToast: null,
  terminalMenuOpen: false,
  agentMenuOpen: false,
  setActiveRepoPath: (next) => set((s) => ({ activeRepoPath: resolveNext(s.activeRepoPath, next) })),
  setChatHeaderRepoPath: (next) => set((s) => ({ chatHeaderRepoPath: resolveNext(s.chatHeaderRepoPath, next) })),
  setSidebarReposCollapsed: (next) => set((s) => ({ sidebarReposCollapsed: resolveNext(s.sidebarReposCollapsed, next) })),
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
  setTerminalMenuOpen: (next) => set((s) => ({ terminalMenuOpen: resolveNext(s.terminalMenuOpen, next) })),
  setAgentMenuOpen: (next) => set((s) => ({ agentMenuOpen: resolveNext(s.agentMenuOpen, next) })),
}));

export function useDroneHubUiState() {
  return useDroneHubUiStore(
    useShallow((s) => ({
      activeRepoPath: s.activeRepoPath,
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      sidebarReposCollapsed: s.sidebarReposCollapsed,
      appView: s.appView,
      viewMode: s.viewMode,
      collapsedGroups: s.collapsedGroups,
      autoDelete: s.autoDelete,
      terminalEmulator: s.terminalEmulator,
      selectedDrone: s.selectedDrone,
      selectedDroneIds: s.selectedDroneIds,
      selectedGroupMultiChat: s.selectedGroupMultiChat,
      groupBroadcastExpanded: s.groupBroadcastExpanded,
      groupMultiChatColumnWidth: s.groupMultiChatColumnWidth,
      selectedChat: s.selectedChat,
      draftChat: s.draftChat,
      sidebarCollapsed: s.sidebarCollapsed,
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
      terminalMenuOpen: s.terminalMenuOpen,
      agentMenuOpen: s.agentMenuOpen,
      setActiveRepoPath: s.setActiveRepoPath,
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
      setSidebarReposCollapsed: s.setSidebarReposCollapsed,
      setAppView: s.setAppView,
      setViewMode: s.setViewMode,
      setCollapsedGroups: s.setCollapsedGroups,
      setAutoDelete: s.setAutoDelete,
      setTerminalEmulator: s.setTerminalEmulator,
      setSelectedDrone: s.setSelectedDrone,
      setSelectedDroneIds: s.setSelectedDroneIds,
      setSelectedGroupMultiChat: s.setSelectedGroupMultiChat,
      setGroupBroadcastExpanded: s.setGroupBroadcastExpanded,
      setGroupMultiChatColumnWidth: s.setGroupMultiChatColumnWidth,
      setSelectedChat: s.setSelectedChat,
      setDraftChat: s.setDraftChat,
      setSidebarCollapsed: s.setSidebarCollapsed,
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
      setTerminalMenuOpen: s.setTerminalMenuOpen,
      setAgentMenuOpen: s.setAgentMenuOpen,
    })),
  );
}
