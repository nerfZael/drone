import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { droneRootPath, legacyDroneRootDirs } from './paths';
import { normalizeDroneRuntime, type DroneRuntime } from './runtime';
import {
  getSqliteRegistryStoreUnavailableReason,
  hubSqlitePath,
  readRegistryJsonFromSqlite,
  recordSqliteRegistryMigration,
  writeRegistryToSqlite,
} from './sqlite-registry-store';

type DroneRegistryDroneKind = 'standard' | 'playbook-run';
type DroneRegistryDroneVisibility = 'visible' | 'hidden';
type DroneRegistryBuiltinAgentId = 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip';
type DroneRegistryChatAgentConfig =
  | { kind: 'builtin'; id: DroneRegistryBuiltinAgentId }
  | { kind: 'custom'; id: string; label: string; command: string };

const REGISTRY_HOURLY_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const REGISTRY_EMPTY_FLEET_GUARD_MIN_PREVIOUS = 10;

type DroneRegistryPlaybookMeta = {
  id: string;
  label: string;
  messageCount: number;
  chatName?: string;
  artifacts?: string[];
  actions?: Array<{
    id: string;
    label: string;
    messages: string[];
  }>;
};

type DroneRegistryPlaybookRunQueueGate = {
  queueItemId: string;
  playbookId: string;
  chatName: string;
  initialPromptIds: string[];
  releasedAt?: string;
};

type DroneRegistryPlaybookRunQueueItem = {
  id: string;
  playbookId: string;
  playbookLabel: string;
  repoPath: string;
  requestedCount: number;
  launchedCount: number;
  inFlightCount: number;
  serializeFirstMessageGroup: boolean;
  pullHostBranchBeforeCreate: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

type DroneRegistryPlaybookMessage = {
  id: string;
  name?: string;
  prompt: string;
};

type DroneRegistryPlaybookEntry = {
  id: string;
  label: string;
  agent: DroneRegistryChatAgentConfig;
  model?: string;
  messages: DroneRegistryPlaybookMessage[];
  artifacts?: string[];
  actions?: Array<{
    id: string;
    label: string;
    messages: string[];
  }>;
  createdAt: string;
  updatedAt?: string;
};

type DroneRegistryChatEntry = {
  createdAt: string;
  chatId?: string;
  model?: string;
  agent?: DroneRegistryChatAgentConfig;
  agentPermissionMode?: 'full-access' | 'read-only';
  agentMessageAutoContinueEnabled?: boolean;
  agentMessageAutoContinueEnabledAt?: string;
  agentSuggestionEnabled?: boolean;
  agentSuggestionEnabledAt?: string;
  codexThreadId?: string;
  claudeSessionId?: string;
  openCodeSessionId?: string;
  piSessionId?: string;
  blipSessionId?: string;
  turns?: Array<{
    at: string;
    id?: string;
    prompt: string;
    ok: boolean;
    output: string;
    error?: string;
    promptAt?: string;
    completedAt?: string;
    agentMessageAutoContinue?: {
      status?: 'pending' | 'classified' | 'failed';
      bucket?: 'user-turn' | 'continue';
      source?: 'llm' | 'agent-copilot-json' | 'heuristic';
      classifiedAt?: string;
      continuedAt?: string;
      error?: string;
      updatedAt?: string;
    };
    agentSuggestion?: {
      usedDirectAt?: string;
      suggestionHash?: string;
      policyFingerprint?: string;
      updatedAt?: string;
    };
  }>;
  pendingPrompts?: Array<{
    id: string;
    at: string;
    prompt: string;
    state: 'queued' | 'sending' | 'sent' | 'failed';
    cwd?: string | null;
    error?: string;
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
    voiceStream?: {
      pairingPassword?: string;
      updatedAt?: string;
    };
    desktopVoice?: {
      modelId?: string;
      updatedAt?: string;
    };
    voiceApproval?: {
      triggerPhrase?: string;
      unlockCode?: string;
      lockCode?: string;
      lockedOffCode?: string;
      minDigits?: number;
      maxDigits?: number;
      stableMs?: number;
      collectTimeoutMs?: number;
      duplicateCooldownMs?: number;
      finalizeCheckIntervalMs?: number;
      postPromptCommandSuppressionMs?: number;
      updatedAt?: string;
    };
    voiceTranscription?: {
      finalMode?: 'full-recording' | 'segments';
      updatedAt?: string;
    };
    voiceActivation?: {
      normalAliases?: string[];
      realTimeAliases?: string[];
      updatedAt?: string;
    };
    voiceRealtime?: {
      enabled?: boolean;
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
    agentMessageAutoContinue?: {
      prompt?: string;
      enabledByDefault?: boolean;
      updatedAt?: string;
    };
    agentSuggestion?: {
      policyMarkdown?: string;
      enabledByDefault?: boolean;
      updatedAt?: string;
    };
    assistant?: {
      activeThreadId?: string | null;
      threads?: unknown[];
      systemPrompt?: string;
      systemPromptUpdatedAt?: string;
      updatedAt?: string;
    };
    agents?: {
      content?: string;
      updatedAt?: string;
    };
    kanbanBoard?: {
      taskTypes?: Array<{
        id?: string;
        label?: string;
        active?: boolean;
      }>;
      lanes?: Array<{
        id?: string;
        title?: string;
        cards?: Array<{
          id?: string;
          title?: string;
          description?: string;
          typeId?: string;
          createdAt?: string;
          updatedAt?: string;
          repoPath?: string;
          droneId?: string;
          droneName?: string;
          playbookId?: string;
          playbookLabel?: string;
          chatName?: string;
          prompt?: string;
          promptId?: string;
          messageId?: string;
        }>;
      }>;
      updatedAt?: string;
    };
    taskPlaybookButtons?: {
      items?: Array<{
        id?: string;
        label?: string;
        playbookId?: string;
        taskTypeIds?: string[];
      }>;
      updatedAt?: string;
    };
    uiPreferences?: {
      sidebarGroupingMode?: 'groups' | 'repos';
      sidebarDensityMode?: 'compact' | 'default' | 'comfortable';
      sidebarGroupOrder?: string[];
      sidebarDroneOrderByGroup?: Record<string, string[]>;
      sidebarNodeOrderByParent?: Record<string, string[]>;
      sidebarChatOrderByDrone?: Record<string, string[]>;
      hiddenSidebarGroups?: string[];
      autoDelete?: boolean;
      spawnAgentKey?: string;
      spawnModel?: string;
      repoBranchSource?: 'host' | 'remote';
      repoCreateRemoteBranch?: string;
      pullHostBranchBeforeCreate?: boolean;
      automations?: Array<{
        id?: string;
        label?: string;
        prompt?: string;
        onFailurePrompt?: string;
        runs?: number;
        sleepAmount?: number;
        sleepUnit?: 'seconds' | 'minutes' | 'hours' | 'days';
        stopPhrase?: string;
        stopPhraseCaseSensitive?: boolean;
      }>;
      updatedAt?: string;
    };
    nonRepoEnvironment?: {
      vars?: Record<string, string>;
      autoApplyToNewContainerDrones?: boolean;
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
  playbooks?: Record<string, DroneRegistryPlaybookEntry>;
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
   * Groups are UI organization metadata and should exist independently from drones.
   * This allows:
   * - creating empty groups (even when there are 0 drones)
   * - keeping groups around after the last drone is deleted
   * - renaming groups in one place
   */
  groups?: Record<
    string,
    {
      name: string;
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
      kind?: DroneRegistryDroneKind;
      visibility?: DroneRegistryDroneVisibility;
      playbook?: DroneRegistryPlaybookMeta;
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
      playbookQueueGate?: DroneRegistryPlaybookRunQueueGate;
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
      kind?: DroneRegistryDroneKind;
      visibility?: DroneRegistryDroneVisibility;
      playbook?: DroneRegistryPlaybookMeta;
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
      playbookQueueGate?: DroneRegistryPlaybookRunQueueGate;
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
  playbooks?: Record<string, DroneRegistryPlaybookEntry>;
  repos?: DroneRegistryV1['repos'];
  groups?: DroneRegistryV1['groups'];
  archived?: Record<string, DroneRegistryArchivedEntry>;
  playbookRunQueue?: {
    items?: DroneRegistryPlaybookRunQueueItem[];
  };
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

function normalizeRegistryPlaybookAgent(raw: unknown): DroneRegistryChatAgentConfig {
  if (raw && typeof raw === 'object') {
    if ((raw as any).kind === 'builtin') {
      const id = normalizeRegistryBuiltinAgentId((raw as any).id);
      if (id) return { kind: 'builtin', id };
    }
    if ((raw as any).kind === 'custom') {
      const id = String((raw as any).id ?? '').trim();
      const label = String((raw as any).label ?? '').trim();
      const command = String((raw as any).command ?? '').trim();
      if (id && label && command) return { kind: 'custom', id, label, command };
    }
  }
  return { kind: 'builtin', id: 'cursor' };
}

function normalizeRegistryPlaybookModel(raw: unknown, agent: DroneRegistryChatAgentConfig): string | undefined {
  if (agent.kind !== 'builtin') return undefined;
  const model = String(raw ?? '').trim();
  if (!model) return undefined;
  if (model.length > 160) return undefined;
  if (/[\r\n\t]/.test(model)) return undefined;
  return model;
}

function normalizeRegistryActionMessages(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item: unknown) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return String((item as any).prompt ?? (item as any).message ?? '');
      }
      return String(item ?? '');
    })
    .filter((item: string) => item.trim());
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

function registryLockPath(): string {
  // Simple cross-process lockfile next to the registry.
  // NOTE: This is a dev tool; a lockfile is sufficient and avoids native deps.
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
  if (countRecordEntries(reg.playbooks) > 0) return true;
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

function normalizeV2Registry(input: DroneRegistry): DroneRegistry {
  input.playbooks = input.playbooks ?? {};
  for (const [key, entryAny] of Object.entries(input.playbooks ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : String(key);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const agent = normalizeRegistryPlaybookAgent(entry.agent);
    const model = normalizeRegistryPlaybookModel(entry.model, agent);
    const messages = Array.isArray(entry.messages)
      ? entry.messages
          .map((item: unknown, index: number) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const prompt = String((item as any).prompt ?? '');
              if (!prompt.trim()) return null;
              return {
                id: String((item as any).id ?? '').trim() || `message-${index + 1}`,
                ...(typeof (item as any).name === 'string' && String((item as any).name).trim()
                  ? { name: String((item as any).name).trim() }
                  : {}),
                prompt,
              };
            }
            const prompt = String(item ?? '');
            if (!prompt.trim()) return null;
            return {
              id: `message-${index + 1}`,
              prompt,
            };
          })
          .filter(Boolean)
      : [];
    const artifacts = Array.isArray(entry.artifacts)
      ? entry.artifacts.map((item: unknown) => String(item ?? '').trim()).filter((item: string) => item)
      : [];
    const actions = Array.isArray(entry.actions)
      ? entry.actions
          .map((item: unknown) => {
            const action = item as any;
            const id = String(action?.id ?? '').trim();
            const label = typeof action?.label === 'string' ? action.label.trim() : '';
            const messages = normalizeRegistryActionMessages(action?.messages);
            if (!id || !label || messages.length === 0) return null;
            return { id, label, messages };
          })
          .filter(Boolean)
      : [];
    (input.playbooks as any)[key] = {
      id,
      label,
      agent,
      ...(model ? { model } : {}),
      messages: messages.slice(0, 40),
      artifacts: artifacts.slice(0, 60),
      actions: actions.slice(0, 20),
      createdAt: typeof entry.createdAt === 'string' && entry.createdAt.trim() ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' && entry.updatedAt.trim() ? entry.updatedAt : undefined,
    };
  }
  delete (input as any).playbookFindings;
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
    entry.kind = entry.kind === 'playbook-run' ? 'playbook-run' : 'standard';
    entry.visibility = entry.visibility === 'hidden' ? 'hidden' : 'visible';
    if (entry.playbook && typeof entry.playbook === 'object') {
      const playbookId = typeof entry.playbook.id === 'string' ? entry.playbook.id.trim() : '';
      const playbookLabel = typeof entry.playbook.label === 'string' ? entry.playbook.label.trim() : '';
      const messageCountRaw = Number(entry.playbook.messageCount);
      entry.playbook = playbookId
        ? {
            id: playbookId,
            label: playbookLabel || playbookId,
            messageCount: Number.isFinite(messageCountRaw) && messageCountRaw > 0 ? Math.floor(messageCountRaw) : 1,
            chatName:
              typeof entry.playbook.chatName === 'string' && entry.playbook.chatName.trim()
                ? entry.playbook.chatName.trim()
                : undefined,
            artifacts: Array.isArray(entry.playbook.artifacts)
              ? entry.playbook.artifacts.map((item: any) => String(item ?? '').trim()).filter(Boolean)
              : undefined,
	            actions: Array.isArray(entry.playbook.actions)
	              ? entry.playbook.actions
	                  .filter((item: any) => item && typeof item === 'object')
	                  .map((item: any) => ({
	                    id: String(item.id ?? '').trim(),
	                    label: String(item.label ?? '').trim(),
	                    messages: normalizeRegistryActionMessages(item.messages),
	                  }))
	                  .filter((item: any) => item.id && item.label && item.messages.length > 0)
	              : undefined,
          }
        : undefined;
    }
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
    entry.kind = entry.kind === 'playbook-run' ? 'playbook-run' : 'standard';
    entry.visibility = entry.visibility === 'hidden' ? 'hidden' : 'visible';
    if (entry.playbook && typeof entry.playbook === 'object') {
      const playbookId = typeof entry.playbook.id === 'string' ? entry.playbook.id.trim() : '';
      const playbookLabel = typeof entry.playbook.label === 'string' ? entry.playbook.label.trim() : '';
      const messageCountRaw = Number(entry.playbook.messageCount);
      entry.playbook = playbookId
        ? {
            id: playbookId,
            label: playbookLabel || playbookId,
            messageCount: Number.isFinite(messageCountRaw) && messageCountRaw > 0 ? Math.floor(messageCountRaw) : 1,
            chatName:
              typeof entry.playbook.chatName === 'string' && entry.playbook.chatName.trim()
                ? entry.playbook.chatName.trim()
                : undefined,
            artifacts: Array.isArray(entry.playbook.artifacts)
              ? entry.playbook.artifacts.map((item: any) => String(item ?? '').trim()).filter(Boolean)
              : undefined,
	            actions: Array.isArray(entry.playbook.actions)
	              ? entry.playbook.actions
	                  .filter((item: any) => item && typeof item === 'object')
	                  .map((item: any) => ({
	                    id: String(item.id ?? '').trim(),
	                    label: String(item.label ?? '').trim(),
	                    messages: normalizeRegistryActionMessages(item.messages),
	                  }))
	                  .filter((item: any) => item.id && item.label && item.messages.length > 0)
	              : undefined,
          }
        : undefined;
    }
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
    entry.kind = entry.kind === 'playbook-run' ? 'playbook-run' : 'standard';
    entry.visibility = entry.visibility === 'hidden' ? 'hidden' : 'visible';
    if (entry.playbook && typeof entry.playbook === 'object') {
      const playbookId = typeof entry.playbook.id === 'string' ? entry.playbook.id.trim() : '';
      const playbookLabel = typeof entry.playbook.label === 'string' ? entry.playbook.label.trim() : '';
      const messageCountRaw = Number(entry.playbook.messageCount);
      entry.playbook = playbookId
        ? {
            id: playbookId,
            label: playbookLabel || playbookId,
            messageCount: Number.isFinite(messageCountRaw) && messageCountRaw > 0 ? Math.floor(messageCountRaw) : 1,
            chatName:
              typeof entry.playbook.chatName === 'string' && entry.playbook.chatName.trim()
                ? entry.playbook.chatName.trim()
                : undefined,
            artifacts: Array.isArray(entry.playbook.artifacts)
              ? entry.playbook.artifacts.map((item: any) => String(item ?? '').trim()).filter(Boolean)
              : undefined,
	            actions: Array.isArray(entry.playbook.actions)
	              ? entry.playbook.actions
	                  .filter((item: any) => item && typeof item === 'object')
	                  .map((item: any) => ({
	                    id: String(item.id ?? '').trim(),
	                    label: String(item.label ?? '').trim(),
	                    messages: normalizeRegistryActionMessages(item.messages),
	                  }))
	                  .filter((item: any) => item.id && item.label && item.messages.length > 0)
	              : undefined,
          }
        : undefined;
    }
    (input.archived as any)[key] = entry;
  }
  return input;
}

function migrateV1ToV2(v1: DroneRegistryV1): DroneRegistry {
  const out: DroneRegistry = {
    version: 2,
    settings: v1.settings,
    skills: v1.skills,
    playbooks: {},
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

  return out;
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
  const stack = new Error('registry fleet write guard callsite').stack
    ?.split('\n')
    .slice(2, 9)
    .map((line) => line.trim())
    .filter(Boolean);
  const audit = {
    event: dropsToEmpty ? 'empty-fleet-write' : 'severe-fleet-drop',
    before,
    after,
    previousSnapshotPath,
    nextSnapshotPath,
    override,
    stack,
  };

  if (dropsToEmpty && !override) {
    await appendRegistryWriteAuditBestEffort({ ...audit, blocked: true });
    await appendRegistryHubLogBestEffort('error', 'registry fleet write blocked', { ...audit, blocked: true });
    throw new Error(
      `refusing to overwrite registry fleet with zero entries (before=${before.total}, after=${after.total}); ` +
        'set DRONE_ALLOW_EMPTY_REGISTRY_WRITE=1 only for an intentional recovery or reset',
    );
  }

  await appendRegistryWriteAuditBestEffort({ ...audit, blocked: false });
  await appendRegistryHubLogBestEffort('warn', 'registry severe fleet drop allowed', { ...audit, blocked: false });
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

export async function loadRegistry(): Promise<DroneRegistry> {
  const sqliteRaw = readRegistryJsonFromSqlite();
  if (sqliteRaw === undefined && (await sqlitePrimaryExists())) {
    const reason = getSqliteRegistryStoreUnavailableReason();
    throw new Error(`hub SQLite registry exists but could not be opened${reason ? `: ${reason}` : ''}`);
  }
  if (typeof sqliteRaw === 'string') {
    const sqliteRegistry = parseRegistry(sqliteRaw);
    if (sqliteRegistry) return sqliteRegistry;
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
 * Acquire an exclusive lock for short read/modify/write operations on the registry.
 * Prefer `updateRegistry()` for correctness.
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
 * Safely update the registry under an exclusive lock.
 *
 * This avoids "lost update" races when multiple hub/CLI processes write the registry file
 * concurrently (e.g. batch provisioning, multiple `drone create`, pending state updates).
 *
 * Keep the callback fast: do not run long-lived operations while holding the lock.
 */
export async function updateRegistry<T>(
  mutator: (reg: DroneRegistry) => T | Promise<T>,
  opts?: { timeoutMs?: number; staleAfterMs?: number }
): Promise<T> {
  return await withRegistryLock(async () => {
    const reg = await loadRegistry();
    const result = await mutator(reg);
    await saveRegistry(reg);
    return result;
  }, opts);
}
