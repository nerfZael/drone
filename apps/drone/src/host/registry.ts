import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { droneRootPath } from './paths';

type DroneRegistryV1 = {
  version: 1;
  /**
   * Hub/user settings persisted on the host machine.
   */
  settings?: {
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
  };
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
          | { kind: 'builtin'; id: 'cursor' | 'codex' | 'claude' | 'opencode' }
          | { kind: 'custom'; id: string; label: string; command: string };
      };
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
      chats?: Record<
        string,
        {
          createdAt: string;
          /**
           * Legacy Cursor Agent chat ID (when using `agent --resume <chatId>`).
           * Newer hub flows may omit this and rely on tmux session continuity instead.
           */
          chatId?: string;
          model?: string;
          /**
           * Which agent implementation this chat uses.
           *
           * - builtin cursor/codex/claude/opencode: Drone Hub can render a clean "chat transcript" UI
           * - custom: Drone Hub shows the full tmux/CLI output stream (as today)
           */
          agent?:
            | { kind: 'builtin'; id: 'cursor' | 'codex' | 'claude' | 'opencode' }
            | { kind: 'custom'; id: string; label: string; command: string };
          /**
           * Codex exec "thread_id" for `codex exec resume <thread_id>`.
           */
          codexThreadId?: string;
          /**
           * Claude Code session id (`claude --session-id`).
           */
          claudeSessionId?: string;
          /**
           * OpenCode session id (`opencode run --session`).
           */
          openCodeSessionId?: string;
          /**
           * Stored turns for transcript rendering.
           *
           * Back-compat: older turns referenced tmux log files (session/logPath).
           * Newer turns can inline the final output text for cleaner rendering.
           */
          turns?: Array<
            | { at: string; prompt: string; session: string; logPath: string }
            | { at: string; id?: string; prompt: string; ok: boolean; output: string; error?: string }
          >;
          /**
           * Hub-side pending prompt queue for transcript UI (server-driven "sending…" state).
           * This replaces browser-local pending prompt storage.
           */
          pendingPrompts?: Array<{
            id: string;
            at: string;
            prompt: string;
            /**
             * - queued: persisted in registry but not yet enqueued into the drone daemon
             * - sending: hub is attempting to enqueue into the daemon
             * - sent: enqueued into daemon (queued/running/done will reconcile later)
             * - failed: hub/daemon enqueue or run failure
             */
            state: 'queued' | 'sending' | 'sent' | 'failed';
            cwd?: string | null;
            error?: string;
            updatedAt?: string;
          }>;
        }
      >;
    }
  >;
  /**
   * Legacy rename alias map (old name -> new name).
   * Deprecated: v2 uses stable ids for addressing, so aliases are not needed.
   */
  nameAliases?: Record<string, { to: string; at?: string }>;
};

export type DroneRegistry = {
  version: 2;
  /**
   * Hub/user settings persisted on the host machine.
   */
  settings?: DroneRegistryV1['settings'];
  repos?: DroneRegistryV1['repos'];
  groups?: DroneRegistryV1['groups'];
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
  drones: Record<
    string,
    Omit<DroneRegistryV1['drones'][string], 'id' | 'name'> & {
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
    }
  >;
};

export function registryPath(): string {
  return droneRootPath('registry.json');
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

export async function loadRegistry(): Promise<DroneRegistry> {
  const p = registryPath();
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsedAny = JSON.parse(raw) as any;

    // v2 registry: keyed by id.
    if (parsedAny?.version === 2 && parsedAny?.drones && typeof parsedAny.drones === 'object' && !Array.isArray(parsedAny.drones)) {
      const parsed = parsedAny as DroneRegistry;
      // Back-compat: ensure id/containerName exist and match key.
      for (const [key, entryAny] of Object.entries(parsed.drones ?? {})) {
        const entry = entryAny as any;
        if (!entry || typeof entry !== 'object') continue;
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
        (parsed.drones as any)[key] = entry;
      }
      for (const [key, entryAny] of Object.entries(parsed.pending ?? {})) {
        const entry = entryAny as any;
        if (!entry || typeof entry !== 'object') continue;
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
        (parsed.pending as any)[key] = entry;
      }
      return parsed;
    }

    // v1 registry: keyed by display name. Migrate to v2 keyed by id.
    if (parsedAny?.version === 1 && parsedAny?.drones && typeof parsedAny.drones === 'object' && !Array.isArray(parsedAny.drones)) {
      const v1 = parsedAny as DroneRegistryV1;
      const out: DroneRegistry = {
        version: 2,
        settings: v1.settings,
        repos: v1.repos,
        groups: v1.groups,
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
        // Extremely unlikely unless registry was manually edited; regenerate.
        while (usedIds.has(id)) id = crypto.randomUUID();
        usedIds.add(id);
        return id;
      };

      for (const [legacyKey, entryAny] of Object.entries(v1.drones ?? {})) {
        const entry = entryAny as any;
        if (!entry || typeof entry !== 'object') continue;
        const id = ensureUniqueId(typeof entry.id === 'string' ? entry.id : '');
        const name =
          typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim()
            : String(legacyKey);
        const containerName =
          typeof entry.containerName === 'string' && entry.containerName.trim()
            ? entry.containerName.trim()
            : name;
        out.drones[id] = { ...entry, id, name, containerName };
      }

      for (const [legacyKey, entryAny] of Object.entries(v1.pending ?? {})) {
        const entry = entryAny as any;
        if (!entry || typeof entry !== 'object') continue;
        const id = ensureUniqueId(typeof entry.id === 'string' ? entry.id : '');
        const name =
          typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim()
            : String(legacyKey);
        const containerName =
          typeof entry.containerName === 'string' && entry.containerName.trim()
            ? entry.containerName.trim()
            : name;
        (out.pending as any)[id] = { ...entry, id, name, containerName };
      }

      // NOTE: We do NOT write here; the next updateRegistry/save will persist.
      return out;
    }

    throw new Error('bad registry');
  } catch {
    return { version: 2, drones: {}, pending: {} };
  }
}

export async function saveRegistry(reg: DroneRegistry): Promise<void> {
  const p = registryPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(reg, null, 2), 'utf8');
  await setPrivateFileModeBestEffort(p);
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
