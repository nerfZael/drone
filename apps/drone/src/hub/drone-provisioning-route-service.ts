import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AgentApprovalPolicy, AgentPermissionMode } from './chat-types';
import { parseDroneAgentsMdOverride } from './agents-config';
import { readJsonBody, sendJson as json } from './hub-http';
import { getPromptQueueRepository } from '../host/prompt-queue-repository';
import type { DroneRuntime } from '../host/runtime';
import type { ChatImageAttachment } from './chat-attachments';
import type { PendingStartupPrompt } from './drone-pending-state';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './routes/legacy-route';

type RepoBranchSourceMode = 'host' | 'remote';

import type { DroneProvisioningRouteDependencies } from './routes/drone-provisioning-routes';

function assertSeedApprovalPolicySupported(
  policy: AgentApprovalPolicy,
  agent: any,
): void {
  if (policy === 'ask') return;
  if (!agent) throw new Error('approval policy requires a native or Codex seed agent');
  if (policy === 'auto') {
    if (agent.kind === 'builtin' && agent.id === 'codex') return;
    throw new Error('auto approval policy is only available for Codex seed agents');
  }
  if (agent.kind === 'native' || (agent.kind === 'builtin' && agent.id === 'codex')) return;
  throw new Error('approval policies are available for native and Codex seed agents only');
}

type InitialPromptQueueReservation = {
  droneId: string;
  chatName: string;
  promptId: string;
  at: string;
  prompt: string;
  cwd?: string | null;
};

type InitialSeedPromptPlan = {
  seedPrompt: string;
  seedPromptId: string;
  queueSeedPrompt: boolean;
  startupQueuedPrompts: PendingStartupPrompt[];
  shouldReserveQueuePosition: boolean;
};

function attachedPromptFallback(attachments: readonly ChatImageAttachment[]): string {
  return `Attached ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`;
}

function buildInitialSeedPromptPlan(opts: {
  seedPromptRaw: string;
  seedAttachments: ChatImageAttachment[];
  seedPromptIdRaw?: string;
  seedChatName: string;
  seedSubmittedAt: string;
  seedCwdRaw?: string | null;
  createAsDraft: boolean;
}): InitialSeedPromptPlan {
  const seedPrompt =
    opts.seedPromptRaw.trim() ||
    (opts.seedAttachments.length > 0 ? attachedPromptFallback(opts.seedAttachments) : '');
  const seedPromptId = seedPrompt
    ? String(opts.seedPromptIdRaw ?? '').trim() || crypto.randomBytes(9).toString('hex')
    : '';
  const queueSeedPrompt = opts.createAsDraft || opts.seedAttachments.length > 0;
  const startupQueuedPrompts =
    queueSeedPrompt && seedPrompt
      ? [
          {
            id: seedPromptId,
            chatName: opts.seedChatName,
            at: opts.seedSubmittedAt,
            prompt: seedPrompt,
            ...(opts.seedAttachments.length > 0 ? { attachments: opts.seedAttachments } : {}),
            ...(opts.seedAttachments.length > 0 ? { deliveryMode: 'asap' as const } : {}),
            ...(opts.seedCwdRaw ? { cwd: String(opts.seedCwdRaw) } : {}),
            state: 'queued' as const,
            updatedAt: opts.seedSubmittedAt,
          },
        ]
      : [];
  return {
    seedPrompt,
    seedPromptId,
    queueSeedPrompt,
    startupQueuedPrompts,
    shouldReserveQueuePosition: Boolean(
      seedPrompt && seedPromptId && opts.seedAttachments.length === 0,
    ),
  };
}

function buildInitialSeedConfig(opts: {
  seedPrompt: string;
  seedPromptId: string;
  queueSeedPrompt: boolean;
  seedChatName: string;
  seedSubmittedAt: string;
  seedProvider: string;
  seedModel: string | null;
  seedReasoning: string | null;
  seedAgentPermissionMode: AgentPermissionMode;
  seedApprovalPolicy: AgentApprovalPolicy;
  seedCwdRaw?: string | null;
  seedAgent: any;
}) {
  if (
    !(
      opts.seedPrompt ||
      opts.seedAgent ||
      opts.seedProvider ||
      opts.seedModel ||
      opts.seedReasoning ||
      opts.seedAgentPermissionMode !== 'execute' ||
      opts.seedApprovalPolicy !== 'ask'
    )
  ) {
    return undefined;
  }
  return {
    chatName: opts.seedChatName,
    ...(opts.seedProvider ? { provider: opts.seedProvider } : {}),
    ...(opts.seedModel ? { model: opts.seedModel } : {}),
    ...(opts.seedReasoning ? { reasoning: opts.seedReasoning } : {}),
    ...(opts.seedAgentPermissionMode !== 'execute'
      ? { agentPermissionMode: opts.seedAgentPermissionMode }
      : {}),
    ...(opts.seedApprovalPolicy !== 'ask' ? { approvalPolicy: opts.seedApprovalPolicy } : {}),
    ...(!opts.queueSeedPrompt && opts.seedPromptId ? { promptId: opts.seedPromptId } : {}),
    ...(!opts.queueSeedPrompt && opts.seedPrompt ? { prompt: opts.seedPrompt } : {}),
    ...(!opts.queueSeedPrompt && opts.seedPrompt ? { submittedAt: opts.seedSubmittedAt } : {}),
    ...(opts.seedCwdRaw ? { cwd: String(opts.seedCwdRaw) } : {}),
    ...(opts.seedAgent ? { agent: opts.seedAgent } : {}),
  };
}

export async function reserveInitialPromptQueuePosition(
  opts: InitialPromptQueueReservation,
): Promise<void> {
  const queue = getPromptQueueRepository();
  if (!queue) return;
  await queue.enqueue({
    droneId: opts.droneId,
    chatName: opts.chatName,
    prompt: {
      id: opts.promptId,
      at: opts.at,
      prompt: opts.prompt,
      ...(typeof opts.cwd === 'string' || opts.cwd === null ? { cwd: opts.cwd } : {}),
      state: 'queued',
      updatedAt: opts.at,
    },
  });
}

export class DroneProvisioningService {
  readonly handle: LegacyRouteHandler;

  constructor(deps: DroneProvisioningRouteDependencies) {
    this.handle = createDroneProvisioningServiceHandler(deps);
  }
}

function createDroneProvisioningServiceHandler(
  deps: DroneProvisioningRouteDependencies,
): LegacyRouteHandler {
  const {
    allocateUntitledDisplayName,
    assertReadOnlySupportedForAgent,
    buildAssistantDroneSummariesFromRegistry,
    buildDroneDockerSizeSummary,
    buildDroneRegistrySnapshot,
    canonicalRepositoriesMap,
    commitDroneMetadataPatch,
    createRequestTimer,
    deriveCanonicalCreatedDroneEnvironmentConfig,
    deriveCreatedDroneEnvironmentConfig,
    droneChatSseClients,
    droneChatSseLastByKey,
    droneDisplayNameExists,
    droneRegistrySseClients,
    enqueueProvisioning,
    ensureCanonicalGroup,
    resolveCanonicalGroupReference,
    findDroneEntryByIdentity,
    findDroneIdByRef,
    gitResolveRemoteBranchForCreate,
    getDroneRegistrySseLastSnapshot,
    isSafePromptId,
    loadCanonicalActiveModel,
    loadCanonicalLifecycleModel,
    loadRegistry,
    logSlowHubRequest,
    makeDroneIdentity,
    normalizeChatImageAttachments,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeDroneDisplayName,
    normalizeDroneRuntime,
    normalizeSubmittedAtIso,
    notifyCanonicalDroneRegistryWrite,
    nowIso,
    parseAgentPermissionModeForUpdate,
    parseAgentApprovalPolicyForUpdate,
    parseChatModelForUpdate,
    parseCreateRuntime,
    parseDraftFlag,
    parsePersistVolume,
    parseRemoteBranchName,
    parseRepoBranchSourceMode,
    parseSeedAgent,
    refreshDroneChatEventSnapshot,
    refreshDroneRegistryBroadcasterSnapshot,
    resolveDroneOrRespond,
    resolveEffectiveLlmProvider,
    resolveStableDroneOrPendingIdFromRef,
    scheduleDroneRegistryBroadcasterRefresh,
    scheduleDroneStatusRefresh,
    setFleetActorConfig,
    startDroneChatBroadcaster,
    startDroneRegistryBroadcaster,
    stopDroneChatBroadcasterIfIdle,
    stopDroneRegistryBroadcasterIfIdle,
    upsertCanonicalDroneLifecycle,
    upsertCanonicalDroneLifecycleBatch,
    writeHubSseEvent,
  } = deps;
  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones
      // Creates a new drone (container or host runtime, like `drone create`).
      if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'drones') {
        const timer = createRequestTimer();
        let body: any = null;
        try {
          body = await readJsonBody(req);
          timer.mark('readBody');
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const nameRaw = body?.name;
        const createAsDraft = parseDraftFlag(body?.draft ?? body?.isDraft);

        const groupRefRaw = typeof body?.groupId === 'string'
          ? body.groupId.trim()
          : typeof body?.group === 'string'
            ? body.group.trim()
            : '';
        const referencedGroup = body?.groupId ? await resolveCanonicalGroupReference(groupRefRaw) : null;
        timer.mark('resolveGroup');
        if (body?.groupId && !referencedGroup) {
          json(res, 404, { ok: false, error: `unknown group: ${groupRefRaw}` });
          return;
        }
        const group = referencedGroup?.name ?? (groupRefRaw || null);
        const repoRaw = typeof body?.repoPath === 'string' ? body.repoPath.trim() : '';
        let repoPath = repoRaw ? repoRaw : '';
        let repoBranchSource: RepoBranchSourceMode = 'host';
        try {
          repoBranchSource = parseRepoBranchSourceMode(body?.repoBranchSource);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        let remoteBranch = parseRemoteBranchName(body?.remoteBranch);
        const build = body?.build === true;
        const containerPortRaw = body?.containerPort;
        let runtime: DroneRuntime = 'container';
        try {
          runtime = parseCreateRuntime(body?.runtime);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        let persistVolume: boolean | undefined;
        try {
          persistVolume = parsePersistVolume(body?.persistVolume);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        if (runtime === 'host' && persistVolume === false) {
          json(res, 400, {
            ok: false,
            error: 'persistVolume is only supported for container runtime drones',
          });
          return;
        }
        const hasAgentsMdOverride = Object.prototype.hasOwnProperty.call(body ?? {}, 'agentsMd');
        let agentsMdOverride: string | undefined;
        if (hasAgentsMdOverride) {
          try {
            agentsMdOverride = parseDroneAgentsMdOverride(body?.agentsMd);
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
          if (runtime !== 'container' || !repoPath) {
            json(res, 400, {
              ok: false,
              error: 'agentsMd is only supported for repo-attached container drones',
            });
            return;
          }
        }
        timer.mark('parseBasics');

        const preRegAny: any = await loadCanonicalLifecycleModel();
        timer.mark('loadLifecycle');
        let name = '';
        try {
          name = normalizeDroneDisplayName(nameRaw);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        if (!name) name = allocateUntitledDisplayName(preRegAny);
        if (droneDisplayNameExists(preRegAny, name)) {
          json(res, 409, { ok: false, error: `drone already exists: ${name}` });
          return;
        }

        const seedPromptRaw = String(
          body?.seedPrompt ?? body?.initialMessage ?? body?.seed?.prompt ?? '',
        ).trim();
        let seedAttachments: ChatImageAttachment[] = [];
        try {
          seedAttachments = normalizeChatImageAttachments(
            body?.seedAttachments ?? body?.seed?.attachments,
          );
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const seedChatName = normalizeChatName(
          body?.seedChat ?? body?.seed?.chatName ?? body?.seed?.chat ?? 'default',
        );
        const seedAgent = parseSeedAgent(body?.seedAgent ?? body?.agent ?? body?.seed?.agent);
        let seedAgentPermissionMode: AgentPermissionMode = 'execute';
        let seedApprovalPolicy: AgentApprovalPolicy = 'ask';
        try {
          const seedPermissionRaw =
            body?.seedAgentPermissionMode ??
            body?.agentPermissionMode ??
            body?.seed?.agentPermissionMode;
          seedAgentPermissionMode =
            seedPermissionRaw == null || String(seedPermissionRaw).trim() === ''
              ? 'execute'
              : parseAgentPermissionModeForUpdate(seedPermissionRaw);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        try {
          const seedApprovalRaw =
            body?.seedApprovalPolicy ?? body?.approvalPolicy ?? body?.seed?.approvalPolicy;
          seedApprovalPolicy =
            seedApprovalRaw == null || String(seedApprovalRaw).trim() === ''
              ? 'ask'
              : parseAgentApprovalPolicyForUpdate(seedApprovalRaw);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const seedSubmittedAt = normalizeSubmittedAtIso(
          body?.seedSubmittedAt ??
            body?.submittedAt ??
            body?.seed?.submittedAt ??
            body?.seed?.clientSubmittedAt,
        );
        const seedPromptIdRaw =
          typeof body?.seedPromptId === 'string'
            ? body.seedPromptId.trim()
            : typeof body?.seed?.promptId === 'string'
              ? body.seed.promptId.trim()
              : '';
        const seedPromptForIdValidation =
          seedPromptRaw ||
          (seedAttachments.length > 0 ? attachedPromptFallback(seedAttachments) : '');
        if (seedPromptForIdValidation && seedPromptIdRaw && !isSafePromptId(seedPromptIdRaw)) {
          json(res, 400, { ok: false, error: 'invalid seedPromptId' });
          return;
        }
        let seedModel: string | null = null;
        try {
          seedModel = parseChatModelForUpdate(body?.seedModel ?? body?.seed?.model);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const seedProviderRaw = String(
          body?.seedProvider ?? body?.seed?.provider ?? '',
        ).trim().toLowerCase();
        let seedProvider =
          seedProviderRaw === 'openai' ||
          seedProviderRaw === 'gemini' ||
          seedProviderRaw === 'codex'
            ? seedProviderRaw
            : '';
        if (seedProviderRaw && !seedProvider) {
          json(res, 400, { ok: false, error: 'invalid Built-in model provider' });
          return;
        }
        if (seedProvider && seedAgent?.kind !== 'native') {
          json(res, 400, {
            ok: false,
            error: 'seedProvider is only supported for the Built-in agent',
          });
          return;
        }
        if (!seedProvider && seedAgent?.kind === 'native') {
          seedProvider = String((await resolveEffectiveLlmProvider()).provider ?? '').trim();
        }
        const seedReasoning = normalizeChatReasoning(body?.seedReasoning ?? body?.seed?.reasoning);
        if (
          seedReasoning &&
          !(
            seedAgent?.kind === 'native' ||
            (seedAgent?.kind === 'builtin' &&
              (seedAgent.id === 'codex' || seedAgent.id === 'blip'))
          )
        ) {
          json(res, 400, {
            ok: false,
            error: 'reasoning selection is currently supported for Built-in, Codex, and Blip seed agents',
          });
          return;
        }
        if (seedAgentPermissionMode !== 'execute') {
          try {
            if (!seedAgent)
              throw new Error('agent access controls require a native, Codex, or Blip seed agent');
            assertReadOnlySupportedForAgent(seedAgent);
          } catch (e: any) {
            json(res, Number(e?.statusCode ?? 0) || 400, {
              ok: false,
              error: e?.message ?? String(e),
            });
            return;
          }
        }
        try {
          assertSeedApprovalPolicySupported(seedApprovalPolicy, seedAgent);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const seedCwdRaw =
          typeof body?.seedCwd === 'string'
            ? body.seedCwd
            : typeof body?.seed?.cwd === 'string'
              ? body.seed.cwd
              : null;
        const cloneFromRaw = typeof body?.cloneFrom === 'string' ? body.cloneFrom.trim() : '';
        const cloneFrom = cloneFromRaw ? cloneFromRaw : null;
        const cloneChats = body?.cloneChats !== false;
        const cloneFromFound = cloneFrom ? findDroneIdByRef(preRegAny, cloneFrom) : null;
        const cloneFromId =
          cloneFromFound && cloneFromFound.kind === 'real' ? cloneFromFound.id : null;
        if (cloneFrom && !cloneFromId) {
          json(res, 404, { ok: false, error: `unknown cloneFrom drone: ${cloneFrom}` });
          return;
        }
        const fleetParentRaw =
          typeof body?.fleetParentId === 'string'
            ? body.fleetParentId.trim()
            : typeof body?.parentDroneId === 'string'
              ? body.parentDroneId.trim()
              : typeof body?.fleet?.createdBy === 'string'
                ? body.fleet.createdBy.trim()
                : '';
        const fleetParentFound = fleetParentRaw
          ? findDroneIdByRef(preRegAny, fleetParentRaw)
          : null;
        const fleetParentId = fleetParentFound
          ? resolveStableDroneOrPendingIdFromRef(preRegAny, fleetParentRaw)
          : null;
        if (fleetParentRaw && !fleetParentId) {
          json(res, 404, { ok: false, error: `unknown fleet parent drone: ${fleetParentRaw}` });
          return;
        }
        const repoSeedFromDroneRaw =
          typeof body?.repoSeedFromDroneId === 'string' ? body.repoSeedFromDroneId.trim() : '';
        const repoSeedFromDroneFound = repoSeedFromDroneRaw
          ? findDroneIdByRef(preRegAny, repoSeedFromDroneRaw)
          : null;
        const repoSeedFromDroneId =
          repoSeedFromDroneFound?.kind === 'real' ? repoSeedFromDroneFound.id : null;
        if (repoSeedFromDroneRaw && !repoSeedFromDroneId) {
          json(res, 404, {
            ok: false,
            error: `unknown repo seed source drone: ${repoSeedFromDroneRaw}`,
          });
          return;
        }
        const cloneFromEntry = cloneFromId
          ? findDroneEntryByIdentity(preRegAny, cloneFromId)?.entry
          : null;
        const cloneFromRuntime = normalizeDroneRuntime((cloneFromEntry as any)?.runtime);
        if (cloneFrom && runtime === 'container' && cloneFromRuntime !== 'container') {
          json(res, 409, {
            ok: false,
            error: `clone source must use container runtime: ${cloneFrom}`,
          });
          return;
        }
        const cloneFromContainerPortRaw = Number((cloneFromEntry as any)?.containerPort ?? NaN);
        const cloneFromContainerPort =
          Number.isFinite(cloneFromContainerPortRaw) &&
          cloneFromContainerPortRaw > 0 &&
          Math.floor(cloneFromContainerPortRaw) === cloneFromContainerPortRaw
            ? cloneFromContainerPortRaw
            : null;
        const containerPort =
          containerPortRaw == null ? (cloneFromContainerPort ?? 7777) : Number(containerPortRaw);
        if (
          !Number.isFinite(containerPort) ||
          containerPort <= 0 ||
          Math.floor(containerPort) !== containerPort
        ) {
          json(res, 400, { ok: false, error: 'invalid containerPort' });
          return;
        }
        if (repoPath && repoBranchSource === 'remote' && runtime === 'host' && !cloneFrom) {
          json(res, 409, {
            ok: false,
            error: 'remote branch checkout is only available for container runtime drones',
            code: 'remote_branch_requires_container_runtime',
          });
          return;
        }
        if (repoPath && repoBranchSource === 'remote' && !cloneFrom) {
          if (!remoteBranch) {
            json(res, 400, {
              ok: false,
              error: 'missing remoteBranch for repoBranchSource=remote',
            });
            return;
          }
          try {
            const resolvedRemote = await gitResolveRemoteBranchForCreate(repoPath, remoteBranch);
            repoPath = resolvedRemote.repoRoot;
            remoteBranch = resolvedRemote.remoteBranch;
          } catch (e: any) {
            json(res, 409, {
              ok: false,
              error: e?.message ?? String(e),
              code: 'remote_branch_unavailable',
            });
            return;
          }
        }
        timer.mark('validateRequest');
        const createdEnvironment = await deriveCanonicalCreatedDroneEnvironmentConfig(preRegAny, {
          repoPath,
          runtime,
        });
        timer.mark('deriveEnvironment');
        const droneId = makeDroneIdentity();
        if (referencedGroup && referencedGroup.repoPath !== repoPath) {
          json(res, 409, { ok: false, error: 'group belongs to a different repository' });
          return;
        }
        const canonicalGroup = group
          ? referencedGroup ?? await ensureCanonicalGroup(group, repoPath)
          : null;
        timer.mark('ensureGroup');
        if (droneDisplayNameExists(preRegAny, name)) {
          json(res, 409, { ok: false, error: `drone already exists: ${name}` });
          return;
        }
        const at = nowIso();
        const initialPrompt = buildInitialSeedPromptPlan({
          seedPromptRaw,
          seedAttachments,
          seedPromptIdRaw,
          seedChatName,
          seedSubmittedAt,
          seedCwdRaw,
          createAsDraft,
        });
        const { queueSeedPrompt, seedPrompt, seedPromptId, startupQueuedPrompts } = initialPrompt;
        const seedConfig = buildInitialSeedConfig({
          seedPrompt,
          seedPromptId,
          queueSeedPrompt,
          seedChatName,
          seedSubmittedAt,
          seedProvider,
          seedModel,
          seedReasoning,
          seedAgentPermissionMode,
          seedApprovalPolicy,
          seedCwdRaw,
          seedAgent,
        });
        timer.mark('buildPending');
        try {
          await upsertCanonicalDroneLifecycle('pending', droneId, {
            id: droneId,
            name,
            ...(createAsDraft ? { draft: true } : {}),
            group: group ?? undefined,
            groupId: canonicalGroup?.id,
            repoPath,
            runtime,
            ...(hasAgentsMdOverride ? { agentsMdOverride } : {}),
            containerPort,
            build,
            createdAt: at,
            updatedAt: at,
            phase: createAsDraft ? 'draft' : 'starting',
            message: createAsDraft ? 'Draft' : 'Starting…',
            environment: createdEnvironment,
            ...(startupQueuedPrompts.length > 0 ? { startupQueuedPrompts } : {}),
            ...(runtime === 'container' && typeof persistVolume === 'boolean'
              ? { persistVolume }
              : {}),
            ...(repoPath && !cloneFrom ? { repoSeedSource: repoBranchSource } : {}),
            ...(repoPath && repoBranchSource === 'remote' && remoteBranch && !cloneFrom
              ? { repoSeedRemoteBranch: remoteBranch }
              : {}),
            ...(repoPath && repoSeedFromDroneId && !cloneFrom ? { repoSeedFromDroneId } : {}),
            ...(cloneFromId ? { cloneFrom: cloneFromId, cloneChats: Boolean(cloneChats) } : {}),
            ...(fleetParentId
              ? {
                  fleet: setFleetActorConfig(
                    {},
                    {
                      createdBy: fleetParentId,
                      createdAt: at,
                      assigned: [],
                    },
                  ).fleet,
                }
              : {}),
            ...(seedConfig ? { seed: seedConfig } : {}),
          });
        } catch (error: any) {
          if (/display name already exists/i.test(String(error?.message ?? ''))) {
            json(res, 409, { ok: false, error: `drone already exists: ${name}` });
            return;
          }
          throw error;
        }
        timer.mark('persistPending');
        if (initialPrompt.shouldReserveQueuePosition) {
          await reserveInitialPromptQueuePosition({
            droneId,
            chatName: seedChatName,
            promptId: seedPromptId,
            at: seedSubmittedAt,
            prompt: seedPrompt,
            ...(seedCwdRaw ? { cwd: String(seedCwdRaw) } : {}),
          });
        }
        timer.mark('reservePrompt');
        notifyCanonicalDroneRegistryWrite();

        if (!createAsDraft) enqueueProvisioning(droneId);
        timer.mark('scheduleProvisioning');
        timer.setHeader(res);
        logSlowHubRequest('drone create', timer, {
          status: createAsDraft ? 201 : 202,
          droneId,
          runtime,
          draft: createAsDraft,
        });

        json(res, createAsDraft ? 201 : 202, {
          ok: true,
          id: droneId,
          name,
          group,
          groupId: canonicalGroup?.id ?? null,
          runtime,
          phase: createAsDraft ? 'draft' : 'starting',
          draft: createAsDraft,
          ...(seedPromptId
            ? {
                initialMessage: {
                  chat: seedChatName,
                  promptId: seedPromptId,
                  pendingState: 'queued',
                  status: 'queued',
                },
              }
            : {}),
        });
        return;
      }

      // POST /api/drones/batch
      // Enqueue multiple drone creations in one request (backend-driven).
      if (
        method === 'POST' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[2] === 'batch'
      ) {
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const listRaw = body?.drones ?? body?.items ?? body?.requests;
        const list: any[] = Array.isArray(listRaw) ? listRaw : [];
        if (!Array.isArray(listRaw) || list.length === 0) {
          json(res, 400, { ok: false, error: 'missing drones (expected non-empty array)' });
          return;
        }

        const preflightByIndex: Array<{
          repoPath: string;
          repoBranchSource: RepoBranchSourceMode;
          remoteBranch: string;
          error: string | null;
          status?: number;
        }> = Array.from({ length: list.length }, () => ({
          repoPath: '',
          repoBranchSource: 'host',
          remoteBranch: '',
          error: null,
        }));
        for (const [index, raw] of list.entries()) {
          const repoRaw = typeof raw?.repoPath === 'string' ? raw.repoPath.trim() : '';
          const repoPath = repoRaw ? repoRaw : '';
          const cloneFromRaw = typeof raw?.cloneFrom === 'string' ? raw.cloneFrom.trim() : '';
          let runtime: DroneRuntime = 'container';
          try {
            runtime = parseCreateRuntime(raw?.runtime);
          } catch (e: any) {
            preflightByIndex[index] = {
              repoPath,
              repoBranchSource: 'host',
              remoteBranch: '',
              error: e?.message ?? String(e),
              status: 400,
            };
            continue;
          }
          let repoBranchSource: RepoBranchSourceMode = 'host';
          try {
            repoBranchSource = parseRepoBranchSourceMode(raw?.repoBranchSource);
          } catch (e: any) {
            preflightByIndex[index] = {
              repoPath,
              repoBranchSource: 'host',
              remoteBranch: '',
              error: e?.message ?? String(e),
              status: 400,
            };
            continue;
          }
          let remoteBranch = parseRemoteBranchName(raw?.remoteBranch);
          if (!repoPath || cloneFromRaw) {
            preflightByIndex[index] = {
              repoPath,
              repoBranchSource,
              remoteBranch,
              error: null,
            };
            continue;
          }

          if (repoBranchSource === 'remote' && runtime === 'host') {
            preflightByIndex[index] = {
              repoPath,
              repoBranchSource,
              remoteBranch,
              error: 'remote branch checkout is only available for container runtime drones',
              status: 409,
            };
            continue;
          }

          if (repoBranchSource === 'remote') {
            if (!remoteBranch) {
              preflightByIndex[index] = {
                repoPath,
                repoBranchSource,
                remoteBranch,
                error: 'missing remoteBranch for repoBranchSource=remote',
                status: 400,
              };
              continue;
            }
            try {
              const resolvedRemote = await gitResolveRemoteBranchForCreate(repoPath, remoteBranch);
              preflightByIndex[index] = {
                repoPath: resolvedRemote.repoRoot,
                repoBranchSource,
                remoteBranch: resolvedRemote.remoteBranch,
                error: null,
              };
            } catch (e: any) {
              preflightByIndex[index] = {
                repoPath,
                repoBranchSource,
                remoteBranch,
                error: e?.message ?? String(e),
                status: 409,
              };
            }
            continue;
          }

          preflightByIndex[index] = {
            repoPath,
            repoBranchSource,
            remoteBranch,
            error: null,
          };
        }

        let accepted: Array<{
          id: string;
          name: string;
          group?: string;
          groupId?: string;
          phase: 'draft' | 'starting';
          draft?: boolean;
          initialMessage?: {
            chat: string;
            promptId: string;
            pendingState: 'queued';
            status: 'queued';
          };
        }> = [];
        let rejected: Array<{ name: string; error: string; status?: number }> = [];
        try {
          const canonicalRepos = await canonicalRepositoriesMap();
          const regAny: any = await loadRegistry();
          const assumedNativeProvider = String(
            (await resolveEffectiveLlmProvider()).provider ?? '',
          ).trim();
          const pendingEntries: Array<{ state: 'pending'; droneId: string; entry: any }> = [];
          const initialPromptReservations: InitialPromptQueueReservation[] = [];
          const groupsToEnsure = new Map<string, { group: string; repoPath: string }>();
          const groupById = new Map<string, Awaited<ReturnType<typeof resolveCanonicalGroupReference>>>();
          for (const raw of list) {
            const groupId = typeof raw?.groupId === 'string' ? raw.groupId.trim() : '';
            if (groupId && !groupById.has(groupId)) {
              groupById.set(groupId, await resolveCanonicalGroupReference(groupId));
            }
          }
          const result = (() => {
            regAny.pending = regAny.pending ?? {};
            const accepted: Array<{
              id: string;
              name: string;
              group?: string;
              groupId?: string;
              phase: 'draft' | 'starting';
              draft?: boolean;
              initialMessage?: {
                chat: string;
                promptId: string;
                pendingState: 'queued';
                status: 'queued';
              };
            }> = [];
            const rejected: Array<{ name: string; error: string; status?: number }> = [];
            const seenInRequest = new Set<string>();

            for (const [index, raw] of list.entries()) {
              let name = '';
              try {
                name = normalizeDroneDisplayName(raw?.name);
              } catch (e: any) {
                rejected.push({
                  name: String(raw?.name ?? '').trim(),
                  error: e?.message ?? String(e),
                  status: 400,
                });
                continue;
              }
              if (!name) name = allocateUntitledDisplayName(regAny);
              if (seenInRequest.has(name)) {
                rejected.push({ name, error: `duplicate name in request: ${name}`, status: 400 });
                continue;
              }
              seenInRequest.add(name);
              if (droneDisplayNameExists(regAny, name)) {
                rejected.push({ name, error: `drone already exists: ${name}`, status: 409 });
                continue;
              }

              const preflight = preflightByIndex[index] ?? {
                repoPath: '',
                repoBranchSource: 'host' as const,
                remoteBranch: '',
                error: null,
                status: undefined,
              };
              if (preflight.error) {
                rejected.push({
                  name,
                  error: preflight.error,
                  status: preflight.status ?? 409,
                });
                continue;
              }

              const groupRefRaw = typeof raw?.groupId === 'string'
                ? raw.groupId.trim()
                : typeof raw?.group === 'string'
                  ? raw.group.trim()
                  : '';
              const referencedGroup = raw?.groupId ? groupById.get(groupRefRaw) ?? null : null;
              if (raw?.groupId && !referencedGroup) {
                rejected.push({ name, error: `unknown group: ${groupRefRaw}`, status: 404 });
                continue;
              }
              const group = referencedGroup?.name ?? (groupRefRaw || null);
              const repoPath = preflight.repoPath;
              if (referencedGroup && referencedGroup.repoPath !== repoPath) {
                rejected.push({ name, error: 'group belongs to a different repository', status: 409 });
                continue;
              }
              const repoBranchSource = preflight.repoBranchSource;
              const remoteBranch = preflight.remoteBranch;
              let runtime: DroneRuntime = 'container';
              try {
                runtime = parseCreateRuntime(raw?.runtime);
              } catch (e: any) {
                rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                continue;
              }
              const hasAgentsMdOverride = Object.prototype.hasOwnProperty.call(
                raw ?? {},
                'agentsMd',
              );
              let agentsMdOverride: string | undefined;
              if (hasAgentsMdOverride) {
                try {
                  agentsMdOverride = parseDroneAgentsMdOverride(raw?.agentsMd);
                } catch (e: any) {
                  rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                  continue;
                }
                if (runtime !== 'container' || !repoPath) {
                  rejected.push({
                    name,
                    error: 'agentsMd is only supported for repo-attached container drones',
                    status: 400,
                  });
                  continue;
                }
              }
              const build = raw?.build === true;
              const createAsDraft = parseDraftFlag(raw?.draft ?? raw?.isDraft);
              const createdEnvironment = deriveCreatedDroneEnvironmentConfig(
                { ...regAny, repos: canonicalRepos },
                { repoPath, runtime },
              );
              let persistVolume: boolean | undefined;
              try {
                persistVolume = parsePersistVolume(raw?.persistVolume);
              } catch (e: any) {
                rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                continue;
              }
              if (runtime === 'host' && persistVolume === false) {
                rejected.push({
                  name,
                  error: 'persistVolume is only supported for container runtime drones',
                  status: 400,
                });
                continue;
              }

              const seedPromptRaw = String(
                raw?.seedPrompt ?? raw?.initialMessage ?? raw?.seed?.prompt ?? '',
              ).trim();
              let seedAttachments: ChatImageAttachment[] = [];
              try {
                seedAttachments = normalizeChatImageAttachments(
                  raw?.seedAttachments ?? raw?.seed?.attachments,
                );
              } catch (e: any) {
                rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                continue;
              }
              const seedChatName = normalizeChatName(
                raw?.seedChat ?? raw?.seed?.chatName ?? raw?.seed?.chat ?? 'default',
              );
              const seedAgent = parseSeedAgent(raw?.seedAgent ?? raw?.agent ?? raw?.seed?.agent);
              const seedProviderRaw = String(
                raw?.seedProvider ?? raw?.seed?.provider ?? '',
              ).trim().toLowerCase();
              let seedProvider =
                seedProviderRaw === 'openai' ||
                seedProviderRaw === 'gemini' ||
                seedProviderRaw === 'codex'
                  ? seedProviderRaw
                  : '';
              if (seedProviderRaw && !seedProvider) {
                rejected.push({ name, error: 'invalid Built-in model provider', status: 400 });
                continue;
              }
              if (seedProvider && seedAgent?.kind !== 'native') {
                rejected.push({
                  name,
                  error: 'seedProvider is only supported for the Built-in agent',
                  status: 400,
                });
                continue;
              }
              if (!seedProvider && seedAgent?.kind === 'native') {
                seedProvider = assumedNativeProvider;
              }
              let seedAgentPermissionMode: AgentPermissionMode = 'execute';
              let seedApprovalPolicy: AgentApprovalPolicy = 'ask';
              try {
                const seedPermissionRaw =
                  raw?.seedAgentPermissionMode ??
                  raw?.agentPermissionMode ??
                  raw?.seed?.agentPermissionMode;
                seedAgentPermissionMode =
                  seedPermissionRaw == null || String(seedPermissionRaw).trim() === ''
                    ? 'execute'
                    : parseAgentPermissionModeForUpdate(seedPermissionRaw);
              } catch (e: any) {
                rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                continue;
              }
              try {
                const seedApprovalRaw =
                  raw?.seedApprovalPolicy ?? raw?.approvalPolicy ?? raw?.seed?.approvalPolicy;
                seedApprovalPolicy =
                  seedApprovalRaw == null || String(seedApprovalRaw).trim() === ''
                    ? 'ask'
                    : parseAgentApprovalPolicyForUpdate(seedApprovalRaw);
              } catch (e: any) {
                rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                continue;
              }
              const seedSubmittedAt = normalizeSubmittedAtIso(
                raw?.seedSubmittedAt ??
                  raw?.submittedAt ??
                  raw?.seed?.submittedAt ??
                  raw?.seed?.clientSubmittedAt,
              );
              let seedModel: string | null = null;
              try {
                seedModel = parseChatModelForUpdate(raw?.seedModel ?? raw?.seed?.model);
              } catch (e: any) {
                rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                continue;
              }
              const seedReasoning = normalizeChatReasoning(
                raw?.seedReasoning ?? raw?.seed?.reasoning,
              );
              if (
                seedReasoning &&
                !(
                  seedAgent?.kind === 'native' ||
                  (seedAgent?.kind === 'builtin' &&
                    (seedAgent.id === 'codex' || seedAgent.id === 'blip'))
                )
              ) {
                rejected.push({
                  name,
                  error:
                    'reasoning selection is currently supported for Built-in, Codex, and Blip seed agents',
                  status: 400,
                });
                continue;
              }
              if (seedAgentPermissionMode !== 'execute') {
                try {
                  if (!seedAgent)
                    throw new Error(
                      'agent access controls require a native, Codex, or Blip seed agent',
                    );
                  assertReadOnlySupportedForAgent(seedAgent);
                } catch (e: any) {
                  rejected.push({
                    name,
                    error: e?.message ?? String(e),
                    status: Number(e?.statusCode ?? 0) || 400,
                  });
                  continue;
                }
              }
              try {
                assertSeedApprovalPolicySupported(seedApprovalPolicy, seedAgent);
              } catch (e: any) {
                rejected.push({ name, error: e?.message ?? String(e), status: 400 });
                continue;
              }
              const seedCwdRaw =
                typeof raw?.seedCwd === 'string'
                  ? raw.seedCwd
                  : typeof raw?.seed?.cwd === 'string'
                    ? raw.seed.cwd
                    : null;

              const cloneFromRaw = typeof raw?.cloneFrom === 'string' ? raw.cloneFrom.trim() : '';
              const cloneFrom = cloneFromRaw ? cloneFromRaw : null;
              const cloneChats = raw?.cloneChats !== false;
              const cloneFromFound = cloneFrom ? findDroneIdByRef(regAny, cloneFrom) : null;
              const cloneFromId =
                cloneFromFound && cloneFromFound.kind === 'real' ? cloneFromFound.id : null;
              if (cloneFrom && !cloneFromId) {
                rejected.push({
                  name,
                  error: `unknown cloneFrom drone: ${cloneFrom}`,
                  status: 404,
                });
                continue;
              }
              const fleetParentRaw =
                typeof raw?.fleetParentId === 'string'
                  ? raw.fleetParentId.trim()
                  : typeof raw?.parentDroneId === 'string'
                    ? raw.parentDroneId.trim()
                    : typeof raw?.fleet?.createdBy === 'string'
                      ? raw.fleet.createdBy.trim()
                      : '';
              const fleetParentFound = fleetParentRaw
                ? findDroneIdByRef(regAny, fleetParentRaw)
                : null;
              const fleetParentId = fleetParentFound
                ? resolveStableDroneOrPendingIdFromRef(regAny, fleetParentRaw)
                : null;
              if (fleetParentRaw && !fleetParentId) {
                rejected.push({
                  name,
                  error: `unknown fleet parent drone: ${fleetParentRaw}`,
                  status: 404,
                });
                continue;
              }
              const repoSeedFromDroneRaw =
                typeof raw?.repoSeedFromDroneId === 'string' ? raw.repoSeedFromDroneId.trim() : '';
              const repoSeedFromDroneFound = repoSeedFromDroneRaw
                ? findDroneIdByRef(regAny, repoSeedFromDroneRaw)
                : null;
              const repoSeedFromDroneId =
                repoSeedFromDroneFound?.kind === 'real' ? repoSeedFromDroneFound.id : null;
              if (repoSeedFromDroneRaw && !repoSeedFromDroneId) {
                rejected.push({
                  name,
                  error: `unknown repo seed source drone: ${repoSeedFromDroneRaw}`,
                  status: 404,
                });
                continue;
              }
              const cloneFromEntry = cloneFromId
                ? findDroneEntryByIdentity(regAny, cloneFromId)?.entry
                : null;
              const cloneFromRuntime = normalizeDroneRuntime((cloneFromEntry as any)?.runtime);
              if (cloneFrom && runtime === 'container' && cloneFromRuntime !== 'container') {
                rejected.push({
                  name,
                  error: `clone source must use container runtime: ${cloneFrom}`,
                  status: 409,
                });
                continue;
              }
              const cloneFromContainerPortRaw = Number(
                (cloneFromEntry as any)?.containerPort ?? NaN,
              );
              const cloneFromContainerPort =
                Number.isFinite(cloneFromContainerPortRaw) &&
                cloneFromContainerPortRaw > 0 &&
                Math.floor(cloneFromContainerPortRaw) === cloneFromContainerPortRaw
                  ? cloneFromContainerPortRaw
                  : null;

              const containerPortRaw = raw?.containerPort;
              const containerPort =
                containerPortRaw == null
                  ? (cloneFromContainerPort ?? 7777)
                  : Number(containerPortRaw);
              if (
                !Number.isFinite(containerPort) ||
                containerPort <= 0 ||
                Math.floor(containerPort) !== containerPort
              ) {
                rejected.push({ name, error: 'invalid containerPort', status: 400 });
                continue;
              }

              const id = makeDroneIdentity();
              const at = nowIso();
              const initialPrompt = buildInitialSeedPromptPlan({
                seedPromptRaw,
                seedAttachments,
                seedChatName,
                seedSubmittedAt,
                seedCwdRaw,
                createAsDraft,
              });
              const { queueSeedPrompt, seedPrompt, seedPromptId, startupQueuedPrompts } =
                initialPrompt;
              const seedConfig = buildInitialSeedConfig({
                seedPrompt,
                seedPromptId,
                queueSeedPrompt,
                seedChatName,
                seedSubmittedAt,
                seedProvider,
                seedModel,
                seedReasoning,
                seedAgentPermissionMode,
                seedApprovalPolicy,
                seedCwdRaw,
                seedAgent,
              });
              if (group && !referencedGroup) {
                groupsToEnsure.set(`${repoPath}\0${group}`, { group, repoPath });
              }
              const pendingEntry = {
                id,
                name,
                ...(createAsDraft ? { draft: true } : {}),
                group: group ?? undefined,
                repoPath,
                runtime,
                ...(hasAgentsMdOverride ? { agentsMdOverride } : {}),
                containerPort,
                build,
                createdAt: at,
                updatedAt: at,
                phase: createAsDraft ? 'draft' : 'starting',
                message: createAsDraft ? 'Draft' : 'Starting…',
                environment: createdEnvironment,
                ...(startupQueuedPrompts.length > 0 ? { startupQueuedPrompts } : {}),
                ...(runtime === 'container' && typeof persistVolume === 'boolean'
                  ? { persistVolume }
                  : {}),
                ...(repoPath && !cloneFromId ? { repoSeedSource: repoBranchSource } : {}),
                ...(repoPath && repoBranchSource === 'remote' && remoteBranch && !cloneFromId
                  ? { repoSeedRemoteBranch: remoteBranch }
                  : {}),
                ...(repoPath && repoSeedFromDroneId && !cloneFromId ? { repoSeedFromDroneId } : {}),
                ...(cloneFromId ? { cloneFrom: cloneFromId, cloneChats: Boolean(cloneChats) } : {}),
                ...(fleetParentId
                  ? {
                      fleet: setFleetActorConfig(
                        {},
                        {
                          createdBy: fleetParentId,
                          createdAt: at,
                          assigned: [],
                        },
                      ).fleet,
                    }
                  : {}),
                ...(seedConfig ? { seed: seedConfig } : {}),
              };
              regAny.pending[id] = pendingEntry;
              pendingEntries.push({ state: 'pending', droneId: id, entry: pendingEntry });
              if (initialPrompt.shouldReserveQueuePosition) {
                initialPromptReservations.push({
                  droneId: id,
                  chatName: seedChatName,
                  promptId: seedPromptId,
                  at: seedSubmittedAt,
                  prompt: seedPrompt,
                  ...(seedCwdRaw ? { cwd: String(seedCwdRaw) } : {}),
                });
              }

              accepted.push({
                id,
                name,
                ...(group ? { group, ...(referencedGroup ? { groupId: referencedGroup.id } : {}) } : {}),
                phase: createAsDraft ? 'draft' : 'starting',
                ...(createAsDraft ? { draft: true } : {}),
                ...(seedPromptId
                  ? {
                      initialMessage: {
                        chat: seedChatName,
                        promptId: seedPromptId,
                        pendingState: 'queued' as const,
                        status: 'queued' as const,
                      },
                    }
                  : {}),
              });
            }

            return { accepted, rejected };
          })();
          const groupIdByScopeAndName = new Map<string, string>();
          for (const { group, repoPath } of groupsToEnsure.values()) {
            const canonicalGroup = await ensureCanonicalGroup(group, repoPath);
            groupIdByScopeAndName.set(`${canonicalGroup.repoPath}\0${canonicalGroup.name}`, canonicalGroup.id);
          }
          for (const entry of pendingEntries) {
            const groupName = String(entry.entry?.group ?? '').trim();
            const repoPath = String(entry.entry?.repoPath ?? '').trim();
            const groupId = groupIdByScopeAndName.get(`${repoPath}\0${groupName}`);
            if (!groupId) continue;
            entry.entry.groupId = groupId;
          }
          for (const item of result.accepted) {
            if (!item.group || item.groupId) continue;
            const pending = pendingEntries.find((entry) => entry.droneId === item.id);
            const repoPath = String(pending?.entry?.repoPath ?? '').trim();
            item.groupId = groupIdByScopeAndName.get(`${repoPath}\0${item.group}`);
          }
          await upsertCanonicalDroneLifecycleBatch(pendingEntries);
          for (const reservation of initialPromptReservations) {
            await reserveInitialPromptQueuePosition(reservation);
          }
          notifyCanonicalDroneRegistryWrite();
          accepted = result.accepted;
          rejected = result.rejected;
        } catch (e: any) {
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        // Enqueue provisioning after pending is persisted.
        for (const a of accepted) {
          if ((a as any).draft === true || a.phase === 'draft') continue;
          enqueueProvisioning(a.id);
        }

        json(res, 202, { ok: true, accepted, rejected, total: list.length });
        return;
      }

      // GET /api/drones/events
      if (
        method === 'GET' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[2] === 'events'
      ) {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache, no-transform');
        res.setHeader('connection', 'keep-alive');
        req.socket.setTimeout(0);
        (res as any).flushHeaders?.();

        let cleanedUp = false;
        droneRegistrySseClients.add(res);
        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          droneRegistrySseClients.delete(res);
          stopDroneRegistryBroadcasterIfIdle();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        startDroneRegistryBroadcaster();
        writeHubSseEvent(res, 'connected', { ok: true, at: nowIso() });
        const lastSnapshot = getDroneRegistrySseLastSnapshot();
        if (lastSnapshot) {
          writeHubSseEvent(res, 'snapshot', lastSnapshot);
          scheduleDroneRegistryBroadcasterRefresh(0);
        } else {
          void refreshDroneRegistryBroadcasterSnapshot({ broadcastSnapshot: true });
        }
        return;
      }

      // GET /api/drones/chat-events
      if (
        method === 'GET' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[2] === 'chat-events'
      ) {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-cache, no-transform');
        res.setHeader('connection', 'keep-alive');
        req.socket.setTimeout(0);
        (res as any).flushHeaders?.();

        let cleanedUp = false;
        droneChatSseClients.add(res);
        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          droneChatSseClients.delete(res);
          stopDroneChatBroadcasterIfIdle();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        startDroneChatBroadcaster();
        writeHubSseEvent(res, 'connected', { ok: true, at: nowIso() });
        void refreshDroneChatEventSnapshot({ broadcastSnapshot: droneChatSseLastByKey.size === 0 });
        return;
      }

      // GET /api/drones/summary
      // Registry-only summaries for assistant/extension tooling. This avoids live
      // daemon status probes, Docker size checks, and container recovery work.
      if (
        method === 'GET' &&
        parts.length === 3 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[2] === 'summary'
      ) {
        const timer = createRequestTimer();
        try {
          const regAny: any = await loadCanonicalActiveModel();
          timer.mark('load');
          const drones = buildAssistantDroneSummariesFromRegistry(regAny);
          timer.mark('format');
          timer.setHeader(res);
          logSlowHubRequest('drone summary', timer, { status: 200, count: drones.length });
          json(res, 200, { ok: true, drones });
        } catch (e: any) {
          timer.mark('error');
          timer.setHeader(res);
          logSlowHubRequest('drone summary', timer, {
            status: 500,
            error: e?.message ?? String(e),
          });
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
        }
        return;
      }

      // GET /api/drones
      if (method === 'GET' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'drones') {
        scheduleDroneStatusRefresh('api:drones', 0);
        const timer = createRequestTimer();
        try {
          const { drones } = await buildDroneRegistrySnapshot('api:drones');
          timer.mark('snapshot');
          timer.setHeader(res);
          logSlowHubRequest('drone list', timer, { status: 200, count: drones.length });
          json(res, 200, { ok: true, drones });
        } catch (e: any) {
          timer.mark('error');
          timer.setHeader(res);
          logSlowHubRequest('drone list', timer, { status: 500, error: e?.message ?? String(e) });
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
        }
        return;
      }

      // POST /api/drones/:id/hub/error/clear
      // Manually clear Hub-side error badge/message for a drone.
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'hub' &&
        parts[4] === 'error' &&
        parts[5] === 'clear'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const resolvedName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        let cleared = false;
        await commitDroneMetadataPatch({
          droneId,
          state: 'real',
          eventType: 'drone.hub-error.cleared',
          transform: (dd: any) => {
            if (
              String(dd?.hub?.phase ?? '')
                .trim()
                .toLowerCase() === 'error'
            ) {
              delete dd.hub;
              cleared = true;
            }
            dd.repo = dd.repo ?? {};
            if (typeof dd.repo.lastPullError === 'string') dd.repo.lastPullError = null;
            return dd;
          },
        });
        json(res, 200, { ok: true, id: droneId, name: resolvedName, cleared });
        return;
      }

      // GET /api/drones/:id/docker-size
      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'docker-size'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        if (normalizeDroneRuntime(resolved.drone?.runtime) === 'host') {
          json(res, 409, {
            ok: false,
            error: 'Docker size is only available for container drones',
          });
          return;
        }
        const dockerSize = await buildDroneDockerSizeSummary(resolved.drone);
        json(res, 200, {
          ok: true,
          id: resolved.id,
          name: String(resolved.drone?.name ?? resolved.id),
          dockerSize,
        });
        return;
      }

      return false;
    })();
    return handled !== false;
  };
}
