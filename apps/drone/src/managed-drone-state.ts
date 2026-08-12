import crypto from 'node:crypto';

export const MANAGED_DRONE_STATE_VERSION = 1 as const;

export type ManagedSkillFile = {
  path: string;
  content: string;
  executable?: boolean;
};

export type ManagedDroneDesiredState = {
  version: typeof MANAGED_DRONE_STATE_VERSION;
  skillTargets: Array<{
    rootPath: string;
    cleanupOnly?: boolean;
    packages: Array<{ slug: string; files: ManagedSkillFile[] }>;
  }>;
  mcpTargets: Array<{
    configPath: string;
    projection:
      | { format: 'toml'; managedNames: string[]; managedBlock: string }
      | {
          format: 'json';
          managedNames: string[];
          rootKey: 'mcpServers' | 'mcp';
          entries: Record<string, unknown>;
          schema?: string;
        };
  }>;
  agentsFile?: { path: string; content: string };
};

export type ManagedDroneSyncPayload = ManagedDroneDesiredState & { fingerprint: string };

export type ManagedDroneSyncResult = {
  changed: boolean;
  fingerprint: string;
  filesWritten: number;
  durationMs: number;
  phases: Record<string, number>;
};

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, canonicalize(record[key])]),
  );
}

export function managedDroneStateFingerprint(state: ManagedDroneDesiredState): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(state))).digest('hex');
}

export function unsignedManagedDroneState(payload: ManagedDroneSyncPayload): ManagedDroneDesiredState {
  const { fingerprint: _fingerprint, ...state } = payload;
  return state;
}
