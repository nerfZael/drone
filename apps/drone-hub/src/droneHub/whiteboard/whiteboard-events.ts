import { DRONE_WORKSPACE_STATE_DISPOSE_EVENT, disposedDroneIdFromEvent } from '../workspace-state-events';

function normalizeProfileId(raw: unknown): string {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value) return '';
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value) ? value : '';
}

function readStoredProfileOverride(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return normalizeProfileId(localStorage.getItem('droneHub.activeProfileOverride'));
  } catch {
    return '';
  }
}

function whiteboardProfileStorageKey(baseKeyRaw: string): string {
  const baseKey = String(baseKeyRaw ?? '').trim();
  if (!baseKey) return '';
  const profileId = readStoredProfileOverride() || normalizeProfileId(import.meta.env.VITE_DRONE_PROFILE_ID);
  return profileId ? `${baseKey}:${profileId}` : baseKey;
}

export const WHITEBOARD_ACTIVE_STORAGE_KEY = whiteboardProfileStorageKey('droneHub.whiteboard.activeId');
export const WHITEBOARD_OPEN_EVENT = 'dronehub:whiteboard-open';

function readActiveWhiteboardMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = String(window.localStorage.getItem(WHITEBOARD_ACTIVE_STORAGE_KEY) ?? '').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([droneId, whiteboardId]) => [String(droneId).trim(), String(whiteboardId ?? '').trim()] as const)
        .filter(([droneId, whiteboardId]) => Boolean(droneId && whiteboardId)),
    );
  } catch {
    return {};
  }
}

export function readActiveWhiteboardId(droneIdRaw: string): string {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId || typeof window === 'undefined') return '';
  try {
    const raw = String(window.localStorage.getItem(WHITEBOARD_ACTIVE_STORAGE_KEY) ?? '').trim();
    if (raw && !raw.startsWith('{')) return raw;
  } catch {
    return '';
  }
  return readActiveWhiteboardMap()[droneId] ?? '';
}

export function writeActiveWhiteboardId(droneIdRaw: string, whiteboardIdRaw: string): void {
  const droneId = String(droneIdRaw ?? '').trim();
  const whiteboardId = String(whiteboardIdRaw ?? '').trim();
  if (!droneId || !whiteboardId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      WHITEBOARD_ACTIVE_STORAGE_KEY,
      JSON.stringify({ ...readActiveWhiteboardMap(), [droneId]: whiteboardId }),
    );
  } catch {
    // Ignore localStorage failures; the backend remains authoritative.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(DRONE_WORKSPACE_STATE_DISPOSE_EVENT, (event) => {
    const droneId = disposedDroneIdFromEvent(event);
    if (!droneId) return;
    const current = readActiveWhiteboardMap();
    if (!(droneId in current)) return;
    delete current[droneId];
    try {
      window.localStorage.setItem(WHITEBOARD_ACTIVE_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Ignore localStorage cleanup failures.
    }
  });
}
