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
  repoBranchSource: 'host' | 'remote';
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
};

type DesktopNewDronePreferencesByRepo = Record<string, DesktopNewDronePreferences>;

const STORAGE_KEY = profileStorageKey('droneHub.newDronePreferences.v2');
const NO_REPO_KEY = '__no_repo__';

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
    repoBranchSource: candidate.repoBranchSource === 'remote' ? 'remote' : 'host',
    repoCreateRemoteBranch: trimmed(candidate.repoCreateRemoteBranch),
    pullHostBranchBeforeCreate: candidate.pullHostBranchBeforeCreate !== false,
  };
}

function repoKey(repoPath: unknown): string {
  return trimmed(repoPath) || NO_REPO_KEY;
}

export function normalizeDesktopNewDronePreferencesByRepo(
  value: unknown,
): DesktopNewDronePreferencesByRepo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: DesktopNewDronePreferencesByRepo = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = trimmed(key);
    const preferences = normalizeDesktopNewDronePreferences(candidate);
    if (normalizedKey && preferences) result[normalizedKey] = preferences;
  }
  return result;
}

export function loadDesktopNewDronePreferences(repoPath: string): DesktopNewDronePreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const byRepo = normalizeDesktopNewDronePreferencesByRepo(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
    );
    return byRepo[repoKey(repoPath)] ?? null;
  } catch {
    return null;
  }
}

export function saveDesktopNewDronePreferences(
  repoPath: string,
  preferences: DesktopNewDronePreferences,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const byRepo = normalizeDesktopNewDronePreferencesByRepo(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
    );
    byRepo[repoKey(repoPath)] = normalizeDesktopNewDronePreferences(preferences) ?? preferences;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byRepo));
  } catch {
    // Preferences are best-effort and must never turn a successful create into an error.
  }
}
