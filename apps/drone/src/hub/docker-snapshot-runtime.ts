import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

import { ensureContainerDroneDaemonSession } from '../host/container-daemon';

type DockerTranscriptTurn = any;

type DockerSnapshotRuntimeDependencyName =
  | 'chatHasActivePendingPromptsForSummary'
  | 'droneRuntime'
  | 'droneStatus'
  | 'enqueuePendingPromptPump'
  | 'hubLog'
  | 'inferChatAgent'
  | 'loadRegistry'
  | 'makeClient'
  | 'normalizeChatName'
  | 'normalizeDroneIdentity'
  | 'nowIso'
  | 'projectCanonicalChatToRegistry'
  | 'readChatFromStore'
  | 'resolveHostPort'
  | 'rollbackTranscriptToTurnInStore'
  | 'runHostCommand'
  | 'stopAllDroneChatActivity'
  | 'updateTranscriptTurnById'
  | 'updateTranscriptTurnInStore'
  | 'upsertTranscriptTurnInStore';

export type DockerSnapshotRuntimeDependencies = {
  [Key in DockerSnapshotRuntimeDependencyName]: any;
};

export function createDockerSnapshotRuntime(deps: DockerSnapshotRuntimeDependencies) {
  const {
    chatHasActivePendingPromptsForSummary,
    droneRuntime,
    droneStatus,
    enqueuePendingPromptPump,
    hubLog,
    inferChatAgent,
    loadRegistry,
    makeClient,
    normalizeChatName,
    normalizeDroneIdentity,
    nowIso,
    projectCanonicalChatToRegistry,
    readChatFromStore,
    resolveHostPort,
    rollbackTranscriptToTurnInStore,
    runHostCommand,
    stopAllDroneChatActivity,
    updateTranscriptTurnById,
    updateTranscriptTurnInStore,
    upsertTranscriptTurnInStore,
  } = deps;

  async function dockerContainerId(name: string): Promise<string> {
    const container = String(name || '').trim();
    if (!container) throw new Error('missing container name');
    const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('docker', ['inspect', '-f', '{{.Id}}', container], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      child.once('error', (err: any) =>
        resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }),
      );
      child.once('close', (code: number | null) =>
        resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr }),
      );
    });
    if (r.code !== 0)
      throw new Error((r.stderr || r.stdout || `docker inspect ${container} failed`).trim());
    const id = String(r.stdout || '').trim();
    if (!/^[0-9a-f]{12,64}$/i.test(id)) throw new Error(`unexpected docker id: ${id || '(empty)'}`);
    return id;
  }

  async function runDocker(
    args: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const timeoutMs =
      typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : 2 * 60_000;
    return await new Promise((resolve) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1500).unref();
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      child.once('error', (err: any) => {
        clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` });
      });
      child.once('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
      });
    });
  }

  async function runDockerOrThrow(args: string[], opts?: { timeoutMs?: number }): Promise<string> {
    const result = await runDocker(args, opts);
    if (result.code !== 0) {
      throw new Error((result.stderr || result.stdout || `docker ${args.join(' ')} failed`).trim());
    }
    return result.stdout;
  }

  async function dockerInspectOne(ref: string): Promise<any | null> {
    const name = String(ref ?? '').trim();
    if (!name) return null;
    const stdout = await runDockerOrThrow(['inspect', name], { timeoutMs: 30_000 });
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed[0] ?? null) : null;
  }

  function compactDiagnosticError(raw: unknown): string {
    return String((raw as any)?.message ?? raw ?? 'unknown error')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 500);
  }

  async function collectDroneRuntimeDiagnostics(opts: {
    droneId: string;
    droneEntry: any;
    hostPort?: number | null;
    token?: string | null;
  }): Promise<Record<string, unknown>> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const droneEntry = opts.droneEntry;
    const runtime = droneRuntime(droneEntry);
    const containerName =
      String(
        droneEntry?.containerName ?? droneEntry?.name ?? (droneId ? `drone-${droneId}` : ''),
      ).trim() || null;
    const out: Record<string, unknown> = {
      inspectedAt: nowIso(),
      droneId: droneId || String(opts.droneId ?? '').trim() || null,
      runtime,
      containerName,
    };
    if (runtime === 'host') {
      const hostPort = Number(opts.hostPort ?? droneEntry?.hostPort ?? NaN);
      out.hostPort = Number.isFinite(hostPort) && hostPort > 0 ? Math.floor(hostPort) : null;
      out.tokenPresent = Boolean(String(opts.token ?? droneEntry?.token ?? '').trim());
      return out;
    }

    if (!containerName) return out;
    try {
      const inspect = await dockerInspectOne(containerName);
      const state = inspect?.State ?? null;
      out.containerId = typeof inspect?.Id === 'string' ? String(inspect.Id).slice(0, 12) : null;
      out.dockerState = typeof state?.Status === 'string' ? state.Status : null;
      out.running = Boolean(state?.Running);
      out.paused = Boolean(state?.Paused);
      out.restarting = Boolean(state?.Restarting);
      out.dead = Boolean(state?.Dead);
      out.oomKilled = Boolean(state?.OOMKilled);
      out.exitCode = Number.isFinite(Number(state?.ExitCode)) ? Number(state.ExitCode) : null;
      out.pid = Number.isFinite(Number(state?.Pid)) ? Number(state.Pid) : null;
      out.startedAt = typeof state?.StartedAt === 'string' ? state.StartedAt : null;
      out.finishedAt = typeof state?.FinishedAt === 'string' ? state.FinishedAt : null;
      out.restartPolicy = String(inspect?.HostConfig?.RestartPolicy?.Name ?? '').trim() || null;
    } catch (error) {
      out.dockerInspectError = compactDiagnosticError(error);
    }

    let hostPort =
      typeof opts.hostPort === 'number' && Number.isFinite(opts.hostPort) && opts.hostPort > 0
        ? Math.floor(opts.hostPort)
        : typeof droneEntry?.hostPort === 'number' &&
            Number.isFinite(droneEntry.hostPort) &&
            droneEntry.hostPort > 0
          ? Math.floor(droneEntry.hostPort)
          : 0;
    if (!hostPort) {
      try {
        const containerPort = Number(droneEntry?.containerPort ?? NaN);
        if (Number.isFinite(containerPort) && containerPort > 0) {
          const resolved = await resolveHostPort(containerName, Math.floor(containerPort));
          hostPort =
            Number.isFinite(resolved as number) && (resolved as number) > 0
              ? Math.floor(resolved as number)
              : 0;
        }
      } catch (error) {
        out.hostPortResolutionError = compactDiagnosticError(error);
      }
    }
    out.hostPort = hostPort || null;
    const token = String(opts.token ?? droneEntry?.token ?? '').trim();
    out.tokenPresent = Boolean(token);
    if (hostPort && token) {
      try {
        await droneStatus(makeClient(hostPort, token));
        out.daemonStatusOk = true;
      } catch (error) {
        out.daemonStatusOk = false;
        out.daemonStatusError = compactDiagnosticError(error);
      }
    }
    return out;
  }

  async function dockerImageSizeBytes(imageRef: string): Promise<number | null> {
    try {
      const stdout = await runDockerOrThrow(
        ['image', 'inspect', imageRef, '--format', '{{json .Size}}'],
        {
          timeoutMs: 30_000,
        },
      );
      const value = Number(JSON.parse(String(stdout ?? '').trim() || 'null'));
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    } catch {
      return null;
    }
  }

  type DockerImageDiskUsage = {
    virtualBytes: number | null;
    sharedBytes: number | null;
    uniqueBytes: number | null;
  };

  let dockerImageDiskUsageCache: { at: number; usage: Map<string, DockerImageDiskUsage> } | null =
    null;
  const DOCKER_IMAGE_DISK_USAGE_CACHE_MS = 5000;

  function parseDockerDfSizeBytes(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
    const text = String(raw ?? '').trim();
    if (!text || text.toLowerCase() === 'n/a') return null;
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 0) return null;
    const unit = String(match[2] ?? 'B').toLowerCase();
    const multipliers: Record<string, number> = {
      b: 1,
      kb: 1000,
      mb: 1000 ** 2,
      gb: 1000 ** 3,
      tb: 1000 ** 4,
    };
    const multiplier = multipliers[unit];
    if (!multiplier) return null;
    return Math.floor(value * multiplier);
  }

  function dockerDfImageKeys(raw: any): string[] {
    const keys: string[] = [];
    const repo = String(raw?.Repository ?? raw?.Repo ?? '').trim();
    const tag = String(raw?.Tag ?? '').trim();
    if (repo && repo !== '<none>' && tag && tag !== '<none>') keys.push(`${repo}:${tag}`);
    const id = String(raw?.ID ?? raw?.ImageID ?? '').trim();
    if (id) {
      keys.push(id);
      if (id.startsWith('sha256:')) keys.push(id.slice('sha256:'.length));
    }
    return Array.from(new Set(keys));
  }

  function dockerDfImageDiskUsage(raw: any): DockerImageDiskUsage {
    return {
      virtualBytes: parseDockerDfSizeBytes(raw?.Size),
      sharedBytes: parseDockerDfSizeBytes(raw?.SharedSize),
      uniqueBytes: parseDockerDfSizeBytes(raw?.UniqueSize),
    };
  }

  async function dockerImageDiskUsageByRef(): Promise<Map<string, DockerImageDiskUsage>> {
    const now = Date.now();
    if (
      dockerImageDiskUsageCache &&
      now - dockerImageDiskUsageCache.at < DOCKER_IMAGE_DISK_USAGE_CACHE_MS
    ) {
      return dockerImageDiskUsageCache.usage;
    }
    const usage = new Map<string, DockerImageDiskUsage>();
    try {
      const stdout = await runDockerOrThrow(['system', 'df', '-v', '--format', '{{json .}}'], {
        timeoutMs: 10_000,
      });
      const trimmed = String(stdout ?? '').trim();
      if (trimmed) {
        const payloads: any[] = [];
        try {
          payloads.push(JSON.parse(trimmed));
        } catch {
          for (const line of trimmed.split(/\r?\n/)) {
            const clean = line.trim();
            if (!clean) continue;
            try {
              payloads.push(JSON.parse(clean));
            } catch {
              // Ignore malformed lines from older Docker versions.
            }
          }
        }
        for (const payload of payloads) {
          const images = Array.isArray(payload?.Images)
            ? payload.Images
            : payload?.Repository
              ? [payload]
              : [];
          for (const image of images) {
            const entry = dockerDfImageDiskUsage(image);
            for (const key of dockerDfImageKeys(image)) usage.set(key, entry);
          }
        }
      }
    } catch {
      // Fall back to the stored virtual image sizes below.
    }
    dockerImageDiskUsageCache = { at: now, usage };
    return usage;
  }

  async function dockerContainerSizeBytes(containerName: string): Promise<number | null> {
    try {
      const stdout = await runDockerOrThrow(
        ['inspect', '--size', containerName, '--format', '{{json .SizeRw}}'],
        {
          timeoutMs: 2500,
        },
      );
      const value = Number(JSON.parse(String(stdout ?? '').trim() || 'null'));
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    } catch {
      return null;
    }
  }

  function dockerSnapshotImageRef(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): string {
    const droneId =
      normalizeDroneIdentity(opts.droneId) ||
      crypto
        .createHash('sha1')
        .update(String(opts.droneId ?? ''))
        .digest('hex')
        .slice(0, 12);
    const chatHash = crypto
      .createHash('sha1')
      .update(String(opts.chatName ?? 'default'))
      .digest('hex')
      .slice(0, 10);
    const promptId =
      String(opts.promptId ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .slice(0, 48) || 'turn';
    return `drone-hub-snapshot-${droneId}-${chatHash}:${promptId}`;
  }

  function normalizeDockerSnapshot(raw: any): DockerTranscriptTurn['dockerSnapshot'] | undefined {
    const id = String(raw?.id ?? '').trim();
    const status = String(raw?.status ?? '').trim();
    if (!id) return undefined;
    if (
      status !== 'creating' &&
      status !== 'ready' &&
      status !== 'failed' &&
      status !== 'restoring'
    )
      return undefined;
    const createdAt = String(raw?.createdAt ?? '').trim() || nowIso();
    const out: NonNullable<DockerTranscriptTurn['dockerSnapshot']> = { id, status, createdAt };
    const imageRef = String(raw?.imageRef ?? '').trim();
    const imageId = String(raw?.imageId ?? '').trim();
    const readyAt = String(raw?.readyAt ?? '').trim();
    const restoredAt = String(raw?.restoredAt ?? '').trim();
    const error = String(raw?.error ?? '').trim();
    const sizeBytes = Number(raw?.sizeBytes);
    if (imageRef) out.imageRef = imageRef;
    if (imageId) out.imageId = imageId;
    if (readyAt) out.readyAt = readyAt;
    if (restoredAt) out.restoredAt = restoredAt;
    if (error) out.error = error;
    if (Number.isFinite(sizeBytes) && sizeBytes >= 0) out.sizeBytes = Math.floor(sizeBytes);
    return out;
  }

  function dockerSnapshotAfterAgentMessageEnabledForChat(droneEntry: any, chatEntry: any): boolean {
    if (droneRuntime(droneEntry) === 'host') return false;
    if (droneEntry?.persistVolume !== false) return false;
    const raw = chatEntry?.dockerSnapshotAfterAgentMessageEnabled;
    const agent = inferChatAgent(chatEntry, droneEntry);
    if (agent.kind !== 'builtin') return false;
    return raw === true;
  }

  function chatHasActiveDockerSnapshot(entry: any): boolean {
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    return turns.some((turn: any) => {
      const status = String(turn?.dockerSnapshot?.status ?? '').trim();
      return status === 'creating' || status === 'restoring';
    });
  }

  function isStaleDockerExecErrorMessage(raw: unknown): boolean {
    const msg = String(raw ?? '').trim();
    if (!msg) return false;
    return /no such exec/i.test(msg) || /no such exec instance/i.test(msg);
  }

  const DOCKER_SNAPSHOT_ACTIVE_STALE_MS = 30 * 60_000;

  async function inspectDockerSnapshotImage(
    imageRef: string,
  ): Promise<{ imageId: string | null; sizeBytes: number | null } | null> {
    const ref = String(imageRef ?? '').trim();
    if (!ref) return null;
    try {
      const stdout = await runDockerOrThrow(['image', 'inspect', ref, '--format', '{{json .}}'], {
        timeoutMs: 30_000,
      });
      const inspect = JSON.parse(String(stdout ?? '').trim() || 'null');
      const imageId = String(inspect?.Id ?? '').trim() || null;
      const size = Number(inspect?.Size);
      const sizeBytes = Number.isFinite(size) && size >= 0 ? Math.floor(size) : null;
      return imageId || sizeBytes != null ? { imageId, sizeBytes } : null;
    } catch {
      return null;
    }
  }

  async function failStaleDockerSnapshotsForChat(opts: {
    droneId: string;
    chatName: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    if (!droneId || !chatName) return;
    const cutoffMs = Date.now() - DOCKER_SNAPSHOT_ACTIVE_STALE_MS;
    const candidates: Array<{
      promptId: string;
      snapshotId: string;
      status: 'creating' | 'restoring';
      imageRef: string;
    }> = [];

    const regSnap: any = await loadRegistry();
    const initialTurns: DockerTranscriptTurn[] = Array.isArray(
      regSnap?.drones?.[droneId]?.chats?.[chatName]?.turns,
    )
      ? regSnap.drones[droneId].chats[chatName].turns
      : [];
    for (const turn of initialTurns as any[]) {
      const promptId = String(turn?.id ?? '').trim();
      const snap = normalizeDockerSnapshot(turn?.dockerSnapshot);
      if (!promptId || !snap || (snap.status !== 'creating' && snap.status !== 'restoring'))
        continue;
      const createdMs = Date.parse(String(snap.createdAt ?? ''));
      if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
      candidates.push({
        promptId,
        snapshotId: snap.id,
        status: snap.status,
        imageRef: String(snap.imageRef ?? '').trim(),
      });
    }
    if (candidates.length === 0) return;

    const recoveredBySnapshotId = new Map<
      string,
      { imageId: string | null; sizeBytes: number | null }
    >();
    for (const candidate of candidates) {
      if (candidate.status !== 'creating' || !candidate.imageRef) continue;
      // eslint-disable-next-line no-await-in-loop
      const image = await inspectDockerSnapshotImage(candidate.imageRef);
      if (image) recoveredBySnapshotId.set(candidate.snapshotId, image);
    }

    let syncedTurns: DockerTranscriptTurn[] | null = null;
    {
      const turns: DockerTranscriptTurn[] = initialTurns.map((turn) => ({ ...turn }));
      let changed = false;
      for (let i = 0; i < turns.length; i += 1) {
        const turn: any = turns[i];
        const promptId = String(turn?.id ?? '').trim();
        const snap = normalizeDockerSnapshot(turn?.dockerSnapshot);
        if (!snap || (snap.status !== 'creating' && snap.status !== 'restoring')) continue;
        const createdMs = Date.parse(String(snap.createdAt ?? ''));
        if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
        if (
          !candidates.some(
            (candidate) => candidate.promptId === promptId && candidate.snapshotId === snap.id,
          )
        )
          continue;
        const recovered = recoveredBySnapshotId.get(snap.id);
        if (snap.status === 'creating' && recovered) {
          turn.dockerSnapshot = {
            ...snap,
            status: 'ready',
            ...(String(snap.imageRef ?? '').trim()
              ? { imageRef: String(snap.imageRef).trim() }
              : {}),
            ...(recovered.imageId ? { imageId: recovered.imageId } : {}),
            ...(typeof recovered.sizeBytes === 'number' ? { sizeBytes: recovered.sizeBytes } : {}),
            readyAt: nowIso(),
          };
          turns[i] = turn;
          changed = true;
          continue;
        }
        turn.dockerSnapshot = {
          ...snap,
          status: 'failed',
          error: `${snap.status === 'restoring' ? 'Rollback' : 'Snapshot'} did not finish before Hub lost track of it`,
        };
        turns[i] = turn;
        changed = true;
      }
      if (changed) syncedTurns = turns;
    }
    if (syncedTurns) {
      for (const candidate of candidates) {
        const updated = (syncedTurns as DockerTranscriptTurn[]).find(
          (turn: any) => String(turn?.id ?? '').trim() === candidate.promptId,
        );
        if (!updated) continue;
        await upsertTranscriptTurnInStore({ droneId, chatName, turn: updated });
      }
    }
  }

  async function dockerSnapshotTotalsForDroneEntry(
    droneEntry: any,
  ): Promise<{ count: number; sizeBytes: number; virtualSizeBytes: number | null }> {
    let count = 0;
    let sizeBytes = 0;
    let virtualSizeBytes = 0;
    let hasVirtualSize = false;
    const imageRefs: string[] = [];
    const fallbackVirtualSizes = new Map<string, number>();
    const visitChat = (chat: any) => {
      const turns = Array.isArray(chat?.turns) ? chat.turns : [];
      for (const turn of turns) {
        const snap = normalizeDockerSnapshot((turn as any)?.dockerSnapshot);
        if (!snap || snap.status !== 'ready') continue;
        count += 1;
        const imageRef = String(snap.imageRef ?? '').trim();
        const size = Number(snap.sizeBytes);
        if (imageRef) {
          imageRefs.push(imageRef);
          if (Number.isFinite(size) && size > 0)
            fallbackVirtualSizes.set(imageRef, Math.floor(size));
        } else if (Number.isFinite(size) && size > 0) {
          sizeBytes += Math.floor(size);
          virtualSizeBytes += Math.floor(size);
          hasVirtualSize = true;
        }
      }
    };
    for (const chat of Object.values(droneEntry?.chats ?? {})) visitChat(chat);
    for (const chat of Object.values(droneEntry?.archivedChats ?? {})) visitChat(chat);
    const usageByRef = imageRefs.length
      ? await dockerImageDiskUsageByRef()
      : new Map<string, DockerImageDiskUsage>();
    for (const imageRef of Array.from(new Set(imageRefs))) {
      const usage = usageByRef.get(imageRef);
      const fallback = fallbackVirtualSizes.get(imageRef) ?? null;
      const unique = usage?.uniqueBytes ?? null;
      const virtual = usage?.virtualBytes ?? fallback;
      if (unique != null && Number.isFinite(unique) && unique >= 0) {
        sizeBytes += Math.floor(unique);
      } else if (fallback != null) {
        sizeBytes += fallback;
      }
      if (virtual != null && Number.isFinite(virtual) && virtual >= 0) {
        virtualSizeBytes += Math.floor(virtual);
        hasVirtualSize = true;
      }
    }
    return { count, sizeBytes, virtualSizeBytes: hasVirtualSize ? virtualSizeBytes : null };
  }

  function collectDockerSnapshotImageRefsFromChatEntry(chatEntry: any): string[] {
    const out: string[] = [];
    const turns = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
    for (const turn of turns) {
      const imageRef = String((turn as any)?.dockerSnapshot?.imageRef ?? '').trim();
      if (imageRef && !out.includes(imageRef)) out.push(imageRef);
    }
    return out;
  }

  function collectDockerSnapshotImageRefsFromDroneEntry(droneEntry: any): string[] {
    const out: string[] = [];
    const add = (refs: string[]) => {
      for (const ref of refs) {
        if (ref && !out.includes(ref)) out.push(ref);
      }
    };
    for (const chat of Object.values(droneEntry?.chats ?? {}))
      add(collectDockerSnapshotImageRefsFromChatEntry(chat));
    for (const chat of Object.values(droneEntry?.archivedChats ?? {}))
      add(collectDockerSnapshotImageRefsFromChatEntry(chat));
    return out;
  }

  async function removeDockerSnapshotImagesBestEffort(
    imageRefs: string[],
    context: Record<string, unknown>,
  ): Promise<void> {
    const refs = Array.from(new Set(imageRefs.map((x) => String(x ?? '').trim()).filter(Boolean)));
    for (const imageRef of refs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await runDockerOrThrow(['image', 'rm', '-f', imageRef], { timeoutMs: 60_000 });
      } catch (e: any) {
        hubLog('warn', 'failed removing docker snapshot image', {
          ...context,
          imageRef,
          error: String(e?.message ?? e ?? 'unknown error'),
        });
      }
    }
  }

  async function beginDockerSnapshotForTranscriptTurn(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): Promise<{ snapshotId: string; imageRef: string; containerName: string } | null> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const promptId = String(opts.promptId ?? '').trim();
    if (!droneId || !chatName || !promptId) return null;
    const reg = await loadRegistry();
    const d = (reg as any)?.drones?.[droneId];
    const stored = readChatFromStore({ droneId, chatName });
    const chat = stored.available ? stored.chat : null;
    if (
      !d ||
      !chat ||
      droneRuntime(d) === 'host' ||
      !dockerSnapshotAfterAgentMessageEnabledForChat(d, chat)
    )
      return null;
    const snapshotId = crypto.randomBytes(8).toString('hex');
    const imageRef = dockerSnapshotImageRef({ droneId, chatName, promptId });
    const containerName =
      String(d?.containerName ?? d?.name ?? `drone-${droneId}`).trim() || `drone-${droneId}`;
    const updated = await updateTranscriptTurnInStore({
      droneId,
      chatName,
      turnId: promptId,
      update: (turn: any) => {
        const existing = normalizeDockerSnapshot((turn as any)?.dockerSnapshot);
        if (!turn.ok || (existing && existing.status !== 'failed')) return turn;
        return {
          ...turn,
          dockerSnapshot: { id: snapshotId, status: 'creating', imageRef, createdAt: nowIso() },
        };
      },
    });
    if (updated.changed) await projectCanonicalChatToRegistry(droneId, chatName);
    return updated.changed ? { snapshotId, imageRef, containerName } : null;
  }

  async function finishDockerSnapshotForTranscriptTurn(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    snapshotId: string;
    imageRef: string;
    containerName: string;
  }): Promise<void> {
    try {
      await cleanupContainerBeforeDockerSnapshot(opts.containerName);
      const stdout = await runDockerOrThrow(['commit', opts.containerName, opts.imageRef], {
        timeoutMs: 10 * 60_000,
      });
      const imageId = String(stdout ?? '').trim();
      const sizeBytes = await dockerImageSizeBytes(opts.imageRef);
      await updateTranscriptTurnById({
        droneId: opts.droneId,
        chatName: opts.chatName,
        promptId: opts.promptId,
        update: (turn: any) => {
          const current = normalizeDockerSnapshot((turn as any).dockerSnapshot);
          if (!current || current.id !== opts.snapshotId) return turn;
          return {
            ...turn,
            dockerSnapshot: {
              ...current,
              status: 'ready',
              imageRef: opts.imageRef,
              ...(imageId ? { imageId } : {}),
              ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
              readyAt: nowIso(),
            },
          };
        },
      });
    } catch (e: any) {
      const error = String(e?.message ?? e ?? 'snapshot failed');
      await updateTranscriptTurnById({
        droneId: opts.droneId,
        chatName: opts.chatName,
        promptId: opts.promptId,
        update: (turn: any) => {
          const current = normalizeDockerSnapshot((turn as any).dockerSnapshot);
          if (!current || current.id !== opts.snapshotId) return turn;
          return {
            ...turn,
            dockerSnapshot: {
              ...current,
              status: 'failed',
              error,
            },
          };
        },
      });
      hubLog('warn', 'docker snapshot failed', {
        droneId: opts.droneId,
        chatName: opts.chatName,
        promptId: opts.promptId,
        imageRef: opts.imageRef,
        error,
      });
    }
  }

  async function cleanupContainerBeforeDockerSnapshot(containerName: string): Promise<void> {
    const name = String(containerName ?? '').trim();
    if (!name) return;
    const script = [
      'rm -f /tmp/dvm-repo.bundle',
      'rm -rf /tmp/yarn--* /tmp/node-compile-cache /tmp/v8-compile-cache-*',
      'rm -rf /root/.npm/_cacache /root/.cache/node /root/.cache/cursor-compile-cache',
      'rm -rf /usr/local/share/.cache/yarn',
    ].join('\n');
    const result = await runDocker(['exec', name, 'sh', '-lc', script], { timeoutMs: 60_000 });
    if (result.code !== 0) {
      hubLog('warn', 'docker snapshot pre-cleanup failed', {
        containerName: name,
        error: (
          result.stderr ||
          result.stdout ||
          `docker exec cleanup failed with code ${result.code}`
        ).trim(),
      });
    }
  }

  async function maybeStartDockerSnapshotForTranscriptTurn(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): Promise<void> {
    const started = await beginDockerSnapshotForTranscriptTurn(opts);
    if (!started) return;
    void finishDockerSnapshotForTranscriptTurn({
      ...opts,
      snapshotId: started.snapshotId,
      imageRef: started.imageRef,
      containerName: started.containerName,
    });
  }

  function dockerPortBindingArgs(inspect: any): string[] {
    const bindings = inspect?.HostConfig?.PortBindings ?? {};
    const args: string[] = [];
    for (const [containerPort, rawList] of Object.entries(bindings)) {
      const list = Array.isArray(rawList) ? rawList : [];
      for (const binding of list) {
        const hostPort = String((binding as any)?.HostPort ?? '').trim();
        if (!hostPort) continue;
        const hostIp = String((binding as any)?.HostIp ?? '').trim();
        args.push(
          '-p',
          hostIp && hostIp !== '0.0.0.0'
            ? `${hostIp}:${hostPort}:${containerPort}`
            : `${hostPort}:${containerPort}`,
        );
      }
    }
    return args;
  }

  function dockerBindMountArgs(inspect: any): string[] {
    const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];
    const args: string[] = [];
    for (const mount of mounts) {
      if (String(mount?.Type ?? '').trim() !== 'bind') continue;
      const source = String(mount?.Source ?? '').trim();
      const target = String(mount?.Destination ?? '').trim();
      if (!source || !target || target === '/dvm-data') continue;
      const readonly = mount?.RW === false;
      args.push('--mount', `type=bind,src=${source},dst=${target}${readonly ? ',readonly' : ''}`);
    }
    return args;
  }

  function dockerNetworkArgs(inspect: any): string[] {
    const networks =
      inspect?.NetworkSettings?.Networks && typeof inspect.NetworkSettings.Networks === 'object'
        ? Object.keys(inspect.NetworkSettings.Networks)
        : [];
    const preferred = networks.find(
      (name) => name && name !== 'bridge' && name !== 'host' && name !== 'none',
    );
    return preferred ? ['--network', preferred] : [];
  }

  async function recreateDroneContainerFromSnapshot(opts: {
    droneId: string;
    droneEntry: any;
    imageRef: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId) throw new Error('missing drone id');
    if (droneRuntime(opts.droneEntry) === 'host')
      throw new Error('Docker snapshots are only supported for container drones');
    if (opts.droneEntry?.persistVolume !== false) {
      throw new Error('Docker snapshots require this drone to be created with Persist volume off');
    }
    const containerName =
      String(
        opts.droneEntry?.containerName ?? opts.droneEntry?.name ?? `drone-${droneId}`,
      ).trim() || `drone-${droneId}`;
    const backupName = `${containerName}-rollback-backup-${crypto.randomBytes(5).toString('hex')}`;
    const inspect = await dockerInspectOne(containerName);
    if (!inspect) throw new Error(`container "${containerName}" does not exist`);

    await stopAllDroneChatActivity({
      droneId,
      droneEntry: opts.droneEntry,
      reason: 'restart',
      updateLiveRegistry: true,
    });

    let renamed = false;
    let createdReplacement = false;
    try {
      await runDocker(['stop', containerName], { timeoutMs: 60_000 });
      await runDockerOrThrow(['rename', containerName, backupName], { timeoutMs: 30_000 });
      renamed = true;

      const createArgs = [
        'create',
        '--name',
        containerName,
        ...dockerNetworkArgs(inspect),
        ...dockerPortBindingArgs(inspect),
        ...dockerBindMountArgs(inspect),
        opts.imageRef,
      ];
      await runDockerOrThrow(createArgs, { timeoutMs: 60_000 });
      createdReplacement = true;
      await runDockerOrThrow(['start', containerName], { timeoutMs: 60_000 });
      await ensureContainerDroneDaemonSession({
        containerName,
        containerPort: Number(opts.droneEntry?.containerPort ?? 7777),
      });
      const hostPort =
        typeof opts.droneEntry?.hostPort === 'number' && Number.isFinite(opts.droneEntry.hostPort)
          ? opts.droneEntry.hostPort
          : await resolveHostPort(containerName, opts.droneEntry?.containerPort);
      const token = typeof opts.droneEntry?.token === 'string' ? opts.droneEntry.token : '';
      if (hostPort && token) await droneStatus(makeClient(hostPort, token));
      await runDocker(['rm', '-f', backupName], { timeoutMs: 60_000 });
    } catch (e) {
      if (createdReplacement) {
        await runDocker(['rm', '-f', containerName], { timeoutMs: 60_000 });
      }
      if (renamed) {
        await runDocker(['rename', backupName, containerName], { timeoutMs: 30_000 });
        await runDocker(['start', containerName], { timeoutMs: 60_000 });
      } else {
        await runDocker(['start', containerName], { timeoutMs: 60_000 });
      }
      throw e;
    }
  }

  async function restoreDockerSnapshotForTranscriptTurn(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    snapshotId: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const promptId = String(opts.promptId ?? '').trim();
    const snapshotId = String(opts.snapshotId ?? '').trim();
    if (!droneId || !chatName || !promptId || !snapshotId)
      throw new Error('missing snapshot target');

    let imageRef = '';
    let droneEntry: any = null;
    const reg = await loadRegistry();
    const d = (reg as any)?.drones?.[droneId];
    const stored = readChatFromStore({ droneId, chatName });
    const chat = stored.available ? stored.chat : null;
    const turns: DockerTranscriptTurn[] = Array.isArray(chat?.turns) ? chat.turns : [];
    const turn = turns.find(
      (candidate: any) => String(candidate?.id ?? '').trim() === promptId,
    ) as any;
    const snap = normalizeDockerSnapshot(turn?.dockerSnapshot);
    if (chatHasActivePendingPromptsForSummary(chat)) {
      const error: Error & { statusCode?: number } = new Error(
        'chat is busy; wait for the current work to finish before rolling back',
      );
      error.statusCode = 409;
      throw error;
    }
    const hasOtherActiveSnapshot = turns.some((candidate: any) => {
      if (String(candidate?.id ?? '').trim() === promptId) return false;
      const status = String(candidate?.dockerSnapshot?.status ?? '').trim();
      return status === 'creating' || status === 'restoring';
    });
    if (hasOtherActiveSnapshot) {
      const error: Error & { statusCode?: number } = new Error(
        'another Docker snapshot is still in progress for this chat',
      );
      error.statusCode = 409;
      throw error;
    }
    if (
      !d ||
      !chat ||
      !turn ||
      !snap ||
      snap.id !== snapshotId ||
      snap.status !== 'ready' ||
      !snap.imageRef
    ) {
      const error: Error & { statusCode?: number } = new Error(
        'snapshot is not available for rollback',
      );
      error.statusCode = 404;
      throw error;
    }
    imageRef = snap.imageRef;
    droneEntry = { ...d };
    const marked = await updateTranscriptTurnInStore({
      droneId,
      chatName,
      turnId: promptId,
      update: (current: any) => {
        const currentSnapshot = normalizeDockerSnapshot((current as any).dockerSnapshot);
        if (
          !currentSnapshot ||
          currentSnapshot.id !== snapshotId ||
          currentSnapshot.status !== 'ready'
        )
          return current;
        return { ...current, dockerSnapshot: { ...currentSnapshot, status: 'restoring' } };
      },
    });
    if (!marked.changed) {
      const error: Error & { statusCode?: number } = new Error(
        'snapshot is not available for rollback',
      );
      error.statusCode = 409;
      throw error;
    }

    try {
      await recreateDroneContainerFromSnapshot({ droneId, droneEntry, imageRef });
    } catch (e: any) {
      const error = String(e?.message ?? e ?? 'rollback failed');
      await updateTranscriptTurnById({
        droneId,
        chatName,
        promptId,
        update: (turn: any) => {
          const snap = normalizeDockerSnapshot((turn as any).dockerSnapshot);
          if (!snap || snap.id !== snapshotId) return turn;
          return {
            ...turn,
            dockerSnapshot: {
              ...snap,
              status: 'ready',
              error,
            },
          };
        },
      });
      throw e;
    }

    const rollback = await rollbackTranscriptToTurnInStore({
      droneId,
      chatName,
      turnId: promptId,
      update: (current: any) => {
        const currentSnapshot = normalizeDockerSnapshot((current as any).dockerSnapshot);
        if (!currentSnapshot || currentSnapshot.id !== snapshotId) return current;
        return {
          ...current,
          dockerSnapshot: { ...currentSnapshot, status: 'ready', restoredAt: nowIso() },
        };
      },
    });
    if (rollback.changed) await projectCanonicalChatToRegistry(droneId, chatName);
    const prunedImageRefs = rollback.removedTurns
      .map((turn: any) => String(turn?.dockerSnapshot?.imageRef ?? '').trim())
      .filter(Boolean);
    await removeDockerSnapshotImagesBestEffort(prunedImageRefs, {
      droneId,
      chatName,
      reason: 'rollback-pruned-turns',
    });
    enqueuePendingPromptPump(droneId, chatName);
  }

  return {
    chatHasActiveDockerSnapshot,
    collectDockerSnapshotImageRefsFromChatEntry,
    collectDockerSnapshotImageRefsFromDroneEntry,
    collectDroneRuntimeDiagnostics,
    compactDiagnosticError,
    dockerContainerId,
    dockerContainerSizeBytes,
    dockerSnapshotAfterAgentMessageEnabledForChat,
    dockerSnapshotTotalsForDroneEntry,
    failStaleDockerSnapshotsForChat,
    isStaleDockerExecErrorMessage,
    maybeStartDockerSnapshotForTranscriptTurn,
    normalizeDockerSnapshot,
    removeDockerSnapshotImagesBestEffort,
    restoreDockerSnapshotForTranscriptTurn,
  };
}
