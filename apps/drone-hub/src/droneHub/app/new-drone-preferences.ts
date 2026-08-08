import { profileStorageKey } from '../../profile-storage';

export type DesktopNewDronePreferences = {
  mode: 'with-chat' | 'without-chat';
  runtime: 'container' | 'host';
  persistVolume: boolean;
  spawnAgentKey: string;
  spawnModel: string;
  spawnReasoning: string;
  spawnAgentPermissionMode: 'read-only' | 'workspace-write' | 'full-access';
  spawnApprovalPolicy: 'ask' | 'agent-decides' | 'never';
  repoBranchSource: 'host' | 'remote';
  repoCreateRemoteBranch: string;
};

export type DesktopNewDronePreferencesByRepo = Record<string, DesktopNewDronePreferences>;

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
    // The desktop new-drone workspace is chat-first. Keep the legacy field in
    // storage so older preferences remain readable, but never restore the
    // removed empty-drone mode.
    mode: 'with-chat',
    runtime: candidate.runtime === 'host' ? 'host' : 'container',
    persistVolume: candidate.persistVolume === true,
    spawnAgentKey: trimmed(candidate.spawnAgentKey) || 'builtin:cursor',
    spawnModel: trimmed(candidate.spawnModel),
    spawnReasoning: trimmed(candidate.spawnReasoning),
    spawnAgentPermissionMode:
      candidate.spawnAgentPermissionMode === 'read-only' ||
      candidate.spawnAgentPermissionMode === 'workspace-write'
        ? candidate.spawnAgentPermissionMode
        : 'full-access',
    spawnApprovalPolicy:
      candidate.spawnApprovalPolicy === 'agent-decides' ||
      candidate.spawnApprovalPolicy === 'never'
        ? candidate.spawnApprovalPolicy
        : 'ask',
    repoBranchSource: candidate.repoBranchSource === 'remote' ? 'remote' : 'host',
    repoCreateRemoteBranch: trimmed(candidate.repoCreateRemoteBranch),
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
  return loadDesktopNewDronePreferencesByRepo()[repoKey(repoPath)] ?? null;
}

export function loadDesktopNewDronePreferencesByRepo(): DesktopNewDronePreferencesByRepo {
  if (typeof localStorage === 'undefined') return {};
  try {
    return normalizeDesktopNewDronePreferencesByRepo(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'),
    );
  } catch {
    return {};
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
