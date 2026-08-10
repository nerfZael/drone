import type { AgentPlan, AgentRunActivity } from '@drone/assistant-chat';
import { codexPromptOwnsResponse } from './codex-prompt-run';
import type { PendingPrompt } from './drone-pending-prompts';
import { finalizeDroneRunFileChanges } from './run-file-changes';

export type ChatReconciliationExecutorDependencies = {
  applyChatReconciliationInStore: any;
  chatHasReconcilablePendingPrompts: any;
  clearScheduledReconcileRetryByKey: any;
  collectDroneRuntimeDiagnostics: any;
  compactDiagnosticError: any;
  defaultPromptEnqueueTimeoutMs: any;
  droneChatMapKey: any;
  dronePromptGet: any;
  droneRuntime: any;
  enqueuePendingPromptPump: any;
  ensureOpenCodeSessionId: any;
  formatTranscriptJobFailure: any;
  hubLog: any;
  importChatFromRegistry: any;
  inferChatAgent: any;
  interruptedPromptDeliveryError: any;
  loadRegistry: any;
  makeClient: any;
  maybeStartDockerSnapshotForTranscriptTurn: any;
  normalizeBuiltinAgentId: any;
  normalizeChatImageAttachmentRefs: any;
  normalizeChatModel: any;
  normalizeChatName: any;
  normalizeChatReasoning: any;
  normalizeDroneIdentity: any;
  nowIso: any;
  parseBlipJobTranscript: any;
  parseCodexJobTranscript: any;
  parsePiJobTranscript: any;
  parseStructuredAgentJobTranscript: any;
  projectCanonicalChatToRegistry: any;
  pruneCompletedPendingPrompts: any;
  readChatFromStore: any;
  recoverStalePromptJobSession: any;
  resolveCanonicalDroneOrPendingForReadRef: any;
  resolveCodexTurnRuntime: any;
  resolveHostPort: any;
  resolveTranscriptPromptAt: any;
  sameAgentPlan: any;
  schedulePendingPromptPumpRetry: any;
  scheduleReconcileRetry: any;
  shouldRetryFailedPendingPrompt: any;
  stalePendingPromptState: any;
  updatePendingPrompt: any;
  STOPPED_BY_USER_ERROR: any;
};

export function createChatReconciliationExecutor(deps: ChatReconciliationExecutorDependencies) {
  const {
    applyChatReconciliationInStore,
    chatHasReconcilablePendingPrompts,
    clearScheduledReconcileRetryByKey,
    collectDroneRuntimeDiagnostics,
    compactDiagnosticError,
    defaultPromptEnqueueTimeoutMs,
    droneChatMapKey,
    dronePromptGet,
    droneRuntime,
    enqueuePendingPromptPump,
    ensureOpenCodeSessionId,
    formatTranscriptJobFailure,
    hubLog,
    importChatFromRegistry,
    inferChatAgent,
    interruptedPromptDeliveryError,
    loadRegistry,
    makeClient,
    maybeStartDockerSnapshotForTranscriptTurn,
    normalizeBuiltinAgentId,
    normalizeChatImageAttachmentRefs,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeDroneIdentity,
    nowIso,
    parseBlipJobTranscript,
    parseCodexJobTranscript,
    parsePiJobTranscript,
    parseStructuredAgentJobTranscript,
    projectCanonicalChatToRegistry,
    pruneCompletedPendingPrompts,
    readChatFromStore,
    recoverStalePromptJobSession,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveCodexTurnRuntime,
    resolveHostPort,
    resolveTranscriptPromptAt,
    sameAgentPlan,
    schedulePendingPromptPumpRetry,
    scheduleReconcileRetry,
    shouldRetryFailedPendingPrompt,
    stalePendingPromptState,
    updatePendingPrompt,
    STOPPED_BY_USER_ERROR,
  } = deps;

  function parseLiveAgentState(jobKind: string, job: any): any {
    if (jobKind === 'codex') return parseCodexJobTranscript(job);
    if (jobKind === 'cursor' || jobKind === 'claude' || jobKind === 'opencode') {
      return parseStructuredAgentJobTranscript(jobKind, job);
    }
    if (jobKind === 'pi') return parsePiJobTranscript(job);
    if (jobKind === 'blip') return parseBlipJobTranscript(job);
    return {};
  }

  function sameLiveAgentActivity(
    left: AgentRunActivity | undefined,
    right: AgentRunActivity | undefined,
  ): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    if (
      left.version !== right.version ||
      left.source !== right.source ||
      left.updatedAt !== right.updatedAt ||
      left.truncated !== right.truncated ||
      !Array.isArray(left.messages) ||
      !Array.isArray(right.messages) ||
      left.messages.length !== right.messages.length
    ) {
      return false;
    }
    return JSON.stringify(left.messages) === JSON.stringify(right.messages);
  }

  function validRunStartedAt(raw: unknown): string | undefined {
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value && Number.isFinite(Date.parse(value)) ? value : undefined;
  }

  async function reconcileChatFromDaemon(opts: {
    droneId: string;
    chatName: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    let d: any = null;
    let entry: any = null;
    if (!(globalThis as any).Bun) {
      const resolved = droneId ? await resolveCanonicalDroneOrPendingForReadRef(droneId) : null;
      if (resolved?.kind === 'real') d = resolved.drone;
      const stored = droneId ? readChatFromStore({ droneId, chatName }) : null;
      entry = stored?.available ? stored.chat : null;
    } else {
      const regAny: any = await loadRegistry();
      d = droneId ? regAny?.drones?.[droneId] : null;
      const registryEntry = d?.chats?.[chatName];
      if (registryEntry) {
        await importChatFromRegistry({ droneId, chatName, chatEntry: registryEntry });
        const projectedEntry = readChatFromStore({ droneId, chatName });
        entry =
          projectedEntry.available && projectedEntry.chat ? projectedEntry.chat : registryEntry;
      }
    }
    if (!d) return;
    const token = typeof d.token === 'string' ? d.token : '';
    const containerName = String(d?.containerName ?? d?.name ?? droneId).trim() || droneId;
    const runtime = droneRuntime(d);
    const hostPort =
      typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
        ? d.hostPort
        : await resolveHostPort(containerName, d.containerPort);
    if (!hostPort || !token) return;

    if (!entry) return;
    const agent = inferChatAgent(entry, d);
    if (!agent || agent.kind !== 'builtin') return;

    const pendingList: any[] = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (pendingList.length === 0) {
      clearScheduledReconcileRetryByKey(droneChatMapKey(droneId, chatName));
      return;
    }

    const turns: any[] = Array.isArray(entry?.turns) ? entry.turns : [];
    const pendingBefore = new Map(
      pendingList
        .map((pending: any) => [String(pending?.id ?? '').trim(), JSON.stringify(pending)] as const)
        .filter(([id]) => Boolean(id)),
    );
    const initialTurnIds = new Set(
      turns.map((turn: any) => String(turn?.id ?? '').trim()).filter(Boolean),
    );
    const metadataBefore = Object.fromEntries(
      ['codexThreadId', 'claudeSessionId', 'openCodeSessionId', 'piSessionId', 'blipSessionId'].map(
        (field) => [field, String((entry as any)?.[field] ?? '').trim()],
      ),
    ) as Record<string, string>;
    const transcriptIds = new Set(
      turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean),
    );

    const client = makeClient(hostPort, token);
    let changed = false;
    const completedTurnIdsForSnapshot: string[] = [];
    for (let i = 0; i < pendingList.length; i++) {
      const p = pendingList[i] ?? {};
      const id = String(p?.id ?? '').trim();
      const state = String(p?.state ?? '');
      const promptAttachments = normalizeChatImageAttachmentRefs((p as any)?.attachments);
      const pendingModel =
        normalizeChatModel((p as any)?.model) ?? normalizeChatModel((entry as any)?.model);
      if (!id) continue;
      if (state === 'queued') continue;

      // If already in transcript, nothing to do.
      if (transcriptIds.has(id)) {
        if (state !== 'sent') {
          pendingList[i] = { ...p, state: 'sent', observability: undefined, updatedAt: nowIso() };
          changed = true;
        }
        continue;
      }
      if (state === 'failed') {
        if (
          !shouldRetryFailedPendingPrompt({
            error: p?.error,
            updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : null,
            at: typeof p?.at === 'string' ? p.at : null,
          })
        ) {
          continue;
        }
      }

      let jobResp: any = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        jobResp = await dronePromptGet(client, id);
      } catch (error: any) {
        // If daemon job lookups fail after acceptance, keep the prompt active and
        // surface observability loss separately from agent failure.
        const staleState = stalePendingPromptState({
          state,
          updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : null,
          at: typeof p?.at === 'string' ? p.at : null,
          enqueueTimeoutMs: defaultPromptEnqueueTimeoutMs(),
        });
        if (staleState === 'sending' || staleState === 'sent') {
          const diagnostics = await collectDroneRuntimeDiagnostics({
            droneId,
            droneEntry: d,
          }).catch((error: unknown) => ({
            diagnosticError: compactDiagnosticError(error),
          }));
          hubLog('warn', 'pending prompt daemon status unavailable after stale threshold', {
            droneId,
            chatName,
            promptId: id,
            pendingState: state,
            staleState,
            diagnostics,
          });
          if (staleState === 'sending') {
            pendingList[i] = {
              ...p,
              state: 'queued',
              error: interruptedPromptDeliveryError(
                'daemon status unavailable while prompt was being delivered',
              ),
              observability: undefined,
              updatedAt: nowIso(),
            };
            schedulePendingPromptPumpRetry(droneId, chatName);
          } else {
            const checkedAt = nowIso();
            const errorText = String(error?.message ?? error ?? '').trim();
            pendingList[i] = {
              ...p,
              state: 'sent',
              observability: {
                state: 'status-unavailable',
                message:
                  'Prompt status is temporarily unavailable. The agent may still be running.',
                lastCheckedAt: checkedAt,
                ...(errorText ? { lastError: errorText.slice(0, 240) } : {}),
              },
              updatedAt: checkedAt,
            };
            scheduleReconcileRetry(droneId, chatName, 10_000);
          }
          changed = true;
        }
        continue;
      }
      let job = jobResp?.job ?? null;
      let jobState = String(job?.state ?? '').trim();
      let jobKind = normalizeBuiltinAgentId(job?.kind) ?? agent.id;
      const appServerThreadId = String(job?.codexAppServer?.threadId ?? '').trim();
      if (
        jobKind === 'codex' &&
        appServerThreadId &&
        String(entry?.codexThreadId ?? '').trim() !== appServerThreadId
      ) {
        entry.codexThreadId = appServerThreadId;
        changed = true;
      }
      if (jobState === 'queued' || jobState === 'running') {
        const ownsLiveOutput =
          jobKind !== 'codex' || !job?.codexAppServer || codexPromptOwnsResponse(job, id);
        const liveState =
          jobState === 'running' && ownsLiveOutput ? parseLiveAgentState(jobKind, job) : {};
        const parsedBlip = jobKind === 'blip' && jobState === 'running' ? liveState : null;
        const nextAgentPlan = jobState === 'running' ? liveState.agentPlan : (p as any).agentPlan;
        const nextActivity = jobState === 'running' ? liveState.activity : (p as any).activity;
        const nextApprovals =
          jobKind === 'codex' && job?.codexAppServer
            ? Array.isArray(job.codexAppServer?.run?.pendingApprovals)
              ? job.codexAppServer.run.pendingApprovals
              : []
            : (p as any).approvals;
        if (
          parsedBlip?.sessionId &&
          String(parsedBlip.sessionId).trim() &&
          String(entry?.blipSessionId ?? '').trim() !== parsedBlip.sessionId
        ) {
          entry.blipSessionId = parsedBlip.sessionId;
          changed = true;
        }
        const agentPlanChanged = !sameAgentPlan((p as any).agentPlan, nextAgentPlan);
        const activityChanged = !sameLiveAgentActivity((p as any).activity, nextActivity);
        const approvalsChanged =
          JSON.stringify((p as any).approvals ?? []) !== JSON.stringify(nextApprovals ?? []);
        const observabilityChanged = Boolean((p as any).observability);
        const priorStartedAt = validRunStartedAt((p as any).startedAt);
        const nextStartedAt =
          jobState === 'running'
            ? (validRunStartedAt(job?.startedAt) ?? priorStartedAt)
            : priorStartedAt;
        const startedAtChanged = nextStartedAt !== priorStartedAt;
        if (
          state !== 'sent' ||
          agentPlanChanged ||
          activityChanged ||
          approvalsChanged ||
          observabilityChanged ||
          startedAtChanged
        ) {
          pendingList[i] = {
            ...p,
            state: 'sent',
            observability: undefined,
            agentPlan: nextAgentPlan,
            activity: nextActivity,
            approvals: nextApprovals,
            ...(nextStartedAt ? { startedAt: nextStartedAt } : {}),
            updatedAt: nowIso(),
          };
          changed = true;
          continue;
        }
        const staleState = stalePendingPromptState({
          state,
          updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : null,
          at: typeof p?.at === 'string' ? p.at : null,
          enqueueTimeoutMs: defaultPromptEnqueueTimeoutMs(),
        });
        if (staleState !== 'sent') continue;

        // A running prompt can legitimately exceed the enqueue timeout. Do not kill
        // active agent work here; cancellation has to preserve an explicit cause.
        if (jobState === 'running') continue;

        // Auto-recover stale queued prompt jobs by closing any leftover prompt tmux session.
        const recovered = await recoverStalePromptJobSession({
          droneId,
          droneEntry: d,
          promptId: id,
        });
        if (recovered.jobState && recovered.job) {
          job = recovered.job;
          jobState = recovered.jobState;
          jobKind = normalizeBuiltinAgentId(job?.kind) ?? agent.id;
        } else {
          pendingList[i] = {
            ...p,
            state: 'failed',
            error: `auto-finalized stale pending prompt; daemon job remained ${jobState || 'non-terminal'} until session recovery`,
            observability: undefined,
            updatedAt: nowIso(),
          };
          changed = true;
          continue;
        }
      }

      if (jobState === 'queued' || jobState === 'running') {
        continue;
      }

      const terminalStartedAt =
        validRunStartedAt(job?.startedAt) ?? validRunStartedAt((p as any).startedAt);
      if (terminalStartedAt && (p as any).startedAt !== terminalStartedAt) {
        (p as any).startedAt = terminalStartedAt;
        pendingList[i] = p;
        changed = true;
      }

      if ((p as any).fileChangesBaseline && !(p as any).fileChanges) {
        try {
          const fileChanges = await finalizeDroneRunFileChanges({
            baseline: (p as any).fileChangesBaseline,
            drone: d,
          });
          (p as any).fileChanges = fileChanges ?? {
            version: 1,
            capturedAt: nowIso(),
            counts: { changed: 0, additions: 0, deletions: 0, modified: 0 },
            workspaces: [],
          };
          changed = true;
        } catch (error: any) {
          hubLog('warn', 'failed finalizing agent run file changes', {
            droneId,
            chatName,
            promptId: id,
            error: String(error?.message ?? error ?? 'unknown error'),
          });
        }
      }

      if (jobState === 'done') {
        const stdout = typeof job?.stdout === 'string' ? job.stdout : '';
        const stderr = typeof job?.stderr === 'string' ? job.stderr : '';
        const finishedAt = typeof job?.finishedAt === 'string' ? job.finishedAt : nowIso();
        const promptAt = resolveTranscriptPromptAt({
          pendingAt: p?.at,
          jobStartedAt: job?.startedAt,
          finishedAt,
        });
        const startedAt = terminalStartedAt ?? promptAt;
        if (jobKind === 'codex') {
          const parsed = parseCodexJobTranscript(job);
          if (!codexPromptOwnsResponse(job, id)) {
            turns.push({
              at: promptAt,
              promptAt,
              startedAt,
              completedAt: finishedAt,
              id,
              prompt: String(p?.prompt ?? ''),
              ...(pendingModel ? { model: pendingModel } : {}),
              ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
              ok: true,
              output: '',
              userOnly: true,
            });
            transcriptIds.add(id);
            pendingList[i] = {
              ...p,
              state: 'sent',
              error: undefined,
              observability: undefined,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          const turnRuntime = await resolveCodexTurnRuntime({
            parsed,
            pendingModel,
            runtime,
            containerName,
            fallbackThreadId: entry?.codexThreadId,
          });
          const threadId = parsed.threadId;
          const msg = parsed.message;
          const output = String(msg ?? '').trimEnd();
          if (!output) {
            const error = formatTranscriptJobFailure({
              agentId: jobKind,
              stdoutRaw: stdout,
              stderrRaw: stderr,
              fallbackRaw: 'codex finished but no message was parsed',
              exitCode: 0,
            });
            pendingList[i] = {
              ...p,
              state: 'failed',
              error,
              observability: undefined,
              activity: parsed.activity ?? (p as any).activity,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          if (threadId) {
            entry.codexThreadId = threadId;
            changed = true;
          }
          // Record transcript turn (success).
          turns.push({
            at: promptAt,
            promptAt,
            startedAt,
            completedAt: finishedAt,
            id,
            prompt: String(p?.prompt ?? ''),
            ...(turnRuntime.model ? { model: turnRuntime.model } : {}),
            ...(turnRuntime.reasoning ? { reasoning: turnRuntime.reasoning } : {}),
            ...(parsed.agentPlan ? { agentPlan: parsed.agentPlan } : {}),
            ...(parsed.activity ? { activity: parsed.activity } : {}),
            ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
            ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
            ok: true,
            output,
          });
          transcriptIds.add(id);
          completedTurnIdsForSnapshot.push(id);
          pendingList[i] = { ...p, state: 'sent', observability: undefined, updatedAt: nowIso() };
          changed = true;
          continue;
        }

        if (jobKind === 'cursor' || jobKind === 'claude' || jobKind === 'opencode') {
          const parsed = parseStructuredAgentJobTranscript(jobKind, job);
          const turnModel = normalizeChatModel(parsed.model) ?? pendingModel;
          const turnReasoning = normalizeChatReasoning(parsed.reasoning);
          const output = String(parsed.message ?? '').trimEnd();
          if (!output) {
            const error = formatTranscriptJobFailure({
              agentId: jobKind,
              stdoutRaw: stdout,
              stderrRaw: stderr,
              fallbackRaw: `${jobKind} finished but no assistant message was parsed`,
              exitCode: 0,
            });
            pendingList[i] = {
              ...p,
              state: 'failed',
              error,
              observability: undefined,
              activity: parsed.activity ?? (p as any).activity,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          if (jobKind === 'opencode') {
            const openCodeSessionId =
              parsed.sessionId ??
              (await ensureOpenCodeSessionId({
                droneId,
                droneLabel: String(d?.name ?? '').trim() || droneId,
                containerName: String(d?.containerName ?? d?.name ?? droneId).trim() || droneId,
                chatName: opts.chatName,
              }).catch(() => null));
            if (openCodeSessionId) {
              entry.openCodeSessionId = openCodeSessionId;
              changed = true;
            }
          }
          turns.push({
            at: promptAt,
            promptAt,
            startedAt,
            completedAt: finishedAt,
            id,
            prompt: String(p?.prompt ?? ''),
            ...(turnModel ? { model: turnModel } : {}),
            ...(turnReasoning ? { reasoning: turnReasoning } : {}),
            ...(parsed.agentPlan ? { agentPlan: parsed.agentPlan } : {}),
            ...(parsed.activity ? { activity: parsed.activity } : {}),
            ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
            ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
            ok: true,
            output,
          });
          transcriptIds.add(id);
          completedTurnIdsForSnapshot.push(id);
          pendingList[i] = { ...p, state: 'sent', observability: undefined, updatedAt: nowIso() };
          changed = true;
          continue;
        }

        if (jobKind === 'pi') {
          const parsed = parsePiJobTranscript(job);
          const turnModel = normalizeChatModel(parsed.model) ?? pendingModel;
          const turnReasoning = normalizeChatReasoning(parsed.reasoning);
          if (
            parsed.sessionId &&
            String(parsed.sessionId).trim() &&
            String(entry?.piSessionId ?? '').trim() !== parsed.sessionId
          ) {
            entry.piSessionId = parsed.sessionId;
            changed = true;
          }
          const output = String(parsed.message ?? '').trimEnd();
          if (!output) {
            pendingList[i] = {
              ...p,
              state: 'failed',
              error: 'pi finished but no assistant message was parsed',
              observability: undefined,
              activity: parsed.activity ?? (p as any).activity,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          turns.push({
            at: promptAt,
            promptAt,
            startedAt,
            completedAt: finishedAt,
            id,
            prompt: String(p?.prompt ?? ''),
            ...(turnModel ? { model: turnModel } : {}),
            ...(turnReasoning ? { reasoning: turnReasoning } : {}),
            ...(parsed.activity ? { activity: parsed.activity } : {}),
            ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
            ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
            ok: true,
            output,
          });
          transcriptIds.add(id);
          completedTurnIdsForSnapshot.push(id);
          pendingList[i] = { ...p, state: 'sent', observability: undefined, updatedAt: nowIso() };
          changed = true;
          continue;
        }

        if (jobKind === 'blip') {
          const parsed = parseBlipJobTranscript(job);
          const turnModel = normalizeChatModel(parsed.model) ?? pendingModel;
          const turnReasoning = normalizeChatReasoning(parsed.reasoning);
          if (
            parsed.sessionId &&
            String(parsed.sessionId).trim() &&
            String(entry?.blipSessionId ?? '').trim() !== parsed.sessionId
          ) {
            entry.blipSessionId = parsed.sessionId;
            changed = true;
          }
          const output = String(parsed.message ?? '').trimEnd();
          if (!output) {
            pendingList[i] = {
              ...p,
              state: 'failed',
              error: 'blip finished but no assistant message was parsed',
              observability: undefined,
              activity: parsed.activity ?? (p as any).activity,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          turns.push({
            at: promptAt,
            promptAt,
            startedAt,
            completedAt: finishedAt,
            id,
            prompt: String(p?.prompt ?? ''),
            ...(turnModel ? { model: turnModel } : {}),
            ...(turnReasoning ? { reasoning: turnReasoning } : {}),
            ...(parsed.activity ? { activity: parsed.activity } : {}),
            ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
            ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
            ok: true,
            output,
          });
          transcriptIds.add(id);
          pendingList[i] = { ...p, state: 'sent', observability: undefined, updatedAt: nowIso() };
          changed = true;
          continue;
        }

        if (
          jobKind === 'opencode' &&
          !(typeof entry?.openCodeSessionId === 'string' && String(entry.openCodeSessionId).trim())
        ) {
          // Best-effort: discover session id after first successful run, so future turns
          // can continue the exact same OpenCode session.
          const openCodeSessionId =
            (await ensureOpenCodeSessionId({
              droneId,
              droneLabel: String(d?.name ?? '').trim() || droneId,
              containerName: String(d?.containerName ?? d?.name ?? droneId).trim() || droneId,
              chatName: opts.chatName,
            }).catch(() => null)) ?? null;
          if (openCodeSessionId) {
            entry.openCodeSessionId = openCodeSessionId;
            changed = true;
          }
        }

        // Non-Codex builtins: treat stdout as final output.
        const output = (stdout || stderr || '').trimEnd();
        turns.push({
          at: promptAt,
          promptAt,
          startedAt,
          completedAt: finishedAt,
          id,
          prompt: String(p?.prompt ?? ''),
          ...(pendingModel ? { model: pendingModel } : {}),
          ...((p as any).activity ? { activity: (p as any).activity } : {}),
          ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
          ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
          ok: true,
          output: output || '(no output)',
        });
        transcriptIds.add(id);
        completedTurnIdsForSnapshot.push(id);
        pendingList[i] = { ...p, state: 'sent', observability: undefined, updatedAt: nowIso() };
        changed = true;
        continue;
      }

      if (jobState === 'failed') {
        let failedActivity = (p as any).activity;
        if (jobKind === 'codex') {
          const stdout = String(job?.stdout ?? '');
          const stderr = String(job?.stderr ?? '');
          const parsed = parseCodexJobTranscript(job);
          const turnRuntime = await resolveCodexTurnRuntime({
            parsed,
            pendingModel,
            runtime,
            containerName,
            fallbackThreadId: entry?.codexThreadId,
          });
          const output = String(parsed.message ?? '').trimEnd();
          const finishedAt = typeof job?.finishedAt === 'string' ? job.finishedAt : nowIso();
          const promptAt = resolveTranscriptPromptAt({
            pendingAt: p?.at,
            jobStartedAt: job?.startedAt,
            finishedAt,
          });
          const startedAt = terminalStartedAt ?? promptAt;
          // Self-heal false failed states only when Codex emitted a terminal
          // completion event. An in-flight status update is not a final answer.
          const terminalEvent = String(parsed.terminalEvent ?? '').trim();
          const hasCompletedTurn =
            terminalEvent === 'turn.completed' || terminalEvent === 'response.completed';
          if (output && hasCompletedTurn) {
            if (parsed.threadId) {
              entry.codexThreadId = parsed.threadId;
              changed = true;
            }
            turns.push({
              at: promptAt,
              promptAt,
              startedAt,
              completedAt: finishedAt,
              id,
              prompt: String(p?.prompt ?? ''),
              ...(turnRuntime.model ? { model: turnRuntime.model } : {}),
              ...(turnRuntime.reasoning ? { reasoning: turnRuntime.reasoning } : {}),
              ...(parsed.agentPlan ? { agentPlan: parsed.agentPlan } : {}),
              ...(parsed.activity ? { activity: parsed.activity } : {}),
              ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
              ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
              ok: true,
              output,
            });
            transcriptIds.add(id);
            completedTurnIdsForSnapshot.push(id);
            pendingList[i] = {
              ...p,
              state: 'sent',
              error: undefined,
              observability: undefined,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          failedActivity = parsed.activity ?? failedActivity;
        }
        if (jobKind === 'cursor' || jobKind === 'claude' || jobKind === 'opencode') {
          const parsed = parseStructuredAgentJobTranscript(jobKind, job);
          const output = String(parsed.message ?? '').trimEnd();
          const finishedAt = typeof job?.finishedAt === 'string' ? job.finishedAt : nowIso();
          const promptAt = resolveTranscriptPromptAt({
            pendingAt: p?.at,
            jobStartedAt: job?.startedAt,
            finishedAt,
          });
          const startedAt = terminalStartedAt ?? promptAt;
          if (output && parsed.terminalStatus === 'completed') {
            const turnModel = normalizeChatModel(parsed.model) ?? pendingModel;
            const turnReasoning = normalizeChatReasoning(parsed.reasoning);
            turns.push({
              at: promptAt,
              promptAt,
              startedAt,
              completedAt: finishedAt,
              id,
              prompt: String(p?.prompt ?? ''),
              ...(turnModel ? { model: turnModel } : {}),
              ...(turnReasoning ? { reasoning: turnReasoning } : {}),
              ...(parsed.agentPlan ? { agentPlan: parsed.agentPlan } : {}),
              ...(parsed.activity ? { activity: parsed.activity } : {}),
              ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
              ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
              ok: true,
              output,
            });
            transcriptIds.add(id);
            completedTurnIdsForSnapshot.push(id);
            pendingList[i] = {
              ...p,
              state: 'sent',
              error: undefined,
              observability: undefined,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          const exitCode =
            typeof job?.exitCode === 'number' && Number.isFinite(job.exitCode)
              ? Math.floor(job.exitCode)
              : null;
          const error = formatTranscriptJobFailure({
            agentId: jobKind,
            stdoutRaw: '',
            stderrRaw: String(job?.stderr ?? ''),
            fallbackRaw: parsed.error || `${jobKind} agent failed`,
            exitCode,
          });
          pendingList[i] = {
            ...p,
            state: 'failed',
            error,
            observability: undefined,
            agentPlan: parsed.agentPlan ?? (p as any).agentPlan,
            activity: parsed.activity ?? (p as any).activity,
            updatedAt: nowIso(),
          };
          changed = true;
          continue;
        }
        if (jobKind === 'pi') {
          const stdout = String(job?.stdout ?? '');
          const parsed = parsePiJobTranscript(job);
          const turnModel = normalizeChatModel(parsed.model) ?? pendingModel;
          const turnReasoning = normalizeChatReasoning(parsed.reasoning);
          const output = String(parsed.message ?? '').trimEnd();
          const finishedAt = typeof job?.finishedAt === 'string' ? job.finishedAt : nowIso();
          const promptAt = resolveTranscriptPromptAt({
            pendingAt: p?.at,
            jobStartedAt: job?.startedAt,
            finishedAt,
          });
          const startedAt = terminalStartedAt ?? promptAt;
          if (
            parsed.sessionId &&
            String(parsed.sessionId).trim() &&
            String(entry?.piSessionId ?? '').trim() !== parsed.sessionId
          ) {
            entry.piSessionId = parsed.sessionId;
            changed = true;
          }
          // Same self-heal logic as Codex: if Pi produced a complete assistant turn before the
          // daemon finalized the job as failed, trust the parsed transcript output.
          if (output) {
            turns.push({
              at: promptAt,
              promptAt,
              startedAt,
              completedAt: finishedAt,
              id,
              prompt: String(p?.prompt ?? ''),
              ...(turnModel ? { model: turnModel } : {}),
              ...(turnReasoning ? { reasoning: turnReasoning } : {}),
              ...(parsed.activity ? { activity: parsed.activity } : {}),
              ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
              ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
              ok: true,
              output,
            });
            transcriptIds.add(id);
            completedTurnIdsForSnapshot.push(id);
            pendingList[i] = {
              ...p,
              state: 'sent',
              error: undefined,
              observability: undefined,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          failedActivity = parsed.activity ?? failedActivity;
        }
        if (jobKind === 'blip') {
          const parsed = parseBlipJobTranscript(job);
          const turnModel = normalizeChatModel(parsed.model) ?? pendingModel;
          const turnReasoning = normalizeChatReasoning(parsed.reasoning);
          const output = String(parsed.message ?? '').trimEnd();
          const finishedAt = typeof job?.finishedAt === 'string' ? job.finishedAt : nowIso();
          const promptAt = resolveTranscriptPromptAt({
            pendingAt: p?.at,
            jobStartedAt: job?.startedAt,
            finishedAt,
          });
          const startedAt = terminalStartedAt ?? promptAt;
          if (
            parsed.sessionId &&
            String(parsed.sessionId).trim() &&
            String(entry?.blipSessionId ?? '').trim() !== parsed.sessionId
          ) {
            entry.blipSessionId = parsed.sessionId;
            changed = true;
          }
          if (output && parsed.terminalEvent === 'session_finished') {
            turns.push({
              at: promptAt,
              promptAt,
              startedAt,
              completedAt: finishedAt,
              id,
              prompt: String(p?.prompt ?? ''),
              ...(turnModel ? { model: turnModel } : {}),
              ...(turnReasoning ? { reasoning: turnReasoning } : {}),
              ...(parsed.activity ? { activity: parsed.activity } : {}),
              ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
              ...((p as any).fileChanges ? { fileChanges: (p as any).fileChanges } : {}),
              ok: true,
              output,
            });
            transcriptIds.add(id);
            pendingList[i] = {
              ...p,
              state: 'sent',
              error: undefined,
              observability: undefined,
              updatedAt: nowIso(),
            };
            changed = true;
            continue;
          }
          failedActivity = parsed.activity ?? failedActivity;
        }
        const exitCode =
          typeof job?.exitCode === 'number' && Number.isFinite(job.exitCode)
            ? Math.floor(job.exitCode)
            : null;
        let errText = formatTranscriptJobFailure({
          agentId: jobKind,
          stdoutRaw: String(job?.stdout ?? ''),
          stderrRaw: String(job?.stderr ?? ''),
          fallbackRaw:
            String(job?.error ?? '').trim() ||
            String(job?.stderr ?? '').trim() ||
            String(job?.stdout ?? '').trim() ||
            '',
          exitCode,
        });
        pendingList[i] = {
          ...p,
          state: 'failed',
          error: errText,
          observability: undefined,
          activity: failedActivity,
          updatedAt: nowIso(),
        };
        changed = true;
        continue;
      }

      if (jobState === 'canceled') {
        pendingList[i] = {
          ...p,
          state: 'failed',
          error: STOPPED_BY_USER_ERROR,
          observability: undefined,
          updatedAt: nowIso(),
        };
        changed = true;
        continue;
      }
    }

    const reconciledPendingList = [...pendingList];
    const prunedPendingList = pruneCompletedPendingPrompts(pendingList as PendingPrompt[], turns, {
      keepRecentlyCompleted: true,
    });
    if (prunedPendingList.length !== pendingList.length) {
      pendingList.length = 0;
      pendingList.push(...prunedPendingList);
      changed = true;
    }

    if (changed) {
      const metadataSet: Record<string, string> = {};
      for (const field of Object.keys(metadataBefore)) {
        const value = String((entry as any)?.[field] ?? '').trim();
        if (value && value !== metadataBefore[field]) metadataSet[field] = value;
      }
      const newTurns = turns.filter((turn: any) => {
        const id = String(turn?.id ?? '').trim();
        return id && !initialTurnIds.has(id);
      });
      if (Object.keys(metadataSet).length > 0 || newTurns.length > 0) {
        await applyChatReconciliationInStore({
          droneId,
          chatName,
          metadataPatch: Object.keys(metadataSet).length > 0 ? { set: metadataSet } : undefined,
          turns: newTurns,
        });
        await projectCanonicalChatToRegistry(droneId, chatName);
      }
      for (const pending of reconciledPendingList) {
        const id = String((pending as any)?.id ?? '').trim();
        if (!id || pendingBefore.get(id) === JSON.stringify(pending)) continue;
        // Prompt delivery state has one owner. Chat reconciliation projects its
        // result into the prompt queue and never stores it in chat metadata.
        // eslint-disable-next-line no-await-in-loop
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: {
            state: pending.state,
            error: pending.error,
            observability: pending.observability,
            blipClones: pending.blipClones,
            agentPlan: pending.agentPlan,
            approvals: (pending as any).approvals,
            fileChangesBaseline: pending.fileChangesBaseline,
            fileChanges: pending.fileChanges,
            activity: pending.activity,
            startedAt: pending.startedAt,
            updatedAt: pending.updatedAt,
          },
        });
      }
    }

    for (const promptId of completedTurnIdsForSnapshot) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await maybeStartDockerSnapshotForTranscriptTurn({ droneId, chatName, promptId });
      } catch (error: any) {
        hubLog('warn', 'failed starting docker snapshot for transcript turn', {
          droneId,
          chatName,
          promptId,
          error: String(error?.message ?? error ?? 'unknown error'),
        });
      }
    }

    if (changed) {
      // Best-effort: session ids may have been established (codexThreadId/openCodeSessionId/piSessionId/blipSessionId)
      // or a prior prompt may have completed/failed, unblocking queued follow-ups.
      enqueuePendingPromptPump(droneId, chatName);
    }

    if (chatHasReconcilablePendingPrompts({ pendingPrompts: pendingList, turns })) {
      scheduleReconcileRetry(droneId, chatName);
    } else {
      clearScheduledReconcileRetryByKey(droneChatMapKey(droneId, chatName));
    }
  }

  return { reconcileChatFromDaemon };
}
