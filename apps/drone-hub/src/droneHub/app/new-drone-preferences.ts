import { profileStorageKey } from '../../profile-storage';

export type DesktopNewDronePreferences = {
  mode: 'with-chat' | 'without-chat';
  runtime: 'container' | 'host';
  createAsDraft: boolean;
  persistVolume: boolean;
  spawnAgentKey: string;
  spawnModel: string;
  spawnReasoning: string;
  spawnAgentPermissionMode: 'full-access' | 'read-only';
};

const STORAGE_KEY = profileStorageKey('droneHub.newDronePreferences.v1');

function trimmed(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopNewDronePreferences(
  value: unknown,
): DesktopNewDronePreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<DesktopNewDronePreferences>;
  return {
    mode: candidate.mode === 'without-chat' ? 'without-chat' : 'with-chat',
    runtime: candidate.runtime === 'host' ? 'host' : 'container',
    createAsDraft: candidate.createAsDraft === true,
    persistVolume: candidate.persistVolume === true,
    spawnAgentKey: trimmed(candidate.spawnAgentKey) || 'builtin:cursor',
    spawnModel: trimmed(candidate.spawnModel),
    spawnReasoning: trimmed(candidate.spawnReasoning),
    spawnAgentPermissionMode:
      candidate.spawnAgentPermissionMode === 'read-only' ? 'read-only' : 'full-access',
  };
}

export function loadDesktopNewDronePreferences(): DesktopNewDronePreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return normalizeDesktopNewDronePreferences(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'),
    );
  } catch {
    return null;
  }
}

export function saveDesktopNewDronePreferences(
  preferences: DesktopNewDronePreferences,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are best-effort and must never turn a successful create into an error.
  }
}
