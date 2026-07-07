import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadRegistry, updateRegistry } from '../host/registry';
import { droneRootPath } from '../host/paths';
import { dvmRepoExport, dvmRepoSeed } from '../host/dvm';
import { normalizeDroneRuntime } from '../host/runtime';
import { normalizeDisabledRepoKeys, normalizeEnvVarMap } from './environment-config';
import {
  fleetActorConfig,
  sanitizeFleetCapabilities,
  sanitizeFleetQuotas,
  sanitizeFleetReadScopes,
  setFleetActorConfig,
} from './fleet-helpers';
import { resolveDroneContainerNameByIdentity, setDroneHubMetaByIdentity } from './drone-lifecycle-service';
import { findDroneEntryByIdentity, normalizeDroneIdentity } from './drone-lifecycle-registry';
import type { PendingPhase, PendingPromptProjection, PendingStartupPrompt } from './drone-pending-state';
import { deleteHostRefBestEffort, gitCurrentBranchOrSha, gitResolveRemoteBranchForCreate, gitTopLevel, importBundleHeadToHostRef } from './repoOps';

type PendingDronePatch = Partial<{
  phase: PendingPhase;
  message: string;
  error: string;
  updatedAt: string;
}>;

type DroneProvisioningControllerDeps = {
  NON_REPO_HOME_CWD: string;
  applyPendingDisplayNameToProvisionedDrone: (droneEntry: any, pendingEntry: any, fallbackRaw: unknown) => string;
  cloneChatEntryForDroneClone: (entryRaw: any) => any;
  defaultDaemonReadyTimeoutMs: () => number;
  defaultRepoSeedTimeoutMs: () => number;
  ensureChatEntry: (opts: { droneId: string; chatName: string }) => Promise<void>;
  enqueuePrompt: (opts: { id?: string; droneId: string; chatName: string; prompt: string; cwd?: string | null; waitForDaemonMs?: number }) => Promise<any>;
  enqueuePendingPromptPump: (droneIdRaw: string, chatName: string) => void;
  hubLog: (level: 'error' | 'info' | 'warn', message: string, meta?: Record<string, unknown>) => void;
  inferChatAgent: (entry: any, droneEntry?: any) => any;
  isSafePromptId: (raw: string) => boolean;
  normalizeChatModel: (raw: any) => string | null;
  normalizeChatName: (raw: any) => string;
  normalizeDroneEntryKind: (raw: unknown) => 'standard' | 'playbook-run';
  normalizeDroneEntryVisibility: (raw: unknown) => 'visible' | 'hidden';
  normalizePlaybookRunQueueGate?: (raw: unknown) => any | null;
  normalizePendingStartupPrompts: (raw: unknown, chatNameFilter?: string) => PendingStartupPrompt[];
  nowIso: () => string;
  parseSeedAgent: (raw: any) => any | null;
  playbookMetaFromEntry: (raw: unknown) => any | null;
  resolveDroneCliPath: () => string;
  resolveAgentSuggestionEnabledByDefault: () => Promise<boolean>;
  resolvePendingDroneDisplayName: (pendingEntry: any, fallbackRaw: unknown) => string;
  runNodeCli: (args: string[], opts?: { cwd?: string; timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
  setChatAgentConfig: (opts: {
    droneId: string;
    chatName: string;
    agent?: any;
    setModel: boolean;
    model?: string | null;
    setAgentPermissionMode?: boolean;
    agentPermissionMode?: 'full-access' | 'read-only';
    setAgentSuggestionEnabled?: boolean;
    agentSuggestionEnabled?: boolean;
  }) => Promise<void>;
  startupPromptToPendingPrompt: (prompt: PendingStartupPrompt) => PendingPromptProjection;
  syncMcpServersForDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
  syncRepoAgentsInstructionsForDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
  syncSkillLibraryForDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
  syncSharedPathsToDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
  syncTaskStateSnapshotToDrone: (droneId: string, droneEntry: any) => Promise<void>;
};

function normalizeIsoTimestamp(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return fallback;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? text : fallback;
}

export function createDroneProvisioningController(deps: DroneProvisioningControllerDeps) {
  const PROVISIONING_TASKS = new Map<string, Promise<void>>();
  const PROVISION_QUEUE: string[] = [];
  const PROVISION_QUEUED = new Set<string>();
  let PROVISION_ACTIVE = 0;
  let PROVISION_PUMPING = false;
  let PROVISION_PUMP_SCHEDULED = false;

  async function updatePendingDrone(droneIdRaw: string, patch: PendingDronePatch) {
    await updateRegistry((regAny: any) => {
      const droneId = normalizeDroneIdentity(droneIdRaw);
      const pending = droneId ? regAny?.pending?.[droneId] : null;
      if (!pending) return;
      regAny.pending = regAny.pending ?? {};
      regAny.pending[droneId] = {
        ...pending,
        ...patch,
        updatedAt: patch.updatedAt ?? deps.nowIso(),
      };
    });
  }

  function provisionConcurrencyLimit(): number {
    const raw = String(process.env.DRONE_HUB_PROVISION_CONCURRENCY ?? '').trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(16, Math.floor(n)));
    return 3;
  }

  function removeFromArrayInPlace<T>(arr: T[], pred: (v: T) => boolean): number {
    let removed = 0;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (pred(arr[i]!)) {
        arr.splice(i, 1);
        removed += 1;
      }
    }
    return removed;
  }

  function materializeSeedChatConfigOnDroneEntry(droneEntry: any, seedRaw: any) {
    if (!droneEntry || typeof droneEntry !== 'object' || !seedRaw || typeof seedRaw !== 'object') return;
    const seedAgent = deps.parseSeedAgent(seedRaw?.agent);
    const seedAgentPermissionMode = seedRaw?.agentPermissionMode === 'read-only' ? 'read-only' : null;
    const hasSeedModel = Object.prototype.hasOwnProperty.call(seedRaw, 'model');
    if (!seedAgent && !hasSeedModel && !seedAgentPermissionMode) return;

    const chatName = deps.normalizeChatName(seedRaw?.chatName ?? 'default');
    const seedModel = deps.normalizeChatModel(seedRaw?.model);
    droneEntry.chats = droneEntry.chats && typeof droneEntry.chats === 'object' ? droneEntry.chats : {};
    const entry =
      droneEntry.chats[chatName] && typeof droneEntry.chats[chatName] === 'object'
        ? droneEntry.chats[chatName]
        : { createdAt: deps.nowIso() };
    if (!(typeof entry.createdAt === 'string' && entry.createdAt.trim())) entry.createdAt = deps.nowIso();
    if (seedAgent) entry.agent = seedAgent;
    if (seedAgentPermissionMode) entry.agentPermissionMode = seedAgentPermissionMode;
    else delete entry.agentPermissionMode;
    if (hasSeedModel) {
      if (seedModel) entry.model = seedModel;
      else delete entry.model;
    }
    droneEntry.chats[chatName] = entry;
  }

  async function provisionDroneFromPending(name: string) {
    const regAny: any = await loadRegistry();
    const pending = regAny?.pending?.[name];
    if (!pending) return;
    const pendingDroneId = normalizeDroneIdentity(pending?.id);
    if (!pendingDroneId) {
      await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: 'missing pending drone identity' });
      return;
    }
    if (regAny?.drones?.[name]) {
      await updateRegistry((regLatest: any) => {
        if (regLatest?.pending?.[name]) delete regLatest.pending[name];
      });
      return;
    }

    const repoPath = String(pending.repoPath ?? '').trim();
    const group = typeof pending.group === 'string' ? pending.group.trim() : '';
    const runtime = normalizeDroneRuntime((pending as any)?.runtime);
    const build = Boolean(pending.build);
    const persistVolume = (pending as any)?.persistVolume === false ? false : undefined;
    const containerPort = typeof pending.containerPort === 'number' && Number.isFinite(pending.containerPort) ? pending.containerPort : null;
    const cloneFrom = typeof pending.cloneFrom === 'string' ? pending.cloneFrom.trim() : '';
    const cloneChats = pending.cloneChats !== false;
    const cloneSource = cloneFrom ? findDroneEntryByIdentity(regAny, cloneFrom) : null;
    const cloneSourceContainerName = cloneSource
      ? String((cloneSource.entry as any)?.containerName ?? (cloneSource.entry as any)?.name ?? cloneSource.key ?? '').trim()
      : '';
    const cloneSourceRuntime = cloneSource ? normalizeDroneRuntime((cloneSource.entry as any)?.runtime) : 'container';
    if (cloneFrom && runtime === 'container' && cloneSourceRuntime !== 'container') {
      await updatePendingDrone(name, {
        phase: 'error',
        message: 'Failed to start',
        error: `clone source must use container runtime: ${cloneFrom}`,
      });
      return;
    }
    if (cloneFrom && runtime === 'container' && !cloneSourceContainerName) {
      await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: `clone source not found: ${cloneFrom}` });
      return;
    }

    await updatePendingDrone(name, {
      phase: 'creating',
      message: runtime === 'host' ? 'Starting host runtime…' : 'Creating container…',
    });

    const droneCli = deps.resolveDroneCliPath();
    const repoArg = repoPath ? repoPath : '-';
    const latestPendingForCreate: any = (await loadRegistry())?.pending?.[name] ?? pending;
    const displayName = deps.resolvePendingDroneDisplayName(latestPendingForCreate, String(pending?.name ?? '').trim() || name);
    const args: string[] = [droneCli, 'create', displayName, '--runtime', runtime, '--repo', repoArg, '--drone-id', pendingDroneId];
    if (group) args.push('--group', group);
    if (!build) args.push('--no-build');
    if (containerPort != null) args.push('--container-port', String(containerPort));
    if (runtime === 'container' && persistVolume === false) args.push('--no-persist-volume');
    if (runtime === 'container' && cloneSourceContainerName) args.push('--clone-container', cloneSourceContainerName);
    if (runtime === 'container' && !repoPath) args.push('--cwd', deps.NON_REPO_HOME_CWD, '--mkdir');

    const r = await deps.runNodeCli(args);
    if (r.code !== 0) {
      const errText = (r.stderr || r.stdout || `drone create failed (exit ${r.code})`).trim();
      if (runtime === 'container' && /already exists/i.test(errText)) {
        await updatePendingDrone(name, { phase: 'creating', message: 'Container exists; importing…' });
        const impArgs: string[] = [droneCli, 'import', displayName, '--runtime', 'container', '--repo', repoArg, '--drone-id', pendingDroneId];
        if (group) impArgs.push('--group', group);
        if (containerPort != null) impArgs.push('--container-port', String(containerPort));
        if (persistVolume === false) impArgs.push('--no-persist-volume');
        if (!repoPath) impArgs.push('--cwd', deps.NON_REPO_HOME_CWD, '--mkdir');
        const imp = await deps.runNodeCli(impArgs);
        if (imp.code !== 0) {
          const impErr = (imp.stderr || imp.stdout || `drone import failed (exit ${imp.code})`).trim();
          await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: `${errText}\n\nImport also failed:\n${impErr}` });
          return;
        }
      } else {
        await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: errText });
        return;
      }
    }

    try {
      await updateRegistry((regLatest: any) => {
        const pendingLatest = regLatest?.pending?.[name] ?? null;
        const fleetMeta = pendingLatest?.fleet && typeof pendingLatest.fleet === 'object' ? pendingLatest.fleet : null;
        const environment = pendingLatest?.environment ?? null;
        const pendingKind = deps.normalizeDroneEntryKind(pendingLatest?.kind);
        const pendingVisibility = deps.normalizeDroneEntryVisibility(pendingLatest?.visibility);
        const pendingPlaybook = deps.playbookMetaFromEntry(pendingLatest?.playbook);
        const pendingPlaybookQueueGate = deps.normalizePlaybookRunQueueGate?.(pendingLatest?.playbookQueueGate) ?? null;
        const cloneSourceLatest = cloneFrom ? findDroneEntryByIdentity(regLatest, cloneFrom)?.entry : null;
        const found = findDroneEntryByIdentity(regLatest, pendingDroneId);
        if (!found) return;
        const d = found.entry;
        deps.applyPendingDisplayNameToProvisionedDrone(d, pendingLatest, displayName);
        d.kind = pendingKind;
        d.visibility = pendingVisibility;
        if (pendingPlaybook) d.playbook = pendingPlaybook;
        else delete d.playbook;
        if (pendingPlaybookQueueGate) d.playbookQueueGate = pendingPlaybookQueueGate;
        else delete d.playbookQueueGate;
        if (fleetMeta) {
          const current = fleetActorConfig(d);
          setFleetActorConfig(d, {
            createdBy:
              typeof fleetMeta.createdBy === 'string' && fleetMeta.createdBy.trim()
                ? String(fleetMeta.createdBy).trim()
                : current.createdBy,
            createdAt:
              typeof fleetMeta.createdAt === 'string' && fleetMeta.createdAt.trim()
                ? String(fleetMeta.createdAt).trim()
                : current.createdAt,
            enabled: fleetMeta.enabled === true,
            capabilities: sanitizeFleetCapabilities(fleetMeta.capabilities),
            readScopes: sanitizeFleetReadScopes(fleetMeta.readScopes),
            assigned: fleetMeta.assigned,
            quotas: sanitizeFleetQuotas(fleetMeta.quotas),
          });
        }
        if (environment && typeof environment === 'object') {
          d.environment = {
            vars: normalizeEnvVarMap((environment as any)?.vars),
            useRepoVars: (environment as any)?.useRepoVars === true,
            disabledRepoKeys: normalizeDisabledRepoKeys((environment as any)?.disabledRepoKeys),
            updatedAt: typeof (environment as any)?.updatedAt === 'string' ? String((environment as any).updatedAt).trim() || null : null,
          };
        }
        if (cloneSourceLatest && typeof cloneSourceLatest === 'object') {
          const cloneSourceCwd =
            typeof (cloneSourceLatest as any)?.cwd === 'string'
              ? String((cloneSourceLatest as any).cwd).trim()
              : '';
          const cloneSourceRepoPath =
            typeof (cloneSourceLatest as any)?.repoPath === 'string'
              ? String((cloneSourceLatest as any).repoPath).trim()
              : '';
          const cloneSourceRepo = (cloneSourceLatest as any)?.repo;
          if (cloneSourceCwd) d.cwd = cloneSourceCwd;
          if (cloneSourceRepoPath && !String((d as any)?.repoPath ?? '').trim()) d.repoPath = cloneSourceRepoPath;
          if (cloneSourceRepo && typeof cloneSourceRepo === 'object') {
            try {
              d.repo = JSON.parse(JSON.stringify(cloneSourceRepo));
            } catch {
              d.repo = { ...(cloneSourceRepo as any) };
            }
          }
        }
        materializeSeedChatConfigOnDroneEntry(d, pendingLatest?.seed);
        regLatest.drones[found.key] = d;
      });
    } catch {
      // ignore (best-effort lineage persistence)
    }

    if (repoPath && runtime === 'container' && !cloneFrom) {
      await setDroneHubMetaByIdentity({
        droneId: pendingDroneId,
        hub: { phase: 'seeding', message: 'Seeding repo…' },
      });
      let repoRoot = '';
      let importedRefName = '';
      let exportedBundlePath = '';
      try {
        repoRoot = await gitTopLevel(repoPath);
        const repoSeedSource = String((pending as any)?.repoSeedSource ?? '').trim().toLowerCase() === 'remote' ? 'remote' : 'host';
        const repoSeedRemoteBranch = String((pending as any)?.repoSeedRemoteBranch ?? '').trim();
        const repoSeedFromDroneId = String((pending as any)?.repoSeedFromDroneId ?? '').trim();
        let baseRef = '';
        if (repoSeedFromDroneId) {
          const sourceRegistry: any = await loadRegistry();
          const sourceFound = findDroneEntryByIdentity(sourceRegistry, repoSeedFromDroneId);
          const sourceEntry = sourceFound?.entry ?? null;
          const sourceRuntime = normalizeDroneRuntime((sourceEntry as any)?.runtime);
          const sourceContainerName = sourceEntry
            ? String((sourceEntry as any)?.containerName ?? (sourceEntry as any)?.name ?? sourceFound?.key ?? '').trim()
            : '';
          const sourceRepoPathInContainer = String((sourceEntry as any)?.repo?.dest ?? '/work/repo').trim() || '/work/repo';
          if (!sourceEntry) throw new Error(`repo seed source not found: ${repoSeedFromDroneId}`);
          if (sourceRuntime !== 'container') throw new Error(`repo seed source must use container runtime: ${repoSeedFromDroneId}`);
          if (!sourceContainerName) throw new Error(`repo seed source container is unavailable: ${repoSeedFromDroneId}`);

          const safeSourceRefSeg =
            String((sourceEntry as any)?.name ?? repoSeedFromDroneId)
              .toLowerCase()
              .replace(/[^a-z0-9_.-]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'drone';
          const importRunId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
          importedRefName = `refs/drone/imports/create-child/${safeSourceRefSeg}/${importRunId}`;
          const bundlesRoot = droneRootPath('repo-exports');
          await fs.mkdir(bundlesRoot, { recursive: true });
          const exported = await dvmRepoExport({
            container: sourceContainerName,
            repoPathInContainer: sourceRepoPathInContainer,
            outDir: bundlesRoot,
            format: 'bundle',
          });
          exportedBundlePath = path.resolve(exported.exportedPath);
          baseRef = await importBundleHeadToHostRef({
            repoRoot,
            bundlePath: exportedBundlePath,
            refName: importedRefName,
          });
        } else {
          baseRef =
            repoSeedSource === 'remote'
              ? (await gitResolveRemoteBranchForCreate(repoRoot, repoSeedRemoteBranch)).remoteBranch
              : await gitCurrentBranchOrSha(repoRoot);
        }
        const repoSeedContainer = await resolveDroneContainerNameByIdentity(pendingDroneId);
        if (!repoSeedContainer) throw new Error('drone disappeared during repo seed');

        await dvmRepoSeed({
          container: repoSeedContainer,
          hostPath: repoRoot,
          dest: '/work/repo',
          baseRef,
          branch: 'dvm/work',
          clean: true,
          timeoutMs: deps.defaultRepoSeedTimeoutMs(),
        });

        await updateRegistry((reg2: any) => {
          const found = findDroneEntryByIdentity(reg2, pendingDroneId);
          if (!found) return;
          const d = found.entry;
          d.repoPath = repoRoot;
          d.cwd = '/work/repo';
          d.repo = d.repo ?? {};
          d.repo.dest = '/work/repo';
          d.repo.branch = 'dvm/work';
          d.repo.baseRef = baseRef;
          d.repo.seededAt = deps.nowIso();
          reg2.drones = reg2.drones ?? {};
          reg2.drones[found.key] = d;
        });

        await setDroneHubMetaByIdentity({ droneId: pendingDroneId, hub: null });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        await setDroneHubMetaByIdentity({
          droneId: pendingDroneId,
          hub: { phase: 'error', message: `Repo seed failed: ${msg}` },
        });
        return;
      } finally {
        if (repoRoot && importedRefName) {
          await deleteHostRefBestEffort({ repoRoot, refName: importedRefName });
        }
        if (exportedBundlePath) {
          await fs.rm(exportedBundlePath, { force: true }).catch(() => {});
        }
      }
    }

    const pendingTransition = await updateRegistry((regLatest: any) => {
      const pendingEntry = regLatest?.pending?.[name] ?? pending ?? null;
      const seed = pendingEntry?.seed ?? null;
      const startupQueuedPrompts = deps.normalizePendingStartupPrompts((pendingEntry as any)?.startupQueuedPrompts);
      const createdAt = typeof pendingEntry?.createdAt === 'string' && pendingEntry.createdAt.trim() ? String(pendingEntry.createdAt) : deps.nowIso();
      if (regLatest?.pending?.[name]) delete regLatest.pending[name];
      return { seed, startupQueuedPrompts, createdAt };
    });
    const seed = pendingTransition?.seed ?? null;
    const startupQueuedPrompts = Array.isArray(pendingTransition?.startupQueuedPrompts)
      ? (pendingTransition.startupQueuedPrompts as PendingStartupPrompt[])
      : [];
    const seedChatName = deps.normalizeChatName(seed?.chatName ?? 'default');
    const seedAgent = deps.parseSeedAgent(seed?.agent);
    const seedModel = deps.normalizeChatModel(seed?.model);
    const seedAgentPermissionMode = seed?.agentPermissionMode === 'read-only' ? 'read-only' : null;
    const seedPrompt = String(seed?.prompt ?? '').trim();
    const seedPromptIdRaw = typeof (seed as any)?.promptId === 'string' ? String((seed as any).promptId).trim() : '';
    const seedPromptId =
      seedPrompt && seedPromptIdRaw && deps.isSafePromptId(seedPromptIdRaw)
        ? seedPromptIdRaw
        : seedPrompt
          ? crypto.randomBytes(9).toString('hex')
          : undefined;
    const seedPromptAt = normalizeIsoTimestamp(
      (seed as any)?.submittedAt ?? (seed as any)?.clientSubmittedAt ?? (seed as any)?.promptAt ?? (seed as any)?.at,
      String(pendingTransition?.createdAt ?? deps.nowIso()),
    );
    const queuedPromptsForMaterialization = [
      ...startupQueuedPrompts,
      ...(seedPrompt && seedPromptId
        ? [
            {
              id: seedPromptId,
              chatName: seedChatName,
              at: seedPromptAt,
              prompt: seedPrompt,
              ...(typeof seed?.cwd === 'string' ? { cwd: seed.cwd } : {}),
              state: 'queued' as const,
              updatedAt: seedPromptAt,
            },
          ]
        : []),
    ]
      .map((prompt, index) => ({ prompt, index }))
      .sort((a, b) => {
        const aa = Date.parse(a.prompt.at);
        const bb = Date.parse(b.prompt.at);
        const aMs = Number.isFinite(aa) ? aa : 0;
        const bMs = Number.isFinite(bb) ? bb : 0;
        if (aMs !== bMs) return aMs - bMs;
        return a.index - b.index;
      })
      .map((item) => item.prompt);

    if (cloneFrom && cloneChats) {
      const agentSuggestionEnabledByDefault = await deps.resolveAgentSuggestionEnabledByDefault();
      try {
        await updateRegistry((reg3Any: any) => {
          const src = reg3Any?.drones?.[cloneFrom];
          const dstFound = findDroneEntryByIdentity(reg3Any, pendingDroneId);
          if (!dstFound) return;
          const dst = dstFound.entry;
          const srcChats = src?.chats && typeof src.chats === 'object' ? src.chats : null;
          if (!src || !srcChats) return;
          const cloned: any = {};
          for (const [chatName, entryRaw] of Object.entries(srcChats)) {
            const entry = deps.cloneChatEntryForDroneClone(entryRaw);
            const agent = deps.inferChatAgent(entry, dst);
            const model = deps.normalizeChatModel(entry?.model);
            const createdAt = typeof entry?.createdAt === 'string' && entry.createdAt.trim() ? String(entry.createdAt) : deps.nowIso();
            entry.createdAt = createdAt;
            entry.agent = agent;
            if (model) entry.model = model;
            else delete entry.model;
            delete entry.agentSuggestionEnabled;
            delete entry.agentSuggestionEnabledAt;
            if (agentSuggestionEnabledByDefault && agent?.kind === 'builtin') {
              entry.agentSuggestionEnabled = true;
              entry.agentSuggestionEnabledAt = createdAt;
            }
            cloned[String(chatName)] = entry;
          }
          dst.chats = dst.chats ?? {};
          dst.chats = { ...dst.chats, ...cloned };
          reg3Any.drones = reg3Any.drones ?? {};
          reg3Any.drones[dstFound.key] = dst;
        });
      } catch {
        // ignore (best-effort)
      }
    }

    let startupQueuedPromptChats: string[] = [];
    if (queuedPromptsForMaterialization.length > 0) {
      startupQueuedPromptChats = await updateRegistry((reg4Any: any) => {
        const found = findDroneEntryByIdentity(reg4Any, pendingDroneId);
        if (!found) return [] as string[];
        const d: any = found.entry;
        d.chats = d.chats ?? {};
        const touched = new Set<string>();
        for (const queued of queuedPromptsForMaterialization) {
          const chatName = deps.normalizeChatName(queued.chatName);
          const entry = d.chats[chatName] ?? { createdAt: deps.nowIso() };
          if (chatName === seedChatName && (seedAgent || Object.prototype.hasOwnProperty.call(seed ?? {}, 'model'))) {
            if (seedAgent) entry.agent = seedAgent;
            if (seedModel) entry.model = seedModel;
            else delete entry.model;
          }
          if (chatName === seedChatName && seedAgentPermissionMode) {
            entry.agentPermissionMode = seedAgentPermissionMode;
          }
          entry.pendingPrompts = Array.isArray(entry.pendingPrompts) ? entry.pendingPrompts : [];
          const row = deps.startupPromptToPendingPrompt(queued);
          const existingIdx = entry.pendingPrompts.findIndex((p: any) => String(p?.id ?? '').trim() === row.id);
          if (existingIdx === -1) {
            entry.pendingPrompts.push(row);
          } else {
            const cur = entry.pendingPrompts[existingIdx] ?? {};
            entry.pendingPrompts[existingIdx] = { ...cur, ...row, updatedAt: row.updatedAt ?? deps.nowIso() };
          }
          entry.pendingPrompts = entry.pendingPrompts.slice(-60);
          d.chats[chatName] = entry;
          touched.add(chatName);
        }
        reg4Any.drones = reg4Any.drones ?? {};
        reg4Any.drones[found.key] = d;
        return Array.from(touched.values());
      });
    }

    if (seed && (seedAgent || seedModel || seedAgentPermissionMode || seedPrompt)) {
      const chatName = seedChatName;
      const prompt = seedPrompt;

      await setDroneHubMetaByIdentity({
        droneId: pendingDroneId,
        hub: {
          phase: 'seeding',
          message: prompt ? 'Seeding initial message…' : 'Configuring agent…',
          ...(seedPromptId ? { promptId: seedPromptId } : {}),
        },
      });
      try {
        if (seedAgent || seedModel || seedAgentPermissionMode) {
          const agentSuggestionEnabledByDefault = await deps.resolveAgentSuggestionEnabledByDefault();
          await deps.ensureChatEntry({ droneId: pendingDroneId, chatName });
          await deps.setChatAgentConfig({
            droneId: pendingDroneId,
            chatName,
            ...(seedAgent ? { agent: seedAgent } : {}),
            setModel: true,
            model: seedModel,
            ...(seedAgentPermissionMode ? { setAgentPermissionMode: true, agentPermissionMode: seedAgentPermissionMode } : {}),
            setAgentSuggestionEnabled: true,
            agentSuggestionEnabled: agentSuggestionEnabledByDefault && seedAgent?.kind !== 'custom',
          });
        }
        await setDroneHubMetaByIdentity({ droneId: pendingDroneId, hub: null });
      } catch (e: any) {
        await setDroneHubMetaByIdentity({
          droneId: pendingDroneId,
          hub: { phase: 'error', message: e?.message ?? String(e) },
        });
        return;
      }
    }

    try {
      const regAfterCreate: any = await loadRegistry();
      const createdDrone = findDroneEntryByIdentity(regAfterCreate, pendingDroneId)?.entry ?? null;
      if (createdDrone) {
        await deps.syncTaskStateSnapshotToDrone(pendingDroneId, createdDrone);
        await deps.syncSkillLibraryForDrone({ droneId: pendingDroneId, droneEntry: createdDrone });
        await deps.syncMcpServersForDrone({ droneId: pendingDroneId, droneEntry: createdDrone });
        await deps.syncSharedPathsToDrone({ droneId: pendingDroneId, droneEntry: createdDrone });
        await deps.syncRepoAgentsInstructionsForDrone({ droneId: pendingDroneId, droneEntry: createdDrone });
      }
    } catch (e: any) {
      deps.hubLog('warn', 'post-create sync failed after drone creation', {
        droneId: pendingDroneId,
        error: String(e?.message ?? String(e)),
      });
    }

    for (const chatNameToPump of startupQueuedPromptChats) {
      deps.enqueuePendingPromptPump(pendingDroneId, String(chatNameToPump));
    }
  }

  function pumpProvisionQueue() {
    PROVISION_PUMP_SCHEDULED = false;
    if (PROVISION_PUMPING) return;
    PROVISION_PUMPING = true;
    try {
      const limit = provisionConcurrencyLimit();
      while (PROVISION_ACTIVE < limit && PROVISION_QUEUE.length > 0) {
        const name = PROVISION_QUEUE.shift();
        if (!name) break;
        PROVISION_QUEUED.delete(name);
        if (PROVISIONING_TASKS.has(name)) continue;
        PROVISION_ACTIVE += 1;
        const task = provisionDroneFromPending(name)
          .catch(async (e: any) => {
            const msg = e?.message ?? String(e);
            await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: msg });
          })
          .finally(() => {
            PROVISION_ACTIVE -= 1;
            PROVISIONING_TASKS.delete(name);
            pumpProvisionQueue();
          });
        PROVISIONING_TASKS.set(name, task);
        void task;
      }
    } finally {
      PROVISION_PUMPING = false;
    }
  }

  function scheduleProvisionQueuePump() {
    if (PROVISION_PUMP_SCHEDULED) return;
    PROVISION_PUMP_SCHEDULED = true;
    setTimeout(() => {
      pumpProvisionQueue();
    }, 0);
  }

  function enqueueProvisioningForAllPending(regAny: any) {
    try {
      const pending = regAny?.pending && typeof regAny.pending === 'object' ? Object.entries(regAny.pending) : [];
      for (const [idRaw, p] of pending as any[]) {
        const id = normalizeDroneIdentity(idRaw);
        if (!id) continue;
        const phase = String(p?.phase ?? 'starting').trim();
        if (phase === 'error' || phase === 'draft') continue;
        enqueueProvisioning(id);
      }
    } catch {
      // ignore (best-effort)
    }
  }

  function enqueueProvisioning(name: string) {
    const normalized = String(name ?? '').trim();
    if (!normalized) return;
    if (PROVISIONING_TASKS.has(normalized)) return;
    if (PROVISION_QUEUED.has(normalized)) return;
    PROVISION_QUEUED.add(normalized);
    PROVISION_QUEUE.push(normalized);
    scheduleProvisionQueuePump();
  }

  function dequeueProvisioning(name: string) {
    const normalized = String(name ?? '').trim();
    if (!normalized) return;
    if (PROVISION_QUEUED.has(normalized)) {
      PROVISION_QUEUED.delete(normalized);
      removeFromArrayInPlace(PROVISION_QUEUE, (entry) => String(entry) === normalized);
    }
  }

  return {
    dequeueProvisioning,
    enqueueProvisioning,
    enqueueProvisioningForAllPending,
  };
}
