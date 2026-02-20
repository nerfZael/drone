export const CHANGES_DATA_MODE_STORAGE_KEY = 'droneHub.changesDataMode';
export const CHANGES_OPEN_PULL_REQUEST_EVENT = 'droneHub:changes:openPullRequest';
const CHANGES_PULL_REQUEST_SELECTION_STORAGE_KEY = 'droneHub.changesPullRequestSelectionByDrone';

export type ChangesOpenPullRequestDetail = {
  droneId: string;
  pullNumber: number;
};

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

export function requestChangesPullRequest(detail: ChangesOpenPullRequestDetail): void {
  const droneId = String(detail.droneId ?? '').trim();
  const pullNumber = Number(detail.pullNumber);
  if (!droneId || !Number.isFinite(pullNumber) || pullNumber <= 0) return;

  try {
    localStorage.setItem(CHANGES_DATA_MODE_STORAGE_KEY, 'pull-request');
  } catch {
    // ignore
  }
  setSelectedPullRequestForDrone(droneId, pullNumber);

  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent<ChangesOpenPullRequestDetail>(CHANGES_OPEN_PULL_REQUEST_EVENT, {
        detail: { droneId, pullNumber: Math.floor(pullNumber) },
      }),
    );
  } catch {
    // ignore
  }
}
