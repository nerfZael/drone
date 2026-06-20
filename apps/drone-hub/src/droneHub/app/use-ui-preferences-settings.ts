import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  normalizeAutomationConfigs,
} from './automation-config';
import type {
  SidebarDensityMode,
  SidebarGroupingMode,
  UiPreferencesSettingsResponse,
} from './settings-types';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { profileStorageKey } from '../../profile-storage';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UiPreferencesSnapshot = UiPreferencesSettingsResponse['uiPreferences'];

type UseUiPreferencesSettingsArgs = {
  requestJson: RequestJson;
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

function normalizeTrimmedText(value: unknown, maxChars: number): string {
  return String(value ?? '').trim().slice(0, maxChars);
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

function normalizeUiPreferencesSnapshot(value: Partial<UiPreferencesSnapshot> | null | undefined): UiPreferencesSnapshot {
  return {
    sidebarGroupingMode: normalizeSidebarGroupingMode(value?.sidebarGroupingMode),
    sidebarDensityMode: normalizeSidebarDensityMode(value?.sidebarDensityMode),
    sidebarGroupOrder: normalizeOrderedStringList(value?.sidebarGroupOrder),
    sidebarDroneOrderByGroup: normalizeOrderedStringMap(value?.sidebarDroneOrderByGroup),
    sidebarNodeOrderByParent: normalizeOrderedStringMap(value?.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: normalizeOrderedStringMap(value?.sidebarChatOrderByDrone),
    hiddenSidebarGroups: normalizeOrderedStringList(value?.hiddenSidebarGroups),
    autoDelete: value?.autoDelete === true,
    automations: normalizeAutomationConfigs(value?.automations),
    spawnAgentKey: normalizeTrimmedText(value?.spawnAgentKey, 200) || 'builtin:cursor',
    spawnModel: normalizeTrimmedText(value?.spawnModel, 200),
    repoBranchSource: normalizeRepoBranchSource(value?.repoBranchSource),
    repoCreateRemoteBranch: normalizeTrimmedText(value?.repoCreateRemoteBranch, 400),
    pullHostBranchBeforeCreate: value?.pullHostBranchBeforeCreate !== false,
  };
}

function serializeUiPreferencesSnapshot(value: UiPreferencesSnapshot): string {
  return JSON.stringify(value);
}

function hasMeaningfulUiPreferencesSnapshot(value: UiPreferencesSnapshot): boolean {
  return (
    value.sidebarGroupingMode === 'groups' ||
    value.sidebarDensityMode !== 'default' ||
    value.sidebarGroupOrder.length > 0 ||
    Object.keys(value.sidebarDroneOrderByGroup).length > 0 ||
    Object.keys(value.sidebarNodeOrderByParent).length > 0 ||
    Object.keys(value.sidebarChatOrderByDrone).length > 0 ||
    value.hiddenSidebarGroups.length > 0 ||
    value.autoDelete ||
    value.automations.length > 0 ||
    value.spawnAgentKey !== 'builtin:cursor' ||
    value.spawnModel.length > 0 ||
    value.repoBranchSource !== 'host' ||
    value.repoCreateRemoteBranch.length > 0 ||
    value.pullHostBranchBeforeCreate !== true
  );
}

function mergeUiPreferencesForRecovery(base: UiPreferencesSnapshot, rescue: UiPreferencesSnapshot): UiPreferencesSnapshot {
  return normalizeUiPreferencesSnapshot({
    sidebarGroupingMode: base.sidebarGroupingMode === 'repos' ? rescue.sidebarGroupingMode : base.sidebarGroupingMode,
    sidebarDensityMode: base.sidebarDensityMode === 'default' ? rescue.sidebarDensityMode : base.sidebarDensityMode,
    sidebarGroupOrder: base.sidebarGroupOrder.length > 0 ? base.sidebarGroupOrder : rescue.sidebarGroupOrder,
    sidebarDroneOrderByGroup:
      Object.keys(base.sidebarDroneOrderByGroup).length > 0 ? base.sidebarDroneOrderByGroup : rescue.sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent:
      Object.keys(base.sidebarNodeOrderByParent).length > 0 ? base.sidebarNodeOrderByParent : rescue.sidebarNodeOrderByParent,
    sidebarChatOrderByDrone:
      Object.keys(base.sidebarChatOrderByDrone).length > 0 ? base.sidebarChatOrderByDrone : rescue.sidebarChatOrderByDrone,
    hiddenSidebarGroups: base.hiddenSidebarGroups.length > 0 ? base.hiddenSidebarGroups : rescue.hiddenSidebarGroups,
    autoDelete: base.autoDelete || rescue.autoDelete,
    automations: base.automations.length > 0 ? base.automations : rescue.automations,
    spawnAgentKey: base.spawnAgentKey !== 'builtin:cursor' ? base.spawnAgentKey : rescue.spawnAgentKey,
    spawnModel: base.spawnModel || rescue.spawnModel,
    repoBranchSource: base.repoBranchSource !== 'host' ? base.repoBranchSource : rescue.repoBranchSource,
    repoCreateRemoteBranch: base.repoCreateRemoteBranch || rescue.repoCreateRemoteBranch,
    pullHostBranchBeforeCreate:
      base.pullHostBranchBeforeCreate === false ? base.pullHostBranchBeforeCreate : rescue.pullHostBranchBeforeCreate,
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
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'state')
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

export function useUiPreferencesSettings({ requestJson }: UseUiPreferencesSettingsArgs): void {
  const {
    sidebarGroupingMode,
    sidebarDensityMode,
    sidebarGroupOrder,
    sidebarDroneOrderByGroup,
    sidebarNodeOrderByParent,
    sidebarChatOrderByDrone,
    hiddenSidebarGroups,
    autoDelete,
    automations,
    spawnAgentKey,
    spawnModel,
    repoBranchSource,
    repoCreateRemoteBranch,
    pullHostBranchBeforeCreate,
    setSidebarGroupingMode,
    setSidebarDensityMode,
    setSidebarGroupOrder,
    setSidebarDroneOrderByGroup,
    setSidebarNodeOrderByParent,
    setSidebarChatOrderByDrone,
    setHiddenSidebarGroups,
    setAutoDelete,
    setAutomations,
    setSpawnAgentKey,
    setSpawnModel,
    setRepoBranchSource,
    setRepoCreateRemoteBranch,
    setPullHostBranchBeforeCreate,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      sidebarGroupingMode: s.sidebarGroupingMode,
      sidebarDensityMode: s.sidebarDensityMode,
      sidebarGroupOrder: s.sidebarGroupOrder,
      sidebarDroneOrderByGroup: s.sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent: s.sidebarNodeOrderByParent,
      sidebarChatOrderByDrone: s.sidebarChatOrderByDrone,
      hiddenSidebarGroups: s.hiddenSidebarGroups,
      autoDelete: s.autoDelete,
      automations: s.automations,
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      repoBranchSource: s.repoBranchSource,
      repoCreateRemoteBranch: s.repoCreateRemoteBranch,
      pullHostBranchBeforeCreate: s.pullHostBranchBeforeCreate,
      setSidebarGroupingMode: s.setSidebarGroupingMode,
      setSidebarDensityMode: s.setSidebarDensityMode,
      setSidebarGroupOrder: s.setSidebarGroupOrder,
      setSidebarDroneOrderByGroup: s.setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent: s.setSidebarNodeOrderByParent,
      setSidebarChatOrderByDrone: s.setSidebarChatOrderByDrone,
      setHiddenSidebarGroups: s.setHiddenSidebarGroups,
      setAutoDelete: s.setAutoDelete,
      setAutomations: s.setAutomations,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      setRepoBranchSource: s.setRepoBranchSource,
      setRepoCreateRemoteBranch: s.setRepoCreateRemoteBranch,
      setPullHostBranchBeforeCreate: s.setPullHostBranchBeforeCreate,
    })),
  );

  const readyRef = React.useRef(false);
  const lastSavedSerializedRef = React.useRef('');
  const saveSeqRef = React.useRef(0);
  const saveTimeoutRef = React.useRef<number | null>(null);

  const applyUiPreferences = React.useCallback(
    (value: Partial<UiPreferencesSnapshot> | null | undefined): UiPreferencesSnapshot => {
      const normalized = normalizeUiPreferencesSnapshot(value);
      setSidebarGroupingMode(normalized.sidebarGroupingMode);
      setSidebarDensityMode(normalized.sidebarDensityMode);
      setSidebarGroupOrder(normalized.sidebarGroupOrder);
      setSidebarDroneOrderByGroup(normalized.sidebarDroneOrderByGroup);
      setSidebarNodeOrderByParent(normalized.sidebarNodeOrderByParent);
      setSidebarChatOrderByDrone(normalized.sidebarChatOrderByDrone);
      setHiddenSidebarGroups(normalized.hiddenSidebarGroups);
      setAutoDelete(normalized.autoDelete);
      setAutomations(normalized.automations);
      setSpawnAgentKey(normalized.spawnAgentKey);
      setSpawnModel(normalized.spawnModel);
      setRepoBranchSource(normalized.repoBranchSource);
      setRepoCreateRemoteBranch(normalized.repoCreateRemoteBranch);
      setPullHostBranchBeforeCreate(normalized.pullHostBranchBeforeCreate);
      return normalized;
    },
    [
      setAutoDelete,
      setAutomations,
      setPullHostBranchBeforeCreate,
      setRepoBranchSource,
      setRepoCreateRemoteBranch,
      setSidebarDensityMode,
      setHiddenSidebarGroups,
      setSidebarChatOrderByDrone,
      setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent,
      setSidebarGroupOrder,
      setSidebarGroupingMode,
      setSpawnAgentKey,
      setSpawnModel,
    ],
  );

  const cancelPendingSave = React.useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveSeqRef.current += 1;
  }, []);

  const snapshot = React.useMemo(
    () =>
      normalizeUiPreferencesSnapshot({
        sidebarGroupingMode,
        sidebarDensityMode,
        sidebarGroupOrder,
        sidebarDroneOrderByGroup,
        sidebarNodeOrderByParent,
        sidebarChatOrderByDrone,
        hiddenSidebarGroups,
        autoDelete,
        automations,
        spawnAgentKey,
        spawnModel,
        repoBranchSource,
        repoCreateRemoteBranch,
        pullHostBranchBeforeCreate,
      }),
    [
      autoDelete,
      automations,
      hiddenSidebarGroups,
      pullHostBranchBeforeCreate,
      repoBranchSource,
      repoCreateRemoteBranch,
      sidebarDensityMode,
      sidebarChatOrderByDrone,
      sidebarDroneOrderByGroup,
      sidebarNodeOrderByParent,
      sidebarGroupOrder,
      sidebarGroupingMode,
      spawnAgentKey,
      spawnModel,
    ],
  );

  const reloadUiPreferences = React.useCallback(async () => {
    cancelPendingSave();
    try {
      const data = await requestJson<UiPreferencesSettingsResponse>('/api/settings/ui-preferences');
      const backendSnapshot = normalizeUiPreferencesSnapshot(data.uiPreferences);
      const restored = restoreUiPreferencesFromPersistedStorage(
        backendSnapshot,
        typeof localStorage !== 'undefined' ? localStorage.getItem(profileStorageKey('droneHub.ui')) : null,
      );
      if (data.updatedAt || restored.restored) {
        const normalized = applyUiPreferences(restored.snapshot);
        lastSavedSerializedRef.current = restored.restored
          ? serializeUiPreferencesSnapshot(backendSnapshot)
          : serializeUiPreferencesSnapshot(normalized);
      } else {
        lastSavedSerializedRef.current = '';
      }
    } catch {
      // Keep the local snapshot when the backend copy is unavailable.
    } finally {
      readyRef.current = true;
    }
  }, [applyUiPreferences, cancelPendingSave, requestJson]);

  React.useEffect(() => {
    void reloadUiPreferences();
  }, [reloadUiPreferences]);

  React.useEffect(() => {
    if (!readyRef.current) return;
    const serialized = serializeUiPreferencesSnapshot(snapshot);
    if (serialized === lastSavedSerializedRef.current) return;
    const seq = saveSeqRef.current + 1;
    saveSeqRef.current = seq;
    const timeout = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void requestJson<UiPreferencesSettingsResponse>('/api/settings/ui-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uiPreferences: snapshot }),
      })
        .then((data) => {
          if (saveSeqRef.current !== seq) return;
          const normalized = normalizeUiPreferencesSnapshot(data.uiPreferences);
          lastSavedSerializedRef.current = serializeUiPreferencesSnapshot(normalized);
        })
        .catch(() => {
          if (saveSeqRef.current !== seq) return;
        });
    }, SAVE_DEBOUNCE_MS);
    saveTimeoutRef.current = timeout;
    return () => {
      if (saveTimeoutRef.current === timeout) saveTimeoutRef.current = null;
      window.clearTimeout(timeout);
    };
  }, [requestJson, snapshot]);
}
