import { profileStorageKey } from '../../profile-storage';
import type { AgentRunFileChanges } from '@blip/protocol';

export const CHANGES_OPEN_PULL_REQUEST_EVENT = 'droneHub:changes:openPullRequest';
export const CHANGES_OPEN_AGENT_RUN_EVENT = 'droneHub:changes:openAgentRun';
const CHANGES_PULL_REQUEST_SELECTION_STORAGE_KEY = profileStorageKey(
  'droneHub.changesPullRequestSelectionByDrone',
);
const CHANGES_PENDING_PULL_REQUEST_OPEN_STORAGE_KEY = profileStorageKey(
  'droneHub.changesPendingPullRequestOpenByDrone',
);

export type ChangesOpenPullRequestDetail = {
  droneId: string;
  pullNumber: number;
};

export type AgentRunChangesSelection = {
  workspaceTargetId: string;
  path?: string;
};

export type ChangesOpenAgentRunDetail = {
  fileChanges: AgentRunFileChanges;
  initialSelection: AgentRunChangesSelection;
  droneId?: string;
};

let pendingAgentRunChanges: ChangesOpenAgentRunDetail | null = null;

export function consumeRequestedAgentRunChanges(
  droneIdRaw: string,
): ChangesOpenAgentRunDetail | null {
  if (!pendingAgentRunChanges) return null;
  const droneId = String(droneIdRaw ?? '').trim();
  if (pendingAgentRunChanges.droneId && pendingAgentRunChanges.droneId !== droneId) return null;
  const requested = pendingAgentRunChanges;
  pendingAgentRunChanges = null;
  return requested;
}

export function requestAgentRunChanges(detail: ChangesOpenAgentRunDetail): void {
  pendingAgentRunChanges = detail;
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CHANGES_OPEN_AGENT_RUN_EVENT));
  } catch {
    // ignore
  }
}

function readPullRequestSelectionByDrone(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CHANGES_PULL_REQUEST_SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const droneId = String(k ?? '').trim();
      const pullNumber = Number(v);
      if (!droneId || !Number.isFinite(pullNumber) || pullNumber <= 0) continue;
      out[droneId] = Math.floor(pullNumber);
    }
    return out;
  } catch {
    return {};
  }
}

function writePullRequestSelectionByDrone(next: Record<string, number>): void {
  try {
    localStorage.setItem(CHANGES_PULL_REQUEST_SELECTION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function readPendingPullRequestOpenByDrone(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CHANGES_PENDING_PULL_REQUEST_OPEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const droneId = String(k ?? '').trim();
      const pullNumber = Number(v);
      if (!droneId || !Number.isFinite(pullNumber) || pullNumber <= 0) continue;
      out[droneId] = Math.floor(pullNumber);
    }
    return out;
  } catch {
    return {};
  }
}

function writePendingPullRequestOpenByDrone(next: Record<string, number>): void {
  try {
    localStorage.setItem(CHANGES_PENDING_PULL_REQUEST_OPEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function setPendingPullRequestOpenForDrone(droneIdRaw: string, pullNumberRaw: number | null): void {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return;
  const next = readPendingPullRequestOpenByDrone();
  const pullNumber = Number(pullNumberRaw);
  if (!Number.isFinite(pullNumber) || pullNumber <= 0) {
    delete next[droneId];
    writePendingPullRequestOpenByDrone(next);
    return;
  }
  next[droneId] = Math.floor(pullNumber);
  writePendingPullRequestOpenByDrone(next);
}

function setSelectedPullRequestForDrone(droneIdRaw: string, pullNumberRaw: number | null): void {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return;
  const next = readPullRequestSelectionByDrone();
  const pullNumber = Number(pullNumberRaw);
  if (!Number.isFinite(pullNumber) || pullNumber <= 0) {
    delete next[droneId];
    writePullRequestSelectionByDrone(next);
    return;
  }
  next[droneId] = Math.floor(pullNumber);
  writePullRequestSelectionByDrone(next);
}

export function selectedPullRequestForDrone(droneIdRaw: string): number | null {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return null;
  const map = readPullRequestSelectionByDrone();
  const value = Number(map[droneId]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

export function clearSelectedPullRequestForDrone(droneIdRaw: string): void {
  setSelectedPullRequestForDrone(droneIdRaw, null);
}

export function requestedPullRequestForDrone(droneIdRaw: string): number | null {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return null;
  const map = readPendingPullRequestOpenByDrone();
  const value = Number(map[droneId]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

export function consumeRequestedPullRequestForDrone(droneIdRaw: string): number | null {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return null;
  const map = readPendingPullRequestOpenByDrone();
  const value = Number(map[droneId]);
  delete map[droneId];
  writePendingPullRequestOpenByDrone(map);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

export function requestChangesPullRequest(detail: ChangesOpenPullRequestDetail): void {
  const droneId = String(detail.droneId ?? '').trim();
  const pullNumber = Number(detail.pullNumber);
  if (!droneId || !Number.isFinite(pullNumber) || pullNumber <= 0) return;
  const normalizedPullNumber = Math.floor(pullNumber);
  setSelectedPullRequestForDrone(droneId, normalizedPullNumber);
  setPendingPullRequestOpenForDrone(droneId, normalizedPullNumber);

  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent<ChangesOpenPullRequestDetail>(CHANGES_OPEN_PULL_REQUEST_EVENT, {
        detail: { droneId, pullNumber: normalizedPullNumber },
      }),
    );
  } catch {
    // ignore
  }
}
