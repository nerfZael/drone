import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SidebarMoveCommandResult } from '@drone/device-protocol';
import type {
  SidebarDensityMode,
  SidebarGroupingMode,
  UiPreferencesSettingsResponse,
} from './settings-types';
import {
  normalizeSpawnContextByRepoKey,
  resolveSpawnContextPreferencesForRepo,
  useDroneHubUiStore,
} from './use-drone-hub-ui-store';
import { loadDesktopNewDronePreferencesByRepo } from './new-drone-preferences';
import { profileStorageKey } from '../../profile-storage';
import {
  UI_PREFERENCES_SNAPSHOT_EVENT,
  type UiPreferencesSnapshotEventDetail,
} from './ui-preferences-sync-event';
import {
  appendSidebarOptimisticCommand,
  applySidebarMove,
  createSidebarOptimisticJournal,
  normalizeSidebarLayout,
  replaceSidebarConfirmedState,
  settleSidebarOptimisticCommand,
  sidebarLayoutPatch,
  sidebarOptimisticJournalValue,
  type SidebarLayoutState,
  type SidebarCommandQueue,
  type SidebarMoveIntent,
  type SidebarOptimisticJournal,
} from '@drone/hub-model/sidebar';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UiPreferencesSnapshot = UiPreferencesSettingsResponse['uiPreferences'];

type UseUiPreferencesSettingsArgs = {
  requestJson: RequestJson;
  sidebarCommandQueue: SidebarCommandQueue;
};

export type UseUiPreferencesSettingsResult = {
  uiPreferencesReady: boolean;
  reloadUiPreferences: () => Promise<void>;
  reloadPinnedDrones: () => Promise<void>;
  setDronePinned: (droneId: string, pinned: boolean) => Promise<boolean>;
  setDronesPinned: (droneIds: readonly string[], pinned: boolean) => Promise<boolean>;
  moveSidebar: (intent: SidebarMoveIntent) => Promise<SidebarMoveCommandResult>;
};

const SAVE_DEBOUNCE_MS = 400;

function normalizeSidebarGroupingMode(value: unknown): SidebarGroupingMode {
  return value === 'groups' ? 'groups' : 'repos';
}

function normalizeSidebarDensityMode(value: unknown): SidebarDensityMode {
  return value === 'compact' || value === 'comfortable' ? value : 'default';
}

function normalizeRepoBranchSource(value: unknown): 'host' | 'remote' {
  return value === 'remote' ? 'remote' : 'host';
}

function normalizeSpawnAgentPermissionMode(value: unknown): 'read' | 'write' | 'execute' {
  return value === 'read' || value === 'write' ? value : 'execute';
}

function normalizeSpawnApprovalPolicy(value: unknown): 'ask' | 'auto' | 'none' {
  return value === 'auto' || value === 'none' ? value : 'ask';
}

function normalizeTrimmedText(value: unknown, maxChars: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, maxChars);
}

function normalizeOrderedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const entry = String(item ?? '').trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function normalizeOrderedStringMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [keyRaw, listRaw] of Object.entries(value as Record<string, unknown>)) {
    const key = String(keyRaw ?? '').trim();
    if (!key) continue;
    const list = normalizeOrderedStringList(listRaw);
    if (list.length === 0) continue;
    out[key] = list;
  }
  return out;
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [keyRaw, itemRaw] of Object.entries(value as Record<string, unknown>)) {
    const key = String(keyRaw ?? '').trim();
    if (!key) continue;
    out[key] = itemRaw === true;
  }
  return out;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([keyRaw, itemRaw]) => {
      const key = String(keyRaw ?? '').trim();
      const item = String(itemRaw ?? '').trim();
      return key && item ? [[key, item] as const] : [];
    }),
  );
}

function normalizeUiPreferencesSnapshot(
  value: Partial<UiPreferencesSnapshot> | null | undefined,
): UiPreferencesSnapshot {
  return {
    sidebarGroupingMode: normalizeSidebarGroupingMode(value?.sidebarGroupingMode),
    sidebarDensityMode: normalizeSidebarDensityMode(value?.sidebarDensityMode),
    collapsedGroups: normalizeBooleanRecord(value?.collapsedGroups),
    collapsedDroneSections: normalizeBooleanRecord(value?.collapsedDroneSections),
    sidebarGroupOrder: normalizeOrderedStringList(value?.sidebarGroupOrder),
    sidebarDroneOrderByGroup: normalizeOrderedStringMap(value?.sidebarDroneOrderByGroup),
    sidebarNodeOrderByParent: normalizeOrderedStringMap(value?.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: normalizeOrderedStringMap(value?.sidebarChatOrderByDrone),
    sidebarChatGroupPathsByDrone: normalizeOrderedStringMap(value?.sidebarChatGroupPathsByDrone),
    sidebarChatGroupByChat: normalizeStringRecord(value?.sidebarChatGroupByChat),
    sidebarChatNodeOrderByParent: normalizeOrderedStringMap(value?.sidebarChatNodeOrderByParent),
    pinnedDroneIds: normalizeOrderedStringList(value?.pinnedDroneIds),
    mutedSidebarGroupIds: normalizeOrderedStringList(value?.mutedSidebarGroupIds),
    mutedDroneIds: normalizeOrderedStringList(value?.mutedDroneIds),
    mutedChatIds: normalizeOrderedStringList(value?.mutedChatIds),
    hiddenSidebarGroups: normalizeOrderedStringList(value?.hiddenSidebarGroups),
    spawnAgentKey: normalizeTrimmedText(value?.spawnAgentKey, 200) || 'builtin:cursor',
    spawnModel: normalizeTrimmedText(value?.spawnModel, 200),
    spawnReasoning: normalizeTrimmedText(value?.spawnReasoning, 200),
    spawnAgentPermissionMode: normalizeSpawnAgentPermissionMode(value?.spawnAgentPermissionMode),
    spawnApprovalPolicy: normalizeSpawnApprovalPolicy(value?.spawnApprovalPolicy),
    repoBranchSource: normalizeRepoBranchSource(value?.repoBranchSource),
    repoCreateRemoteBranch: normalizeTrimmedText(value?.repoCreateRemoteBranch, 400),
    spawnContextByRepoKey: normalizeSpawnContextByRepoKey(value?.spawnContextByRepoKey),
  };
}

function serializeUiPreferencesSnapshot(value: UiPreferencesSnapshot): string {
  return JSON.stringify(value);
}

export function recoverInitialSpawnContextByRepoKey({
  backend,
  current,
  remembered,
  backendUpdated,
}: {
  backend: Partial<UiPreferencesSnapshot> | null | undefined;
  current: Partial<UiPreferencesSnapshot> | null | undefined;
  remembered: unknown;
  backendUpdated: boolean;
}): UiPreferencesSnapshot['spawnContextByRepoKey'] {
  const backendSnapshot = normalizeUiPreferencesSnapshot(backend);
  if (Object.keys(backendSnapshot.spawnContextByRepoKey).length > 0) {
    return backendSnapshot.spawnContextByRepoKey;
  }
  const currentRepoContexts = {
    ...normalizeUiPreferencesSnapshot(current).spawnContextByRepoKey,
  };
  if (backendUpdated) delete currentRepoContexts.__no_repo__;
  return {
    ...(backendUpdated
      ? normalizeSpawnContextByRepoKey({ __no_repo__: backendSnapshot })
      : {}),
    ...currentRepoContexts,
    ...normalizeSpawnContextByRepoKey(remembered),
  };
}

function sameUiPreferenceValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeOrderedStringMapChanges(
  base: Record<string, string[]>,
  local: Record<string, string[]>,
  remote: Record<string, string[]>,
): Record<string, string[]> {
  const merged = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (sameUiPreferenceValue(base[key] ?? [], local[key] ?? [])) continue;
    if (local[key]?.length) merged[key] = local[key];
    else delete merged[key];
  }
  return merged;
}

function mergeRecordChanges<T>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
): Record<string, T> {
  const merged = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (sameUiPreferenceValue(base[key], local[key])) continue;
    if (Object.prototype.hasOwnProperty.call(local, key)) merged[key] = local[key]!;
    else delete merged[key];
  }
  return merged;
}

/** Rebase locally changed preference fields onto a newer server snapshot. */
export function mergeUiPreferencesChanges(
  baseRaw: Partial<UiPreferencesSnapshot> | null | undefined,
  localRaw: Partial<UiPreferencesSnapshot> | null | undefined,
  remoteRaw: Partial<UiPreferencesSnapshot> | null | undefined,
): UiPreferencesSnapshot {
  const base = normalizeUiPreferencesSnapshot(baseRaw);
  const local = normalizeUiPreferencesSnapshot(localRaw);
  const remote = normalizeUiPreferencesSnapshot(remoteRaw);
  const localValue = <K extends keyof UiPreferencesSnapshot>(key: K): UiPreferencesSnapshot[K] =>
    sameUiPreferenceValue(base[key], local[key]) ? remote[key] : local[key];
  return normalizeUiPreferencesSnapshot({
    sidebarGroupingMode: localValue('sidebarGroupingMode'),
    sidebarDensityMode: localValue('sidebarDensityMode'),
    collapsedGroups: mergeRecordChanges(
      base.collapsedGroups,
      local.collapsedGroups,
      remote.collapsedGroups,
    ),
    collapsedDroneSections: mergeRecordChanges(
      base.collapsedDroneSections,
      local.collapsedDroneSections,
      remote.collapsedDroneSections,
    ),
    sidebarGroupOrder: localValue('sidebarGroupOrder'),
    sidebarDroneOrderByGroup: mergeOrderedStringMapChanges(
      base.sidebarDroneOrderByGroup,
      local.sidebarDroneOrderByGroup,
      remote.sidebarDroneOrderByGroup,
    ),
    sidebarNodeOrderByParent: mergeOrderedStringMapChanges(
      base.sidebarNodeOrderByParent,
      local.sidebarNodeOrderByParent,
      remote.sidebarNodeOrderByParent,
    ),
    sidebarChatOrderByDrone: mergeOrderedStringMapChanges(
      base.sidebarChatOrderByDrone,
      local.sidebarChatOrderByDrone,
      remote.sidebarChatOrderByDrone,
    ),
    sidebarChatGroupPathsByDrone: mergeOrderedStringMapChanges(
      base.sidebarChatGroupPathsByDrone,
      local.sidebarChatGroupPathsByDrone,
      remote.sidebarChatGroupPathsByDrone,
    ),
    sidebarChatGroupByChat: mergeRecordChanges(
      base.sidebarChatGroupByChat,
      local.sidebarChatGroupByChat,
      remote.sidebarChatGroupByChat,
    ),
    sidebarChatNodeOrderByParent: mergeOrderedStringMapChanges(
      base.sidebarChatNodeOrderByParent,
      local.sidebarChatNodeOrderByParent,
      remote.sidebarChatNodeOrderByParent,
    ),
    pinnedDroneIds: localValue('pinnedDroneIds'),
    mutedSidebarGroupIds: localValue('mutedSidebarGroupIds'),
    mutedDroneIds: localValue('mutedDroneIds'),
    mutedChatIds: localValue('mutedChatIds'),
    hiddenSidebarGroups: localValue('hiddenSidebarGroups'),
    spawnAgentKey: localValue('spawnAgentKey'),
    spawnModel: localValue('spawnModel'),
    spawnReasoning: localValue('spawnReasoning'),
    spawnAgentPermissionMode: localValue('spawnAgentPermissionMode'),
    spawnApprovalPolicy: localValue('spawnApprovalPolicy'),
    repoBranchSource: localValue('repoBranchSource'),
    repoCreateRemoteBranch: localValue('repoCreateRemoteBranch'),
    spawnContextByRepoKey: mergeRecordChanges(
      base.spawnContextByRepoKey,
      local.spawnContextByRepoKey,
      remote.spawnContextByRepoKey,
    ),
  });
}

function hasMeaningfulUiPreferencesSnapshot(value: UiPreferencesSnapshot): boolean {
  return (
    value.sidebarGroupingMode === 'groups' ||
    value.sidebarDensityMode !== 'default' ||
    Object.keys(value.collapsedGroups).length > 0 ||
    Object.keys(value.collapsedDroneSections).length > 0 ||
    value.sidebarGroupOrder.length > 0 ||
    Object.keys(value.sidebarDroneOrderByGroup).length > 0 ||
    Object.keys(value.sidebarNodeOrderByParent).length > 0 ||
    Object.keys(value.sidebarChatOrderByDrone).length > 0 ||
    Object.keys(value.sidebarChatGroupPathsByDrone).length > 0 ||
    Object.keys(value.sidebarChatGroupByChat).length > 0 ||
    Object.keys(value.sidebarChatNodeOrderByParent).length > 0 ||
    value.pinnedDroneIds.length > 0 ||
    value.mutedSidebarGroupIds.length > 0 ||
    value.mutedDroneIds.length > 0 ||
    value.mutedChatIds.length > 0 ||
    value.hiddenSidebarGroups.length > 0 ||
    value.spawnAgentKey !== 'builtin:cursor' ||
    value.spawnModel.length > 0 ||
    value.spawnReasoning.length > 0 ||
    value.spawnAgentPermissionMode !== 'execute' ||
    value.spawnApprovalPolicy !== 'ask' ||
    value.repoBranchSource !== 'host' ||
    value.repoCreateRemoteBranch.length > 0 ||
    Object.keys(value.spawnContextByRepoKey).length > 0
  );
}

function mergeUiPreferencesForRecovery(
  base: UiPreferencesSnapshot,
  rescue: UiPreferencesSnapshot,
): UiPreferencesSnapshot {
  return normalizeUiPreferencesSnapshot({
    sidebarGroupingMode:
      base.sidebarGroupingMode === 'repos' ? rescue.sidebarGroupingMode : base.sidebarGroupingMode,
    sidebarDensityMode:
      base.sidebarDensityMode === 'default' ? rescue.sidebarDensityMode : base.sidebarDensityMode,
    collapsedGroups:
      Object.keys(base.collapsedGroups).length > 0
        ? base.collapsedGroups
        : rescue.collapsedGroups,
    collapsedDroneSections:
      Object.keys(base.collapsedDroneSections).length > 0
        ? base.collapsedDroneSections
        : rescue.collapsedDroneSections,
    sidebarGroupOrder:
      base.sidebarGroupOrder.length > 0 ? base.sidebarGroupOrder : rescue.sidebarGroupOrder,
    sidebarDroneOrderByGroup:
      Object.keys(base.sidebarDroneOrderByGroup).length > 0
        ? base.sidebarDroneOrderByGroup
        : rescue.sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent:
      Object.keys(base.sidebarNodeOrderByParent).length > 0
        ? base.sidebarNodeOrderByParent
        : rescue.sidebarNodeOrderByParent,
    sidebarChatOrderByDrone:
      Object.keys(base.sidebarChatOrderByDrone).length > 0
        ? base.sidebarChatOrderByDrone
        : rescue.sidebarChatOrderByDrone,
    sidebarChatGroupPathsByDrone:
      Object.keys(base.sidebarChatGroupPathsByDrone).length > 0
        ? base.sidebarChatGroupPathsByDrone
        : rescue.sidebarChatGroupPathsByDrone,
    sidebarChatGroupByChat:
      Object.keys(base.sidebarChatGroupByChat).length > 0
        ? base.sidebarChatGroupByChat
        : rescue.sidebarChatGroupByChat,
    sidebarChatNodeOrderByParent:
      Object.keys(base.sidebarChatNodeOrderByParent).length > 0
        ? base.sidebarChatNodeOrderByParent
        : rescue.sidebarChatNodeOrderByParent,
    pinnedDroneIds: base.pinnedDroneIds.length > 0 ? base.pinnedDroneIds : rescue.pinnedDroneIds,
    mutedSidebarGroupIds:
      base.mutedSidebarGroupIds.length > 0
        ? base.mutedSidebarGroupIds
        : rescue.mutedSidebarGroupIds,
    mutedDroneIds: base.mutedDroneIds.length > 0 ? base.mutedDroneIds : rescue.mutedDroneIds,
    mutedChatIds: base.mutedChatIds.length > 0 ? base.mutedChatIds : rescue.mutedChatIds,
    hiddenSidebarGroups:
      base.hiddenSidebarGroups.length > 0 ? base.hiddenSidebarGroups : rescue.hiddenSidebarGroups,
    spawnAgentKey:
      base.spawnAgentKey !== 'builtin:cursor' ? base.spawnAgentKey : rescue.spawnAgentKey,
    spawnModel: base.spawnModel || rescue.spawnModel,
    spawnReasoning: base.spawnReasoning || rescue.spawnReasoning,
    spawnAgentPermissionMode: base.spawnAgentPermissionMode !== 'execute'
      ? base.spawnAgentPermissionMode
      : rescue.spawnAgentPermissionMode,
    spawnApprovalPolicy: base.spawnApprovalPolicy !== 'ask'
      ? base.spawnApprovalPolicy
      : rescue.spawnApprovalPolicy,
    repoBranchSource:
      base.repoBranchSource !== 'host' ? base.repoBranchSource : rescue.repoBranchSource,
    repoCreateRemoteBranch: base.repoCreateRemoteBranch || rescue.repoCreateRemoteBranch,
    spawnContextByRepoKey: Object.keys(base.spawnContextByRepoKey).length > 0
      ? base.spawnContextByRepoKey
      : rescue.spawnContextByRepoKey,
  });
}

export function restoreUiPreferencesFromPersistedStorage(
  current: Partial<UiPreferencesSnapshot> | null | undefined,
  storageRaw: string | null,
): { snapshot: UiPreferencesSnapshot; restored: boolean } {
  const base = normalizeUiPreferencesSnapshot(current);
  if (!storageRaw) return { snapshot: base, restored: false };
  try {
    const parsed = JSON.parse(storageRaw) as any;
    const persistedState =
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, 'state')
        ? parsed.state
        : parsed;
    const rescue = normalizeUiPreferencesSnapshot(persistedState as Partial<UiPreferencesSnapshot>);
    if (!hasMeaningfulUiPreferencesSnapshot(rescue)) return { snapshot: base, restored: false };
    const merged = mergeUiPreferencesForRecovery(base, rescue);
    return {
      snapshot: merged,
      restored: serializeUiPreferencesSnapshot(merged) !== serializeUiPreferencesSnapshot(base),
    };
  } catch {
    return { snapshot: base, restored: false };
  }
}

export function reconcileUiPreferencesReload({
  backend,
  backendUpdatedAt,
  current,
  previousBackend,
  wasReady,
  storageRaw,
}: {
  backend: Partial<UiPreferencesSnapshot> | null | undefined;
  backendUpdatedAt: string | null;
  current: Partial<UiPreferencesSnapshot> | null | undefined;
  previousBackend: Partial<UiPreferencesSnapshot> | null | undefined;
  wasReady: boolean;
  storageRaw: string | null;
}): UiPreferencesSnapshot {
  const backendSnapshot = normalizeUiPreferencesSnapshot(backend);
  const currentSnapshot = normalizeUiPreferencesSnapshot(current);
  const previousBackendSnapshot = previousBackend
    ? normalizeUiPreferencesSnapshot(previousBackend)
    : null;
  const hasLocalChanges =
    wasReady &&
    previousBackendSnapshot !== null &&
    serializeUiPreferencesSnapshot(currentSnapshot) !==
      serializeUiPreferencesSnapshot(previousBackendSnapshot);
  if (hasLocalChanges && previousBackendSnapshot) {
    return mergeUiPreferencesChanges(previousBackendSnapshot, currentSnapshot, backendSnapshot);
  }
  if (backendUpdatedAt) {
    if (!wasReady) {
      if (Object.keys(backendSnapshot.collapsedGroups).length === 0) {
        backendSnapshot.collapsedGroups = currentSnapshot.collapsedGroups;
      }
      if (Object.keys(backendSnapshot.collapsedDroneSections).length === 0) {
        backendSnapshot.collapsedDroneSections = currentSnapshot.collapsedDroneSections;
      }
    }
    return backendSnapshot;
  }
  return restoreUiPreferencesFromPersistedStorage(backendSnapshot, storageRaw).snapshot;
}

export function useUiPreferencesSettings({
  requestJson,
  sidebarCommandQueue,
}: UseUiPreferencesSettingsArgs): UseUiPreferencesSettingsResult {
  const {
    sidebarGroupingMode,
    sidebarDensityMode,
    collapsedGroups,
    collapsedDroneSections,
    sidebarGroupOrder,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    sidebarChatGroupPathsByDrone,
    sidebarChatGroupByChat,
    sidebarChatNodeOrderByParent,
    pinnedDroneIds,
    mutedSidebarGroupIds,
    mutedDroneIds,
    mutedChatIds,
    hiddenSidebarGroups,
    spawnAgentKey,
    spawnModel,
    spawnReasoning,
    spawnAgentPermissionMode,
    spawnApprovalPolicy,
    spawnContextByRepoKey,
    repoBranchSource,
    repoCreateRemoteBranch,
    setSidebarGroupingMode,
    setSidebarDensityMode,
    setCollapsedGroups,
    setCollapsedDroneSections,
    setSidebarGroupOrder,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setSidebarChatGroupPathsByDrone,
    setSidebarChatGroupByChat,
    setSidebarChatNodeOrderByParent,
    setPinnedDroneIds,
    setMutedSidebarGroupIds,
    setMutedDroneIds,
    setMutedChatIds,
    setHiddenSidebarGroups,
    setSpawnAgentKey,
    setSpawnModel,
    setSpawnReasoning,
    setSpawnAgentPermissionMode,
    setSpawnApprovalPolicy,
    setRepoBranchSource,
    setRepoCreateRemoteBranch,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarDensityMode: s.sidebarDensityMode,
      collapsedGroups: s.collapsedGroups,
      collapsedDroneSections: s.collapsedDroneSections,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      sidebarChatGroupPathsByDrone: s.sidebarChatGroupPathsByDrone,
      sidebarChatGroupByChat: s.sidebarChatGroupByChat,
      sidebarChatNodeOrderByParent: s.sidebarChatNodeOrderByParent,
      pinnedDroneIds: s.pinnedDroneIds,
      mutedSidebarGroupIds: s.mutedSidebarGroupIds,
      mutedDroneIds: s.mutedDroneIds,
      mutedChatIds: s.mutedChatIds,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      spawnReasoning: s.spawnReasoning,
      spawnAgentPermissionMode: s.spawnAgentPermissionMode,
      spawnApprovalPolicy: s.spawnApprovalPolicy,
      spawnContextByRepoKey: s.spawnContextByRepoKey,
      repoBranchSource: s.repoBranchSource,
      repoCreateRemoteBranch: s.repoCreateRemoteBranch,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarDensityMode: s.setSidebarDensityMode,
      setCollapsedGroups: s.setCollapsedGroups,
      setCollapsedDroneSections: s.setCollapsedDroneSections,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setSidebarChatGroupPathsByDrone: s.setSidebarChatGroupPathsByDrone,
      setSidebarChatGroupByChat: s.setSidebarChatGroupByChat,
      setSidebarChatNodeOrderByParent: s.setSidebarChatNodeOrderByParent,
      setPinnedDroneIds: s.setPinnedDroneIds,
      setMutedSidebarGroupIds: s.setMutedSidebarGroupIds,
      setMutedDroneIds: s.setMutedDroneIds,
      setMutedChatIds: s.setMutedChatIds,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      setSpawnReasoning: s.setSpawnReasoning,
      setSpawnAgentPermissionMode: s.setSpawnAgentPermissionMode,
      setSpawnApprovalPolicy: s.setSpawnApprovalPolicy,
      setRepoBranchSource: s.setRepoBranchSource,
      setRepoCreateRemoteBranch: s.setRepoCreateRemoteBranch,
    })),
  );

  const readyRef = React.useRef(false);
  const lastSavedSerializedRef = React.useRef('');
  const lastSavedSnapshotRef = React.useRef<UiPreferencesSnapshot | null>(null);
  const lastSavedVersionRef = React.useRef<number | null>(null);
  const pendingSidebarCommandsRef = React.useRef(0);
  const sidebarCommandSeqRef = React.useRef(0);
  const sidebarJournalRef = React.useRef<SidebarOptimisticJournal<SidebarLayoutState, SidebarMoveIntent>>(
    createSidebarOptimisticJournal(normalizeSidebarLayout(null)),
  );
  const [sidebarCommandRevision, setSidebarCommandRevision] = React.useState(0);
  const [uiPreferencesReady, setUiPreferencesReady] = React.useState(false);
  const saveSeqRef = React.useRef(0);
  const saveTimeoutRef = React.useRef<number | null>(null);

  const applyUiPreferences = React.useCallback(
    (value: Partial<UiPreferencesSnapshot> | null | undefined): UiPreferencesSnapshot => {
      const normalized = normalizeUiPreferencesSnapshot(value);
      setSidebarGroupingMode(normalized.sidebarGroupingMode);
      setSidebarDensityMode(normalized.sidebarDensityMode);
      setCollapsedGroups(normalized.collapsedGroups);
      setCollapsedDroneSections(normalized.collapsedDroneSections);
      setSidebarGroupOrder(normalized.sidebarGroupOrder);
      setSidebarDroneOrderByGroup(normalized.sidebarDroneOrderByGroup);
      setSidebarNodeOrderByParent(normalized.sidebarNodeOrderByParent);
      setSidebarChatOrderByDrone(normalized.sidebarChatOrderByDrone);
      setSidebarChatGroupPathsByDrone(normalized.sidebarChatGroupPathsByDrone);
      setSidebarChatGroupByChat(normalized.sidebarChatGroupByChat);
      setSidebarChatNodeOrderByParent(normalized.sidebarChatNodeOrderByParent);
      setPinnedDroneIds(normalized.pinnedDroneIds);
      setMutedSidebarGroupIds(normalized.mutedSidebarGroupIds);
      setMutedDroneIds(normalized.mutedDroneIds);
      setMutedChatIds(normalized.mutedChatIds);
      setHiddenSidebarGroups(normalized.hiddenSidebarGroups);
      if (Object.keys(normalized.spawnContextByRepoKey).length > 0) {
        const current = useDroneHubUiStore.getState();
        const resolved = resolveSpawnContextPreferencesForRepo(
          normalized.spawnContextByRepoKey,
          current.spawnContextRepoPath,
        );
        useDroneHubUiStore.setState({
          spawnContextByRepoKey: normalized.spawnContextByRepoKey,
          ...resolved,
        });
      } else {
        setSpawnAgentKey(normalized.spawnAgentKey);
        setSpawnModel(normalized.spawnModel);
        setSpawnReasoning(normalized.spawnReasoning);
        setSpawnAgentPermissionMode(normalized.spawnAgentPermissionMode);
        setSpawnApprovalPolicy(normalized.spawnApprovalPolicy);
        setRepoBranchSource(normalized.repoBranchSource);
        setRepoCreateRemoteBranch(normalized.repoCreateRemoteBranch);
      }
      return normalized;
    },
    [
      setSidebarDensityMode,
      setCollapsedGroups,
      setCollapsedDroneSections,
      setHiddenSidebarGroups,
      setSidebarChatOrderByDrone,
      setSidebarChatGroupPathsByDrone,
      setSidebarChatGroupByChat,
      setSidebarChatNodeOrderByParent,
      setPinnedDroneIds,
      setMutedSidebarGroupIds,
      setMutedDroneIds,
      setMutedChatIds,
      setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent,
      setSidebarGroupOrder,
      setSidebarGroupingMode,
      setSpawnAgentKey,
      setSpawnAgentPermissionMode,
      setSpawnApprovalPolicy,
      setSpawnModel,
      setSpawnReasoning,
      setRepoBranchSource,
      setRepoCreateRemoteBranch,
    ],
  );

  const cancelPendingSave = React.useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveSeqRef.current += 1;
  }, []);

  const rebasePendingSidebarCommands = React.useCallback(
    (snapshotRaw: UiPreferencesSnapshot): UiPreferencesSnapshot => {
      const snapshot = normalizeUiPreferencesSnapshot(snapshotRaw);
      sidebarJournalRef.current = replaceSidebarConfirmedState(
        sidebarJournalRef.current,
        normalizeSidebarLayout(snapshot),
      );
      const visibleLayout = sidebarOptimisticJournalValue(
        sidebarJournalRef.current,
        applySidebarMove,
      );
      return normalizeUiPreferencesSnapshot({ ...snapshot, ...visibleLayout });
    },
    [],
  );

  const snapshot = React.useMemo(
    () =>
      normalizeUiPreferencesSnapshot({
        sidebarGroupingMode,
        sidebarDensityMode,
        collapsedGroups,
        collapsedDroneSections,
        sidebarGroupOrder,
        sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent,
        sidebarChatOrderByDrone,
        sidebarChatGroupPathsByDrone,
        sidebarChatGroupByChat,
        sidebarChatNodeOrderByParent,
        pinnedDroneIds,
        mutedSidebarGroupIds,
        mutedDroneIds,
        mutedChatIds,
        hiddenSidebarGroups,
        spawnAgentKey,
        spawnModel,
        spawnReasoning,
        spawnAgentPermissionMode,
        spawnApprovalPolicy,
        repoBranchSource,
        repoCreateRemoteBranch,
        spawnContextByRepoKey,
      }),
    [
      hiddenSidebarGroups,
      collapsedGroups,
      collapsedDroneSections,
      repoBranchSource,
      repoCreateRemoteBranch,
      sidebarDensityMode,
      sidebarChatOrderByDrone,
      sidebarChatGroupPathsByDrone,
      sidebarChatGroupByChat,
      sidebarChatNodeOrderByParent,
      pinnedDroneIds,
      mutedSidebarGroupIds,
      mutedDroneIds,
      mutedChatIds,
      sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent,
      sidebarGroupOrder,
      sidebarGroupingMode,
      spawnAgentKey,
      spawnAgentPermissionMode,
      spawnApprovalPolicy,
      spawnModel,
      spawnReasoning,
      spawnContextByRepoKey,
    ],
  );

  const applyUiPreferencesSnapshot = React.useCallback(
    (detail: UiPreferencesSnapshotEventDetail) => {
      if (detail.updatedAt === null && detail.version === null) return;
      if (
        detail.version !== null &&
        lastSavedVersionRef.current !== null &&
        detail.version < lastSavedVersionRef.current
      ) {
        return;
      }
      const backendSnapshot = normalizeUiPreferencesSnapshot(detail.uiPreferences);
      const backendSerialized = serializeUiPreferencesSnapshot(backendSnapshot);
      if (
        detail.version === lastSavedVersionRef.current &&
        backendSerialized === lastSavedSerializedRef.current
      ) {
        return;
      }
      const currentSnapshot = normalizeUiPreferencesSnapshot(useDroneHubUiStore.getState());
      const previousBackendSnapshot = lastSavedSnapshotRef.current;
      cancelPendingSave();
      const nextSnapshot = reconcileUiPreferencesReload({
        backend: backendSnapshot,
        backendUpdatedAt: detail.updatedAt,
        current: currentSnapshot,
        previousBackend: previousBackendSnapshot,
        wasReady: readyRef.current,
        storageRaw: null,
      });
      lastSavedSnapshotRef.current = backendSnapshot;
      lastSavedSerializedRef.current = backendSerialized;
      lastSavedVersionRef.current = detail.version;
      readyRef.current = true;
      applyUiPreferences(rebasePendingSidebarCommands(nextSnapshot));
    },
    [applyUiPreferences, cancelPendingSave, rebasePendingSidebarCommands],
  );

  React.useEffect(() => {
    const handleSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<UiPreferencesSnapshotEventDetail>).detail;
      if (detail) applyUiPreferencesSnapshot(detail);
    };
    window.addEventListener(UI_PREFERENCES_SNAPSHOT_EVENT, handleSnapshot);
    return () => window.removeEventListener(UI_PREFERENCES_SNAPSHOT_EVENT, handleSnapshot);
  }, [applyUiPreferencesSnapshot]);

  const reloadUiPreferences = React.useCallback(async (options?: {
    discardSidebarIntent?: SidebarMoveIntent;
  }) => {
    const wasReady = readyRef.current;
    const currentSnapshot = normalizeUiPreferencesSnapshot(useDroneHubUiStore.getState());
    const previousBackendSnapshot = lastSavedSnapshotRef.current;
    cancelPendingSave();
    try {
      const data = await requestJson<UiPreferencesSettingsResponse>('/api/settings/ui-preferences');
      const backendSnapshot = normalizeUiPreferencesSnapshot(data.uiPreferences);
      const nextSnapshot = reconcileUiPreferencesReload({
        backend: backendSnapshot,
        backendUpdatedAt: data.updatedAt,
        current: currentSnapshot,
        previousBackend: previousBackendSnapshot,
        wasReady,
        storageRaw:
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(profileStorageKey('droneHub.ui'))
            : null,
      });
      if (!wasReady && Object.keys(backendSnapshot.spawnContextByRepoKey).length === 0) {
        nextSnapshot.spawnContextByRepoKey = recoverInitialSpawnContextByRepoKey({
          backend: backendSnapshot,
          current: data.updatedAt ? currentSnapshot : nextSnapshot,
          remembered: loadDesktopNewDronePreferencesByRepo(),
          backendUpdated: Boolean(data.updatedAt),
        });
      }
      if (options?.discardSidebarIntent) {
        Object.assign(
          nextSnapshot,
          sidebarLayoutPatch(
            normalizeSidebarLayout(backendSnapshot),
            options.discardSidebarIntent,
          ),
        );
      }
      lastSavedSnapshotRef.current = backendSnapshot;
      lastSavedSerializedRef.current = serializeUiPreferencesSnapshot(backendSnapshot);
      lastSavedVersionRef.current = data.version;
      applyUiPreferences(rebasePendingSidebarCommands(nextSnapshot));
    } catch {
      // Keep the local snapshot when the backend copy is unavailable.
    } finally {
      readyRef.current = true;
      setUiPreferencesReady(true);
    }
  }, [applyUiPreferences, cancelPendingSave, rebasePendingSidebarCommands, requestJson]);

  React.useEffect(() => {
    void reloadUiPreferences();
  }, [reloadUiPreferences]);

  React.useEffect(() => {
    if (!readyRef.current) return;
    if (pendingSidebarCommandsRef.current > 0) return;
    const serialized = serializeUiPreferencesSnapshot(snapshot);
    if (serialized === lastSavedSerializedRef.current) return;
    const seq = saveSeqRef.current + 1;
    saveSeqRef.current = seq;
    const timeout = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void requestJson<UiPreferencesSettingsResponse>('/api/settings/ui-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uiPreferences: snapshot,
          expectedVersion: lastSavedVersionRef.current,
        }),
      })
        .then((data) => {
          if (saveSeqRef.current !== seq) return;
          const normalized = normalizeUiPreferencesSnapshot(data.uiPreferences);
          lastSavedSnapshotRef.current = normalized;
          lastSavedSerializedRef.current = serializeUiPreferencesSnapshot(normalized);
          lastSavedVersionRef.current = data.version;
        })
        .catch((error: any) => {
          if (saveSeqRef.current !== seq) return;
          if (error?.status === 409) void reloadUiPreferences();
        });
    }, SAVE_DEBOUNCE_MS);
    saveTimeoutRef.current = timeout;
    return () => {
      if (saveTimeoutRef.current === timeout) saveTimeoutRef.current = null;
      window.clearTimeout(timeout);
    };
  }, [reloadUiPreferences, requestJson, sidebarCommandRevision, snapshot]);

  const moveSidebar = React.useCallback(
    (intent: SidebarMoveIntent): Promise<SidebarMoveCommandResult> => {
      const commandSeq = sidebarCommandSeqRef.current + 1;
      sidebarCommandSeqRef.current = commandSeq;
      const commandId = `desktop:${Date.now()}:${commandSeq}`;
      const before = normalizeUiPreferencesSnapshot(useDroneHubUiStore.getState());
      sidebarJournalRef.current = appendSidebarOptimisticCommand(
        sidebarJournalRef.current,
        { id: commandId, command: intent },
      );
      pendingSidebarCommandsRef.current += 1;
      cancelPendingSave();
      const optimisticLayout = applySidebarMove(normalizeSidebarLayout(before), intent);
      applyUiPreferences({
        ...before,
        ...sidebarLayoutPatch(optimisticLayout, intent),
      });

      const write = async (): Promise<SidebarMoveCommandResult> => {
        try {
          const data = await requestJson<SidebarMoveCommandResult>(
            '/api/sidebar/move',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                mutationId: commandId,
                intent,
              }),
            },
          );
          if (!data.ok) {
            sidebarJournalRef.current = settleSidebarOptimisticCommand(
              sidebarJournalRef.current,
              commandId,
            );
            const canonicalSidebar = data.canonical.sidebar;
            if (canonicalSidebar) {
              const backend = normalizeUiPreferencesSnapshot(
                canonicalSidebar.uiPreferences,
              );
              lastSavedSnapshotRef.current = backend;
              lastSavedSerializedRef.current = serializeUiPreferencesSnapshot(backend);
              lastSavedVersionRef.current = canonicalSidebar.version;
              applyUiPreferences(rebasePendingSidebarCommands(backend));
            } else {
              await reloadUiPreferences({ discardSidebarIntent: intent });
            }
            return data;
          }
          const backend = normalizeUiPreferencesSnapshot(data.uiPreferences);
          const current = normalizeUiPreferencesSnapshot(useDroneHubUiStore.getState());
          const reconciled = lastSavedSnapshotRef.current
            ? mergeUiPreferencesChanges(lastSavedSnapshotRef.current, current, backend)
            : backend;
          Object.assign(
            reconciled,
            sidebarLayoutPatch(normalizeSidebarLayout(backend), intent),
          );
          sidebarJournalRef.current = settleSidebarOptimisticCommand(
            sidebarJournalRef.current,
            commandId,
            normalizeSidebarLayout(reconciled),
          );
          lastSavedSnapshotRef.current = backend;
          lastSavedSerializedRef.current = serializeUiPreferencesSnapshot(backend);
          lastSavedVersionRef.current = data.version;
          applyUiPreferences(rebasePendingSidebarCommands(reconciled));
          return data;
        } catch (error) {
          sidebarJournalRef.current = settleSidebarOptimisticCommand(
            sidebarJournalRef.current,
            commandId,
          );
          const message =
            error instanceof Error && error.message.trim()
              ? error.message.trim()
              : 'The sidebar update failed.';
          console.error('[DroneHub] sidebar move failed', { intent, error });
          try {
            await reloadUiPreferences({ discardSidebarIntent: intent });
          } catch (reloadError) {
            console.error('[DroneHub] sidebar reload after failed move failed', {
              intent,
              error: reloadError,
            });
          }
          return {
            ok: false,
            mutationId: commandId,
            code: 'REQUEST_FAILED',
            error: message,
            stages: {
              membership: { status: 'unknown', error: message },
              layout: { status: 'unknown', error: message },
            },
            canonical: { group: null, sidebar: null },
          };
        } finally {
          pendingSidebarCommandsRef.current = Math.max(
            0,
            pendingSidebarCommandsRef.current - 1,
          );
          if (pendingSidebarCommandsRef.current === 0) {
            setSidebarCommandRevision((revision) => revision + 1);
          }
        }
      };
      return sidebarCommandQueue.enqueue(write);
    },
    [
      applyUiPreferences,
      cancelPendingSave,
      rebasePendingSidebarCommands,
      reloadUiPreferences,
      requestJson,
      sidebarCommandQueue,
    ],
  );

  const setDronesPinned = React.useCallback(
    (droneIdsRaw: readonly string[], pinned: boolean): Promise<boolean> => {
      const droneIds = normalizeOrderedStringList(droneIdsRaw);
      if (droneIds.length === 0) return Promise.resolve(false);
      return moveSidebar({ kind: 'set-pinned', droneIds, pinned }).then(
        (result) => result.ok,
      );
    },
    [moveSidebar],
  );

  const setDronePinned = React.useCallback(
    (droneId: string, pinned: boolean): Promise<boolean> => setDronesPinned([droneId], pinned),
    [setDronesPinned],
  );

  const reloadPinnedDrones = React.useCallback(async () => {
    await reloadUiPreferences();
  }, [reloadUiPreferences]);

  return {
    uiPreferencesReady,
    reloadUiPreferences,
    reloadPinnedDrones,
    setDronePinned,
    setDronesPinned,
    moveSidebar,
  };
}
