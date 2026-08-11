import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentRunActivity } from '@drone/assistant-chat';
import { droneRootPath, legacyDroneRootDirs } from './paths';
import {
  getLegacyResidualStateRepository,
  mergeRegistryResidualState,
} from './legacy-residual-state';
import { normalizeDroneRuntime, type DroneRuntime } from './runtime';
import {
  getSqliteRegistryStoreUnavailableReason,
  hubSqlitePath,
  readRegistryJsonFromSqlite,
  recordSqliteRegistryMigration,
  writeRegistryToSqlite,
} from './sqlite-registry-store';

type DroneRegistryBuiltinAgentId = 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip';
type DroneRegistryChatAgentConfig =
  | { kind: 'builtin'; id: DroneRegistryBuiltinAgentId }
  | { kind: 'custom'; id: string; label: string; command: string };

const REGISTRY_HOURLY_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const REGISTRY_EMPTY_FLEET_GUARD_MIN_PREVIOUS = 10;

type DroneRegistryChatEntry = {
  id?: string;
  createdAt: string;
  chatId?: string;
  model?: string;
  agent?: DroneRegistryChatAgentConfig;
  agentPermissionMode?: 'read' | 'write' | 'execute';
  approvalPolicy?: 'ask' | 'auto' | 'none';
  codexThreadId?: string;
  claudeSessionId?: string;
  openCodeSessionId?: string;
  piSessionId?: string;
  blipSessionId?: string;
  droneHubMcpAccessScope?: {
    readMode: 'all' | 'selected';
    writeMode: 'all' | 'selected';
    executeMode: 'all' | 'selected';
    droneIds: string[];
    updatedAt: string;
  };
  turns?: Array<{
    at: string;
    id?: string;
    prompt: string;
    model?: string;
    reasoning?: string;
    activity?: AgentRunActivity;
    ok: boolean;
    output: string;
    error?: string;
    promptAt?: string;
    completedAt?: string;
  }>;
  pendingPrompts?: Array<{
    id: string;
    at: string;
    prompt: string;
    model?: string;
    activity?: AgentRunActivity;
    state: 'queued' | 'sending' | 'sent' | 'failed';
    cwd?: string | null;
    error?: string;
    observability?: {
      state: 'status-unavailable';
      message: string;
      lastCheckedAt: string;
      lastError?: string;
    };
    updatedAt?: string;
  }>;
};

type DroneRegistryArchivedChatEntry = DroneRegistryChatEntry & {
  archivedAt: string;
  deleteAt: string;
  archiveRetention: '1h' | '8h' | '1d' | '1w';
};

type DroneRegistryV1 = {
  version: 1;
  /**
   * Hub/user settings persisted on the host machine.
   */
  settings?: {
    deleteAction?: {
      mode?: 'permanent' | 'archive';
      archiveRetention?: '1h' | '8h' | '1d' | '1w';
      archiveRuntimePolicy?: 'keep-running' | 'stop';
      updatedAt?: string;
    };
    llm?: {
      provider?: 'openai' | 'gemini' | 'codex';
      updatedAt?: string;
    };
    openai?: {
      apiKey?: string;
      updatedAt?: string;
    };
    gemini?: {
      apiKey?: string;
      updatedAt?: string;
    };
    groq?: {
      apiKey?: string;
      updatedAt?: string;
    };
    exa?: {
      apiKey?: string;
      updatedAt?: string;
    };
    filesystem?: {
      uploadMaxBytes?: number;
      updatedAt?: string;
    };
    backups?: {
      enabled?: boolean;
      hourlyEnabled?: boolean;
      dailyEnabled?: boolean;
      hourlyRetentionHours?: number;
      dailyRetentionDays?: number;
      updatedAt?: string;
    };
    agents?: {
      content?: string;
      updatedAt?: string;
    };
    uiPreferences?: {
      sidebarGroupingMode?: 'groups' | 'repos';
      sidebarDensityMode?: 'compact' | 'default' | 'comfortable';
      collapsedGroups?: Record<string, boolean>;
      collapsedDroneSections?: Record<string, boolean>;
      sidebarGroupOrder?: string[];
      sidebarDroneOrderByGroup?: Record<string, string[]>;
      sidebarNodeOrderByParent?: Record<string, string[]>;
      sidebarChatOrderByDrone?: Record<string, string[]>;
      pinnedDroneIds?: string[];
      hiddenSidebarGroups?: string[];
      spawnAgentKey?: string;
      spawnModel?: string;
      repoBranchSource?: 'host' | 'remote';
      repoCreateRemoteBranch?: string;
      updatedAt?: string;
    };
    nonRepoEnvironment?: {
      vars?: Record<string, string>;
      autoApplyToNewContainerDrones?: boolean;
      updatedAt?: string;
    };
    localCheckout?: {
      autoUpdates?: 'off' | 'commits' | 'all';
      session?: {
        droneId?: string;
        droneName?: string;
        repoRoot?: string;
        returnRef?: string;
        returnSha?: string;
        returnDetached?: boolean;
        snapshotSha?: string;
        snapshotKind?: 'commit' | 'working-tree';
        sourceHeadSha?: string;
        sourceTreeSha?: string;
        sourceDirtyFileCount?: number;
        activatedAt?: string;
        updatedAt?: string;
      } | null;
      updatedAt?: string;
    };
  };
  /**
   * Hub-managed shared skills library.
   *
   * This field is intentionally host-side and independent from any single drone.
   * The Hub projects these skills into drone runtimes on demand.
   */
  skills?: Record<string, unknown>;
  /**
   * Hub-managed global MCP servers.
   *
   * This field is host-side and independent from any single repo. The Hub
   * projects these servers into agent user config files inside drone runtimes.
   */
  mcpServers?: Record<string, unknown>;
  mcpTokens?: Record<string, unknown>;
  /**
   * Host-side list of repositories the user has "registered" with `drone repo`.
   * This is stored in the same registry file so the Hub UI can render it.
   */
  repos?: Record<
    string,
    {
      path: string;
      addedAt: string;
      remoteUrl?: string;
      github?: { owner: string; repo: string };
      environment?: {
        vars?: Record<string, string>;
        autoApplyToNewContainerDrones?: boolean;
        updatedAt?: string;
      };
      agents?: {
        mode?: 'inherit' | 'override' | 'disabled';
        content?: string;
        updatedAt?: string;
      };
    }
  >;
  /**
   * Host-side group registry.
   *
   * Groups are repository-scoped UI organization metadata and should exist independently from drones.
   * This allows:
   * - creating empty groups (even when there are 0 drones)
   * - keeping groups around after the last drone is deleted
   * - renaming groups in one place
   */
  groups?: Record<
    string,
    {
      id?: string;
      repoPath?: string;
      name: string;
      label?: string;
      parentId?: string | null;
      createdAt: string;
      updatedAt?: string;
    }
  >;
  /**
   * Hub-side, short-lived entries for drones that are being provisioned.
   * These are stored in the same registry file so the Hub UI can show
   * "starting" states without relying on browser storage.
   */
  pending?: Record<
    string,
    {
      /**
       * Stable identity for this startup workflow.
       * Unlike `name`, this does not change if the drone is renamed.
       */
      id?: string;
      name: string;
      group?: string;
      runtime?: DroneRuntime;
      repoPath: string;
      repoSeedSource?: 'host' | 'remote';
      repoSeedRemoteBranch?: string;
      repoSeedFromDroneId?: string;
      containerPort: number;
      build: boolean;
      createdAt: string;
      updatedAt?: string;
      phase: 'starting' | 'creating' | 'seeding' | 'error';
      message?: string;
      error?: string;
      seed?: {
        /**
         * Optional id to use for the initial seed prompt job in the drone daemon.
         * When present, this makes the first-turn prompt id stable across create/send flows.
         */
        promptId?: string;
        chatName: string;
        model?: string;
        prompt?: string;
        cwd?: string;
        agent?:
          | { kind: 'builtin'; id: 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip' }
          | { kind: 'custom'; id: string; label: string; command: string };
      };
      environment?: {
        vars?: Record<string, string>;
        useRepoVars?: boolean;
        disabledRepoKeys?: string[];
        updatedAt?: string;
      };
    }
  >;
  archived?: Record<
    string,
    DroneRegistryV1['drones'][string] & {
      archivedAt: string;
      deleteAt: string;
      archiveRetention: '1h' | '8h' | '1d' | '1w';
      archiveRuntimePolicy?: 'keep-running' | 'stop';
    }
  >;
  drones: Record<
    string,
    {
      /**
       * Stable identity for this drone.
       * The key/name may change via rename, but this id should remain constant.
       */
      id?: string;
      name: string;
      /**
       * Stable internal container name.
       *
       * - This should NOT change when the drone is renamed in the UI/registry.
       * - When absent (older registries), treat `name` (or the registry key) as the container name.
       */
      containerName?: string;
      /**
       * Runtime kind for this drone.
       *
       * - container: default behavior (managed by dvm/docker)
       * - host: daemon runs directly on host
       */
      runtime?: DroneRuntime;
      /**
       * Optional group name for organizing drones in the Hub UI.
       * This is host-side metadata (stored in the host drone registry file).
       */
      group?: string;
      /**
       * Optional default working directory inside the container.
       * Used when starting processes (agent/run/proc-start) if the caller does not provide --cwd.
       */
      cwd?: string;
      hostPort?: number;
      containerPort: number;
      token: string;
      repoPath: string;
      persistVolume?: boolean;
      createdAt: string;
      /**
       * Hub-specific lifecycle metadata. This is UI-facing state only.
       * It is safe for other CLIs/tools to ignore.
       */
      hub?: {
        phase: 'starting' | 'seeding' | 'error';
        message?: string;
        updatedAt: string;
      };
      /**
       * Optional per-drone chat IDs for persistent multi-turn agent sessions.
       * The host CLI stores these and uses Cursor Agent `--resume <chatId>`.
       */
      chats?: Record<string, DroneRegistryChatEntry>;
      archivedChats?: Record<string, DroneRegistryArchivedChatEntry>;
      environment?: {
        vars?: Record<string, string>;
        useRepoVars?: boolean;
        disabledRepoKeys?: string[];
        updatedAt?: string;
      };
    }
  >;
};

export type DroneRegistry = {
  version: 2;
  /**
   * Hub/user settings persisted on the host machine.
   */
  settings?: DroneRegistryV1['settings'];
  skills?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  mcpTokens?: Record<string, unknown>;
  repos?: DroneRegistryV1['repos'];
  groups?: DroneRegistryV1['groups'];
  archived?: Record<string, DroneRegistryArchivedEntry>;
  /**
   * Hub-side, short-lived entries for drones that are being provisioned.
   *
   * Keyed by stable drone id.
   */
  pending?: Record<
    string,
    Omit<NonNullable<DroneRegistryV1['pending']>[string], 'id'> & {
      id: string;
      /**
       * User-visible mutable name (can change over time).
       * All addressing should use `id`.
       */
      name: string;
      /**
       * Stable internal container name.
       */
      containerName?: string;
    }
  >;
  /**
   * Persistent drones.
   *
   * Keyed by stable drone id.
   */
  drones: Record<string, DroneRegistryDroneEntry>;
};

function normalizeRegistryBuiltinAgentId(raw: unknown): DroneRegistryBuiltinAgentId | null {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (id === 'cursor' || id === 'codex' || id === 'claude' || id === 'opencode' || id === 'pi' || id === 'blip') return id;
  if (id === 'cloud') return 'claude';
  if (id === 'open-code' || id === 'open_code') return 'opencode';
  if (id === 'pi-agent' || id === 'pi_agent') return 'pi';
  return null;
}

export function registryHasDisplayName(
  reg: Pick<DroneRegistry, 'drones' | 'pending'> | null | undefined,
  nameRaw: string,
  opts?: { excludeId?: string | null }
): boolean {
  const name = String(nameRaw ?? '').trim();
  if (!name) return false;
  const excludeId = typeof opts?.excludeId === 'string' ? opts.excludeId.trim() : '';
  for (const entryAny of Object.values(reg?.drones ?? {})) {
    const entry = entryAny as any;
    if (String(entry?.name ?? '').trim() !== name) continue;
    if (excludeId && String(entry?.id ?? '').trim() === excludeId) continue;
    return true;
  }
  for (const entryAny of Object.values(reg?.pending ?? {})) {
    const entry = entryAny as any;
    if (String(entry?.name ?? '').trim() !== name) continue;
    if (excludeId && String(entry?.id ?? '').trim() === excludeId) continue;
    return true;
  }
  return false;
}

type DroneRegistryDroneEntry = Omit<DroneRegistryV1['drones'][string], 'id' | 'name'> & {
  id: string;
  /**
   * User-visible mutable name (can change over time).
   * All addressing should use `id`.
   */
  name: string;
  /**
   * Stable internal container name (does not change on rename).
   */
  containerName: string;
};

type DroneRegistryArchivedEntry = DroneRegistryDroneEntry & {
  archivedAt: string;
  deleteAt: string;
  archiveRetention: '1h' | '8h' | '1d' | '1w';
  archiveRuntimePolicy?: 'keep-running' | 'stop';
};

export function registryPath(): string {
  return droneRootPath('registry.json');
}

function legacyRegistryPath(): string {
  const home = process.env.HOME?.trim() || os.homedir();
  return path.join(home, '.drone', 'registry.json');
}

function legacyRegistryPaths(): string[] {
  const explicit = legacyRegistryPath();
  const current = path.resolve(registryPath());
  const candidates = [
    ...legacyDroneRootDirs().map((dir) => path.join(dir, 'registry.json')),
    explicit,
  ]
    .map((p) => path.resolve(p))
    .filter((p) => p !== current);
  return Array.from(new Set(candidates));
}

// Compatibility transforms may span a residual transaction followed by
// canonical repository commands. Keep that bridge FIFO within the process;
// each individual repository command remains its own short SQLite transaction.
let legacyRegistryUpdateQueue: Promise<void> = Promise.resolve();

function registryLockPath(): string {
  // Bun/native-binding fallback only. Node writes use canonical repositories or
  // the short legacy_residual_state SQLite transaction instead.
  const p = registryPath();
  return path.join(path.dirname(p), 'registry.json.lock');
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function isLikelyStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const st = await fs.stat(lockPath);
    const age = Date.now() - st.mtimeMs;
    return Number.isFinite(age) && age > staleAfterMs;
  } catch {
    return false;
  }
}

async function acquireRegistryLock(opts?: { timeoutMs?: number; staleAfterMs?: number }): Promise<{
  release: () => Promise<void>;
}> {
  const lockPath = registryLockPath();
  const timeoutMs = typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) ? Math.max(250, opts.timeoutMs) : 10_000;
  const staleAfterMs =
    typeof opts?.staleAfterMs === 'number' && Number.isFinite(opts.staleAfterMs) ? Math.max(2_000, opts.staleAfterMs) : 30_000;

  const start = Date.now();
  let handle: any = null;

  while (true) {
    try {
      // Ensure parent dir exists before locking.
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      // Exclusive create.
      handle = await fs.open(lockPath, 'wx', 0o600);
      try {
        const meta = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
        await handle.writeFile(meta, { encoding: 'utf8' });
      } catch {
        // ignore
      }
      break;
    } catch (e: any) {
      const code = String(e?.code ?? '');
      if (code !== 'EEXIST') throw e;

      // Best-effort stale lock recovery (e.g. prior crash).
      if (await isLikelyStaleLock(lockPath, staleAfterMs)) {
        try {
          await fs.rm(lockPath, { force: true });
        } catch {
          // ignore; retry normally
        }
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out acquiring registry lock (${timeoutMs}ms)`);
      }
      await sleepMs(35);
    }
  }

  return {
    release: async () => {
      try {
        if (handle) await handle.close();
      } catch {
        // ignore
      }
      try {
        await fs.rm(lockPath, { force: true });
      } catch {
        // ignore
      }
    },
  };
}

function countRecordEntries(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.keys(value).length;
}

function hasMeaningfulRegistryData(reg: DroneRegistry): boolean {
  if (countRecordEntries(reg.drones) > 0) return true;
  if (countRecordEntries(reg.pending) > 0) return true;
  if (countRecordEntries(reg.archived) > 0) return true;
  if (countRecordEntries(reg.skills) > 0) return true;
  if (countRecordEntries(reg.mcpServers) > 0) return true;
  if (countRecordEntries(reg.mcpTokens) > 0) return true;
  if (countRecordEntries(reg.repos) > 0) return true;
  if (countRecordEntries(reg.groups) > 0) return true;
  if (countRecordEntries(reg.settings) > 0) return true;
  return false;
}

type RegistryFleetCounts = {
  drones: number;
  pending: number;
  archived: number;
  total: number;
};

function registryFleetCounts(reg: Pick<DroneRegistry, 'drones' | 'pending' | 'archived'> | null | undefined): RegistryFleetCounts {
  const drones = countRecordEntries(reg?.drones);
  const pending = countRecordEntries(reg?.pending);
  const archived = countRecordEntries(reg?.archived);
  return { drones, pending, archived, total: drones + pending + archived };
}

function stripRetiredFeatureState(input: DroneRegistry): DroneRegistry {
  delete (input as any).playbooks;
  delete (input as any).playbookRunQueue;
  delete (input as any).playbookFindings;
  const settings = input.settings as Record<string, unknown> | undefined;
  if (settings) {
    delete settings.agentMessageAutoContinue;
    delete settings.agentSuggestion;
    const uiPreferences = settings.uiPreferences as Record<string, unknown> | undefined;
    if (uiPreferences) delete uiPreferences.automations;
  }
  for (const bucket of [input.drones, input.pending, input.archived]) {
    for (const drone of Object.values(bucket ?? {}) as any[]) {
      delete drone.kind;
      delete drone.visibility;
      delete drone.playbook;
      delete drone.playbookQueueGate;
      for (const chats of [drone?.chats, drone?.archivedChats]) {
        for (const chat of Object.values(chats ?? {}) as any[]) {
          if (!chat || typeof chat !== 'object') continue;
          delete chat.agentMessageAutoContinueEnabled;
          delete chat.agentMessageAutoContinueEnabledAt;
          delete chat.agentSuggestionEnabled;
          delete chat.agentSuggestionEnabledAt;
          delete chat.agentCopilotHandledSourceMessageIds;
          for (const prompt of Array.isArray(chat.pendingPrompts) ? chat.pendingPrompts : []) {
            if (!prompt || typeof prompt !== 'object') continue;
            delete prompt.automation;
            delete prompt.blockedByAutomation;
          }
          for (const turn of Array.isArray(chat.turns) ? chat.turns : []) {
            if (!turn || typeof turn !== 'object') continue;
            delete turn.agentMessageAutoContinue;
            delete turn.agentSuggestion;
            delete turn.automation;
          }
        }
      }
    }
  }
  return input;
}

function normalizeV2Registry(input: DroneRegistry): DroneRegistry {
  for (const [key, entryAny] of Object.entries(input.drones ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    entry.runtime = normalizeDroneRuntime(entry.runtime);
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : String(key);
    entry.id = id;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Untitled';
    entry.name = name;
    const containerName =
      typeof entry.containerName === 'string' && entry.containerName.trim()
        ? entry.containerName.trim()
        : typeof entry.id === 'string' && entry.id.trim()
          ? `drone-${entry.id}`
          : 'drone-unknown';
    entry.containerName = containerName;
    (input.drones as any)[key] = entry;
  }
  for (const [key, entryAny] of Object.entries(input.pending ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    entry.runtime = normalizeDroneRuntime(entry.runtime);
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : String(key);
    entry.id = id;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Untitled';
    entry.name = name;
    const containerName =
      typeof entry.containerName === 'string' && entry.containerName.trim()
        ? entry.containerName.trim()
        : typeof entry.id === 'string' && entry.id.trim()
          ? `drone-${entry.id}`
          : undefined;
    if (containerName) entry.containerName = containerName;
    (input.pending as any)[key] = entry;
  }
  for (const [key, entryAny] of Object.entries(input.archived ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    entry.runtime = normalizeDroneRuntime(entry.runtime);
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : String(key);
    entry.id = id;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Untitled';
    entry.name = name;
    const containerName =
      typeof entry.containerName === 'string' && entry.containerName.trim()
        ? entry.containerName.trim()
        : typeof entry.id === 'string' && entry.id.trim()
          ? `drone-${entry.id}`
          : 'drone-unknown';
    entry.containerName = containerName;
    (input.archived as any)[key] = entry;
  }
  return stripRetiredFeatureState(input);
}

function migrateV1ToV2(v1: DroneRegistryV1): DroneRegistry {
  const out: DroneRegistry = {
    version: 2,
    settings: v1.settings,
    skills: v1.skills,
    mcpServers: (v1 as any).mcpServers,
    mcpTokens: (v1 as any).mcpTokens,
    repos: v1.repos,
    groups: v1.groups,
    archived: {},
    drones: {},
    pending: {},
  };

  const usedIds = new Set<string>();
  const ensureUniqueId = (idRaw: string): string => {
    let id = String(idRaw ?? '').trim();
    if (!id) id = crypto.randomUUID();
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
    while (usedIds.has(id)) id = crypto.randomUUID();
    usedIds.add(id);
    return id;
  };

  for (const [legacyKey, entryAny] of Object.entries(v1.drones ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    const id = ensureUniqueId(typeof entry.id === 'string' ? entry.id : '');
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : String(legacyKey);
    const containerName =
      typeof entry.containerName === 'string' && entry.containerName.trim() ? entry.containerName.trim() : name;
    out.drones[id] = { ...entry, id, name, containerName, runtime: normalizeDroneRuntime(entry.runtime) };
  }

  for (const [legacyKey, entryAny] of Object.entries(v1.pending ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    const id = ensureUniqueId(typeof entry.id === 'string' ? entry.id : '');
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : String(legacyKey);
    const containerName =
      typeof entry.containerName === 'string' && entry.containerName.trim() ? entry.containerName.trim() : name;
    (out.pending as any)[id] = { ...entry, id, name, containerName, runtime: normalizeDroneRuntime(entry.runtime) };
  }

  for (const [legacyKey, entryAny] of Object.entries(v1.archived ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    const id = ensureUniqueId(typeof entry.id === 'string' ? entry.id : '');
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : String(legacyKey);
    const containerName =
      typeof entry.containerName === 'string' && entry.containerName.trim() ? entry.containerName.trim() : name;
    (out.archived as any)[id] = { ...entry, id, name, containerName, runtime: normalizeDroneRuntime(entry.runtime) };
  }

  return stripRetiredFeatureState(out);
}

function parseRegistry(raw: string): DroneRegistry | null {
  try {
    const parsedAny = JSON.parse(raw) as any;
    if (parsedAny?.version === 2 && parsedAny?.drones && typeof parsedAny.drones === 'object' && !Array.isArray(parsedAny.drones)) {
      return normalizeV2Registry(parsedAny as DroneRegistry);
    }
    if (parsedAny?.version === 1 && parsedAny?.drones && typeof parsedAny.drones === 'object' && !Array.isArray(parsedAny.drones)) {
      return migrateV1ToV2(parsedAny as DroneRegistryV1);
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeRegistryForPersistence(reg: DroneRegistry): DroneRegistry {
  const cloned = JSON.parse(JSON.stringify(reg ?? { version: 2, drones: {}, pending: {} }));
  const parsed = parseRegistry(JSON.stringify(cloned));
  return parsed ?? { version: 2, drones: {}, pending: {} };
}

async function readRegistryFromPath(p: string): Promise<DroneRegistry | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return parseRegistry(raw);
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function registryHourlySnapshotPath(p: string, at = new Date()): string {
  const bucketStartMs = Math.floor(at.getTime() / REGISTRY_HOURLY_SNAPSHOT_INTERVAL_MS) * REGISTRY_HOURLY_SNAPSHOT_INTERVAL_MS;
  const stamp = new Date(bucketStartMs).toISOString().replace(/[:.]/g, '-');
  const parsed = path.parse(p);
  return path.join(parsed.dir, `${parsed.name}.snapshot-${stamp}${parsed.ext || '.json'}`);
}

async function saveRegistryHourlySnapshotBestEffort(p: string): Promise<void> {
  if (!(await pathExists(p))) return;
  const snapshotPath = registryHourlySnapshotPath(p);
  try {
    await fs.copyFile(p, snapshotPath, fsConstants.COPYFILE_EXCL);
    await setPrivateFileModeBestEffort(snapshotPath);
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'EEXIST' || code === 'ENOENT') return;
  }
}

async function saveRegistryAtPath(p: string, reg: DroneRegistry): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await saveRegistryHourlySnapshotBestEffort(p);
  const tmpPath = path.join(path.dirname(p), `.registry.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  try {
    await fs.writeFile(tmpPath, JSON.stringify(reg, null, 2), 'utf8');
    await setPrivateFileModeBestEffort(tmpPath);
    await fs.rename(tmpPath, p);
    await setPrivateFileModeBestEffort(p);
  } catch (error) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {
      // ignore cleanup failures
    }
    throw error;
  }
}

async function readPersistedRegistryForWriteGuard(): Promise<DroneRegistry | null> {
  const sqliteRaw = readRegistryJsonFromSqlite();
  if (typeof sqliteRaw === 'string') return parseRegistry(sqliteRaw);
  return await readRegistryFromPath(registryPath());
}

function registryWriteAuditPath(): string {
  return droneRootPath('registry.write-audit.jsonl');
}

function registryHubLogPath(): string {
  return droneRootPath('hub.log');
}

async function appendRegistryWriteAuditBestEffort(event: Record<string, unknown>): Promise<void> {
  try {
    const auditPath = registryWriteAuditPath();
    await fs.mkdir(path.dirname(auditPath), { recursive: true });
    await fs.appendFile(
      auditPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        ...event,
      })}\n`,
      'utf8',
    );
    await setPrivateFileModeBestEffort(auditPath);
  } catch {
    // Audit logging must never be the reason a registry write fails.
  }
}

async function appendRegistryHubLogBestEffort(level: 'info' | 'warn' | 'error', message: string, meta: Record<string, unknown>): Promise<void> {
  try {
    const at = new Date().toISOString();
    const payload = { at, ...meta };
    await fs.mkdir(path.dirname(registryHubLogPath()), { recursive: true });
    await fs.appendFile(registryHubLogPath(), `[DroneHub] ${message} ${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    try {
      const payload = { at: new Date().toISOString(), ...meta };
      const line = `[DroneHub] ${message} ${JSON.stringify(payload)}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    } catch {
      // ignore
    }
  }
}

async function saveRegistryGuardSnapshotBestEffort(kind: string, reg: DroneRegistry): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(path.dirname(registryPath()), `registry.guard-${kind}-${stamp}.json`);
  try {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(reg, null, 2), 'utf8');
    await setPrivateFileModeBestEffort(snapshotPath);
    return snapshotPath;
  } catch {
    return null;
  }
}

async function assertRegistryFleetWriteAllowed(next: DroneRegistry): Promise<void> {
  const previous = await readPersistedRegistryForWriteGuard();
  if (!previous) return;

  const before = registryFleetCounts(previous);
  const after = registryFleetCounts(next);
  if (before.total < REGISTRY_EMPTY_FLEET_GUARD_MIN_PREVIOUS) return;

  const override = String(process.env.DRONE_ALLOW_EMPTY_REGISTRY_WRITE ?? '').trim() === '1';
  const dropsToEmpty = before.total > 0 && after.total === 0;
  const severeDrop = after.total > 0 && after.total <= Math.floor(before.total * 0.25);
  if (!dropsToEmpty && !severeDrop) return;

  const previousSnapshotPath = await saveRegistryGuardSnapshotBestEffort('before', previous);
  const nextSnapshotPath = await saveRegistryGuardSnapshotBestEffort('after', next);
  const stack = new Error('registry write guard callsite').stack
    ?.split('\n')
    .slice(2, 9)
    .map((line) => line.trim())
    .filter(Boolean);
  const audit = {
    event: dropsToEmpty ? 'empty-registry-write' : 'severe-registry-drop',
    before,
    after,
    previousSnapshotPath,
    nextSnapshotPath,
    override,
    stack,
  };

  if (dropsToEmpty && !override) {
    await appendRegistryWriteAuditBestEffort({ ...audit, blocked: true });
    await appendRegistryHubLogBestEffort('error', 'registry write blocked', { ...audit, blocked: true });
    throw new Error(
      `refusing to overwrite registry with zero drone entries (before=${before.total}, after=${after.total}); ` +
        'set DRONE_ALLOW_EMPTY_REGISTRY_WRITE=1 only for an intentional recovery or reset',
    );
  }

  await appendRegistryWriteAuditBestEffort({ ...audit, blocked: false });
  await appendRegistryHubLogBestEffort('warn', 'severe registry drop allowed', { ...audit, blocked: false });
}

function registriesEqual(a: DroneRegistry, b: DroneRegistry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function removePathBestEffort(p: string): Promise<void> {
  try {
    await fs.rm(p, { force: true });
  } catch {
    // ignore
  }
}

async function archiveLegacyRegistryBestEffort(legacyPath: string): Promise<void> {
  const dir = path.dirname(legacyPath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `registry.migrated-${ts}.json`);
  try {
    await fs.rename(legacyPath, backupPath);
    await setPrivateFileModeBestEffort(backupPath);
  } catch {
    // If we cannot move it aside, leave it in place; loadRegistry() will still ignore it.
  }
}

async function backupRegistryBeforeSqliteMigrationBestEffort(p: string): Promise<string | null> {
  if (!(await pathExists(p))) return null;
  const dir = path.dirname(p);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `registry.backup-before-sqlite-${ts}.json`);
  try {
    await fs.copyFile(p, backupPath, fsConstants.COPYFILE_EXCL);
    await setPrivateFileModeBestEffort(backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

async function backupAndRemoveRegistryJsonBestEffort(p: string): Promise<string | null> {
  if (!(await pathExists(p))) return null;
  const dir = path.dirname(p);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `registry.backup-before-json-removal-${ts}.json`);
  try {
    await fs.copyFile(p, backupPath, fsConstants.COPYFILE_EXCL);
    await setPrivateFileModeBestEffort(backupPath);
  } catch {
    return null;
  }
  try {
    await fs.rm(p, { force: true });
  } catch {
    // ignore; a future successful save will try again
  }
  return backupPath;
}

async function removeRegistryJsonWithExistingBackupBestEffort(p: string, existingBackupPath: string | null): Promise<void> {
  if (existingBackupPath) {
    await removePathBestEffort(p);
    return;
  }
  try {
    await backupAndRemoveRegistryJsonBestEffort(p);
  } catch {
    // ignore; if backup/removal fails, keep the JSON file in place
  }
}

async function sqlitePrimaryExists(): Promise<boolean> {
  return await pathExists(hubSqlitePath());
}

async function consolidateRegistryPaths(): Promise<DroneRegistry | null> {
  const preferredPath = registryPath();
  const preferred = await readRegistryFromPath(preferredPath);
  for (const legacyPath of legacyRegistryPaths()) {
    const legacy = await readRegistryFromPath(legacyPath);
    if (!legacy) continue;

    if (!preferred) {
      try {
        await saveRegistryAtPath(preferredPath, legacy);
        await removePathBestEffort(legacyPath);
      } catch {
        // If migration fails, keep reading the legacy registry so state is still available.
      }
      return legacy;
    }

    if (!hasMeaningfulRegistryData(preferred) && hasMeaningfulRegistryData(legacy)) {
      try {
        await saveRegistryAtPath(preferredPath, legacy);
        await removePathBestEffort(legacyPath);
        return legacy;
      } catch {
        return legacy;
      }
    }

    if (registriesEqual(preferred, legacy)) {
      await removePathBestEffort(legacyPath);
      continue;
    }

    if (hasMeaningfulRegistryData(legacy)) {
      await archiveLegacyRegistryBestEffort(legacyPath);
    } else {
      await removePathBestEffort(legacyPath);
    }
  }

  return preferred;
}

/**
 * Reads the migration-era registry snapshot without overlaying canonical stores.
 *
 * Canonical read models must use this as their seed to avoid recursively loading
 * themselves. Most callers should continue to use `loadRegistry()` until they
 * have moved to a domain repository or the compatibility projection.
 */
export async function loadRegistryRawSnapshot(): Promise<DroneRegistry> {
  const sqliteRaw = readRegistryJsonFromSqlite();
  if (sqliteRaw === undefined && (await sqlitePrimaryExists())) {
    const reason = getSqliteRegistryStoreUnavailableReason();
    throw new Error(`hub SQLite registry exists but could not be opened${reason ? `: ${reason}` : ''}`);
  }
  if (typeof sqliteRaw === 'string') {
    const sqliteRegistry = parseRegistry(sqliteRaw);
    if (sqliteRegistry) {
      // A registry.json created after the one-time migration is not a live
      // writer. Preserve it as recovery evidence, then remove it immediately
      // instead of waiting for a later compatibility update.
      await backupAndRemoveRegistryJsonBestEffort(registryPath());
      return sqliteRegistry;
    }
    throw new Error('hub SQLite registry state is invalid');
  }

  const consolidated = await consolidateRegistryPaths();
  const registry = consolidated ?? { version: 2, drones: {}, pending: {} };
  const normalized = normalizeRegistryForPersistence(registry);
  const sourcePath = registryPath();
  const backupPath = await backupRegistryBeforeSqliteMigrationBestEffort(sourcePath);
  const migratedAt = new Date().toISOString();
  if (writeRegistryToSqlite(normalized, { sourcePath, migratedAt })) {
    recordSqliteRegistryMigration({ sourcePath, backupPath, registry: normalized, createdAt: migratedAt });
    await removeRegistryJsonWithExistingBackupBestEffort(sourcePath, backupPath);
    return normalized;
  }

  return normalized;
}

/** Reads the compatibility base (raw migration seed plus live residual state). */
export async function loadRegistryCompatibilityBase(): Promise<DroneRegistry> {
  const raw = await loadRegistryRawSnapshot();
  const residual = getLegacyResidualStateRepository();
  if (!residual) return raw;
  const state = residual.read() ?? await residual.seedIfAbsent(raw);
  return mergeRegistryResidualState(raw, state);
}

export async function loadRegistry(): Promise<DroneRegistry> {
  if ((globalThis as any).Bun) return await loadRegistryCompatibilityBase();
  // Dynamic import keeps the migration seed acyclic: the projection itself
  // reads `loadRegistryCompatibilityBase`, never this projected entry point.
  const { buildHubStateProjection } = await import('./hub-state-projection');
  return await buildHubStateProjection();
}

export async function saveRegistry(reg: DroneRegistry): Promise<void> {
  const normalized = normalizeRegistryForPersistence(reg);
  await assertRegistryFleetWriteAllowed(normalized);
  if (writeRegistryToSqlite(normalized, { sourcePath: registryPath() })) {
    await backupAndRemoveRegistryJsonBestEffort(registryPath());
  } else {
    if (await sqlitePrimaryExists()) {
      const reason = getSqliteRegistryStoreUnavailableReason();
      throw new Error(`hub SQLite registry exists but could not be opened${reason ? `: ${reason}` : ''}`);
    }
    await saveRegistryAtPath(registryPath(), normalized);
  }
  for (const legacyPath of legacyRegistryPaths()) {
    const legacy = await readRegistryFromPath(legacyPath);
    if (!legacy) continue;
    if (registriesEqual(normalized, legacy) || !hasMeaningfulRegistryData(legacy)) {
      await removePathBestEffort(legacyPath);
      continue;
    }
    await archiveLegacyRegistryBestEffort(legacyPath);
  }
}

async function setPrivateFileModeBestEffort(p: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(p, 0o600);
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOSYS' || code === 'EINVAL' || code === 'EPERM') return;
    throw error;
  }
}

/**
 * Acquire the legacy registry.json lock explicitly. Production Node paths no
 * longer call this; it remains public for Bun/native-binding compatibility.
 */
export async function withRegistryLock<T>(fn: () => Promise<T>, opts?: { timeoutMs?: number; staleAfterMs?: number }): Promise<T> {
  const lock = await acquireRegistryLock(opts);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Updates stripped compatibility state through SQLite on Node. Canonical-owned
 * namespaces are rejected by LegacyResidualStateRepository.
 * Bun retains the registry.json lock fallback when native SQLite is unavailable.
 */
export async function updateRegistry<T>(
  mutator: (reg: DroneRegistry) => T | Promise<T>,
  opts?: { timeoutMs?: number; staleAfterMs?: number }
): Promise<T> {
  const residual = getLegacyResidualStateRepository();
  if (residual) {
    const previous = legacyRegistryUpdateQueue;
    let resolveCurrent!: () => void;
    legacyRegistryUpdateQueue = new Promise<void>((resolve) => { resolveCurrent = resolve; });
    await previous.catch(() => {});
    try {
      const compatibility = await loadRegistry();
      const updated = await residual.update(compatibility, mutator as (reg: DroneRegistry) => T);
      return updated.result;
    } finally {
      resolveCurrent();
    }
  }
  return await withRegistryLock(async () => {
    const reg = await loadRegistry();
    const result = await mutator(reg);
    await saveRegistry(reg);
    return result;
  }, opts);
}
