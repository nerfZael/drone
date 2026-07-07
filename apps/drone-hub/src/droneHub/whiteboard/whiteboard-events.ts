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
