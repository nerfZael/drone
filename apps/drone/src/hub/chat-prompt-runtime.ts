import crypto from 'node:crypto';
import path from 'node:path';
import {
  chatAttachmentPreviewLabel,
  completedTurnIds,
  hasBlockingPendingPrompt,
  isSendInNewChatQueueAction,
} from '@drone/assistant-chat';

import type { AgentPlan } from '@drone/assistant-chat';
import { DroneApiRequestError } from '../host/api';
import { commandForPid } from '../host/process-inspection';
import type { ChatImageAttachment, ChatImageAttachmentRef } from './chat-attachments';
import type { AgentPermissionMode, BuiltinAgentId, ChatAgentConfig } from './chat-types';
import type { PromptSubmissionSource } from '../host/prompt-queue-repository';
import { ChatReconciliationQueue } from './chat-reconciliation-queue';
import { createChatReconciliationExecutor } from './chat-reconciliation-executor';
import { pendingCodexApprovalsForNeverAsk } from './codex-never-ask';
import { createSendInNewChatActionRuntime } from './chat-queue-action-runtime';
import { DaemonPromptEventMonitor } from './daemon-prompt-event-monitor';
import { DroneDaemonRecovery } from './drone-daemon-recovery';
import { isDroneDaemonCommandForPort } from './drone-daemon-runtime';
import type { PendingPromptState } from './drone-pending-state';
import {
  nativeAssistantOwnsPromptDelivery,
  pendingPromptKeepsChatBusy,
  PendingPromptPump,
} from './pending-prompt-pump';
import type { PendingPrompt } from './drone-pending-prompts';
import { chatPromptAcceptancePlan } from './prompt-acceptance';
import {
  captureDroneRunFileChangesBaseline,
  type AgentRunFileChangesBaseline,
} from './run-file-changes';
import { createTerminalPromptWakeHandler } from './terminal-prompt-wake';
import { workflowBlipPermissionArgs } from './workflows/workflow-permissions';
import { createPromptDeliveryTiming, type PromptDeliveryTiming } from './prompt-delivery-timing';
import {
  ProvisionedPromptHandoffStore,
  type ProvisionedPromptHandoff,
} from './provisioned-prompt-handoff';
import { pendingChatForkSourceSessionId } from './chat-fork';

type ChatPromptRuntimeDependencyName =
  | 'NON_REPO_HOME_CWD'
  | 'PROMPT_SKILL_SYNC_WARNINGS'
  | 'UPGRADE_DAEMON_READY_TIMEOUT_MS'
  | 'applyChatReconciliationInStore'
  | 'applyPendingDisplayNameToProvisionedDrone'
  | 'autoRenameGeneratedChatFromFirstPrompt'
  | 'assertReadOnlySupportedForAgent'
  | 'bashQuote'
  | 'buildChatAttachmentsDirectory'
  | 'buildChatImageAttachmentRefs'
  | 'buildContainerManagedEnvLines'
  | 'buildEnvExportLines'
  | 'chatAttachmentsStorageRootForDrone'
  | 'chatHasActiveDockerSnapshot'
  | 'chatNameExists'
  | 'cliSupportsModelFlag'
  | 'cloneChatEntryForDroneClone'
  | 'collectDroneRuntimeDiagnostics'
  | 'compactDiagnosticError'
  | 'commitDroneMetadataPatch'
  | 'copyChatAttachmentsToContainer'
  | 'copyChatAttachmentsToHost'
  | 'createDroneChat'
  | 'createDronePendingPromptStore'
  | 'createDroneProvisioningController'
  | 'createDroneRuntime'
  | 'defaultDaemonReadyTimeoutMs'
  | 'defaultPendingPromptEnqueueRetryDelayMs'
  | 'defaultPromptEnqueueTimeoutMs'
  | 'defaultRepoSeedTimeoutMs'
  | 'droneCodexPromptApprovalResolve'
  | 'dronePromptCancel'
  | 'droneCodexPromptEnqueue'
  | 'dronePromptEnqueue'
  | 'dronePromptGet'
  | 'droneHealth'
  | 'droneStatus'
  | 'droneRuntime'
  | 'dvmExec'
  | 'dvmSessionType'
  | 'dvmStart'
  | 'dvmStop'
  | 'ensureChatEntry'
  | 'ensureClaudeSessionId'
  | 'ensureContainerDroneDaemonSession'
  | 'ensureCursorChatId'
  | 'ensureHubChatSessionRunning'
  | 'ensureOpenCodeSessionId'
  | 'failStaleDockerSnapshotsForChat'
  | 'formatTranscriptJobFailure'
  | 'getChatEntry'
  | 'hubChatSessionName'
  | 'hubLog'
  | 'importChatFromRegistry'
  | 'importContainerDroneRuntime'
  | 'inferChatAgent'
  | 'isDraftChatEntry'
  | 'isNotFoundErrorMessage'
  | 'loadRegistry'
  | 'listChatsFromStore'
  | 'looksLikeTransientPromptEnqueueError'
  | 'launchHostDroneDaemon'
  | 'makeClient'
  | 'maybeBootstrapPromptFromTranscript'
  | 'maybeStartDockerSnapshotForTranscriptTurn'
  | 'normalizeAgentPermissionMode'
  | 'normalizeAgentApprovalPolicy'
  | 'normalizeBuiltinAgentId'
  | 'normalizeChatModel'
  | 'normalizeChatName'
  | 'normalizeChatReasoning'
  | 'normalizeContainerPath'
  | 'normalizeDroneCwdForRuntime'
  | 'normalizeDroneIdentity'
  | 'normalizePendingPromptState'
  | 'normalizePendingPromptText'
  | 'normalizePendingStartupPrompts'
  | 'normalizeSubmittedAtIso'
  | 'notifyDroneChatWrite'
  | 'nowIso'
  | 'openCodeSessionTitle'
  | 'parseBlipJobTranscript'
  | 'parseCodexJobTranscript'
  | 'parsePiJobTranscript'
  | 'parseSeedAgent'
  | 'parseStructuredAgentJobTranscript'
  | 'promptNativeChat'
  | 'stopNativeChat'
  | 'projectCanonicalChatToRegistry'
  | 'promptWithImageAttachments'
  | 'readBuiltinTranscriptSessionId'
  | 'readChatFromStore'
  | 'readChatAttachmentsFromRefs'
  | 'resetTranscriptStoreForTests'
  | 'resolveBlipPromptCommand'
  | 'resolveCanonicalDroneOrPendingForReadRef'
  | 'resolveChatTmuxCommand'
  | 'resolveCodexTurnRuntime'
  | 'resolveDroneDaemonClientForEntry'
  | 'resolveDroneEnvironmentConfig'
  | 'resolveEffectiveLlmProvider'
  | 'resolveEffectiveProviderApiKeySettings'
  | 'resolveHostPort'
  | 'resolveManagedChatMcpEnv'
  | 'resolvePendingDroneDisplayName'
  | 'resolveTranscriptPromptAt'
  | 'sameAgentPlan'
  | 'setChatAgentConfig'
  | 'setDroneHubMetaByIdentity'
  | 'shouldRetryFailedPendingPrompt'
  | 'sleepMs'
  | 'stalePendingPromptState'
  | 'startupPromptToPendingPrompt'
  | 'syncManagedFilesForDrone'
  | 'syncSetService'
  | 'unsupportedHostCustomAgentError'
  | 'updateTranscriptTurnById'
  | 'upgradeDroneDaemonInContainer'
  | 'nativeChatIsBusy'
  | 'nativeChatError'
  | 'nativeChatLatestAssistantText'
  | 'waitForDroneDaemonReady'
  | 'withDroneOpLock'
  | 'withLockedDroneContainer'
  | 'withTimeout';

export type ChatPromptRuntimeDependencies = {
  [Key in ChatPromptRuntimeDependencyName]: any;
};

export type EnqueuePromptOptions = {
  id?: string;
  droneId: string;
  chatName: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  attachmentRefs?: ChatImageAttachmentRef[];
  messageId?: string;
  cwd?: string | null;
  submittedAt?: string | null;
  waitForDaemonMs?: number;
  deliveryMode?: 'background' | 'immediate';
  priority?: 'queue' | 'asap';
  schedulePump?: boolean;
  submissionSource?: PromptSubmissionSource;
  mark?: (name: string) => void;
};

export function createChatPromptRuntime(deps: ChatPromptRuntimeDependencies) {
  const {
    NON_REPO_HOME_CWD,
    PROMPT_SKILL_SYNC_WARNINGS,
    UPGRADE_DAEMON_READY_TIMEOUT_MS,
    applyChatReconciliationInStore,
    applyPendingDisplayNameToProvisionedDrone,
    autoRenameGeneratedChatFromFirstPrompt,
    assertReadOnlySupportedForAgent,
    bashQuote,
    buildChatAttachmentsDirectory,
    buildChatImageAttachmentRefs,
    buildContainerManagedEnvLines,
    buildEnvExportLines,
    chatAttachmentsStorageRootForDrone,
    chatHasActiveDockerSnapshot,
    chatNameExists,
    cliSupportsModelFlag,
    cloneChatEntryForDroneClone,
    collectDroneRuntimeDiagnostics,
    compactDiagnosticError,
    commitDroneMetadataPatch,
    copyChatAttachmentsToContainer,
    copyChatAttachmentsToHost,
    createDroneChat,
    createDronePendingPromptStore,
    createDroneProvisioningController,
    createDroneRuntime,
    defaultDaemonReadyTimeoutMs,
    defaultPendingPromptEnqueueRetryDelayMs,
    defaultPromptEnqueueTimeoutMs,
    defaultRepoSeedTimeoutMs,
    droneCodexPromptApprovalResolve,
    dronePromptCancel,
    droneCodexPromptEnqueue,
    dronePromptEnqueue,
    dronePromptGet,
    droneHealth,
    droneStatus,
    droneRuntime,
    dvmExec,
    dvmSessionType,
    dvmStart,
    dvmStop,
    ensureChatEntry,
    ensureClaudeSessionId,
    ensureContainerDroneDaemonSession,
    ensureCursorChatId,
    ensureHubChatSessionRunning,
    ensureOpenCodeSessionId,
    failStaleDockerSnapshotsForChat,
    formatTranscriptJobFailure,
    getChatEntry,
    hubChatSessionName,
    hubLog,
    importChatFromRegistry,
    importContainerDroneRuntime,
    inferChatAgent,
    isDraftChatEntry,
    isNotFoundErrorMessage,
    loadRegistry,
    listChatsFromStore,
    looksLikeTransientPromptEnqueueError,
    launchHostDroneDaemon,
    makeClient,
    maybeBootstrapPromptFromTranscript,
    maybeStartDockerSnapshotForTranscriptTurn,
    normalizeAgentPermissionMode,
    normalizeAgentApprovalPolicy,
    normalizeBuiltinAgentId,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeContainerPath,
    normalizeDroneCwdForRuntime,
    normalizeDroneIdentity,
    normalizePendingPromptState,
    normalizePendingPromptText,
    normalizePendingStartupPrompts,
    normalizeSubmittedAtIso,
    notifyDroneChatWrite,
    nowIso,
    openCodeSessionTitle,
    parseBlipJobTranscript,
    parseCodexJobTranscript,
    parsePiJobTranscript,
    parseSeedAgent,
    parseStructuredAgentJobTranscript,
    promptNativeChat,
    stopNativeChat,
    nativeChatIsBusy,
    nativeChatError,
    nativeChatLatestAssistantText,
    projectCanonicalChatToRegistry,
    promptWithImageAttachments,
    readBuiltinTranscriptSessionId,
    readChatFromStore,
    readChatAttachmentsFromRefs,
    resetTranscriptStoreForTests,
    resolveBlipPromptCommand,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveChatTmuxCommand,
    resolveCodexTurnRuntime,
    resolveDroneDaemonClientForEntry,
    resolveDroneEnvironmentConfig,
    resolveEffectiveLlmProvider,
    resolveEffectiveProviderApiKeySettings,
    resolveHostPort,
    resolveManagedChatMcpEnv,
    resolvePendingDroneDisplayName,
    resolveTranscriptPromptAt,
    sameAgentPlan,
    setChatAgentConfig,
    setDroneHubMetaByIdentity,
    shouldRetryFailedPendingPrompt,
    sleepMs,
    stalePendingPromptState,
    startupPromptToPendingPrompt,
    syncManagedFilesForDrone,
    syncSetService,
    unsupportedHostCustomAgentError,
    updateTranscriptTurnById,
    upgradeDroneDaemonInContainer,
    waitForDroneDaemonReady,
    withDroneOpLock,
    withLockedDroneContainer,
    withTimeout,
  } = deps;

  const provisionedPromptHandoffs = new ProvisionedPromptHandoffStore();
  const registerProvisionedPromptHandoff = (handoff: ProvisionedPromptHandoff) =>
    provisionedPromptHandoffs.register(handoff);

  async function measurePromptDeliveryPhase<T>(
    timing: PromptDeliveryTiming | undefined,
    name: string,
    run: () => Promise<T>,
  ): Promise<T> {
    return timing ? await timing.measure(name, run) : await run();
  }

  const daemonRecovery = new DroneDaemonRecovery({
    probe: async (client) => {
      // Health is an event-loop liveness check. Status also probes tmux-backed
      // process state, which can be slow under a burst of concurrent chats and
      // must not be used as evidence that the daemon itself is dead.
      await droneHealth(client, { timeoutMs: 3_000 });
    },
    shouldRecoverProbeError: (error) => !(error instanceof DroneApiRequestError),
    ensureContainer: async ({ containerName, containerPort }) => {
      await ensureContainerDroneDaemonSession({
        containerName,
        containerPort,
        forceRestart: true,
      });
    },
    launchHost: async ({ droneId, hostPort, token }) =>
      await launchHostDroneDaemon({ droneId, hostPort, token }),
    persistHostPid: async ({ droneId, pid }) => {
      await commitDroneMetadataPatch({
        droneId,
        state: 'real',
        eventType: 'drone.host-daemon.recovered',
        payload: { pid },
        transform: (lifecycle: Record<string, any>) => ({
          ...lifecycle,
          host: {
            ...(lifecycle?.host && typeof lifecycle.host === 'object' ? lifecycle.host : {}),
            pid,
          },
        }),
      });
    },
    waitUntilReady: async (client, timeoutMs) => {
      await waitForDroneDaemonReady(client, timeoutMs);
    },
  });

  async function enqueueTranscriptPrompt(opts: {
    id?: string;
    drone: any;
    waitForDaemonMs?: number;
    kind: string;
    script: string;
    prompt?: string;
    deliveryMode?: 'queue' | 'asap';
    signal?: AbortSignal;
    timing?: PromptDeliveryTiming;
  }) {
    throwIfBackgroundPromptAborted(opts.signal);
    const d = opts.drone;
    const runtime = droneRuntime(d);
    const droneId = normalizeDroneIdentity(d?.id) || String(d?.name ?? '');
    const containerName = String(d?.containerName ?? d?.name ?? '').trim();
    const token = typeof d.token === 'string' ? d.token : '';
    const hostPort = await measurePromptDeliveryPhase(opts.timing, 'resolveDaemonPort', async () =>
      typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
        ? d.hostPort
        : await resolveHostPort(containerName, d.containerPort),
    );
    if (!hostPort || !token) throw new Error('drone daemon not reachable (missing hostPort/token)');
    const daemonReadyTimeoutMs =
      typeof opts.waitForDaemonMs === 'number' &&
      Number.isFinite(opts.waitForDaemonMs) &&
      opts.waitForDaemonMs > 0
        ? Math.floor(opts.waitForDaemonMs)
        : defaultDaemonReadyTimeoutMs();
    const daemonReadyAfterUpgradeTimeoutMs =
      typeof opts.waitForDaemonMs === 'number' &&
      Number.isFinite(opts.waitForDaemonMs) &&
      opts.waitForDaemonMs > 0
        ? Math.floor(opts.waitForDaemonMs)
        : Math.max(daemonReadyTimeoutMs, UPGRADE_DAEMON_READY_TIMEOUT_MS);
    const client = makeClient(hostPort, token);
    const recovery = await measurePromptDeliveryPhase(
      opts.timing,
      'daemonReady',
      async () =>
        await daemonRecovery.ensure({
          droneId,
          runtime,
          client,
          containerName,
          containerPort: Number(d?.containerPort ?? hostPort),
          hostPort,
          token,
          readyTimeoutMs: daemonReadyTimeoutMs,
        }),
    );
    throwIfBackgroundPromptAborted(opts.signal);
    if (recovery.recovered) {
      hubLog('info', 'recovered drone daemon on demand', {
        droneId,
        runtime,
        containerName,
        hostPort,
      });
    }
    try {
      await measurePromptDeliveryPhase(
        opts.timing,
        'daemonEnqueueRequest',
        async () =>
          await dronePromptEnqueue(
            client,
            {
              id: String(opts.id ?? ''),
              kind: opts.kind,
              cmd: 'bash',
              args: ['-lc', opts.script],
              ...(typeof opts.prompt === 'string' ? { prompt: opts.prompt } : {}),
              ...(opts.deliveryMode ? { deliveryMode: opts.deliveryMode } : {}),
            },
            { signal: opts.signal },
          ),
      );
      ensureDaemonPromptEventSubscription(droneId);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (isNotFoundErrorMessage(msg)) {
        await upgradeDroneDaemonInContainer({ containerName, containerPort: d.containerPort });
        await waitForDroneDaemonReady(client, daemonReadyAfterUpgradeTimeoutMs, opts.signal);
        await dronePromptEnqueue(
          client,
          {
            id: String(opts.id ?? ''),
            kind: opts.kind,
            cmd: 'bash',
            args: ['-lc', opts.script],
            ...(typeof opts.prompt === 'string' ? { prompt: opts.prompt } : {}),
            ...(opts.deliveryMode ? { deliveryMode: opts.deliveryMode } : {}),
          },
          { signal: opts.signal },
        );
        ensureDaemonPromptEventSubscription(droneId);
        return;
      }
      throw e;
    }
  }

  async function enqueueCodexTranscriptPrompt(opts: {
    id: string;
    drone: any;
    waitForDaemonMs?: number;
    sessionKey: string;
    launchScript: string;
    prompt: string;
    imagePaths?: string[];
    existingThreadId?: string;
    forkThreadId?: string;
    deliveryMode?: 'queue' | 'asap';
    approvalPolicy: 'untrusted' | 'on-request' | 'never';
    approvalsReviewer: 'user' | 'auto_review';
    sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
    model?: string;
    effort?: string;
    signal?: AbortSignal;
    timing?: PromptDeliveryTiming;
  }) {
    throwIfBackgroundPromptAborted(opts.signal);
    const d = opts.drone;
    const runtime = droneRuntime(d);
    const droneId = normalizeDroneIdentity(d?.id) || String(d?.name ?? '');
    const containerName = String(d?.containerName ?? d?.name ?? '').trim();
    const token = typeof d.token === 'string' ? d.token : '';
    const hostPort = await measurePromptDeliveryPhase(opts.timing, 'resolveDaemonPort', async () =>
      typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
        ? d.hostPort
        : await resolveHostPort(containerName, d.containerPort),
    );
    if (!hostPort || !token) throw new Error('drone daemon not reachable (missing hostPort/token)');
    const daemonReadyTimeoutMs =
      typeof opts.waitForDaemonMs === 'number' &&
      Number.isFinite(opts.waitForDaemonMs) &&
      opts.waitForDaemonMs > 0
        ? Math.floor(opts.waitForDaemonMs)
        : defaultDaemonReadyTimeoutMs();
    const daemonReadyAfterUpgradeTimeoutMs = Math.max(
      daemonReadyTimeoutMs,
      UPGRADE_DAEMON_READY_TIMEOUT_MS,
    );
    const client = makeClient(hostPort, token);
    const recovery = await measurePromptDeliveryPhase(
      opts.timing,
      'daemonReady',
      async () =>
        await daemonRecovery.ensure({
          droneId,
          runtime,
          client,
          containerName,
          containerPort: Number(d?.containerPort ?? hostPort),
          hostPort,
          token,
          readyTimeoutMs: daemonReadyTimeoutMs,
        }),
    );
    throwIfBackgroundPromptAborted(opts.signal);
    if (recovery.recovered) {
      hubLog('info', 'recovered drone daemon on demand', {
        droneId,
        runtime,
        containerName,
        hostPort,
      });
    }
    const payload = {
      id: opts.id,
      sessionKey: opts.sessionKey,
      launchScript: opts.launchScript,
      prompt: opts.prompt,
      ...(opts.imagePaths?.length ? { imagePaths: opts.imagePaths } : {}),
      ...(opts.existingThreadId ? { existingThreadId: opts.existingThreadId } : {}),
      ...(opts.forkThreadId ? { forkThreadId: opts.forkThreadId } : {}),
      ...(opts.deliveryMode ? { deliveryMode: opts.deliveryMode } : {}),
      approvalPolicy: opts.approvalPolicy,
      approvalsReviewer: opts.approvalsReviewer,
      sandbox: opts.sandbox,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
    };
    const enqueueAtDaemon = async () => {
      const result = await droneCodexPromptEnqueue(client, payload, { signal: opts.signal });
      if (opts.deliveryMode === 'asap') {
        const disposition = String(result?.disposition ?? '').trim() || 'unknown';
        const steering =
          result?.steering && typeof result.steering === 'object' ? result.steering : null;
        hubLog(disposition === 'steered' ? 'info' : 'warn', 'Codex ASAP delivery result', {
          droneId,
          promptId: opts.id,
          sessionKey: opts.sessionKey,
          disposition,
          daemonState: String(result?.state ?? '').trim() || 'unknown',
          ...(String(result?.runId ?? '').trim() ? { runId: String(result.runId).trim() } : {}),
          ...(String(result?.turnId ?? '').trim()
            ? { responseTurnId: String(result.turnId).trim() }
            : {}),
          ...(steering ? { steering } : {}),
        });
      }
      return result;
    };
    const upgradeHostDaemon = async () => {
      const oldPid = Number(d?.host?.pid);
      if (!Number.isFinite(oldPid) || oldPid <= 0) {
        throw new Error('host drone daemon is outdated and has no restartable process id');
      }
      const pid = Math.floor(oldPid);
      const command = await commandForPid(pid);
      throwIfBackgroundPromptAborted(opts.signal);
      if (!command || !isDroneDaemonCommandForPort(command, hostPort)) {
        throw new Error(
          'host drone daemon is outdated, but its recorded process id no longer identifies the expected daemon',
        );
      }
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // It may have exited between the successful request and this upgrade.
      }
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          await sleepMs(100);
        } catch {
          break;
        }
      }
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already stopped.
      }
      const nextPid = await launchHostDroneDaemon({ droneId, hostPort, token });
      await waitForDroneDaemonReady(client, daemonReadyAfterUpgradeTimeoutMs);
      await commitDroneMetadataPatch({
        droneId,
        state: 'real',
        eventType: 'drone.host-daemon.upgraded',
        payload: { pid: nextPid },
        transform: (lifecycle: Record<string, any>) => ({
          ...lifecycle,
          host: {
            ...(lifecycle?.host && typeof lifecycle.host === 'object' ? lifecycle.host : {}),
            pid: nextPid,
          },
        }),
      });
    };
    try {
      await measurePromptDeliveryPhase(opts.timing, 'daemonEnqueueRequest', enqueueAtDaemon);
      ensureDaemonPromptEventSubscription(droneId);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (runtime === 'container' && isNotFoundErrorMessage(msg)) {
        await upgradeDroneDaemonInContainer({ containerName, containerPort: d.containerPort });
        await waitForDroneDaemonReady(client, daemonReadyAfterUpgradeTimeoutMs, opts.signal);
        await enqueueAtDaemon();
        ensureDaemonPromptEventSubscription(droneId);
        return;
      }
      if (runtime === 'host' && isNotFoundErrorMessage(msg)) {
        await upgradeHostDaemon();
        await enqueueAtDaemon();
        ensureDaemonPromptEventSubscription(droneId);
        return;
      }
      throw e;
    }
  }

  async function sendPromptToChat(opts: {
    id?: string;
    droneId: string;
    chatName: string;
    prompt: string;
    attachments?: ChatImageAttachment[];
    attachmentRefs?: ChatImageAttachmentRef[];
    cwd?: string | null;
    waitForDaemonMs?: number;
    skipManagedRepoSync?: boolean;
    deliveryMode?: 'queue' | 'asap';
    mark?: (name: string) => void;
    signal?: AbortSignal;
    timing?: PromptDeliveryTiming;
    provisioningHandoff?: ProvisionedPromptHandoff;
  }) {
    throwIfBackgroundPromptAborted(opts.signal);
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId) throw new Error('missing droneId');

    const provisioningHandoff = opts.provisioningHandoff;
    let dSeed: any = provisioningHandoff?.droneEntry ?? null;
    if (dSeed) {
      opts.timing?.record('reuseProvisioningState', 0);
    } else {
      const regAny: any = await measurePromptDeliveryPhase(
        opts.timing,
        'loadRegistryBeforeSync',
        async () => await loadRegistry(),
      );
      if (regAny?.pending?.[droneId] && !regAny?.drones?.[droneId]) {
        throw new Error(`drone "${droneId}" is still starting`);
      }
      dSeed = (regAny as any).drones?.[droneId];
      if (!dSeed) throw new Error(`unknown drone: ${droneId}`);
    }

    if (opts.skipManagedRepoSync !== true && !provisioningHandoff) {
      try {
        await measurePromptDeliveryPhase(
          opts.timing,
          'syncManagedFiles',
          async () => await syncManagedFilesForDrone({ droneId, droneEntry: dSeed }),
        );
        opts.mark?.('skillSync');
      } catch (e: any) {
        const error = String(e?.message ?? String(e));
        const warningKey = `${droneId}\u0000${error}`;
        if (!PROMPT_SKILL_SYNC_WARNINGS.has(warningKey)) {
          PROMPT_SKILL_SYNC_WARNINGS.add(warningKey);
          hubLog('warn', 'managed repo sync failed before prompt enqueue; continuing', {
            droneId,
            chatName: opts.chatName || 'default',
            error,
          });
        }
      }
    }
    throwIfBackgroundPromptAborted(opts.signal);

    const lockKey = `drone:${droneId}`;

    const lockWaitStartedAt = performance.now();
    return await withDroneOpLock(lockKey, async () => {
      opts.timing?.record('droneLockWait', performance.now() - lockWaitStartedAt);
      throwIfBackgroundPromptAborted(opts.signal);
      let regLatest: any = provisioningHandoff?.registrySnapshot ?? null;
      let d: any = provisioningHandoff?.droneEntry ?? null;
      if (!d) {
        regLatest = await measurePromptDeliveryPhase(
          opts.timing,
          'loadRegistryAfterLock',
          async () => await loadRegistry(),
        );
        if (regLatest?.pending?.[droneId] && !regLatest?.drones?.[droneId]) {
          throw new Error(`drone "${droneId}" is still starting`);
        }
        d = (regLatest as any).drones?.[droneId] ?? null;
        if (!d) throw new Error(`unknown drone: ${droneId}`);
      }
      const droneLabel = String(d?.name ?? '').trim() || droneId;
      const runtime = droneRuntime(d);
      const containerName =
        String(d?.containerName ?? '').trim() || String(d?.name ?? '').trim() || droneId;

      const normalizedChat = opts.chatName || 'default';
      if (!provisioningHandoff) {
        await measurePromptDeliveryPhase(
          opts.timing,
          'ensureChat',
          async () => await ensureChatEntry({ droneId, chatName: normalizedChat }),
        );
      }

      const { d: dWithChat, chat } = await measurePromptDeliveryPhase(
        opts.timing,
        'loadChat',
        async () => await getChatEntry({ droneId, chatName: normalizedChat }),
      );
      const agent = inferChatAgent(chat, dWithChat);
      const chatModel = normalizeChatModel((chat as any)?.model);
      const chatReasoning = normalizeChatReasoning((chat as any)?.reasoning);
      const agentPermissionMode = normalizeAgentPermissionMode((chat as any)?.agentPermissionMode);
      const approvalPolicy = normalizeAgentApprovalPolicy((chat as any)?.approvalPolicy);
      if (agentPermissionMode !== 'execute') assertReadOnlySupportedForAgent(agent);
      const managedEnv = resolveDroneEnvironmentConfig(regLatest, d).resolvedVars;
      const managedEnvLines = buildEnvExportLines(managedEnv);
      const managedChatMcpEnv = await measurePromptDeliveryPhase(
        opts.timing,
        'resolveChatMcpEnvironment',
        async () =>
          await resolveManagedChatMcpEnv({
            runtime,
            droneId,
            chatName: normalizedChat,
            chat,
          }),
      );
      const managedChatMcpEnvLines = buildEnvExportLines(managedChatMcpEnv);

      const cwd = normalizeDroneCwdForRuntime(d, typeof opts.cwd === 'string' ? opts.cwd : null);
      const cdCommand =
        runtime === 'host'
          ? `cd ${bashQuote(cwd)} 2>/dev/null || cd /`
          : `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data || cd /`;

      const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
      const providedAttachmentRefs = normalizeChatImageAttachmentRefs(opts.attachmentRefs);
      const promptId = String(opts.id ?? '').trim() || crypto.randomBytes(9).toString('hex');
      const attachmentsStorageRoot = chatAttachmentsStorageRootForDrone(d);
      const attachmentsForPrompt =
        providedAttachmentRefs.length > 0
          ? providedAttachmentRefs
          : buildChatImageAttachmentRefs({
              attachments,
              cwd,
              chatName: normalizedChat,
              promptId,
              storageRoot: attachmentsStorageRoot,
            });
      const effectivePrompt = promptWithImageAttachments(opts.prompt, attachmentsForPrompt);
      if (agent.kind === 'native') {
        const nativeAttachments =
          attachments.length > 0 || attachmentsForPrompt.length === 0
            ? attachments
            : await readChatAttachmentsFromRefs({
                runtime,
                containerName,
                attachments: attachmentsForPrompt,
              });
        await promptNativeChat({
          droneId,
          chatName: normalizedChat,
          chatId: String((chat as any)?.id ?? '').trim(),
          promptId,
          provider: String((chat as any)?.nativeProvider ?? '').trim(),
          model: String((chat as any)?.model ?? '').trim(),
          thinkingLevel: String((chat as any)?.reasoning ?? '').trim(),
          prompt: String(opts.prompt ?? '').trim(),
          attachments: nativeAttachments,
          deliveryMode: opts.deliveryMode,
          agentPermissionMode,
          approvalPolicy,
          submissionSource: 'system',
        });
        throwIfBackgroundPromptAborted(opts.signal);
        return {
          ok: true as const,
          agent,
          mode: 'native' as const,
          chat: normalizedChat,
          turnOk: true as const,
        };
      }
      const pendingNativeForkSourceSessionId =
        agent.kind === 'builtin'
          ? pendingChatForkSourceSessionId(chat, agent.id)
          : '';
      const promptWithHistory =
        agent.kind === 'builtin' && !pendingNativeForkSourceSessionId
          ? maybeBootstrapPromptFromTranscript({
              agentId: agent.id,
              prompt: effectivePrompt,
              chatEntry: chat,
            })
          : effectivePrompt;
      if (attachments.length > 0) {
        const attachmentsDir = buildChatAttachmentsDirectory({
          cwd,
          chatName: normalizedChat,
          promptId,
          storageRoot: attachmentsStorageRoot,
        });
        if (runtime === 'host') {
          await copyChatAttachmentsToHost({ hostDir: attachmentsDir, attachments });
        } else {
          await copyChatAttachmentsToContainer({
            containerName,
            containerDir: attachmentsDir,
            attachments,
          });
        }
      }

      if (agent.kind === 'builtin' && agent.id === 'cursor') {
        const chatId = await ensureCursorChatId({
          droneId,
          containerName,
          chatName: normalizedChat,
          runtime,
          cwd,
        });
        const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          ...managedChatMcpEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `agent${modelArg} --resume ${bashQuote(chatId)} -f --approve-mcps --print --output-format stream-json ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'cursor',
          script,
          prompt: effectivePrompt,
          deliveryMode: opts.deliveryMode,
          signal: opts.signal,
          timing: opts.timing,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          turnOk: true as const,
        };
      }

      if (agent.kind === 'builtin' && agent.id === 'codex') {
        const sandboxArg =
          agentPermissionMode === 'read'
            ? 'read-only'
            : agentPermissionMode === 'write'
              ? 'workspace-write'
              : 'danger-full-access';
        const approvalArg =
          approvalPolicy === 'auto'
            ? 'on-request'
            : approvalPolicy === 'none'
              ? 'never'
              : 'untrusted';
        const forkThreadId = pendingChatForkSourceSessionId(chat, 'codex');
        const existingThreadId = forkThreadId
          ? ''
          : readBuiltinTranscriptSessionId(chat, 'codex');
        const stableChatId = String((chat as any)?.id ?? '').trim() || normalizedChat;
        const launchScript = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          ...managedChatMcpEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          'exec codex app-server',
        ].join('\n');
        await enqueueCodexTranscriptPrompt({
          id: promptId,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          sessionKey: `${normalizedChat}:${stableChatId}`,
          launchScript,
          prompt: promptWithHistory,
          imagePaths: attachmentsForPrompt
            .filter((attachment: any) => String(attachment?.mime ?? '').startsWith('image/'))
            .map((attachment: any) => String(attachment?.path ?? '').trim())
            .filter(Boolean),
          ...(existingThreadId ? { existingThreadId } : {}),
          ...(forkThreadId ? { forkThreadId } : {}),
          deliveryMode: opts.deliveryMode,
          approvalPolicy: approvalArg,
          approvalsReviewer: approvalPolicy === 'auto' ? 'auto_review' : 'user',
          sandbox: sandboxArg,
          ...(chatModel ? { model: chatModel } : {}),
          ...(chatReasoning ? { effort: chatReasoning } : {}),
          signal: opts.signal,
          timing: opts.timing,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          codexThreadId: existingThreadId || null,
          turnOk: true as const,
        };
      }

      if (agent.kind === 'builtin' && agent.id === 'claude') {
        const forkSessionId = pendingChatForkSourceSessionId(chat, 'claude');
        const claudeSessionId = forkSessionId
          ? ''
          : await ensureClaudeSessionId({ droneId, chatName: normalizedChat });
        const supportsModel = chatModel
          ? await cliSupportsModelFlag({ runtime, containerName, cwd, bin: 'claude' })
          : false;
        const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          ...managedChatMcpEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `claude --print --dangerously-skip-permissions --output-format stream-json --verbose${modelArg}${
            forkSessionId
              ? ` --resume ${bashQuote(forkSessionId)} --fork-session`
              : ` --session-id ${bashQuote(claudeSessionId)}`
          } ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'claude',
          script,
          prompt: effectivePrompt,
          deliveryMode: opts.deliveryMode,
          signal: opts.signal,
          timing: opts.timing,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          claudeSessionId,
          turnOk: true as const,
        };
      }

      if (agent.kind === 'builtin' && agent.id === 'opencode') {
        const supportsModel = chatModel
          ? await cliSupportsModelFlag({ runtime, containerName, cwd, bin: 'opencode' })
          : false;
        const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
        const forkSessionId = pendingChatForkSourceSessionId(chat, 'opencode');
        const openCodeSessionId = forkSessionId
          ? ''
          : readBuiltinTranscriptSessionId(chat, 'opencode');
        const title = openCodeSessionTitle(droneLabel, normalizedChat);
        const resumeArg = forkSessionId
          ? ` --session ${bashQuote(forkSessionId)} --fork`
          : openCodeSessionId
            ? ` --session ${bashQuote(openCodeSessionId)}`
            : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          ...managedChatMcpEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `opencode run --format json --title ${bashQuote(title)}${modelArg}${resumeArg} ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'opencode',
          script,
          prompt: effectivePrompt,
          deliveryMode: opts.deliveryMode,
          signal: opts.signal,
          timing: opts.timing,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          openCodeSessionId: openCodeSessionId || null,
          turnOk: true as const,
        };
      }

      if (agent.kind === 'builtin' && agent.id === 'pi') {
        const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
        const forkSessionId = pendingChatForkSourceSessionId(chat, 'pi');
        const piSessionId = forkSessionId ? '' : readBuiltinTranscriptSessionId(chat, 'pi');
        const sessionArg = forkSessionId
          ? ` --fork ${bashQuote(forkSessionId)}`
          : piSessionId
            ? ` --session ${bashQuote(piSessionId)}`
            : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          ...managedChatMcpEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `pi --mode json${modelArg}${sessionArg} ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'pi',
          script,
          prompt: effectivePrompt,
          deliveryMode: opts.deliveryMode,
          signal: opts.signal,
          timing: opts.timing,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          piSessionId: piSessionId || null,
          turnOk: true as const,
        };
      }

      if (agent.kind === 'builtin' && agent.id === 'blip') {
        const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
        const reasoningArg = chatReasoning ? ` --reasoning ${bashQuote(chatReasoning)}` : '';
        const permissionArgs =
          workflowBlipPermissionArgs(chat) ??
          (agentPermissionMode === 'read'
            ? '--permission read-only --profile read-only'
            : agentPermissionMode === 'write'
              ? '--permission workspace-write --profile no-shell-workspace-write'
              : '--permission full-access --profile local-trusted-write');
        const forkSessionId = pendingChatForkSourceSessionId(chat, 'blip');
        const blipSessionId = forkSessionId ? '' : readBuiltinTranscriptSessionId(chat, 'blip');
        const sessionArg = forkSessionId
          ? ` --fork ${bashQuote(forkSessionId)}`
          : blipSessionId
            ? ` --session ${bashQuote(blipSessionId)}`
            : '';
        const blipCommand = resolveBlipPromptCommand(runtime);
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          ...managedChatMcpEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `${blipCommand} --jsonl ${permissionArgs}${modelArg}${reasoningArg}${sessionArg} ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'blip',
          script,
          deliveryMode: opts.deliveryMode,
          signal: opts.signal,
          timing: opts.timing,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          blipSessionId: blipSessionId || null,
          turnOk: true as const,
        };
      }

      // Custom agent: keep tmux-backed full CLI behavior.
      if (runtime === 'host') {
        throw unsupportedHostCustomAgentError();
      }
      const tmuxCmd = await resolveChatTmuxCommand({ droneId, chatName: normalizedChat });
      const { sessionName } = await ensureHubChatSessionRunning({
        containerName,
        chatName: normalizedChat,
        command: tmuxCmd,
        cwd,
        envVars: { ...(managedEnv ?? {}), ...managedChatMcpEnv },
      });
      await dvmSessionType(containerName, sessionName, { text: effectivePrompt });
      await sleepMs(60);
      await dvmSessionType(containerName, sessionName, { keys: ['C-m'] });
      return {
        ok: true as const,
        agent,
        mode: 'cli' as const,
        chat: normalizedChat,
        sessionName,
        turnOk: true as const,
      };
    });
  }

  // Reconcile pending prompt completion (drone daemon → registry transcript turns).
  //
  // Without this, the Hub can show a stale "typing" badge for drones whose pending prompts
  // have completed in the daemon but haven't been reconciled into registry turns yet.
  const chatReconciliationQueue = new ChatReconciliationQueue({
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    key: droneChatMapKey,
    execute: (input) => reconcileChatFromDaemon(input),
    concurrency: () => {
      const raw = String(process.env.DRONE_HUB_RECONCILE_CONCURRENCY ?? '').trim();
      const value = raw ? Number(raw) : NaN;
      return Number.isFinite(value) && value >= 1 ? value : 6;
    },
  });
  const daemonPromptEventMonitor = new DaemonPromptEventMonitor({
    normalizeDroneId: normalizeDroneIdentity,
    resolveClient: async (droneId) => {
      const resolved = await resolveCanonicalDroneOrPendingForReadRef(droneId);
      if (resolved?.kind !== 'real') return { exists: false, client: null };
      const daemon = await resolveDroneDaemonClientForEntry(resolved.drone);
      return { exists: true, client: daemon?.client ?? null };
    },
    onTerminalPrompt: enqueueReconcileForDaemonPromptEvent,
    onApprovalPending: enqueueReconcileForDaemonPromptEvent,
    sleep: sleepMs,
  });

  function enqueueReconcile(droneId: string, chatName: string): void {
    chatReconciliationQueue.enqueue(droneId, chatName);
  }

  const handleTerminalPromptWake = createTerminalPromptWakeHandler({
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    listChatNames: async (droneId) => {
      const stored = listChatsFromStore({ droneId });
      if (stored.available && !(globalThis as any).Bun) return stored.chats;
      let registryChatNames: string[] = [];
      try {
        const registry = await loadRegistry();
        const registryChats = registry?.drones?.[droneId]?.chats;
        if (registryChats && typeof registryChats === 'object') {
          registryChatNames = Object.keys(registryChats);
        }
      } catch {
        // Canonical chat and prompt state is enough to handle the wake-up.
      }
      return [...stored.chats, ...registryChatNames];
    },
    readPendingPrompts: async (droneId, chatName) => {
      const stored = readChatFromStore({ droneId, chatName });
      return stored.available && Array.isArray(stored.chat?.pendingPrompts)
        ? stored.chat.pendingPrompts
        : [];
    },
    enqueueReconcile,
    enqueuePromptPump: enqueuePendingPromptPump,
  });

  async function enqueueReconcileForDaemonPromptEvent(
    droneIdRaw: string,
    promptIdRaw: string,
  ): Promise<void> {
    await handleTerminalPromptWake(droneIdRaw, promptIdRaw);
  }

  function ensureDaemonPromptEventSubscription(droneId: string): void {
    daemonPromptEventMonitor.ensure(droneId);
  }

  function clearScheduledReconcileRetryByKey(key: string): void {
    chatReconciliationQueue.clearRetryByKey(key);
  }

  function scheduleReconcileRetry(droneId: string, chatName: string, delayMs = 2_000): void {
    chatReconciliationQueue.scheduleRetry(droneId, chatName, delayMs);
  }

  function looksLikeMissingContainerError(msg: string): boolean {
    const s = String(msg ?? '').toLowerCase();
    return (
      s.includes('no such container') ||
      s.includes('not found') ||
      s.includes('unknown container') ||
      s.includes('could not find') ||
      s.includes('does not exist')
    );
  }

  function looksLikeContainerNotRunningError(msg: string): boolean {
    const s = String(msg ?? '').toLowerCase();
    return (
      s.includes('is not running') ||
      s.includes('already stopped') ||
      (s.includes('cannot stop') && s.includes('not running'))
    );
  }

  function looksLikeContainerAlreadyRunningError(msg: string): boolean {
    const s = String(msg ?? '').toLowerCase();
    return s.includes('already running') || (s.includes('cannot start') && s.includes('running'));
  }

  function looksLikeContainerPausedError(msg: string): boolean {
    const s = String(msg ?? '').toLowerCase();
    return (
      s.includes('is paused') ||
      s.includes('container stopped/paused') ||
      s.includes('unpause the container')
    );
  }

  function looksLikeRepoUnavailableError(msg: string): boolean {
    const s = String(msg ?? '').toLowerCase();
    return (
      s.includes('not a git repository') ||
      s.includes('cannot change to') ||
      s.includes('unable to read current working directory')
    );
  }

  const STOPPED_BY_USER_ERROR = 'Stopped by user.';
  const STOPPED_BEFORE_SUBMISSION_ERROR = 'Stopped before submission.';
  const STOPPED_BY_ARCHIVE_ERROR = 'Stopped because the drone was archived.';
  const STOPPED_BY_DELETE_ERROR = 'Stopped because the drone was deleted.';
  const STOPPED_BY_LIFECYCLE_STOP_ERROR = 'Stopped because the drone was stopped.';
  const STOPPED_BY_LIFECYCLE_RESTART_ERROR = 'Stopped because the drone was restarted.';

  // NOTE: Pending prompts are executed in the drone daemon (tmux-backed) and are restart-resumable.

  function normalizeChatImageAttachmentRefs(raw: unknown): ChatImageAttachmentRef[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: ChatImageAttachmentRef[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const name = String((item as any).name ?? '').trim();
      const mime = String((item as any).mime ?? '')
        .trim()
        .toLowerCase();
      const sizeNum = Number((item as any).size ?? 0);
      const fileName = String((item as any).fileName ?? '').trim();
      const pathRaw = String((item as any).path ?? '').trim();
      const relRaw = String((item as any).relativePath ?? '').trim();
      if (!name || (!mime.startsWith('image/') && mime !== 'text/plain')) continue;
      if (!Number.isFinite(sizeNum) || sizeNum <= 0) continue;
      if (!pathRaw || !pathRaw.startsWith('/')) continue;
      out.push({
        name,
        mime,
        size: Math.floor(sizeNum),
        fileName: fileName || path.posix.basename(pathRaw),
        path: normalizeContainerPath(pathRaw),
        relativePath: relRaw || normalizeContainerPath(pathRaw),
      });
    }
    return out.slice(0, 8);
  }

  function attachmentOnlyPromptLabel(
    attachmentsRaw: ChatImageAttachment[] | ChatImageAttachmentRef[],
  ): string {
    return chatAttachmentPreviewLabel(Array.isArray(attachmentsRaw) ? attachmentsRaw : []);
  }

  const {
    cancelQueuedPendingPrompt,
    claimQueuedPendingPromptForPromotion,
    claimQueuedPendingPromptForSending,
    isSafePromptId,
    pendingPromptsFromChatEntry,
    pruneCompletedPendingPrompts,
    readPendingPrompt,
    readPendingPromptDispatchWindow,
    readPendingPrompts,
    readPendingStartupPrompts,
    reconcileCompletedInterruption,
    releasePendingPromptClaim,
    resolveInterruptedPendingPrompt,
    resumePendingPromptChats,
    retryPendingPrompt,
    transcriptTurnIdsFromEntry,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    updatePendingPrompt,
  } = createDronePendingPromptStore({
    normalizeChatImageAttachmentRefs,
    normalizeChatName,
    normalizePendingPromptState,
    normalizePendingPromptText,
    normalizePendingStartupPrompts,
    nowIso,
    onPendingPromptChanged: ({ droneId, chatName }: any) =>
      notifyDroneChatWrite?.(droneId, chatName),
    startupPromptToPendingPrompt,
  });

  function promptJobTmuxSessionName(promptIdRaw: string): string {
    // Keep this aligned with daemon.ts `promptSessionName`.
    const cleaned = String(promptIdRaw ?? '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .slice(0, 48);
    return `drone-prompt-${cleaned || 'job'}`;
  }

  async function recoverStalePromptJobSession(opts: {
    droneId: string;
    droneEntry: any;
    promptId: string;
  }): Promise<{ job: any | null; jobState: string | null }> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const promptId = String(opts.promptId ?? '').trim();
    if (!droneId || !promptId || !isSafePromptId(promptId)) return { job: null, jobState: null };
    const droneEntry = opts.droneEntry;
    const requestedDroneName = String(droneEntry?.name ?? droneId).trim() || droneId;
    const sessionName = promptJobTmuxSessionName(promptId);

    try {
      await withLockedDroneContainer(
        { requestedDroneName, droneEntry },
        async ({ containerName }: any) => {
          const script = `tmux kill-session -t ${bashQuote(sessionName)} 2>/dev/null || true`;
          await dvmExec(containerName, 'bash', ['-lc', script]);
        },
      );
    } catch {
      // Keep best-effort behavior: reconciliation below can still fail stale rows.
    }

    const regAfterKill: any = await loadRegistry();
    const dAfterKill = regAfterKill?.drones?.[droneId] ?? null;
    const token = typeof dAfterKill?.token === 'string' ? String(dAfterKill.token).trim() : '';
    const containerName =
      String(dAfterKill?.containerName ?? dAfterKill?.name ?? droneId).trim() || droneId;
    const hostPort =
      typeof dAfterKill?.hostPort === 'number' && Number.isFinite(dAfterKill.hostPort)
        ? dAfterKill.hostPort
        : await resolveHostPort(containerName, dAfterKill?.containerPort);
    if (!token || !hostPort) return { job: null, jobState: null };

    const client = makeClient(hostPort, token);
    let job: any = null;
    let jobState: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r: any = await dronePromptGet(client, promptId);
        const nextJob = r?.job ?? null;
        const nextState = String(nextJob?.state ?? '').trim();
        if (nextState) {
          job = nextJob;
          jobState = nextState;
        }
        if (nextState && nextState !== 'queued' && nextState !== 'running') break;
      } catch {
        // keep best-effort behavior
      }
      // eslint-disable-next-line no-await-in-loop
      await sleepMs(250);
    }
    return { job, jobState };
  }

  type StopChatResponseResult = {
    mode: 'transcript' | 'cli';
    stopped: boolean;
    stoppedPromptIds: string[];
    clearedPromptIds: string[];
    sessionName?: string | null;
  };

  async function stopTranscriptPendingPrompts(opts: {
    droneId: string;
    chatName: string;
    droneEntry: any;
    promptIds?: string[] | null;
  }): Promise<StopChatResponseResult> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    if (!droneId) throw new Error('missing droneId');

    await ensureChatEntry({ droneId, chatName });
    await reconcileChatFromDaemon({ droneId, chatName });

    const regAny: any = await loadRegistry();
    const entry = regAny?.drones?.[droneId]?.chats?.[chatName] ?? null;
    const transcriptIds = transcriptTurnIdsFromEntry(entry);
    const pending = (await readPendingPrompts({ droneId, chatName })).filter(
      (item: any) => !transcriptIds.has(item.id),
    );
    const explicitPromptIds = new Set(
      Array.isArray(opts.promptIds)
        ? opts.promptIds.map((id) => String(id ?? '').trim()).filter(Boolean)
        : [],
    );
    const filterByPromptIds = explicitPromptIds.size > 0;
    const cancelable = pending.filter((item: any) => {
      if (!item?.id) return false;
      if (filterByPromptIds) return explicitPromptIds.has(item.id);
      return item.state === 'queued' || item.state === 'sending' || item.state === 'sent';
    });
    if (cancelable.length === 0) {
      return { mode: 'transcript', stopped: false, stoppedPromptIds: [], clearedPromptIds: [] };
    }

    const queuedIds = cancelable
      .filter((item: any) => item.state === 'queued')
      .map((item: any) => item.id);
    const activeIds = cancelable
      .filter((item: any) => item.state === 'sending' || item.state === 'sent')
      .map((item: any) => item.id);

    if (activeIds.length > 0) {
      const token =
        typeof opts.droneEntry?.token === 'string' ? String(opts.droneEntry.token).trim() : '';
      const containerName =
        String(opts.droneEntry?.containerName ?? opts.droneEntry?.name ?? droneId).trim() ||
        droneId;
      const hostPort =
        typeof opts.droneEntry?.hostPort === 'number' && Number.isFinite(opts.droneEntry.hostPort)
          ? opts.droneEntry.hostPort
          : await resolveHostPort(containerName, opts.droneEntry?.containerPort);
      if (!token || !hostPort)
        throw new Error('drone daemon not reachable (missing hostPort/token)');

      const client = makeClient(hostPort, token);
      for (const promptId of activeIds) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await dronePromptCancel(client, promptId);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (!isNotFoundErrorMessage(msg)) throw e;
        }
      }
    }

    const stoppedPromptIds: string[] = [];
    const clearedPromptIds: string[] = [];
    for (const id of queuedIds) {
      // eslint-disable-next-line no-await-in-loop
      const cancelled = await cancelQueuedPendingPrompt({ droneId, chatName, promptId: id });
      if (cancelled.status === 'cancelled') clearedPromptIds.push(id);
    }
    for (const id of activeIds) {
      // eslint-disable-next-line no-await-in-loop
      await updatePendingPrompt({
        droneId,
        chatName,
        id,
        patch: { state: 'failed', error: STOPPED_BY_USER_ERROR, updatedAt: nowIso() },
      });
      stoppedPromptIds.push(id);
    }

    enqueuePendingPromptPump(droneId, chatName);
    return {
      mode: 'transcript',
      stopped: stoppedPromptIds.length > 0 || clearedPromptIds.length > 0,
      stoppedPromptIds,
      clearedPromptIds,
    };
  }

  async function resolveCodexPromptApproval(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    approvalId: string;
    decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
  }) {
    const promptId = String(opts.promptId ?? '').trim();
    const approvalId = String(opts.approvalId ?? '').trim();
    if (!promptId || !isSafePromptId(promptId)) throw new Error('invalid prompt id');
    if (!approvalId) throw new Error('missing Codex approval id');
    const { d, chat, droneId } = await getChatEntry({
      droneId: opts.droneId,
      chatName: normalizeChatName(opts.chatName),
    });
    const agent = inferChatAgent(chat, d);
    if (agent.kind !== 'builtin' || agent.id !== 'codex') {
      throw new Error('chat does not use Codex');
    }
    const pending = readPendingPrompt({
      droneId,
      chatName: normalizeChatName(opts.chatName),
      id: promptId,
    });
    const approval = Array.isArray((pending as any)?.approvals)
      ? (pending as any).approvals.find(
          (candidate: any) => String(candidate?.id ?? '').trim() === approvalId,
        )
      : null;
    if (!approval) throw new Error(`unknown Codex approval: ${approvalId}`);

    const token = typeof d?.token === 'string' ? String(d.token).trim() : '';
    const containerName = String(d?.containerName ?? d?.name ?? droneId).trim() || droneId;
    const hostPort =
      typeof d?.hostPort === 'number' && Number.isFinite(d.hostPort)
        ? d.hostPort
        : await resolveHostPort(containerName, d?.containerPort);
    if (!token || !hostPort) {
      throw new Error('drone daemon not reachable (missing hostPort/token)');
    }

    const result = await droneCodexPromptApprovalResolve(makeClient(hostPort, token), {
      promptId,
      approvalId,
      decision: opts.decision,
    });
    try {
      await updatePendingPrompt({
        droneId,
        chatName: normalizeChatName(opts.chatName),
        id: promptId,
        patch: {
          approvals: (pending as any).approvals.filter(
            (candidate: any) => String(candidate?.id ?? '').trim() !== approvalId,
          ),
          updatedAt: nowIso(),
        },
      });
    } catch (error: any) {
      hubLog('warn', 'Codex approval resolved but its pending projection did not update', {
        droneId,
        chatName: normalizeChatName(opts.chatName),
        promptId,
        approvalId,
        error: compactDiagnosticError(error),
      });
    }
    enqueueReconcile(droneId, normalizeChatName(opts.chatName));
    return result;
  }

  async function resolvePendingCodexApprovalsForNeverAsk(opts: {
    droneId: string;
    chatName: string;
  }): Promise<{ attempted: number; resolved: number }> {
    const chatName = normalizeChatName(opts.chatName);
    let droneId = normalizeDroneIdentity(opts.droneId);
    let refs: ReturnType<typeof pendingCodexApprovalsForNeverAsk> = [];
    try {
      const current = await getChatEntry({ droneId: opts.droneId, chatName });
      droneId = current.droneId;
      refs = pendingCodexApprovalsForNeverAsk({
        agent: inferChatAgent(current.chat, current.d),
        approvalPolicy: normalizeAgentApprovalPolicy(current.chat?.approvalPolicy),
        pendingPrompts: await readPendingPrompts({ droneId, chatName }),
      });
    } catch (error: any) {
      hubLog('warn', 'failed reading pending Codex approvals for never-ask chat', {
        droneId,
        chatName,
        error: compactDiagnosticError(error),
      });
      return { attempted: 0, resolved: 0 };
    }
    let attempted = 0;
    let resolved = 0;
    for (const ref of refs) {
      try {
        // A user can switch back to Ask while a batch is being released. Re-read
        // the durable policy before every decision so the newer setting wins.
        // eslint-disable-next-line no-await-in-loop
        const latest = await getChatEntry({ droneId, chatName });
        const latestAgent = inferChatAgent(latest.chat, latest.d);
        if (
          normalizeAgentApprovalPolicy(latest.chat?.approvalPolicy) !== 'none' ||
          latestAgent.kind !== 'builtin' ||
          latestAgent.id !== 'codex'
        ) {
          break;
        }
        // Resolve once here. DroneHub remains the source of the persistent policy and
        // repeats this for any later approval emitted by the already-running turn.
        // eslint-disable-next-line no-await-in-loop
        attempted += 1;
        await resolveCodexPromptApproval({
          droneId,
          chatName,
          promptId: ref.promptId,
          approvalId: ref.approvalId,
          decision: ref.decision,
        });
        resolved += 1;
      } catch (error: any) {
        const message = String(error?.message ?? error ?? '');
        if (/unknown Codex approval|no longer active/i.test(message)) continue;
        hubLog('warn', 'failed auto-approving Codex request for never-ask chat', {
          droneId,
          chatName,
          promptId: ref.promptId,
          approvalId: ref.approvalId,
          error: compactDiagnosticError(error),
        });
      }
    }
    return { attempted, resolved };
  }

  type DroneChatStopReason = 'archive' | 'delete' | 'stop' | 'restart';
  type DroneChatStopPlan = {
    chatNames: string[];
    builtinChatNames: string[];
    promptIds: string[];
    sessionNames: string[];
  };

  function droneChatStopError(reason: DroneChatStopReason): string {
    if (reason === 'archive') return STOPPED_BY_ARCHIVE_ERROR;
    if (reason === 'delete') return STOPPED_BY_DELETE_ERROR;
    return reason === 'restart'
      ? STOPPED_BY_LIFECYCLE_RESTART_ERROR
      : STOPPED_BY_LIFECYCLE_STOP_ERROR;
  }

  async function clearDroneHubState(droneIdRaw: string): Promise<void> {
    const droneId = normalizeDroneIdentity(droneIdRaw);
    if (!droneId) return;
    await setDroneHubMetaByIdentity({ droneId, hub: null });
  }

  async function runDroneLifecycleAction(opts: {
    droneId: string;
    droneEntry: any;
    action: 'start' | 'stop' | 'restart';
    source?: Record<string, unknown>;
  }) {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId) throw new Error('missing droneId');
    const droneEntry = opts.droneEntry;
    if (!droneEntry || typeof droneEntry !== 'object')
      throw new Error(`unknown drone: ${opts.droneId}`);
    if (droneRuntime(droneEntry) === 'host') {
      throw new Error('lifecycle controls are not yet supported for host runtime drones');
    }

    const droneName = String(droneEntry?.name ?? droneId).trim() || droneId;
    const containerName =
      String(droneEntry?.containerName ?? droneEntry?.name ?? `drone-${droneId}`).trim() ||
      `drone-${droneId}`;

    const beforeDiagnostics = await collectDroneRuntimeDiagnostics({ droneId, droneEntry }).catch(
      (error: any) => ({
        diagnosticError: compactDiagnosticError(error),
      }),
    );
    hubLog('info', 'drone lifecycle action requested', {
      droneId,
      droneName,
      action: opts.action,
      containerName,
      ...(opts.source ? { source: opts.source } : {}),
      before: beforeDiagnostics,
    });

    try {
      if (opts.action === 'stop' || opts.action === 'restart') {
        await stopAllDroneChatActivity({
          droneId,
          droneEntry,
          reason: opts.action === 'restart' ? 'restart' : 'stop',
          updateLiveRegistry: true,
        });
        try {
          await dvmStop(containerName);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (!looksLikeContainerNotRunningError(msg)) throw e;
        }
      }

      if (opts.action === 'start' || opts.action === 'restart') {
        try {
          await dvmStart(containerName);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (!looksLikeContainerAlreadyRunningError(msg)) throw e;
        }
        await ensureContainerDroneDaemonSession({
          containerName,
          containerPort: Number(droneEntry?.containerPort ?? 7777),
        });
      }

      await clearDroneHubState(droneId);
      const afterDiagnostics = await collectDroneRuntimeDiagnostics({ droneId, droneEntry }).catch(
        (error: any) => ({
          diagnosticError: compactDiagnosticError(error),
        }),
      );
      hubLog('info', 'drone lifecycle action completed', {
        droneId,
        droneName,
        action: opts.action,
        containerName,
        ...(opts.source ? { source: opts.source } : {}),
        after: afterDiagnostics,
      });
      return {
        ok: true as const,
        id: droneId,
        name: droneName,
        action: opts.action,
        runtime: 'container' as const,
        containerName,
      };
    } catch (error) {
      const afterDiagnostics = await collectDroneRuntimeDiagnostics({ droneId, droneEntry }).catch(
        (diagnosticError: any) => ({
          diagnosticError: compactDiagnosticError(diagnosticError),
        }),
      );
      hubLog('warn', 'drone lifecycle action failed', {
        droneId,
        droneName,
        action: opts.action,
        containerName,
        ...(opts.source ? { source: opts.source } : {}),
        error: compactDiagnosticError(error),
        after: afterDiagnostics,
      });
      throw error;
    }
  }

  function listStoppablePromptIdsFromChatEntry(entry: any): string[] {
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    const transcriptIds = new Set(
      turns.map((turn: any) => String(turn?.id ?? '').trim()).filter(Boolean),
    );
    return (Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [])
      .map((item: any) => ({
        id: String(item?.id ?? '').trim(),
        state: String(item?.state ?? '').trim(),
      }))
      .filter((item: { id: string; state: string }) => {
        if (!item.id || transcriptIds.has(item.id)) return false;
        return item.state === 'queued' || item.state === 'sending' || item.state === 'sent';
      })
      .map((item: { id: string; state: string }) => item.id);
  }

  function buildDroneChatStopPlan(opts: { droneId: string; droneEntry: any }): DroneChatStopPlan {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId || !opts.droneEntry || typeof opts.droneEntry !== 'object') {
      return { chatNames: [], builtinChatNames: [], promptIds: [], sessionNames: [] };
    }

    const runtime = droneRuntime(opts.droneEntry);
    const chats =
      opts.droneEntry?.chats && typeof opts.droneEntry.chats === 'object'
        ? Object.entries(opts.droneEntry.chats)
        : [];
    const chatNames = new Set<string>();
    const builtinChatNames = new Set<string>();
    const promptIds = new Set<string>();
    const sessionNames = new Set<string>();

    for (const [chatNameRaw, entry] of chats as Array<[string, any]>) {
      const chatName = normalizeChatName(chatNameRaw);
      if (!chatName) continue;
      chatNames.add(chatName);

      const agent = inferChatAgent(entry, opts.droneEntry);
      if (agent.kind === 'custom') {
        if (runtime !== 'host') sessionNames.add(hubChatSessionName(chatName));
        continue;
      }
      builtinChatNames.add(chatName);

      for (const id of listStoppablePromptIdsFromChatEntry(entry)) {
        promptIds.add(id);
        if (runtime !== 'host') sessionNames.add(promptJobTmuxSessionName(id));
      }
    }

    return {
      chatNames: [...chatNames],
      builtinChatNames: [...builtinChatNames],
      promptIds: [...promptIds],
      sessionNames: [...sessionNames],
    };
  }

  function markChatPendingPromptsStopped(
    entry: any,
    opts: {
      runtime: ReturnType<typeof droneRuntime>;
      stopError: string;
    },
  ): { promptIds: string[]; sessionNames: string[] } {
    const promptIds = listStoppablePromptIdsFromChatEntry(entry);
    if (promptIds.length === 0) return { promptIds: [], sessionNames: [] };

    const stoppableIds = new Set(promptIds);
    entry.pendingPrompts = (Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : []).map(
      (item: any) => {
        const id = String(item?.id ?? '').trim();
        if (!stoppableIds.has(id)) return item;
        return {
          ...item,
          state: 'failed',
          error: opts.stopError,
          updatedAt: nowIso(),
        };
      },
    );

    return {
      promptIds,
      sessionNames:
        opts.runtime === 'host'
          ? []
          : promptIds.map((promptId) => promptJobTmuxSessionName(promptId)),
    };
  }

  async function markDronePendingPromptsStopped(opts: {
    droneId: string;
    reason: DroneChatStopReason;
  }): Promise<{ promptIds: string[]; sessionNames: string[] }> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId) return { promptIds: [], sessionNames: [] };
    const stopError = droneChatStopError(opts.reason);
    const regAny = await loadRegistry();
    const d = (regAny as any)?.drones?.[droneId] ?? null;
    if (!d) return { promptIds: [], sessionNames: [] };
    const promptIds = new Set<string>();
    const sessionNames = new Set<string>();
    const runtime = droneRuntime(d);
    const chats = d?.chats && typeof d.chats === 'object' ? Object.keys(d.chats) : [];
    for (const chatNameRaw of chats) {
      const chatName = normalizeChatName(chatNameRaw);
      const stored = readChatFromStore({ droneId, chatName });
      const entry = stored.available && stored.chat ? stored.chat : d.chats[chatName];
      if (inferChatAgent(entry, d).kind !== 'builtin') continue;
      // eslint-disable-next-line no-await-in-loop
      const pending = await readPendingPrompts({ droneId, chatName });
      const ids = listStoppablePromptIdsFromChatEntry({ pendingPrompts: pending });
      for (const promptId of ids) {
        // eslint-disable-next-line no-await-in-loop
        await updatePendingPrompt({
          droneId,
          chatName,
          id: promptId,
          patch: { state: 'failed', error: stopError, updatedAt: nowIso() },
        });
        promptIds.add(promptId);
        if (runtime !== 'host') sessionNames.add(promptJobTmuxSessionName(promptId));
      }
    }
    return { promptIds: [...promptIds], sessionNames: [...sessionNames] };
  }

  async function cancelDronePromptJobsBestEffort(opts: {
    droneEntry: any;
    promptIds: string[];
  }): Promise<void> {
    const promptIds = Array.from(
      new Set((opts.promptIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)),
    );
    if (promptIds.length === 0) return;

    const daemon = await resolveDroneDaemonClientForEntry(opts.droneEntry).catch(() => null);
    if (!daemon) return;

    for (const promptId of promptIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await dronePromptCancel(daemon.client, promptId);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!isNotFoundErrorMessage(msg)) throw e;
      }
    }
  }

  async function killDroneTmuxSessionsBestEffort(opts: {
    droneId: string;
    droneEntry: any;
    sessionNames: string[];
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId || droneRuntime(opts.droneEntry) === 'host') return;

    const sessionNames = Array.from(
      new Set((opts.sessionNames ?? []).map((name) => String(name ?? '').trim()).filter(Boolean)),
    );
    if (sessionNames.length === 0) return;

    const requestedDroneName = String(opts.droneEntry?.name ?? droneId).trim() || droneId;
    try {
      await withLockedDroneContainer(
        { requestedDroneName, droneEntry: opts.droneEntry },
        async ({ containerName }: any) => {
          const script = [
            'set -euo pipefail',
            ...sessionNames.map(
              (sessionName) => `tmux kill-session -t ${bashQuote(sessionName)} 2>/dev/null || true`,
            ),
          ].join('\n');
          await dvmExec(containerName, 'bash', ['-lc', script]);
        },
      );
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!looksLikeMissingContainerError(msg) && !looksLikeContainerNotRunningError(msg)) throw e;
    }
  }

  async function stopAllDroneChatActivity(opts: {
    droneId: string;
    droneEntry: any;
    reason: DroneChatStopReason;
    updateLiveRegistry?: boolean;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId || !opts.droneEntry || typeof opts.droneEntry !== 'object') return;

    const plan = buildDroneChatStopPlan({ droneId, droneEntry: opts.droneEntry });
    if (
      plan.chatNames.length === 0 &&
      plan.promptIds.length === 0 &&
      plan.sessionNames.length === 0
    )
      return;

    const promptIds = new Set(plan.promptIds);
    const sessionNames = new Set(plan.sessionNames);

    for (const chatName of plan.chatNames) {
      clearInMemoryChatStateForDelete({ droneId, chatName });
    }

    if (opts.updateLiveRegistry !== false) {
      for (let pass = 0; pass < 2; pass += 1) {
        const marked = await markDronePendingPromptsStopped({ droneId, reason: opts.reason });
        for (const promptId of marked.promptIds) promptIds.add(promptId);
        for (const sessionName of marked.sessionNames) sessionNames.add(sessionName);
      }
    }

    await cancelDronePromptJobsBestEffort({
      droneEntry: opts.droneEntry,
      promptIds: [...promptIds],
    });
    await killDroneTmuxSessionsBestEffort({
      droneId,
      droneEntry: opts.droneEntry,
      sessionNames: [...sessionNames],
    });
  }

  async function stopSingleDroneChatActivity(opts: {
    droneId: string;
    chatName: string;
    droneEntry: any;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    if (!droneId || !chatName || !opts.droneEntry || typeof opts.droneEntry !== 'object') return;
    if (!chatNameExists(opts.droneEntry, chatName)) return;

    try {
      await stopChatResponse({ droneId, chatName, droneEntry: opts.droneEntry });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (
        /unknown chat/i.test(msg) ||
        /missing hostPort\/token/i.test(msg) ||
        /drone daemon not reachable/i.test(msg) ||
        /custom agents are not supported on host runtime/i.test(msg)
      ) {
        // Best-effort: continue removing/archive chat state even if live runtime cleanup is unavailable.
      } else {
        throw e;
      }
    }
    clearInMemoryChatStateForDelete({ droneId, chatName });
  }

  async function stopTranscriptChatResponse(opts: {
    droneId: string;
    chatName: string;
    droneEntry: any;
  }): Promise<StopChatResponseResult> {
    return await stopTranscriptPendingPrompts({
      droneId: opts.droneId,
      chatName: opts.chatName,
      droneEntry: opts.droneEntry,
    });
  }

  async function stopNativeChatResponse(opts: {
    droneId: string;
    chatName: string;
  }): Promise<StopChatResponseResult> {
    const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const nativeChatId = String(chat?.id ?? '').trim();
    if (!nativeChatId) throw new Error('native chat has no stable identity');
    await stopNativeChat(nativeChatId);
    return {
      mode: 'transcript',
      stopped: true,
      stoppedPromptIds: [],
      clearedPromptIds: [],
    };
  }

  async function stopCliChatResponse(opts: {
    droneId: string;
    chatName: string;
    droneEntry: any;
  }): Promise<StopChatResponseResult> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    if (!droneId) throw new Error('missing droneId');
    if (droneRuntime(opts.droneEntry) === 'host') throw unsupportedHostCustomAgentError();

    const requestedDroneName = String(opts.droneEntry?.name ?? droneId).trim() || droneId;
    const sessionName = hubChatSessionName(chatName);
    let stopped = false;
    await withLockedDroneContainer(
      { requestedDroneName, droneEntry: opts.droneEntry },
      async ({ containerName }: any) => {
        const script = [
          'set -euo pipefail',
          `session=${bashQuote(sessionName)}`,
          'tmux has-session -t "$session" 2>/dev/null || exit 3',
          'tmux send-keys -t "$session:0.0" C-c',
        ].join('\n');
        const result = await dvmExec(containerName, 'bash', ['-lc', script]);
        if (result.code === 0) {
          stopped = true;
          return;
        }
        if (result.code === 3) return;
        const msg =
          `${String(result.stderr ?? '')}\n${String(result.stdout ?? '')}`.trim() ||
          `failed to stop session ${sessionName}`;
        throw new Error(msg);
      },
    );

    return {
      mode: 'cli',
      stopped,
      stoppedPromptIds: [],
      clearedPromptIds: [],
      sessionName,
    };
  }

  async function stopChatResponse(opts: {
    droneId: string;
    chatName: string;
    droneEntry: any;
  }): Promise<StopChatResponseResult> {
    await ensureChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
    const agent = inferChatAgent(chat, opts.droneEntry);
    if (agent.kind === 'builtin') {
      return await stopTranscriptChatResponse(opts);
    }
    if (agent.kind === 'native') {
      return await stopNativeChatResponse(opts);
    }
    return await stopCliChatResponse(opts);
  }

  function chatHasActivePendingPrompts(entry: any): boolean {
    const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (pending.length === 0) return false;
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
    for (const p of pending) {
      const state = String(p?.state ?? '').trim();
      if (state === 'failed') continue;
      const id = String(p?.id ?? '').trim();
      if (!id) continue;
      if (doneIds.has(id)) continue;
      return true;
    }
    return false;
  }

  function pendingPromptPumpConcurrencyLimit(): number {
    const raw = String(process.env.DRONE_HUB_PENDING_PROMPT_PUMP_CONCURRENCY ?? '').trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(16, Math.floor(n)));
    return 6;
  }

  function interruptedPromptDeliveryError(raw: unknown): string {
    const detail = String(raw ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 240);
    return detail
      ? `Prompt delivery was interrupted; retrying when the drone daemon is available. Last error: ${detail}`
      : 'Prompt delivery was interrupted; retrying when the drone daemon is available.';
  }

  function throwIfBackgroundPromptAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new Error('Prompt delivery aborted');
  }

  function backgroundPromptWasAborted(signal: AbortSignal): boolean {
    return signal.aborted;
  }

  async function capturePendingPromptFileChangesBaseline(input: {
    droneId: string;
    chatName: string;
    promptId: string;
    drone: any;
    baseline?: AgentRunFileChangesBaseline;
  }): Promise<void> {
    try {
      const baseline =
        input.baseline ??
        (await captureDroneRunFileChangesBaseline({
          droneId: input.droneId,
          drone: input.drone,
          owner: { chatName: input.chatName, promptId: input.promptId },
        }));
      if (!baseline) return;
      await updatePendingPrompt({
        droneId: input.droneId,
        chatName: input.chatName,
        id: input.promptId,
        patch: { fileChangesBaseline: baseline },
      });
    } catch (error: any) {
      hubLog('warn', 'failed capturing agent run file changes baseline', {
        droneId: input.droneId,
        chatName: input.chatName,
        promptId: input.promptId,
        error: String(error?.message ?? error ?? 'unknown error'),
      });
    }
  }

  async function pumpQueuedPendingPromptsForChat(opts: {
    droneId: string;
    chatName: string;
    signal: AbortSignal;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = String(opts.chatName ?? '').trim() || 'default';
    if (!droneId) return;

    // Avoid unbounded loops if state keeps changing due to concurrent requests.
    for (let attempts = 0; attempts < 50; attempts++) {
      const dispatchStartedEpochMs = Date.now();
      const dispatchStartedMonotonicMs = performance.now();
      throwIfBackgroundPromptAborted(opts.signal);
      const provisioningPreview = provisionedPromptHandoffs.peekForChat({ droneId, chatName });
      const previewDrone = provisioningPreview?.droneEntry ?? null;
      const previewChat = previewDrone?.chats?.[chatName] ?? null;
      const { d, chat } =
        previewDrone && previewChat
          ? { d: previewDrone, chat: previewChat }
          : await getChatEntry({ droneId, chatName });
      if (isDraftChatEntry(chat)) return;
      const agent = inferChatAgent(chat, d);
      if (!agent || (agent.kind !== 'builtin' && agent.kind !== 'native')) return;

      const entry: any = chat;
      const turns: any[] = Array.isArray(entry?.turns) ? entry.turns : [];
      const transcriptDoneIds = completedTurnIds(turns);
      if (
        await reconcileCompletedInterruption({
          droneId,
          chatName,
          completedPromptIds: transcriptDoneIds,
        })
      ) {
        continue;
      }
      // Prompt rows are canonical in SQLite; the registry-backed chat projection
      // is compatibility metadata and can lag queue transitions.
      const dispatchWindow = readPendingPromptDispatchWindow({ droneId, chatName });
      const pendingList: any[] = (
        dispatchWindow?.prompts ?? (await readPendingPrompts({ droneId, chatName }))
      ).filter(
        (pending: any) =>
          !(String(pending?.state ?? '') === 'sent' && isSendInNewChatQueueAction(pending?.action)),
      );
      if (pendingList.length === 0) return;

      let queuedIndex = dispatchWindow?.candidateId
        ? pendingList.findIndex(
            (p: any) => String(p?.id ?? '').trim() === dispatchWindow.candidateId,
          )
        : -1;
      if (!dispatchWindow) {
        const queuedActionIndex = pendingList.findIndex(
          (p: any) =>
            String(p?.state ?? '') === 'queued' &&
            isSendInNewChatQueueAction(p?.action) &&
            String(p?.id ?? '').trim(),
        );
        const actionBarrierIndex = queuedActionIndex >= 0 ? queuedActionIndex : pendingList.length;
        const asapIndex = pendingList.findIndex(
          (p: any, index: number) =>
            index <= actionBarrierIndex &&
            String(p?.state ?? '') === 'queued' &&
            p?.deliveryMode === 'asap' &&
            String(p?.id ?? '').trim(),
        );
        queuedIndex =
          asapIndex >= 0
            ? asapIndex
            : pendingList.findIndex(
                (p: any, index: number) =>
                  index <= actionBarrierIndex &&
                  String(p?.state ?? '') === 'queued' &&
                  String(p?.id ?? '').trim(),
              );
      }
      if (queuedIndex === -1) return;

      const p = pendingList[queuedIndex] ?? {};
      const id = String(p?.id ?? '').trim();
      const prompt = String(p?.prompt ?? '');
      const cwd = typeof p?.cwd === 'string' ? String(p.cwd) : null;
      if (!id || !prompt.trim()) {
        // Mark invalid entries as failed so they don't block forever.
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: 'invalid queued prompt' },
        }).catch(() => {});
        continue;
      }

      const prior = pendingList.slice(0, queuedIndex);
      // Keep manual follow-ups cancellable until the earlier response reaches the transcript.
      // Codex App Server is the exception: ASAP is a same-turn `turn/steer`, so every
      // queued steering input should be offered while the active turn can still accept it.
      const codexAsapCanSteer =
        p?.deliveryMode === 'asap' && agent.kind === 'builtin' && agent.id === 'codex';
      const defer =
        !codexAsapCanSteer &&
        hasBlockingPendingPrompt(
          prior,
          turns,
          p?.deliveryMode === 'asap' ? 'asap' : 'queue',
        );
      if (defer) {
        // Completion events are an optimization, not the only wake-up edge.
        // Recheck so an automated prompt cannot remain queued after a missed event.
        schedulePendingPromptPumpRetry(droneId, chatName);
        return;
      }

      if (isSendInNewChatQueueAction(p?.action)) {
        const claimed = await claimQueuedPendingPromptForSending({ droneId, chatName, id });
        if (!claimed) continue;
        const claimedPending = readPendingPrompt({ droneId, chatName, id });
        if (!claimedPending) continue;
        try {
          throwIfBackgroundPromptAborted(opts.signal);
          await sendInNewChatActionRuntime.executeClaimed({
            droneId,
            sourceChatName: chatName,
            pending: claimedPending,
          });
          throwIfBackgroundPromptAborted(opts.signal);
        } catch (error) {
          if (backgroundPromptWasAborted(opts.signal)) {
            await releasePendingPromptClaim({
              droneId,
              chatName,
              id,
              error: 'Prompt action paused during DroneHub shutdown; retrying after restart.',
            });
            return;
          }
          await sendInNewChatActionRuntime.failOrRetry({
            droneId,
            sourceChatName: chatName,
            actionId: id,
            error,
          });
          return;
        }
        continue;
      }

      if (nativeAssistantOwnsPromptDelivery(agent.kind)) {
        try {
          // Native chats and daemon-backed chats share the canonical prompt table,
          // but the native assistant drain must own the queued -> sending claim.
          // Claiming here first leaves the assistant drain with no claimable row.
          await sendPromptToChat({
            id,
            droneId,
            chatName,
            prompt,
            attachmentRefs: normalizeChatImageAttachmentRefs(p?.attachments),
            cwd,
            waitForDaemonMs: undefined,
            deliveryMode: p?.deliveryMode === 'asap' ? 'asap' : 'queue',
            signal: opts.signal,
          });
        } catch (e: any) {
          if (backgroundPromptWasAborted(opts.signal)) return;
          const errorText = e?.message ?? String(e);
          hubLog('warn', 'queued native prompt enqueue failed', {
            droneId,
            chatName,
            promptId: id,
            error: String(errorText ?? 'unknown error'),
          });
          if (looksLikeTransientPromptEnqueueError(errorText)) {
            schedulePendingPromptPumpRetry(droneId, chatName);
          } else {
            await updatePendingPrompt({
              droneId,
              chatName,
              id,
              patch: { state: 'failed', error: errorText },
            });
          }
        }
        return;
      }

      const deliveryTiming = createPromptDeliveryTiming({
        promptId: id,
        droneId,
        chatName,
        submittedAt: typeof p?.at === 'string' ? p.at : null,
        attemptStartedEpochMs: dispatchStartedEpochMs,
        attemptStartedMonotonicMs: dispatchStartedMonotonicMs,
      });
      deliveryTiming.record(
        'selectDispatchCandidate',
        performance.now() - dispatchStartedMonotonicMs,
      );

      // Transition queued -> sending before we attempt any daemon work.
      // This claim is atomic to prevent a race where a user cancels a queued row.
      const claimed = await deliveryTiming.measure(
        'claimPrompt',
        async () => await claimQueuedPendingPromptForSending({ droneId, chatName, id }),
      );
      if (!claimed) {
        hubLog('info', 'prompt delivery timing', {
          ...deliveryTiming.snapshot(),
          outcome: 'claim-lost',
        });
        continue;
      }

      const provisioningHandoff = provisionedPromptHandoffs.take({
        droneId,
        chatName,
        promptId: id,
      });

      await deliveryTiming.measure(
        'captureFileChangesBaseline',
        async () =>
          await capturePendingPromptFileChangesBaseline({
            droneId,
            chatName,
            promptId: id,
            drone: d,
            baseline: provisioningHandoff?.fileChangesBaseline,
          }),
      );

      let deliveryOutcome = 'failed';
      try {
        const enqueueTimeoutMs = defaultPromptEnqueueTimeoutMs();
        const r: any = await withTimeout(
          sendPromptToChat({
            id,
            droneId,
            chatName,
            prompt,
            attachmentRefs: normalizeChatImageAttachmentRefs(p?.attachments),
            cwd,
            waitForDaemonMs: undefined,
            deliveryMode: p?.deliveryMode === 'asap' ? 'asap' : 'queue',
            signal: opts.signal,
            timing: deliveryTiming,
            provisioningHandoff: provisioningHandoff ?? undefined,
          }),
          enqueueTimeoutMs,
          `queued prompt enqueue failed for ${droneId}/${chatName}`,
        );
        if (r?.turnOk === false) {
          await deliveryTiming.measure(
            'persistDeliveryState',
            async () =>
              await updatePendingPrompt({
                droneId,
                chatName,
                id,
                patch: { state: 'failed', error: String(r?.error ?? 'failed') },
              }),
          );
          deliveryOutcome = 'agent-rejected';
        } else {
          if (agent.kind === 'native') {
            const nativeChatId = String((chat as any)?.id ?? '').trim();
            if (!nativeChatId) throw new Error('native chat has no stable identity');
            await waitForNativePromptCompletion(nativeChatId, 30 * 60_000);
          }
          await deliveryTiming.measure(
            'persistDeliveryState',
            async () =>
              await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sent' } }),
          );
          deliveryOutcome = 'enqueued';
          if (agent.kind === 'builtin') {
            // Best-effort: reconcile soon after enqueue to keep UI fresh.
            enqueueReconcile(droneId, chatName);
          }
        }
      } catch (e: any) {
        if (backgroundPromptWasAborted(opts.signal)) {
          deliveryOutcome = 'paused';
          await releasePendingPromptClaim({
            droneId,
            chatName,
            id,
            error: 'Prompt delivery paused during DroneHub shutdown; retrying after restart.',
          });
          return;
        }
        const errorText = e?.message ?? String(e);
        const diagnostics =
          looksLikeTransientPromptEnqueueError(errorText) ||
          looksLikeContainerPausedError(errorText)
            ? await collectDroneRuntimeDiagnostics({ droneId, droneEntry: d }).catch(
                (error: any) => ({
                  diagnosticError: compactDiagnosticError(error),
                }),
              )
            : null;
        hubLog('warn', 'queued pending prompt enqueue failed', {
          droneId,
          chatName,
          promptId: id,
          error: String(errorText ?? 'unknown error'),
          ...(diagnostics ? { diagnostics } : {}),
        });
        if (looksLikeTransientPromptEnqueueError(errorText)) {
          deliveryOutcome = 'retry';
          const retry = await retryPendingPrompt({
            droneId,
            chatName,
            id,
            error: interruptedPromptDeliveryError(errorText),
          });
          if (retry.disposition === 'retry') {
            const nextMs = retry.nextAttemptAt ? Date.parse(retry.nextAttemptAt) : NaN;
            schedulePendingPromptPumpRetry(
              droneId,
              chatName,
              Number.isFinite(nextMs) ? Math.max(1_000, nextMs - Date.now()) : undefined,
            );
          }
          return;
        }
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: errorText },
        });
      } finally {
        hubLog('info', 'prompt delivery timing', {
          ...deliveryTiming.snapshot(),
          outcome: deliveryOutcome,
        });
      }
    }
  }

  const pendingPromptPump = new PendingPromptPump({
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    concurrencyLimit: pendingPromptPumpConcurrencyLimit,
    defaultRetryDelayMs: defaultPendingPromptEnqueueRetryDelayMs,
    run: async (target, signal) => await pumpQueuedPendingPromptsForChat({ ...target, signal }),
  });

  async function resetPromptRuntimeStateForTests(): Promise<void> {
    await pendingPromptPump.reset();
    provisionedPromptHandoffs.clear();
    resetTranscriptStoreForTests();
  }

  function enqueuePendingPromptPump(droneIdRaw: string, chatName: string) {
    pendingPromptPump.enqueue(droneIdRaw, chatName);
  }

  function schedulePendingPromptPumpRetry(
    droneIdRaw: string,
    chatNameRaw: string,
    delayMs: number = defaultPendingPromptEnqueueRetryDelayMs(),
  ) {
    pendingPromptPump.scheduleRetry(droneIdRaw, chatNameRaw, delayMs);
  }

  function droneChatMapKey(droneIdRaw: string, chatNameRaw: string): string {
    const droneId = normalizeDroneIdentity(droneIdRaw);
    if (!droneId) return '';
    const chatName = normalizeChatName(chatNameRaw);
    return `${droneId}:${chatName}`;
  }

  function clearInMemoryChatStateForDelete(opts: { droneId: string; chatName: string }) {
    const key = droneChatMapKey(opts.droneId, opts.chatName);
    if (!key) return;

    chatReconciliationQueue.delete(opts.droneId, opts.chatName);

    pendingPromptPump.delete(opts.droneId, opts.chatName);
  }

  function migrateInMemoryChatStateForRename(opts: {
    droneId: string;
    fromChatName: string;
    toChatName: string;
  }) {
    const fromKey = droneChatMapKey(opts.droneId, opts.fromChatName);
    const toKey = droneChatMapKey(opts.droneId, opts.toChatName);
    if (!fromKey || !toKey || fromKey === toKey) return;

    chatReconciliationQueue.migrate(opts.droneId, opts.fromChatName, opts.toChatName);

    pendingPromptPump.migrate(opts.droneId, opts.fromChatName, opts.toChatName);
  }

  function chatHasActivePendingPromptsForSummary(entry: any): boolean {
    const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (pending.length === 0) return false;
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
    const native = inferChatAgent(entry, null).kind === 'native';
    for (const p of pending) {
      const st = String(p?.state ?? '').trim();
      const id = String(p?.id ?? '').trim();
      if (
        pendingPromptKeepsChatBusy({
          state: st,
          hasTurn: Boolean(id && doneIds.has(id)),
          native,
          countsAsAgentRun: !isSendInNewChatQueueAction(p?.action),
        })
      )
        return true;
    }
    return false;
  }

  function chatRequiresCodexApprovalForSummary(opts: {
    droneId: string;
    chatName: string;
    entry: any;
    preferEntry?: boolean;
  }): boolean {
    const stored = opts.preferEntry
      ? null
      : readChatFromStore({
          droneId: normalizeDroneIdentity(opts.droneId),
          chatName: normalizeChatName(opts.chatName),
        });
    const pending =
      !opts.preferEntry && Array.isArray(stored?.chat?.pendingPrompts)
        ? stored.chat.pendingPrompts
        : Array.isArray(opts.entry?.pendingPrompts)
          ? opts.entry.pendingPrompts
          : [];
    return pending.some(
      (prompt: any) =>
        Array.isArray(prompt?.approvals) &&
        prompt.approvals.some((approval: any) => approval?.status === 'pending'),
    );
  }

  type BusyChatDebugEntry = {
    chatName: string;
    reasons: string[];
    pendingPrompts: Array<{ id: string; state: string; hasTurn: boolean }>;
  };

  const droneBusyDebugLastById = new Map<string, string>();

  function droneBusyDebugEnabled(): boolean {
    return String(process.env.DRONE_HUB_BUSY_DEBUG ?? '').trim() !== '0';
  }

  function busyChatDebugForEntry(
    droneId: string,
    chatName: string,
    entry: any,
  ): BusyChatDebugEntry {
    const reasons: string[] = [];
    const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
    const pendingPrompts = pending
      .map((p: any) => {
        const id = String(p?.id ?? '').trim();
        return {
          id,
          state: String(p?.state ?? '').trim(),
          hasTurn: Boolean(id && doneIds.has(id)),
        };
      })
      .filter((p: { id: string }) => p.id);
    if (chatHasActivePendingPromptsForSummary(entry)) reasons.push('active-pending-prompt');
    if (chatHasActiveDockerSnapshot(entry)) reasons.push('docker-snapshot');
    return { chatName, reasons, pendingPrompts };
  }

  function logDroneBusyDebugChange(
    d: any,
    droneId: string,
    diagnostics: BusyChatDebugEntry[],
  ): void {
    if (!droneBusyDebugEnabled()) return;
    const busyChats = diagnostics.filter((item) => item.reasons.length > 0);
    const signature = JSON.stringify(busyChats);
    if (droneBusyDebugLastById.get(droneId) === signature) return;
    droneBusyDebugLastById.set(droneId, signature);
    console.log('[DroneHub][busy-debug] summary busy changed', {
      droneId,
      name: String(d?.name ?? droneId).trim() || droneId,
      busy: busyChats.length > 0,
      busyChats,
    });
  }

  function busyChatNamesForDrone(d: any, droneIdRaw: string): string[] {
    const droneId = normalizeDroneIdentity(droneIdRaw);
    if (!droneId) return [];
    const chats = d?.chats && typeof d.chats === 'object' ? Object.entries(d.chats) : [];
    const out: string[] = [];
    const diagnostics: BusyChatDebugEntry[] = [];
    for (const [chatNameRaw, entry] of chats as Array<[string, any]>) {
      const chatName = normalizeChatName(chatNameRaw);
      if (!chatName || out.includes(chatName)) continue;
      const debug = busyChatDebugForEntry(droneId, chatName, entry);
      diagnostics.push(debug);
      if (debug.reasons.length > 0) out.push(chatName);
    }
    logDroneBusyDebugChange(d, droneId, diagnostics);
    return out;
  }

  function chatHasReconcilablePendingPrompts(entry: any): boolean {
    const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (pending.length === 0) return false;
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
    for (const p of pending) {
      const st = String(p?.state ?? '');
      if (st === 'failed') {
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
      // `queued` entries haven't been enqueued into the daemon yet, so there's nothing
      // to reconcile from daemon → transcript for them.
      if (st === 'queued') continue;
      const id = String(p?.id ?? '').trim();
      if (!id) continue;
      if (!doneIds.has(id)) return true;
    }
    return false;
  }

  const chatReconciliationExecutor = createChatReconciliationExecutor({
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
    resolvePendingCodexApprovalsForNeverAsk,
    resolveHostPort,
    resolveTranscriptPromptAt,
    sameAgentPlan,
    schedulePendingPromptPumpRetry,
    scheduleReconcileRetry,
    shouldRetryFailedPendingPrompt,
    stalePendingPromptState,
    updatePendingPrompt,
    STOPPED_BY_USER_ERROR,
  });
  const { reconcileChatFromDaemon } = chatReconciliationExecutor;

  async function waitForNativePromptCompletion(
    nativeChatId: string,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (!(await nativeChatIsBusy(nativeChatId))) {
        const error = await nativeChatError(nativeChatId);
        if (error) throw new Error(error);
        return;
      }
      await sleepMs(250);
    } while (Date.now() < deadline);
    throw new Error('Timed out waiting for the Built-in agent to finish');
  }

  async function enqueuePrompt(
    opts: EnqueuePromptOptions,
  ): Promise<{ id: string; pendingState: PendingPromptState }> {
    const preferredIdRaw = typeof opts.id === 'string' ? opts.id.trim() : '';
    if (preferredIdRaw && !isSafePromptId(preferredIdRaw)) {
      throw new Error('invalid promptId');
    }
    const id = preferredIdRaw || crypto.randomBytes(9).toString('hex');
    const at = normalizeSubmittedAtIso(opts.submittedAt);
    const chatName = normalizeChatName(opts.chatName);
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId) throw new Error('missing droneId');

    // Make sure chat exists before we write pending state.
    await ensureChatEntry({ droneId, chatName });
    opts.mark?.('ensureChat');
    const { d, chat } = await getChatEntry({ droneId, chatName });
    const canonicalPendingPrompts = await readPendingPrompts({ droneId, chatName });
    const runtime = droneRuntime(d);
    const configuredModel = normalizeChatModel((chat as any)?.model);
    const defer = hasBlockingPendingPrompt(
      canonicalPendingPrompts,
      (chat as any)?.turns,
      opts.priority,
    );
    opts.mark?.('disposition');

    const cwd = normalizeDroneCwdForRuntime(d, typeof opts.cwd === 'string' ? opts.cwd : null);
    const rawAttachments = Array.isArray(opts.attachments) ? opts.attachments : [];
    const providedAttachmentRefs = normalizeChatImageAttachmentRefs(opts.attachmentRefs);
    const attachmentsStorageRoot = chatAttachmentsStorageRootForDrone(d);
    const attachmentsForPending =
      providedAttachmentRefs.length > 0
        ? providedAttachmentRefs
        : buildChatImageAttachmentRefs({
            attachments: rawAttachments,
            cwd,
            chatName,
            promptId: id,
            storageRoot: attachmentsStorageRoot,
          });

    const persistedPrompt = await pushPendingPrompt({
      droneId,
      chatName,
      submissionSource: opts.submissionSource,
      pending: {
        id,
        at,
        prompt: opts.prompt,
        ...(opts.messageId ? { messageId: opts.messageId } : {}),
        ...(configuredModel ? { model: configuredModel } : {}),
        cwd: opts.cwd ?? null,
        ...(attachmentsForPending.length > 0 ? { attachments: attachmentsForPending } : {}),
        ...(opts.priority ? { deliveryMode: opts.priority } : {}),
        state: defer || opts.deliveryMode === 'background' ? 'queued' : 'sending',
        updatedAt: at,
      },
    });
    opts.mark?.('persistPending');
    const recoveringInterruptedPrompt = Boolean(persistedPrompt?.interruptedPromptId);

    if (defer || opts.deliveryMode === 'background' || recoveringInterruptedPrompt) {
      if (
        providedAttachmentRefs.length === 0 &&
        rawAttachments.length > 0 &&
        attachmentsForPending.length > 0
      ) {
        const attachmentsDir = buildChatAttachmentsDirectory({
          cwd,
          chatName,
          promptId: id,
          storageRoot: attachmentsStorageRoot,
        });
        try {
          if (runtime === 'host') {
            await copyChatAttachmentsToHost({
              hostDir: attachmentsDir,
              attachments: rawAttachments,
            });
          } else {
            const containerName =
              String((d as any)?.containerName ?? (d as any)?.name ?? droneId).trim() || droneId;
            await copyChatAttachmentsToContainer({
              containerName,
              containerDir: attachmentsDir,
              attachments: rawAttachments,
            });
          }
          opts.mark?.('attachments');
        } catch (e: any) {
          const errText = e?.message ?? String(e);
          await updatePendingPrompt({
            droneId,
            chatName,
            id,
            patch: { state: 'failed', error: `failed staging queued attachments: ${errText}` },
          });
          throw new Error(`failed staging queued attachments: ${errText}`);
        }
      }
      // Persisted as queued; the background pump will claim it when the chat is deliverable.
      if (opts.schedulePump !== false) {
        enqueuePendingPromptPump(droneId, chatName);
        opts.mark?.('queuePump');
      }
      return { id, pendingState: 'queued' };
    }

    if (inferChatAgent(chat, d).kind === 'builtin') {
      await capturePendingPromptFileChangesBaseline({
        droneId,
        chatName,
        promptId: id,
        drone: d,
      });
    }

    let pendingState: PendingPromptState = 'sending';
    try {
      const enqueueTimeoutMs = Math.max(
        defaultPromptEnqueueTimeoutMs(),
        (typeof opts.waitForDaemonMs === 'number' && Number.isFinite(opts.waitForDaemonMs)
          ? Math.floor(opts.waitForDaemonMs)
          : 0) + 30_000,
      );
      // Enqueue work in the drone daemon (restart-resumable).
      // eslint-disable-next-line no-await-in-loop
      const r: any = await withTimeout(
        sendPromptToChat({
          id,
          droneId,
          chatName,
          prompt: opts.prompt,
          attachments: rawAttachments,
          attachmentRefs: attachmentsForPending,
          cwd: opts.cwd ?? null,
          waitForDaemonMs: opts.waitForDaemonMs,
          mark: opts.mark,
          deliveryMode: opts.priority,
        }),
        enqueueTimeoutMs,
        `prompt enqueue failed for ${droneId}/${chatName}`,
      );
      opts.mark?.('daemonEnqueue');
      if (r?.turnOk === false) {
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: String(r?.error ?? 'failed') },
        });
        pendingState = 'failed';
      } else {
        await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sent' } });
        enqueueReconcile(droneId, chatName);
      }
      opts.mark?.('persistDelivery');
    } catch (e: any) {
      const errorText = e?.message ?? String(e);
      const diagnostics =
        looksLikeTransientPromptEnqueueError(errorText) || looksLikeContainerPausedError(errorText)
          ? await collectDroneRuntimeDiagnostics({ droneId, droneEntry: d }).catch(
              (error: any) => ({
                diagnosticError: compactDiagnosticError(error),
              }),
            )
          : null;
      hubLog('warn', 'prompt enqueue delivery failed', {
        droneId,
        chatName,
        promptId: id,
        deliveryMode: opts.deliveryMode ?? 'immediate',
        error: errorText,
        ...(diagnostics ? { diagnostics } : {}),
      });
      if (looksLikeTransientPromptEnqueueError(errorText)) {
        const retry = await retryPendingPrompt({
          droneId,
          chatName,
          id,
          error: interruptedPromptDeliveryError(errorText),
        });
        if (retry.disposition === 'retry') {
          pendingState = 'queued';
          const nextMs = retry.nextAttemptAt ? Date.parse(retry.nextAttemptAt) : NaN;
          schedulePendingPromptPumpRetry(
            droneId,
            chatName,
            Number.isFinite(nextMs) ? Math.max(1_000, nextMs - Date.now()) : undefined,
          );
        } else if (retry.disposition === 'terminal') {
          pendingState = 'failed';
        }
      } else {
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: errorText },
        });
        pendingState = 'failed';
      }
    }

    // Best-effort: if there are any deferred follow-ups, try to enqueue now.
    enqueuePendingPromptPump(droneId, chatName);
    return { id, pendingState };
  }

  const sendInNewChatActionRuntime = createSendInNewChatActionRuntime({
    attachmentOnlyPromptLabel,
    autoRenameGeneratedChatFromFirstPrompt,
    buildChatAttachmentsDirectory,
    buildChatImageAttachmentRefs,
    chatAttachmentsStorageRootForDrone,
    claimQueuedPendingPromptForPromotion,
    claimQueuedPendingPromptForSending,
    copyChatAttachmentsToContainer,
    copyChatAttachmentsToHost,
    createDroneChat,
    createOrEnqueuePrompt: createOrEnqueuePromptUnified,
    droneRuntime,
    enqueuePendingPromptPump,
    getChatEntry,
    hasPendingWork: (chat, pending) => hasBlockingPendingPrompt(pending, chat?.turns),
    isSafePromptId,
    listChatsFromStore,
    loadRegistry,
    normalizeChatImageAttachmentRefs,
    normalizeChatName,
    normalizeDroneCwdForRuntime,
    normalizeDroneIdentity,
    normalizeSubmittedAtIso,
    notifyDroneChatWrite,
    pushPendingPrompt,
    readChatFromStore,
    readPendingPrompt,
    readPendingPrompts,
    retryPendingPrompt,
    schedulePendingPromptPumpRetry,
    updatePendingPrompt,
  });
  const createOrEnqueueNewChatAction = sendInNewChatActionRuntime.createOrEnqueue;
  const promoteQueuedNewChatAction = sendInNewChatActionRuntime.promote;

  type UnifiedPromptCreateOpts = {
    group?: string | null;
    repoPath?: string | null;
    build?: boolean;
    containerPort?: number | null;
  };

  function droneIsProvisioning(drone: any): boolean {
    const phase = String(drone?.hub?.phase ?? drone?.phase ?? '')
      .trim()
      .toLowerCase();
    return phase === 'starting' || phase === 'creating' || phase === 'seeding';
  }

  async function createOrEnqueuePromptUnified(opts: {
    id?: string;
    droneId: string;
    chatName: string;
    prompt: string;
    attachments?: ChatImageAttachment[];
    attachmentRefs?: ChatImageAttachmentRef[];
    cwd?: string | null;
    submittedAt?: string | null;
    deliveryMode?: 'queue' | 'asap';
    submissionSource?: PromptSubmissionSource;
    mark?: (name: string) => void;
  }): Promise<
    | {
        kind: 'enqueued';
        id: string;
        pendingState: PendingPromptState;
      }
    | { kind: 'error'; status: number; error: string }
  > {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(String(opts.chatName ?? '').trim() || 'default');
    const prompt = String(opts.prompt ?? '').trim();
    const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
    const attachmentRefs = normalizeChatImageAttachmentRefs(opts.attachmentRefs);
    const preferredIdRaw = typeof opts.id === 'string' ? opts.id.trim() : '';
    if (preferredIdRaw && !isSafePromptId(preferredIdRaw)) {
      return { kind: 'error', status: 400, error: 'invalid promptId' };
    }
    const fallbackId = preferredIdRaw || crypto.randomBytes(9).toString('hex');

    if (!droneId) return { kind: 'error', status: 400, error: 'missing drone id' };
    if (!prompt) return { kind: 'error', status: 400, error: 'missing prompt' };

    let regSnap: any = await loadRegistry();
    opts.mark?.('loadRegistry');
    if (regSnap?.drones?.[droneId]) {
      let liveDroneEntry = regSnap?.drones?.[droneId] ?? null;
      if (!liveDroneEntry)
        return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
      if (droneIsProvisioning(liveDroneEntry)) {
        if (attachments.length > 0) {
          return {
            kind: 'error',
            status: 409,
            error: `drone "${droneId}" is still starting (attachments require a ready drone)`,
          };
        }
        const submittedAt = normalizeSubmittedAtIso(opts.submittedAt);
        await pushPendingPrompt({
          droneId,
          chatName,
          submissionSource: opts.submissionSource,
          pending: {
            id: fallbackId,
            at: submittedAt,
            prompt,
            ...(opts.cwd != null ? { cwd: opts.cwd } : {}),
            ...(opts.deliveryMode ? { deliveryMode: opts.deliveryMode } : {}),
            state: 'queued',
            updatedAt: submittedAt,
          },
        });
        opts.mark?.('persistProvisioningPending');
        // Provisioning owns the first pump. Starting it here could dispatch a
        // follow-up before the repo and initial prompt have been materialized.
        return {
          kind: 'enqueued',
          id: fallbackId,
          pendingState: 'queued',
        };
      }
      let chatEntry = liveDroneEntry?.chats?.[chatName] ?? null;
      if (chatHasActiveDockerSnapshot(chatEntry)) {
        await failStaleDockerSnapshotsForChat({ droneId, chatName });
        opts.mark?.('snapshotMaintenance');
        regSnap = await loadRegistry();
        opts.mark?.('reloadRegistry');
        liveDroneEntry = regSnap?.drones?.[droneId] ?? null;
        if (!liveDroneEntry)
          return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
        chatEntry = liveDroneEntry?.chats?.[chatName] ?? null;
      }
      if (chatHasActiveDockerSnapshot(chatEntry)) {
        return {
          kind: 'error',
          status: 409,
          error:
            'Docker snapshot is in progress for this chat; wait for it to finish before sending another message',
        };
      }
      if (chatEntry && inferChatAgent(chatEntry, liveDroneEntry).kind === 'native') {
        const runtime = droneRuntime(liveDroneEntry);
        const containerName =
          String(liveDroneEntry?.containerName ?? liveDroneEntry?.name ?? droneId).trim() ||
          droneId;
        const nativeAttachments =
          attachments.length > 0 || attachmentRefs.length === 0
            ? attachments
            : await readChatAttachmentsFromRefs({
                runtime,
                containerName,
                attachments: attachmentRefs,
              });
        await promptNativeChat({
          droneId,
          chatName,
          chatId: String(chatEntry?.id ?? '').trim(),
          promptId: fallbackId,
          provider: String(chatEntry?.nativeProvider ?? '').trim(),
          model: String(chatEntry?.model ?? '').trim(),
          thinkingLevel: String(chatEntry?.reasoning ?? '').trim(),
          prompt,
          attachments: nativeAttachments,
          deliveryMode: opts.deliveryMode,
          submissionSource: opts.submissionSource,
        });
        return {
          kind: 'enqueued',
          id: fallbackId,
          pendingState: 'sending',
        };
      }
      const acceptance = chatPromptAcceptancePlan(opts.deliveryMode);
      const r = await enqueuePrompt({
        id: fallbackId,
        droneId,
        chatName,
        prompt,
        attachments,
        attachmentRefs,
        cwd: opts.cwd ?? null,
        submittedAt: opts.submittedAt ?? null,
        deliveryMode: acceptance.enqueueMode,
        priority: acceptance.priority,
        submissionSource: opts.submissionSource,
        mark: opts.mark,
      });
      return {
        kind: 'enqueued',
        id: r.id,
        pendingState: r.pendingState,
      };
    }

    // If the drone is still provisioning, stage prompt rows on the pending entry and
    // migrate them into normal chat `pendingPrompts` once startup finishes.
    if (regSnap?.pending?.[droneId] && !regSnap?.drones?.[droneId]) {
      if (attachments.length > 0) {
        return {
          kind: 'error',
          status: 409,
          error: `drone "${droneId}" is still starting (attachments require an active drone)`,
        };
      }
      const submittedAt = normalizeSubmittedAtIso(opts.submittedAt);
      const queuedPending: PendingPrompt = {
        id: fallbackId,
        at: submittedAt,
        prompt,
        ...(opts.cwd != null ? { cwd: opts.cwd } : {}),
        ...(opts.deliveryMode ? { deliveryMode: opts.deliveryMode } : {}),
        state: 'queued',
        updatedAt: submittedAt,
      };
      const queuedStatus = await pushPendingStartupPrompt({
        droneId,
        chatName,
        pending: queuedPending,
      });
      if (queuedStatus === 'active') {
        const acceptance = chatPromptAcceptancePlan(opts.deliveryMode);
        const r = await enqueuePrompt({
          id: fallbackId,
          droneId,
          chatName,
          prompt,
          attachments,
          cwd: opts.cwd ?? null,
          submittedAt: opts.submittedAt ?? null,
          deliveryMode: acceptance.enqueueMode,
          priority: acceptance.priority,
          submissionSource: opts.submissionSource,
          mark: opts.mark,
        });
        return {
          kind: 'enqueued',
          id: r.id,
          pendingState: r.pendingState,
        };
      }
      if (queuedStatus !== 'queued') {
        return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
      }
      return {
        kind: 'enqueued',
        id: fallbackId,
        pendingState: 'queued',
      };
    }
    return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
  }

  const {
    dequeueProvisioning,
    enqueueProvisioning,
    enqueueProvisioningForAllPending,
    startProvisioning,
    stopProvisioning,
  } = createDroneProvisioningController({
    NON_REPO_HOME_CWD,
    applyPendingDisplayNameToProvisionedDrone,
    cloneChatEntryForDroneClone,
    defaultDaemonReadyTimeoutMs,
    defaultRepoSeedTimeoutMs,
    ensureChatEntry,
    enqueuePrompt,
    enqueuePendingPromptPump,
    hubLog,
    inferChatAgent,
    isSafePromptId,
    normalizeChatModel,
    normalizeChatReasoning,
    normalizeChatName,
    normalizePendingStartupPrompts,
    nowIso,
    parseSeedAgent,
    createDroneRuntime,
    importContainerDroneRuntime,
    resolvePendingDroneDisplayName,
    setChatAgentConfig,
    registerProvisionedPromptHandoff,
    sharedPathsOverlapRepository: (repositoryPath: string) =>
      syncSetService.syncSetsOverlapRepository(repositoryPath),
    syncManagedFilesForDrone,
    syncSharedPathsToDrone: (opts: any) => syncSetService.applyAllSyncSetsToDrone(opts),
  });

  async function stopPromptRuntimeBackgroundWork(): Promise<void> {
    await Promise.all([
      daemonPromptEventMonitor.close(),
      stopProvisioning(),
      pendingPromptPump.stop(),
      chatReconciliationQueue.stop(),
    ]);
  }

  function startPromptRuntimeBackgroundWork(): void {
    daemonPromptEventMonitor.start();
    startProvisioning();
    pendingPromptPump.start();
    chatReconciliationQueue.start();
  }

  return {
    attachmentOnlyPromptLabel,
    busyChatNamesForDrone,
    cancelQueuedPendingPrompt,
    chatHasActivePendingPromptsForSummary,
    chatHasReconcilablePendingPrompts,
    chatRequiresCodexApprovalForSummary,
    chatReconciliationQueue,
    createOrEnqueuePromptUnified,
    createOrEnqueueNewChatAction,
    daemonPromptEventMonitor,
    dequeueProvisioning,
    enqueuePendingPromptPump,
    schedulePendingPromptPumpRetry,
    enqueueProvisioning,
    enqueueProvisioningForAllPending,
    enqueueReconcile,
    ensureDaemonPromptEventSubscription,
    isSafePromptId,
    looksLikeContainerAlreadyRunningError,
    looksLikeContainerNotRunningError,
    looksLikeMissingContainerError,
    looksLikeRepoUnavailableError,
    migrateInMemoryChatStateForRename,
    normalizeChatImageAttachmentRefs,
    pendingPromptsFromChatEntry,
    promoteQueuedNewChatAction,
    pruneCompletedPendingPrompts,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    readPendingPrompts,
    readPendingStartupPrompts,
    resetPromptRuntimeStateForTests,
    resolveCodexPromptApproval,
    resolveInterruptedPendingPrompt,
    resolvePendingCodexApprovalsForNeverAsk,
    resumePendingPromptChats,
    runDroneLifecycleAction,
    stopAllDroneChatActivity,
    stopChatResponse,
    startPromptRuntimeBackgroundWork,
    stopPromptRuntimeBackgroundWork,
    stopSingleDroneChatActivity,
    stopTranscriptPendingPrompts,
    transcriptTurnIdsFromEntry,
  };
}
