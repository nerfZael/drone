import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { droneRootPath, legacyDroneRootDirs } from './paths';
import { normalizeDroneRuntime, type DroneRuntime } from './runtime';

type DroneRegistryDroneKind = 'standard' | 'playbook-run';
type DroneRegistryDroneVisibility = 'visible' | 'hidden';

type DroneRegistryPlaybookMeta = {
  id: string;
  label: string;
  messageCount: number;
  chatName?: string;
  artifacts?: string[];
  actions?: Array<{
    id: string;
    label: string;
    message: string;
  }>;
};

type DroneRegistryPlaybookEntry = {
  id: string;
  label: string;
  messages: string[];
  artifacts?: string[];
  actions?: Array<{
    id: string;
    label: string;
    message: string;
  }>;
  createdAt: string;
  updatedAt?: string;
};

type DroneRegistryChatEntry = {
  createdAt: string;
  chatId?: string;
  model?: string;
  agent?:
    | { kind: 'builtin'; id: 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' }
    | { kind: 'custom'; id: string; label: string; command: string };
  codexThreadId?: string;
  claudeSessionId?: string;
  openCodeSessionId?: string;
  piSessionId?: string;
  turns?: Array<{
    at: string;
    id?: string;
    prompt: string;
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
      provider?: 'openai' | 'gemini';
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
    filesystem?: {
      uploadMaxBytes?: number;
      updatedAt?: string;
    };
    kanbanBoard?: {
      lanes?: Array<{
        id?: string;
        title?: string;
        cards?: Array<{
          id?: string;
          title?: string;
          description?: string;
        }>;
      }>;
      updatedAt?: string;
    };
    uiPreferences?: {
      sidebarGroupingMode?: 'groups' | 'repos';
      sidebarGroupOrder?: string[];
      sidebarDroneOrderByGroup?: Record<string, string[]>;
      sidebarChatOrderByDrone?: Record<string, string[]>;
      hiddenSidebarGroups?: string[];
      autoDelete?: boolean;
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
          | { kind: 'builtin'; id: 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' }
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
  playbooks?: Record<string, DroneRegistryPlaybookEntry>;
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

function normalizeV2Registry(input: DroneRegistry): DroneRegistry {
  input.playbooks = input.playbooks ?? {};
  for (const [key, entryAny] of Object.entries(input.playbooks ?? {})) {
    const entry = entryAny as any;
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : String(key);
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const messages = Array.isArray(entry.messages)
      ? entry.messages.map((item: unknown) => String(item ?? '')).filter((item: string) => item.trim())
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
            const message = typeof action?.message === 'string' ? action.message : '';
            if (!id || !label || !message.trim()) return null;
            return { id, label, message };
          })
          .filter(Boolean)
      : [];
    (input.playbooks as any)[key] = {
      id,
      label,
      messages: messages.slice(0, 40),
      artifacts: artifacts.slice(0, 60),
      actions: actions.slice(0, 20),
      createdAt: typeof entry.createdAt === 'string' && entry.createdAt.trim() ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' && entry.updatedAt.trim() ? entry.updatedAt : undefined,
    };
  }
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
                    message: String(item.message ?? ''),
                  }))
                  .filter((item: any) => item.id && item.label && item.message.trim())
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
                    message: String(item.message ?? ''),
                  }))
                  .filter((item: any) => item.id && item.label && item.message.trim())
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
                    message: String(item.message ?? ''),
                  }))
                  .filter((item: any) => item.id && item.label && item.message.trim())
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

async function readRegistryFromPath(p: string): Promise<DroneRegistry | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return parseRegistry(raw);
  } catch {
    return null;
  }
}

async function saveRegistryAtPath(p: string, reg: DroneRegistry): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
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
  const consolidated = await consolidateRegistryPaths();
  if (consolidated) return consolidated;

  return { version: 2, drones: {}, pending: {} };
}

export async function saveRegistry(reg: DroneRegistry): Promise<void> {
  await saveRegistryAtPath(registryPath(), reg);
  for (const legacyPath of legacyRegistryPaths()) {
    const legacy = await readRegistryFromPath(legacyPath);
    if (!legacy) continue;
    if (registriesEqual(reg, legacy) || !hasMeaningfulRegistryData(legacy)) {
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
