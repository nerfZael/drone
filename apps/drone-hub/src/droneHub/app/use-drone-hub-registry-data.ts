import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import type { DroneSummary, GroupSummary, RepoSummary } from '../types';
import { compareDronesByNewestFirst } from './helpers';
import { fetchJson, usePoll } from './hooks';

type Updater<T> = T | ((prev: T) => T);
type Setter<T> = (next: Updater<T>) => void;

type UseDroneHubRegistryDataArgs = {
  activeRepoPath: string;
  optimisticallyDeletedDrones: Record<string, boolean>;
  setOptimisticallyDeletedDrones: Setter<Record<string, boolean>>;
  setActiveRepoPath: Setter<string>;
  setChatHeaderRepoPath: Setter<string>;
};

function droneHubBusyDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('droneHub.debugBusy') !== '0';
  } catch {
    return true;
  }
}

const registryBusyDebugLastById = new Map<string, string>();

function logRegistryBusyDebug(event: string, drones: DroneSummary[]): void {
  if (!droneHubBusyDebugEnabled()) return;
  const rows = [];
  for (const drone of drones) {
    const row = {
      id: String(drone?.id ?? '').trim(),
      name: String(drone?.name ?? '').trim(),
      busy: Boolean(drone?.busy),
      busyChats: Array.isArray(drone?.busyChats) ? drone.busyChats.map(String) : [],
      approvalChats: Array.isArray(drone?.approvalChats) ? drone.approvalChats.map(String) : [],
      approvalRequired: Boolean(drone?.approvalRequired),
      hubPhase: drone?.hubPhase ?? null,
      hubMessage: drone?.hubMessage ?? null,
      statusOk: Boolean(drone?.statusOk),
      statusError: drone?.statusError ?? null,
    };
    if (!row.id) continue;
    const signature = JSON.stringify(row);
    if (registryBusyDebugLastById.get(row.id) === signature) continue;
    registryBusyDebugLastById.set(row.id, signature);
    rows.push(row);
  }
  if (rows.length > 0) console.debug('[DroneHub][busy-debug] registry event', { event, drones: rows });
}

function sameStringArray(leftRaw: unknown, rightRaw: unknown): boolean {
  const left = Array.isArray(leftRaw) ? leftRaw : [];
  const right = Array.isArray(rightRaw) ? rightRaw : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (String(left[i] ?? '') !== String(right[i] ?? '')) return false;
  }
  return true;
}

function sameOptionalText(left: unknown, right: unknown): boolean {
  return String(left ?? '') === String(right ?? '');
}

function sameBooleanMap(leftRaw: unknown, rightRaw: unknown): boolean {
  const left = leftRaw && typeof leftRaw === 'object' && !Array.isArray(leftRaw) ? leftRaw as Record<string, unknown> : {};
  const right = rightRaw && typeof rightRaw === 'object' && !Array.isArray(rightRaw) ? rightRaw as Record<string, unknown> : {};
  const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)]));
  for (const key of keys) {
    const leftValue = left[key] === true;
    const rightValue = right[key] === true;
    if (leftValue !== rightValue) return false;
  }
  return true;
}

function sameChatReadStates(
  left: DroneSummary['chatReadStates'],
  right: DroneSummary['chatReadStates'],
): boolean {
  const leftStates = left ?? {};
  const rightStates = right ?? {};
  const keys = Array.from(new Set([...Object.keys(leftStates), ...Object.keys(rightStates)]));
  return keys.every((key) => {
    const leftState = leftStates[key];
    const rightState = rightStates[key];
    if (!leftState || !rightState) return leftState === rightState;
    return (
      leftState.unread === rightState.unread &&
      leftState.latestAgentTurnId === rightState.latestAgentTurnId &&
      leftState.latestAgentRevision === rightState.latestAgentRevision
    );
  });
}

function sameDroneSummary(left: DroneSummary, right: DroneSummary): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    sameOptionalText(left.group, right.group) &&
    left.createdAt === right.createdAt &&
    sameOptionalText(left.lastActivityAt, right.lastActivityAt) &&
    sameOptionalText(left.lastMessageAt, right.lastMessageAt) &&
    sameOptionalText(left.lastActivityChat, right.lastActivityChat) &&
    sameOptionalText(left.fleetParentId, right.fleetParentId) &&
    sameStringArray(left.fleetAssignedIds, right.fleetAssignedIds) &&
    sameOptionalText(left.runtime, right.runtime) &&
    left.repoAttached === right.repoAttached &&
    left.repoPath === right.repoPath &&
    sameOptionalText(left.repoBranch, right.repoBranch) &&
    sameOptionalText(left.cwd, right.cwd) &&
    left.containerPort === right.containerPort &&
    left.hostPort === right.hostPort &&
    left.statusOk === right.statusOk &&
    sameOptionalText(left.statusError, right.statusError) &&
    Boolean(left.statusChecking) === Boolean(right.statusChecking) &&
    sameStringArray(left.chats, right.chats) &&
    sameStringArray(left.unreadChats, right.unreadChats) &&
    sameChatReadStates(left.chatReadStates, right.chatReadStates) &&
    sameBooleanMap(left.draftChats, right.draftChats) &&
    sameStringArray(left.busyChats, right.busyChats) &&
    sameStringArray(left.approvalChats, right.approvalChats) &&
    Boolean(left.approvalRequired) === Boolean(right.approvalRequired) &&
    sameOptionalText(left.hubPhase, right.hubPhase) &&
    sameOptionalText(left.hubMessage, right.hubMessage) &&
    left.busy === right.busy
  );
}

function sameDroneResponse(
  left: { ok: true; drones: DroneSummary[] },
  right: { ok: true; drones: DroneSummary[] },
): boolean {
  const leftDrones = Array.isArray(left?.drones) ? left.drones : [];
  const rightDrones = Array.isArray(right?.drones) ? right.drones : [];
  if (leftDrones.length !== rightDrones.length) return false;
  for (let i = 0; i < leftDrones.length; i++) {
    const a = leftDrones[i];
    const b = rightDrones[i];
    if (!a || !b || !sameDroneSummary(a, b)) return false;
  }
  return true;
}

function mergeDroneListByIdentity(
  previousRaw: DroneSummary[] | null | undefined,
  nextRaw: DroneSummary[],
): DroneSummary[] {
  const previous = Array.isArray(previousRaw) ? previousRaw : [];
  const previousById = new Map(previous.map((drone) => [drone.id, drone] as const));
  let changed = previous.length !== nextRaw.length;
  const next = nextRaw.map((drone) => {
    const existing = previousById.get(drone.id);
    if (existing && sameDroneSummary(existing, drone)) return existing;
    changed = true;
    return drone;
  });
  if (!changed) {
    for (let i = 0; i < previous.length; i++) {
      if (previous[i] !== next[i]) {
        changed = true;
        break;
      }
    }
  }
  return changed ? next : previous;
}

function mergeDroneResponse(
  previous: { ok: true; drones: DroneSummary[] } | null,
  next: { ok: true; drones: DroneSummary[] },
): { ok: true; drones: DroneSummary[] } {
  const drones = mergeDroneListByIdentity(previous?.drones, Array.isArray(next?.drones) ? next.drones : []);
  return previous && drones === previous.drones ? previous : { ok: true, drones };
}

function applyDroneDelta(
  previous: { ok: true; drones: DroneSummary[] } | null,
  delta: { upserts?: DroneSummary[]; removedIds?: string[]; order?: string[] },
): { ok: true; drones: DroneSummary[] } {
  const current = Array.isArray(previous?.drones) ? previous.drones : [];
  const removedIds = new Set((Array.isArray(delta?.removedIds) ? delta.removedIds : []).map((id) => String(id ?? '').trim()).filter(Boolean));
  const upserts = Array.isArray(delta?.upserts) ? delta.upserts : [];
  const upsertById = new Map(upserts.map((drone) => [drone.id, drone] as const));
  let changed = removedIds.size > 0 || upserts.length > 0;
  const next: DroneSummary[] = [];

  for (const existing of current) {
    if (removedIds.has(existing.id)) continue;
    const incoming = upsertById.get(existing.id);
    if (!incoming) {
      next.push(existing);
      continue;
    }
    next.push(sameDroneSummary(existing, incoming) ? existing : incoming);
    upsertById.delete(existing.id);
  }

  for (const incoming of upsertById.values()) next.push(incoming);
  const order = Array.isArray(delta?.order) ? delta.order.map((id) => String(id ?? '').trim()).filter(Boolean) : [];
  if (order.length > 0) {
    const byId = new Map(next.map((drone) => [drone.id, drone] as const));
    const ordered: DroneSummary[] = [];
    for (const id of order) {
      const drone = byId.get(id);
      if (!drone) continue;
      ordered.push(drone);
      byId.delete(id);
    }
    for (const drone of byId.values()) ordered.push(drone);
    return { ok: true, drones: ordered };
  }
  if (!changed) return previous ?? { ok: true, drones: [] };
  return { ok: true, drones: next };
}

export function useDroneRegistryEvents(enabled = true): {
  value: { ok: true; drones: DroneSummary[] } | null;
  error: string | null;
  loading: boolean;
  connected: boolean;
} {
  const [value, setValue] = React.useState<{ ok: true; drones: DroneSummary[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setValue(null);
      setError(null);
      setLoading(false);
      setConnected(false);
      return;
    }
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      setLoading(false);
      setConnected(false);
      return;
    }

    let closed = false;
    const source = new window.EventSource('/api/drones/events');
    const markOpen = () => {
      if (closed) return;
      setConnected(true);
      setError(null);
    };

    source.addEventListener('connected', markOpen);
    source.addEventListener('snapshot', (event) => {
      if (closed) return;
      try {
        const data = JSON.parse((event as MessageEvent).data || '{}') as { ok?: boolean; drones?: DroneSummary[] };
        if (data?.ok !== true || !Array.isArray(data.drones)) throw new Error('Invalid drone registry snapshot.');
        logRegistryBusyDebug('snapshot', data.drones ?? []);
        setValue((prev) => mergeDroneResponse(prev, { ok: true, drones: data.drones ?? [] }));
        setConnected(true);
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    });
    source.addEventListener('delta', (event) => {
      if (closed) return;
      try {
        const data = JSON.parse((event as MessageEvent).data || '{}') as { upserts?: DroneSummary[]; removedIds?: string[]; order?: string[] };
        logRegistryBusyDebug('delta', data.upserts ?? []);
        setValue((prev) => applyDroneDelta(prev, data));
        setConnected(true);
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    });
    source.addEventListener('stream-error', (event) => {
      if (closed) return;
      try {
        const data = JSON.parse((event as MessageEvent).data || '{}') as { error?: string };
        setError(String(data?.error ?? '').trim() || 'Drone registry event stream failed.');
      } catch {
        setError('Drone registry event stream failed.');
      } finally {
        setConnected(false);
        setLoading(false);
      }
    });
    source.onerror = () => {
      if (closed) return;
      setConnected(false);
      setLoading(false);
      setError((prev) => prev ?? 'Drone registry event stream disconnected.');
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [enabled]);

  return { value, error, loading, connected: connected && Boolean(value) };
}

function sameRepoResponse(
  left: { ok: true; repos: RepoSummary[] },
  right: { ok: true; repos: RepoSummary[] },
): boolean {
  const leftRepos = Array.isArray(left?.repos) ? left.repos : [];
  const rightRepos = Array.isArray(right?.repos) ? right.repos : [];
  if (leftRepos.length !== rightRepos.length) return false;
  for (let i = 0; i < leftRepos.length; i++) {
    const a = leftRepos[i];
    const b = rightRepos[i];
    if (!a || !b) return false;
    if (a.path !== b.path) return false;
    if (!sameOptionalText(a.addedAt, b.addedAt)) return false;
    if (!sameOptionalText(a.remoteUrl, b.remoteUrl)) return false;
    if (!a.github && !b.github) continue;
    if (!a.github || !b.github) return false;
    if (a.github.owner !== b.github.owner || a.github.repo !== b.github.repo) return false;
  }
  return true;
}

function sameGroupsResponse(
  left: { ok: true; groups: GroupSummary[] },
  right: { ok: true; groups: GroupSummary[] },
): boolean {
  const leftGroups = Array.isArray(left?.groups) ? left.groups : [];
  const rightGroups = Array.isArray(right?.groups) ? right.groups : [];
  if (leftGroups.length !== rightGroups.length) return false;
  for (let i = 0; i < leftGroups.length; i++) {
    if (String(leftGroups[i]?.name ?? '') !== String(rightGroups[i]?.name ?? '')) return false;
    if (!sameOptionalText(leftGroups[i]?.createdAt, rightGroups[i]?.createdAt)) return false;
  }
  return true;
}

export function useDroneHubRegistryData({
  activeRepoPath,
  optimisticallyDeletedDrones,
  setOptimisticallyDeletedDrones,
  setActiveRepoPath,
  setChatHeaderRepoPath,
}: UseDroneHubRegistryDataArgs) {
  const droneEvents = useDroneRegistryEvents();
  const dronePollIntervalMs = droneEvents.connected ? 60_000 : 2_000;
  const { value: polledDronesResp, error: dronesPollError, loading: dronesPollLoading } = usePoll<{ ok: true; drones: DroneSummary[] }>(
    () => fetchJson('/api/drones'),
    dronePollIntervalMs,
    [droneEvents.connected],
    { isEqual: sameDroneResponse },
  );
  const dronesResp = droneEvents.connected ? droneEvents.value : polledDronesResp ?? droneEvents.value;
  const dronesError = dronesResp ? null : dronesPollError ?? droneEvents.error;
  const dronesLoading = !dronesResp && (droneEvents.loading || dronesPollLoading);
  const dronesErrorUi = dronesResp ? null : dronesError;
  const polledDrones = dronesResp?.drones ?? [];

  const drones = React.useMemo(() => {
    const hiddenNames = Object.keys(optimisticallyDeletedDrones);
    if (hiddenNames.length === 0) return polledDrones;
    return polledDrones.filter((d) => !optimisticallyDeletedDrones[d.id]);
  }, [optimisticallyDeletedDrones, polledDrones]);
  const droneById = React.useMemo(() => {
    const out: Record<string, DroneSummary> = {};
    for (const drone of drones) {
      const id = String(drone?.id ?? '').trim();
      if (!id) continue;
      out[id] = drone;
    }
    return out;
  }, [drones]);

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
  }, [optimisticallyDeletedDrones, polledDrones, setOptimisticallyDeletedDrones]);

  const { value: reposResp, error: reposError, loading: reposLoading } = usePoll<{ ok: true; repos: RepoSummary[] }>(
    () => fetchJson('/api/repos'),
    5000,
    [],
    { isEqual: sameRepoResponse },
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

  const { value: groupsResp } = usePoll<{ ok: true; groups: GroupSummary[] }>(
    () => fetchJson('/api/groups'),
    5000,
    [],
    { isEqual: sameGroupsResponse },
  );
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
  const registryGroupCreatedAtByName = React.useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const group of groupsResp?.groups ?? []) {
      const name = String(group?.name ?? '').trim();
      if (!name || isUngroupedGroupName(name)) continue;
      const createdAt = String(group?.createdAt ?? '').trim();
      out[name] = createdAt || null;
    }
    return out;
  }, [groupsResp]);

  React.useEffect(() => {
    if (!activeRepoPath) return;
    const exists = repos.some((r) => String(r?.path ?? '').trim() === activeRepoPath);
    if (!exists) setActiveRepoPath('');
  }, [activeRepoPath, repos, setActiveRepoPath]);

  React.useEffect(() => {
    setChatHeaderRepoPath((prev) => {
      const p = String(prev ?? '').trim();
      if (!p) return '';
      return registeredRepoPathSet.has(p) ? p : '';
    });
  }, [registeredRepoPathSet, setChatHeaderRepoPath]);

  const dronesFilteredByRepo = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return drones;
    return drones.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, drones]);
  const dronesFilteredByRepoIdSet = React.useMemo(() => {
    const out = new Set<string>();
    for (const drone of dronesFilteredByRepo) out.add(drone.id);
    return out;
  }, [dronesFilteredByRepo]);

  const sidebarDronesBase = drones;

  const sidebarDronesFilteredByRepoBase = React.useMemo(() => {
    const targetRepo = String(activeRepoPath ?? '').trim();
    if (!targetRepo) return sidebarDronesBase;
    return sidebarDronesBase.filter((d) => String(d?.repoPath ?? '').trim() === targetRepo);
  }, [activeRepoPath, sidebarDronesBase]);

  const droneCountByRepoPath = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of sidebarDronesBase) {
      const p = String(d?.repoPath ?? '').trim();
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return counts;
  }, [sidebarDronesBase]);

  const groups = React.useMemo(() => {
    const m = new Map<string, DroneSummary[]>();
    for (const rawName of registryGroupNames) {
      const g = String(rawName ?? '').trim();
      if (!g || isUngroupedGroupName(g)) continue;
      if (!m.has(g)) m.set(g, []);
    }
    for (const d of sidebarDronesFilteredByRepoBase) {
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
  }, [registryGroupNames, sidebarDronesFilteredByRepoBase]);

  return {
    polledDrones,
    drones,
    droneById,
    dronesError: dronesErrorUi,
    dronesLoading,
    repos,
    reposError,
    reposLoading,
    registeredRepoPaths,
    registeredRepoPathSet,
    registryGroupNames,
    registryGroupCreatedAtByName,
    dronesFilteredByRepo,
    dronesFilteredByRepoIdSet,
    sidebarDronesFilteredByRepoBase,
    droneCountByRepoPath,
    groups,
  };
}
