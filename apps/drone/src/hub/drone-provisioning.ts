import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadRegistry, updateRegistry } from '../host/registry';
import { droneRootPath } from '../host/paths';
import { dvmRepoExport, dvmRepoSeed } from '../host/dvm';
import { getPromptQueueRepository } from '../host/prompt-queue-repository';
import { normalizeDroneRuntime } from '../host/runtime';
import { normalizeDisabledRepoKeys, normalizeEnvVarMap } from './environment-config';
import {
  fleetActorConfig,
  setFleetActorConfig,
} from './fleet-helpers';
import {
  getCanonicalDroneLifecycle,
  resolveDroneContainerNameByIdentity,
  setDroneHubMetaByIdentity,
} from './drone-lifecycle-service';
import { commitDroneMetadataPatch } from './drone-metadata-commands';
import { findDroneEntryByIdentity, normalizeDroneIdentity } from './drone-lifecycle-registry';
import type { PendingPhase, PendingPromptProjection, PendingStartupPrompt } from './drone-pending-state';
import { deleteHostRefBestEffort, gitCurrentBranchOrSha, gitResolveRemoteBranchForCreate, gitTopLevel, importBundleHeadToHostRef } from './repoOps';
import { upsertChatInStore } from './transcript-store';

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
  normalizeChatReasoning?: (raw: any) => string | null;
  normalizeChatName: (raw: any) => string;
  normalizePendingStartupPrompts: (raw: unknown, chatNameFilter?: string) => PendingStartupPrompt[];
  nowIso: () => string;
  parseSeedAgent: (raw: any) => any | null;
  resolveDroneCliPath: () => string;
  resolvePendingDroneDisplayName: (pendingEntry: any, fallbackRaw: unknown) => string;
  runNodeCli: (args: string[], opts?: { cwd?: string; timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
  setChatAgentConfig: (opts: {
    droneId: string;
    chatName: string;
    agent?: any;
    setModel: boolean;
    model?: string | null;
    setReasoning?: boolean;
    reasoning?: string | null;
    setAgentPermissionMode?: boolean;
    agentPermissionMode?: 'read-only' | 'workspace-write' | 'full-access';
    setApprovalPolicy?: boolean;
    approvalPolicy?: 'ask' | 'agent-decides' | 'never';
  }) => Promise<void>;
  startupPromptToPendingPrompt: (prompt: PendingStartupPrompt) => PendingPromptProjection;
  syncMcpServersForDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
  syncRepoAgentsInstructionsForDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
  syncSkillLibraryForDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
  syncSharedPathsToDrone: (opts: { droneId: string; droneEntry: any }) => Promise<void>;
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

  const normalizeChatReasoning = (raw: any): string | null => {
    if (deps.normalizeChatReasoning) return deps.normalizeChatReasoning(raw);
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return value && value.length <= 32 && /^[a-z0-9._-]+$/.test(value) ? value : null;
  };

  async function updatePendingDrone(droneIdRaw: string, patch: PendingDronePatch) {
    const registry = await loadRegistry();
    const found = findDroneEntryByIdentity({ drones: registry?.pending }, droneIdRaw);
    const droneId = normalizeDroneIdentity(found?.entry?.id ?? found?.key);
    if (!droneId) return;
    await commitDroneMetadataPatch({
      droneId,
      state: 'pending',
      eventType: 'drone.provisioning.updated',
      payload: { phase: patch.phase ?? null },
      transform: (pending) => ({
        ...pending,
        ...patch,
        updatedAt: patch.updatedAt ?? deps.nowIso(),
      }),
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
    const seedAgentPermissionMode =
      seedRaw?.agentPermissionMode === 'read-only' ||
      seedRaw?.agentPermissionMode === 'workspace-write'
        ? seedRaw.agentPermissionMode
        : null;
    const seedApprovalPolicy =
      seedRaw?.approvalPolicy === 'agent-decides' || seedRaw?.approvalPolicy === 'never'
        ? seedRaw.approvalPolicy
        : null;
    const hasSeedModel = Object.prototype.hasOwnProperty.call(seedRaw, 'model');
    const hasSeedProvider = Object.prototype.hasOwnProperty.call(seedRaw, 'provider');
    const hasSeedReasoning = Object.prototype.hasOwnProperty.call(seedRaw, 'reasoning');
    if (
      !seedAgent &&
      !hasSeedProvider &&
      !hasSeedModel &&
      !hasSeedReasoning &&
      !seedAgentPermissionMode &&
      !seedApprovalPolicy
    )
      return;

    const chatName = deps.normalizeChatName(seedRaw?.chatName ?? 'default');
    const seedModel = deps.normalizeChatModel(seedRaw?.model);
    const seedProvider = String(seedRaw?.provider ?? '').trim().toLowerCase();
    const seedReasoning = normalizeChatReasoning(seedRaw?.reasoning);
    droneEntry.chats = droneEntry.chats && typeof droneEntry.chats === 'object' ? droneEntry.chats : {};
    const entry =
      droneEntry.chats[chatName] && typeof droneEntry.chats[chatName] === 'object'
        ? droneEntry.chats[chatName]
        : { createdAt: deps.nowIso() };
    if (!(typeof entry.createdAt === 'string' && entry.createdAt.trim())) entry.createdAt = deps.nowIso();
    if (seedAgent) entry.agent = seedAgent;
    if (hasSeedProvider && seedAgent?.kind === 'native' && seedProvider) {
      entry.nativeProvider = seedProvider;
    } else if (hasSeedProvider) {
      delete entry.nativeProvider;
    }
    if (seedAgentPermissionMode) entry.agentPermissionMode = seedAgentPermissionMode;
    else delete entry.agentPermissionMode;
    if (seedApprovalPolicy) entry.approvalPolicy = seedApprovalPolicy;
    else delete entry.approvalPolicy;
    if (hasSeedModel) {
      if (seedModel) entry.model = seedModel;
      else delete entry.model;
    }
    if (hasSeedReasoning) {
      if (seedReasoning) entry.reasoning = seedReasoning;
      else delete entry.reasoning;
    }
    droneEntry.chats[chatName] = entry;
  }

  async function provisionDroneFromPending(name: string) {
    const regAny: any = await loadRegistry();
    const canonical = await getCanonicalDroneLifecycle(name);
    if (canonical?.state === 'real') return;
    const pending = canonical?.state === 'pending' ? canonical.lifecycle : regAny?.pending?.[name];
    if (!pending) return;
    const pendingDroneId = normalizeDroneIdentity(pending?.id);
    if (!pendingDroneId) {
      await updatePendingDrone(name, { phase: 'error', message: 'Failed to start', error: 'missing pending drone identity' });
      return;
    }
    if (regAny?.drones?.[name]) return;

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
    const latestCanonicalPending = await getCanonicalDroneLifecycle(pendingDroneId);
    const latestPendingForCreate: any = latestCanonicalPending?.state === 'pending' ? latestCanonicalPending.lifecycle : pending;
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
      const registrySnapshot = await loadRegistry();
      const cloneSourceLatest = cloneFrom ? findDroneEntryByIdentity(registrySnapshot, cloneFrom)?.entry : null;
      await commitDroneMetadataPatch({
        droneId: pendingDroneId,
        state: 'real',
        eventType: 'drone.provisioning.promoted',
        transform: (current) => {
        const pendingLatest = latestPendingForCreate ?? pending;
        const fleetMeta = pendingLatest?.fleet && typeof pendingLatest.fleet === 'object' ? pendingLatest.fleet : null;
        const workflowChild =
          pendingLatest?.workflowChild && typeof pendingLatest.workflowChild === 'object'
            ? pendingLatest.workflowChild
            : null;
        const environment = pendingLatest?.environment ?? null;
        const d = { ...current };
        deps.applyPendingDisplayNameToProvisionedDrone(d, pendingLatest, displayName);
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
            assigned: fleetMeta.assigned,
          });
        }
        if (workflowChild) d.workflowChild = { ...workflowChild };
        if (environment && typeof environment === 'object') {
          d.environment = {
            vars: normalizeEnvVarMap((environment as any)?.vars),
            useRepoVars: (environment as any)?.useRepoVars === true,
            disabledRepoKeys: normalizeDisabledRepoKeys((environment as any)?.disabledRepoKeys),
            updatedAt: typeof (environment as any)?.updatedAt === 'string' ? String((environment as any).updatedAt).trim() || null : null,
          };
        }
        if (typeof pendingLatest?.agentsMdOverride === 'string') {
          d.agentsMdOverride = pendingLatest.agentsMdOverride;
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
        return d;
        },
      });
      const registryAfterPromotion: any = await loadRegistry();
      const foundAfterPromotion = findDroneEntryByIdentity(registryAfterPromotion, pendingDroneId);
      if (foundAfterPromotion) {
        materializeSeedChatConfigOnDroneEntry(foundAfterPromotion.entry, latestPendingForCreate?.seed);
        const seedChatName = deps.normalizeChatName(latestPendingForCreate?.seed?.chatName ?? 'default');
        const seedChat = foundAfterPromotion.entry?.chats?.[seedChatName];
        if (seedChat) {
          if ((globalThis as any).Bun) {
            await updateRegistry((registry: any) => {
              const found = findDroneEntryByIdentity(registry, pendingDroneId);
              if (!found) return;
              found.entry.chats = found.entry.chats ?? {};
              found.entry.chats[seedChatName] = seedChat;
            });
          } else {
            await upsertChatInStore({ droneId: pendingDroneId, chatName: seedChatName, chatEntry: seedChat });
          }
        }
      }
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

        await commitDroneMetadataPatch({
          droneId: pendingDroneId,
          state: 'real',
          eventType: 'drone.repository.seeded',
          transform: (drone) => ({
            ...drone,
            repoPath: repoRoot,
            cwd: '/work/repo',
            repo: {
              ...(drone.repo && typeof drone.repo === 'object' ? drone.repo : {}),
              dest: '/work/repo',
              branch: 'dvm/work',
              baseRef,
              seededAt: deps.nowIso(),
            },
          }),
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

    const transitionEntry = latestPendingForCreate ?? pending ?? null;
    const pendingTransition = {
      seed: transitionEntry?.seed ?? null,
      startupQueuedPrompts: deps.normalizePendingStartupPrompts((transitionEntry as any)?.startupQueuedPrompts),
      createdAt: typeof transitionEntry?.createdAt === 'string' && transitionEntry.createdAt.trim()
        ? String(transitionEntry.createdAt)
        : deps.nowIso(),
    };
    if ((globalThis as any).Bun) {
      await updateRegistry((registry: any) => {
        if (registry?.pending?.[name]) delete registry.pending[name];
      });
    }
    const seed = pendingTransition?.seed ?? null;
    const startupQueuedPrompts = Array.isArray(pendingTransition?.startupQueuedPrompts)
      ? (pendingTransition.startupQueuedPrompts as PendingStartupPrompt[])
      : [];
    const seedChatName = deps.normalizeChatName(seed?.chatName ?? 'default');
    const seedAgent = deps.parseSeedAgent(seed?.agent);
    const seedProvider = String(seed?.provider ?? '').trim().toLowerCase();
    const seedModel = deps.normalizeChatModel(seed?.model);
    const hasSeedReasoning = Object.prototype.hasOwnProperty.call(seed ?? {}, 'reasoning');
    const seedReasoning = normalizeChatReasoning(seed?.reasoning);
    const seedAgentPermissionMode =
      seed?.agentPermissionMode === 'read-only' ||
      seed?.agentPermissionMode === 'workspace-write'
        ? seed.agentPermissionMode
        : null;
    const seedApprovalPolicy =
      seed?.approvalPolicy === 'agent-decides' || seed?.approvalPolicy === 'never'
        ? seed.approvalPolicy
        : null;
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
      try {
        const registryForClone: any = await loadRegistry();
        const srcFound = findDroneEntryByIdentity(registryForClone, cloneFrom);
        const dstFound = findDroneEntryByIdentity(registryForClone, pendingDroneId);
        if (srcFound && dstFound) {
          const src = srcFound.entry;
          const dst = dstFound.entry;
          const srcChats = src?.chats && typeof src.chats === 'object' ? src.chats : null;
          if (srcChats) {
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
              cloned[String(chatName)] = entry;
              if (!(globalThis as any).Bun) {
                await upsertChatInStore({ droneId: pendingDroneId, chatName: String(chatName), chatEntry: entry });
              }
            }
            if ((globalThis as any).Bun) {
              await updateRegistry((reg3Any: any) => {
                const latestDst = findDroneEntryByIdentity(reg3Any, pendingDroneId);
                if (!latestDst) return;
                latestDst.entry.chats = { ...(latestDst.entry.chats ?? {}), ...cloned };
              });
            }
          }
        }
      } catch {
        // ignore (best-effort)
      }
    }

    let startupQueuedPromptChats: string[] = [];
    if (queuedPromptsForMaterialization.length > 0) {
      if ((globalThis as any).Bun) startupQueuedPromptChats = await updateRegistry((reg4Any: any) => {
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
            if (seedAgent?.kind === 'native' && seedProvider) entry.nativeProvider = seedProvider;
            else delete entry.nativeProvider;
            if (seedModel) entry.model = seedModel;
            else delete entry.model;
          }
          if (chatName === seedChatName && Object.prototype.hasOwnProperty.call(seed ?? {}, 'reasoning')) {
            if (seedReasoning) entry.reasoning = seedReasoning;
            else delete entry.reasoning;
          }
          if (chatName === seedChatName && seedAgentPermissionMode) {
            entry.agentPermissionMode = seedAgentPermissionMode;
          }
          if (chatName === seedChatName && seedApprovalPolicy) {
            entry.approvalPolicy = seedApprovalPolicy;
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
      else {
        const queue = getPromptQueueRepository();
        if (!queue) throw new Error('canonical prompt queue is unavailable');
        const touched = new Set<string>();
        for (const queued of queuedPromptsForMaterialization) {
          const chatName = deps.normalizeChatName(queued.chatName);
          const row = deps.startupPromptToPendingPrompt(queued);
          await deps.ensureChatEntry({ droneId: pendingDroneId, chatName });
          await queue.enqueue({ droneId: pendingDroneId, chatName, prompt: row });
          touched.add(chatName);
        }
        startupQueuedPromptChats = [...touched];
      }
    }

    if (
      seed &&
      (seedAgent ||
        seedModel ||
        hasSeedReasoning ||
        seedAgentPermissionMode ||
        seedApprovalPolicy ||
        seedPrompt)
    ) {
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
        if (
          seedAgent ||
          seedModel ||
          hasSeedReasoning ||
          seedAgentPermissionMode ||
          seedApprovalPolicy
        ) {
          await deps.ensureChatEntry({ droneId: pendingDroneId, chatName });
          await deps.setChatAgentConfig({
            droneId: pendingDroneId,
            chatName,
            ...(seedAgent ? { agent: seedAgent } : {}),
            setModel: true,
            model: seedModel,
            ...(hasSeedReasoning ? { setReasoning: true, reasoning: seedReasoning } : {}),
            ...(seedAgentPermissionMode ? { setAgentPermissionMode: true, agentPermissionMode: seedAgentPermissionMode } : {}),
            ...(seedApprovalPolicy
              ? { setApprovalPolicy: true, approvalPolicy: seedApprovalPolicy }
              : {}),
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
