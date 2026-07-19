import crypto from 'node:crypto';
import path from 'node:path';

import { AgentFollowupCoordinator } from './agent-followup-coordinator';
import type { AgentMessageAutoContinueClassification } from './agent-message-auto-continue';
import type { AgentPlan } from './agent-plan';
import type { AgentCopilotRequest } from './agent-copilot-parser';
import type { ChatImageAttachment, ChatImageAttachmentRef } from './chat-attachments';
import type {
  AgentPermissionMode,
  BuiltinAgentId,
  ChatAgentConfig,
  PromptAutomationStopMode,
} from './chat-types';
import { ChatReconciliationQueue } from './chat-reconciliation-queue';
import { createChatReconciliationExecutor } from './chat-reconciliation-executor';
import { DaemonPromptEventMonitor } from './daemon-prompt-event-monitor';
import type { PendingPromptState } from './drone-pending-state';
import {
  nativeAssistantOwnsPromptDelivery,
  pendingPromptKeepsChatBusy,
  PendingPromptPump,
} from './pending-prompt-pump';
import type { PendingPrompt } from './drone-pending-prompts';
import {
  PromptAutomationManager,
  type PromptAutomationJobState,
  type PromptAutomationLaneState,
} from './prompt-automation-manager';

type PromptAutomationMeta = any;
type TranscriptTurn = any;

type ChatPromptRuntimeDependencyName =
  | 'AGENT_COPILOT_HANDLED_CAP'
  | 'NON_REPO_HOME_CWD'
  | 'PROMPT_AUTOMATION_COMPLETION_STALL_RECOVERY_GRACE_MS'
  | 'PROMPT_AUTOMATION_INTER_RUN_SLEEP_CHUNK_MS'
  | 'PROMPT_AUTOMATION_STOP_PHRASE_MAX_CHARS'
  | 'PROMPT_AUTOMATION_WAIT_FOR_IDLE_TIMEOUT_MS'
  | 'PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS'
  | 'PROMPT_AUTOMATION_WAIT_POLL_MS'
  | 'PROMPT_SKILL_SYNC_WARNINGS'
  | 'UPGRADE_DAEMON_READY_TIMEOUT_MS'
  | 'applyChatReconciliationInStore'
  | 'applyPendingDisplayNameToProvisionedDrone'
  | 'assertReadOnlySupportedForAgent'
  | 'bashQuote'
  | 'buildChatAttachmentsDirectory'
  | 'buildChatImageAttachmentRefs'
  | 'buildContainerManagedEnvLines'
  | 'buildEnvExportLines'
  | 'chatAttachmentsStorageRootForDrone'
  | 'chatHasActiveDockerSnapshot'
  | 'chatNameExists'
  | 'classifyAgentMessageAutoContinue'
  | 'cliSupportsModelFlag'
  | 'cloneChatEntryForDroneClone'
  | 'codexImageAttachmentFlags'
  | 'collectDroneRuntimeDiagnostics'
  | 'compactDiagnosticError'
  | 'copyChatAttachmentsToContainer'
  | 'copyChatAttachmentsToHost'
  | 'createDronePendingPromptStore'
  | 'createDroneProvisioningController'
  | 'defaultDaemonReadyTimeoutMs'
  | 'defaultPendingPromptEnqueueRetryDelayMs'
  | 'defaultPromptEnqueueTimeoutMs'
  | 'defaultRepoSeedTimeoutMs'
  | 'dronePromptCancel'
  | 'dronePromptEnqueue'
  | 'dronePromptGet'
  | 'droneRuntime'
  | 'dvmExec'
  | 'dvmSessionType'
  | 'dvmStart'
  | 'dvmStop'
  | 'ensureChatEntry'
  | 'ensureChatEntryCopiedFromChat'
  | 'ensureClaudeSessionId'
  | 'ensureContainerDroneDaemonSession'
  | 'ensureCursorChatId'
  | 'ensureHubChatSessionRunning'
  | 'ensureOpenCodeSessionId'
  | 'extractAgentCopilotFromAgentMessage'
  | 'failStaleDockerSnapshotsForChat'
  | 'formatTranscriptJobFailure'
  | 'getChatEntry'
  | 'hasActivePriorPendingPrompt'
  | 'hasKnownBuiltinTranscriptSession'
  | 'hubChatSessionName'
  | 'hubLog'
  | 'importChatFromRegistry'
  | 'inferChatAgent'
  | 'isDraftChatEntry'
  | 'isNotFoundErrorMessage'
  | 'loadRegistry'
  | 'looksLikeTransientPromptEnqueueError'
  | 'makeClient'
  | 'maybeBootstrapPromptFromTranscript'
  | 'maybeStartDockerSnapshotForTranscriptTurn'
  | 'normalizeAgentPermissionMode'
  | 'normalizeBuiltinAgentId'
  | 'normalizeChatModel'
  | 'normalizeChatName'
  | 'normalizeChatReasoning'
  | 'normalizeContainerPath'
  | 'normalizeDroneCwdForRuntime'
  | 'normalizeDroneEntryKind'
  | 'normalizeDroneEntryVisibility'
  | 'normalizeDroneIdentity'
  | 'normalizePendingPromptState'
  | 'normalizePendingPromptText'
  | 'normalizePendingStartupPrompts'
  | 'normalizePlaybookRunQueueGate'
  | 'normalizePromptAutomationSleepBetweenRunsSeconds'
  | 'normalizePromptAutomationStopPhrase'
  | 'normalizeSubmittedAtIso'
  | 'notifyDroneChatWrite'
  | 'notifyPromptAutomationLaneChange'
  | 'nowIso'
  | 'openCodeSessionTitle'
  | 'parseBlipJobTranscript'
  | 'parseChatNameForMutation'
  | 'parseCodexJobTranscript'
  | 'parsePiJobTranscript'
  | 'parseSeedAgent'
  | 'parseStructuredAgentJobTranscript'
  | 'patchChatMetadataInStore'
  | 'playbookMetaFromEntry'
  | 'promptNativeChat'
  | 'stopNativeChat'
  | 'projectCanonicalChatToRegistry'
  | 'promptWithImageAttachments'
  | 'readBuiltinTranscriptSessionId'
  | 'readChatFromStore'
  | 'resetTranscriptStoreForTests'
  | 'resolveBlipPromptCommand'
  | 'resolveCanonicalDroneOrPendingForReadRef'
  | 'resolveChatTmuxCommand'
  | 'resolveCodexTurnRuntime'
  | 'resolveDroneCliPath'
  | 'resolveDroneDaemonClientForEntry'
  | 'resolveDroneEnvironmentConfig'
  | 'resolveEffectiveAgentMessageAutoContinueSettings'
  | 'resolveEffectiveAgentSuggestionSettings'
  | 'resolveEffectiveLlmProvider'
  | 'resolveEffectiveProviderApiKeySettings'
  | 'resolveHostPort'
  | 'resolvePendingDroneDisplayName'
  | 'resolveTranscriptPromptAt'
  | 'runNodeCli'
  | 'sameAgentPlan'
  | 'setChatAgentConfig'
  | 'setDroneHubMetaByIdentity'
  | 'shouldDeferQueuedPendingPrompt'
  | 'shouldDeferQueuedTranscriptPrompt'
  | 'shouldRetryFailedPendingPrompt'
  | 'sleepMs'
  | 'stalePendingPromptState'
  | 'startupPromptToPendingPrompt'
  | 'stripAnsiFromCliOutput'
  | 'syncMcpServersForDrone'
  | 'syncRepoAgentsInstructionsForDrone'
  | 'syncSetService'
  | 'syncSkillLibraryForDrone'
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

export function createChatPromptRuntime(deps: ChatPromptRuntimeDependencies) {
  const {
    AGENT_COPILOT_HANDLED_CAP,
    NON_REPO_HOME_CWD,
    PROMPT_AUTOMATION_COMPLETION_STALL_RECOVERY_GRACE_MS,
    PROMPT_AUTOMATION_INTER_RUN_SLEEP_CHUNK_MS,
    PROMPT_AUTOMATION_STOP_PHRASE_MAX_CHARS,
    PROMPT_AUTOMATION_WAIT_FOR_IDLE_TIMEOUT_MS,
    PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
    PROMPT_AUTOMATION_WAIT_POLL_MS,
    PROMPT_SKILL_SYNC_WARNINGS,
    UPGRADE_DAEMON_READY_TIMEOUT_MS,
    applyChatReconciliationInStore,
    applyPendingDisplayNameToProvisionedDrone,
    assertReadOnlySupportedForAgent,
    bashQuote,
    buildChatAttachmentsDirectory,
    buildChatImageAttachmentRefs,
    buildContainerManagedEnvLines,
    buildEnvExportLines,
    chatAttachmentsStorageRootForDrone,
    chatHasActiveDockerSnapshot,
    chatNameExists,
    classifyAgentMessageAutoContinue,
    cliSupportsModelFlag,
    cloneChatEntryForDroneClone,
    codexImageAttachmentFlags,
    collectDroneRuntimeDiagnostics,
    compactDiagnosticError,
    copyChatAttachmentsToContainer,
    copyChatAttachmentsToHost,
    createDronePendingPromptStore,
    createDroneProvisioningController,
    defaultDaemonReadyTimeoutMs,
    defaultPendingPromptEnqueueRetryDelayMs,
    defaultPromptEnqueueTimeoutMs,
    defaultRepoSeedTimeoutMs,
    dronePromptCancel,
    dronePromptEnqueue,
    dronePromptGet,
    droneRuntime,
    dvmExec,
    dvmSessionType,
    dvmStart,
    dvmStop,
    ensureChatEntry,
    ensureChatEntryCopiedFromChat,
    ensureClaudeSessionId,
    ensureContainerDroneDaemonSession,
    ensureCursorChatId,
    ensureHubChatSessionRunning,
    ensureOpenCodeSessionId,
    extractAgentCopilotFromAgentMessage,
    failStaleDockerSnapshotsForChat,
    formatTranscriptJobFailure,
    getChatEntry,
    hasActivePriorPendingPrompt,
    hasKnownBuiltinTranscriptSession,
    hubChatSessionName,
    hubLog,
    importChatFromRegistry,
    inferChatAgent,
    isDraftChatEntry,
    isNotFoundErrorMessage,
    loadRegistry,
    looksLikeTransientPromptEnqueueError,
    makeClient,
    maybeBootstrapPromptFromTranscript,
    maybeStartDockerSnapshotForTranscriptTurn,
    normalizeAgentPermissionMode,
    normalizeBuiltinAgentId,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeContainerPath,
    normalizeDroneCwdForRuntime,
    normalizeDroneEntryKind,
    normalizeDroneEntryVisibility,
    normalizeDroneIdentity,
    normalizePendingPromptState,
    normalizePendingPromptText,
    normalizePendingStartupPrompts,
    normalizePlaybookRunQueueGate,
    normalizePromptAutomationSleepBetweenRunsSeconds,
    normalizePromptAutomationStopPhrase,
    normalizeSubmittedAtIso,
    notifyDroneChatWrite,
    notifyPromptAutomationLaneChange,
    nowIso,
    openCodeSessionTitle,
    parseBlipJobTranscript,
    parseChatNameForMutation,
    parseCodexJobTranscript,
    parsePiJobTranscript,
    parseSeedAgent,
    parseStructuredAgentJobTranscript,
    patchChatMetadataInStore,
    playbookMetaFromEntry,
    promptNativeChat,
    stopNativeChat,
    nativeChatIsBusy,
    nativeChatError,
    nativeChatLatestAssistantText,
    projectCanonicalChatToRegistry,
    promptWithImageAttachments,
    readBuiltinTranscriptSessionId,
    readChatFromStore,
    resetTranscriptStoreForTests,
    resolveBlipPromptCommand,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveChatTmuxCommand,
    resolveCodexTurnRuntime,
    resolveDroneCliPath,
    resolveDroneDaemonClientForEntry,
    resolveDroneEnvironmentConfig,
    resolveEffectiveAgentMessageAutoContinueSettings,
    resolveEffectiveAgentSuggestionSettings,
    resolveEffectiveLlmProvider,
    resolveEffectiveProviderApiKeySettings,
    resolveHostPort,
    resolvePendingDroneDisplayName,
    resolveTranscriptPromptAt,
    runNodeCli,
    sameAgentPlan,
    setChatAgentConfig,
    setDroneHubMetaByIdentity,
    shouldDeferQueuedPendingPrompt,
    shouldDeferQueuedTranscriptPrompt,
    shouldRetryFailedPendingPrompt,
    sleepMs,
    stalePendingPromptState,
    startupPromptToPendingPrompt,
    stripAnsiFromCliOutput,
    syncMcpServersForDrone,
    syncRepoAgentsInstructionsForDrone,
    syncSetService,
    syncSkillLibraryForDrone,
    unsupportedHostCustomAgentError,
    updateTranscriptTurnById,
    upgradeDroneDaemonInContainer,
    waitForDroneDaemonReady,
    withDroneOpLock,
    withLockedDroneContainer,
    withTimeout,
  } = deps;

  const agentFollowupCoordinator = new AgentFollowupCoordinator();

  async function enqueueTranscriptPrompt(opts: {
    id?: string;
    drone: any;
    waitForDaemonMs?: number;
    kind: string;
    script: string;
    prompt?: string;
  }) {
    const d = opts.drone;
    const containerName = String(d?.containerName ?? d?.name ?? '').trim();
    const token = typeof d.token === 'string' ? d.token : '';
    const hostPort =
      typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
        ? d.hostPort
        : await resolveHostPort(containerName, d.containerPort);
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
    await waitForDroneDaemonReady(client, daemonReadyTimeoutMs);
    const droneId = normalizeDroneIdentity(d?.id) || String(d?.name ?? '');
    try {
      await dronePromptEnqueue(client, {
        id: String(opts.id ?? ''),
        kind: opts.kind,
        cmd: 'bash',
        args: ['-lc', opts.script],
        ...(typeof opts.prompt === 'string' ? { prompt: opts.prompt } : {}),
      });
      ensureDaemonPromptEventSubscription(droneId);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (isNotFoundErrorMessage(msg)) {
        await upgradeDroneDaemonInContainer({ containerName, containerPort: d.containerPort });
        await waitForDroneDaemonReady(client, daemonReadyAfterUpgradeTimeoutMs);
        await dronePromptEnqueue(client, {
          id: String(opts.id ?? ''),
          kind: opts.kind,
          cmd: 'bash',
          args: ['-lc', opts.script],
          ...(typeof opts.prompt === 'string' ? { prompt: opts.prompt } : {}),
        });
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
    mark?: (name: string) => void;
  }) {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId) throw new Error('missing droneId');

    const regAny: any = await loadRegistry();
    if (regAny?.pending?.[droneId] && !regAny?.drones?.[droneId]) {
      throw new Error(`drone "${droneId}" is still starting`);
    }
    const dSeed = (regAny as any).drones?.[droneId];
    if (!dSeed) throw new Error(`unknown drone: ${droneId}`);

    if (opts.skipManagedRepoSync !== true) {
      try {
        await syncSkillLibraryForDrone({ droneId, droneEntry: dSeed });
        await syncMcpServersForDrone({ droneId, droneEntry: dSeed });
        await syncRepoAgentsInstructionsForDrone({ droneId, droneEntry: dSeed });
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

    const lockKey = `drone:${droneId}`;

    return await withDroneOpLock(lockKey, async () => {
      const regLatest: any = await loadRegistry();
      if (regLatest?.pending?.[droneId] && !regLatest?.drones?.[droneId]) {
        throw new Error(`drone "${droneId}" is still starting`);
      }
      const d: any = (regLatest as any).drones?.[droneId] ?? null;
      if (!d) throw new Error(`unknown drone: ${droneId}`);
      const droneLabel = String(d?.name ?? '').trim() || droneId;
      const runtime = droneRuntime(d);
      const containerName =
        String(d?.containerName ?? '').trim() || String(d?.name ?? '').trim() || droneId;

      const normalizedChat = opts.chatName || 'default';
      await ensureChatEntry({ droneId, chatName: normalizedChat });

      const { d: dWithChat, chat } = await getChatEntry({ droneId, chatName: normalizedChat });
      const agent = inferChatAgent(chat, dWithChat);
      const chatModel = normalizeChatModel((chat as any)?.model);
      const chatReasoning = normalizeChatReasoning((chat as any)?.reasoning);
      const agentPermissionMode = normalizeAgentPermissionMode((chat as any)?.agentPermissionMode);
      if (agentPermissionMode === 'read-only') assertReadOnlySupportedForAgent(agent);
      const managedEnv = resolveDroneEnvironmentConfig(regLatest, d).resolvedVars;
      const managedEnvLines = buildEnvExportLines(managedEnv);

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
        await promptNativeChat({
          droneId,
          chatName: normalizedChat,
          chatId: String((chat as any)?.id ?? '').trim(),
          promptId,
          provider: String((chat as any)?.nativeProvider ?? '').trim(),
          model: String((chat as any)?.model ?? '').trim(),
          thinkingLevel: String((chat as any)?.reasoning ?? '').trim(),
          prompt: String(opts.prompt ?? '').trim(),
          attachments,
        });
        return {
          ok: true as const,
          agent,
          mode: 'native' as const,
          chat: normalizedChat,
          turnOk: true as const,
        };
      }
      const codexImageArgs = codexImageAttachmentFlags(attachmentsForPrompt);
      const promptWithHistory =
        agent.kind === 'builtin'
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
          promptId,
        });
        const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
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
        const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
        const reasoningArg = chatReasoning
          ? ` -c ${bashQuote(`model_reasoning_effort="${chatReasoning}"`)}`
          : '';
        const sandboxArg = agentPermissionMode === 'read-only' ? 'read-only' : 'danger-full-access';
        const existingThreadId = readBuiltinTranscriptSessionId(chat, 'codex');
        if (!existingThreadId) {
          const script = [
            'set -euo pipefail',
            ...buildContainerManagedEnvLines(d),
            ...managedEnvLines,
            `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
            cdCommand,
            `codex --ask-for-approval never${reasoningArg} exec${modelArg} --skip-git-repo-check --sandbox ${sandboxArg} --json --color never${codexImageArgs} ${bashQuote(promptWithHistory)}`,
          ].join('\n');
          await enqueueTranscriptPrompt({
            id: opts.id,
            drone: d,
            waitForDaemonMs: opts.waitForDaemonMs,
            kind: 'codex',
            script,
            prompt: effectivePrompt,
          });
          return {
            ok: true as const,
            agent,
            mode: 'transcript' as const,
            chat: normalizedChat,
            codexThreadId: null,
            turnOk: true as const,
          };
        }

        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `codex --ask-for-approval never${reasoningArg} exec${modelArg} --skip-git-repo-check --sandbox ${sandboxArg} --json --color never resume${codexImageArgs} ${bashQuote(existingThreadId)} ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'codex',
          script,
          prompt: effectivePrompt,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          codexThreadId: existingThreadId,
          turnOk: true as const,
        };
      }

      if (agent.kind === 'builtin' && agent.id === 'claude') {
        const claudeSessionId = await ensureClaudeSessionId({ droneId, chatName: normalizedChat });
        const supportsModel = chatModel
          ? await cliSupportsModelFlag({ runtime, containerName, cwd, bin: 'claude' })
          : false;
        const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `claude --print --dangerously-skip-permissions --output-format stream-json --verbose${modelArg} --session-id ${bashQuote(claudeSessionId)} ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'claude',
          script,
          prompt: effectivePrompt,
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
        const openCodeSessionId = readBuiltinTranscriptSessionId(chat, 'opencode');
        const title = openCodeSessionTitle(droneLabel, normalizedChat);
        const resumeArg = openCodeSessionId ? ` --session ${bashQuote(openCodeSessionId)}` : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
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
        const piSessionId = readBuiltinTranscriptSessionId(chat, 'pi');
        const sessionArg = piSessionId ? ` --session ${bashQuote(piSessionId)}` : '';
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
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
          agentPermissionMode === 'read-only'
            ? '--permission read-only --profile read-only'
            : '--permission full-access --profile local-trusted-write';
        const blipSessionId = readBuiltinTranscriptSessionId(chat, 'blip');
        const sessionArg = blipSessionId ? ` --session ${bashQuote(blipSessionId)}` : '';
        const blipCommand = resolveBlipPromptCommand(runtime);
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
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
        envVars: managedEnv,
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
      const registry: any = await loadRegistry();
      const drone = registry?.drones?.[droneId] ?? null;
      if (!drone) return { exists: false, client: null };
      const daemon = await resolveDroneDaemonClientForEntry(drone);
      return { exists: true, client: daemon?.client ?? null };
    },
    onTerminalPrompt: enqueueReconcileForDaemonPromptEvent,
    sleep: sleepMs,
  });

  function enqueueReconcile(droneId: string, chatName: string): void {
    chatReconciliationQueue.enqueue(droneId, chatName);
  }

  async function enqueueReconcileForDaemonPromptEvent(
    droneIdRaw: string,
    promptIdRaw: string,
  ): Promise<void> {
    const droneId = normalizeDroneIdentity(droneIdRaw);
    const promptId = String(promptIdRaw ?? '').trim();
    if (!droneId || !promptId) return;
    const regAny: any = await loadRegistry();
    const chats = regAny?.drones?.[droneId]?.chats;
    if (!chats || typeof chats !== 'object') return;
    for (const [chatNameRaw, entry] of Object.entries(chats) as Array<[string, any]>) {
      const chatName = normalizeChatName(chatNameRaw);
      if (!chatName) continue;
      const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
      if (!pending.some((item: any) => String(item?.id ?? '').trim() === promptId)) continue;
      enqueueReconcile(droneId, chatName);
      enqueuePendingPromptPump(droneId, chatName);
    }
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
    const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];
    if (attachments.length === 0) return '';
    const imageCount = attachments.filter((item) =>
      String(item?.mime ?? '')
        .trim()
        .toLowerCase()
        .startsWith('image/'),
    ).length;
    const textCount = attachments.filter(
      (item) =>
        String(item?.mime ?? '')
          .trim()
          .toLowerCase() === 'text/plain',
    ).length;
    if (imageCount === attachments.length) {
      return imageCount === 1 ? '[image attachment]' : `[${imageCount} image attachments]`;
    }
    if (textCount === attachments.length) {
      return textCount === 1 ? '[text attachment]' : `[${textCount} text attachments]`;
    }
    return attachments.length === 1 ? '[attachment]' : `[${attachments.length} attachments]`;
  }

  function normalizePromptAutomationMeta(raw: unknown): PromptAutomationMeta | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const kind = String((raw as any).kind ?? '')
      .trim()
      .toLowerCase();
    if (kind !== 'prompt-loop') return undefined;
    const stageRaw = String((raw as any).stage ?? '')
      .trim()
      .toLowerCase();
    const stage =
      stageRaw === 'final-message' ? 'final-message' : stageRaw === 'run' ? 'run' : undefined;
    const jobKeyRaw = String((raw as any).jobKey ?? '').trim();
    const automationIdRaw = String((raw as any).automationId ?? '').trim();
    const automationLabelRaw = String((raw as any).automationLabel ?? '').trim();
    const runIndexRaw = Number((raw as any).runIndex);
    const runsTotalRaw = Number((raw as any).runsTotal);
    const sleepBetweenRunsSecondsRaw = Number((raw as any).sleepBetweenRunsSeconds);
    const stopPhraseRaw = String((raw as any).stopPhrase ?? '').trim();
    const stopPhraseCaseSensitive = (raw as any)?.stopPhraseCaseSensitive === true;
    const stopMatchedRunIndexRaw = Number((raw as any).stopMatchedRunIndex);
    const promptPreviewRaw = String((raw as any).promptPreview ?? '').trim();
    const runIndex =
      Number.isFinite(runIndexRaw) && runIndexRaw > 0 ? Math.floor(runIndexRaw) : undefined;
    const runsTotal =
      Number.isFinite(runsTotalRaw) && runsTotalRaw > 0 ? Math.floor(runsTotalRaw) : undefined;
    const sleepBetweenRunsSeconds =
      Number.isFinite(sleepBetweenRunsSecondsRaw) && sleepBetweenRunsSecondsRaw >= 0
        ? Math.floor(sleepBetweenRunsSecondsRaw)
        : undefined;
    const stopMatchedRunIndex =
      Number.isFinite(stopMatchedRunIndexRaw) && stopMatchedRunIndexRaw > 0
        ? Math.floor(stopMatchedRunIndexRaw)
        : undefined;
    return {
      kind: 'prompt-loop',
      ...(stage ? { stage } : {}),
      ...(jobKeyRaw ? { jobKey: jobKeyRaw } : {}),
      ...(automationIdRaw ? { automationId: automationIdRaw } : {}),
      ...(automationLabelRaw ? { automationLabel: automationLabelRaw.slice(0, 120) } : {}),
      ...(typeof runIndex === 'number' ? { runIndex } : {}),
      ...(typeof runsTotal === 'number' ? { runsTotal } : {}),
      ...(typeof sleepBetweenRunsSeconds === 'number' ? { sleepBetweenRunsSeconds } : {}),
      ...(stopPhraseRaw
        ? { stopPhrase: stopPhraseRaw.slice(0, PROMPT_AUTOMATION_STOP_PHRASE_MAX_CHARS) }
        : {}),
      ...(stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
      ...(typeof stopMatchedRunIndex === 'number' ? { stopMatchedRunIndex } : {}),
      ...(promptPreviewRaw ? { promptPreview: promptPreviewRaw.slice(0, 600) } : {}),
    };
  }

  const {
    cancelQueuedPendingPrompt,
    claimQueuedPendingPromptForSending,
    isSafePromptId,
    pendingPromptsFromChatEntry,
    pruneCompletedPendingPrompts,
    readPendingPrompts,
    readPendingStartupPrompts,
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
    normalizePromptAutomationMeta,
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
    includeAutomation?: boolean;
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
    const includeAutomation = opts.includeAutomation === true;
    const cancelable = pending.filter((item: any) => {
      if (!item?.id) return false;
      if (filterByPromptIds) return explicitPromptIds.has(item.id);
      if (!includeAutomation && item.automation) return false;
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

  async function activePromptAutomationPendingPromptIds(opts: {
    droneId: string;
    chatName: string;
    jobKey?: string | null;
  }): Promise<string[]> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const jobKey = String(opts.jobKey ?? '').trim();
    if (!droneId || !chatName || !jobKey) return [];
    const pending = await readPendingPrompts({ droneId, chatName }).catch(() => []);
    return pending
      .filter((item: any) => {
        const id = String(item?.id ?? '').trim();
        if (!id) return false;
        const state = String(item?.state ?? '').trim();
        if (state !== 'queued' && state !== 'sending' && state !== 'sent') return false;
        const automation = (item as any)?.automation ?? null;
        if (String(automation?.kind ?? '') !== 'prompt-loop') return false;
        if (String(automation?.stage ?? '') !== 'run') return false;
        if (String(automation?.jobKey ?? '').trim() !== jobKey) return false;
        return true;
      })
      .map((item: any) => String(item?.id ?? '').trim())
      .filter(Boolean);
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

    for (const chatName of plan.builtinChatNames) {
      stopPromptAutomationJob({ droneId, chatName, stopMode: 'all', clearQueued: true });
    }
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

    stopPromptAutomationJob({ droneId, chatName, stopMode: 'all', clearQueued: true });
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

  const promptAutomationManager = new PromptAutomationManager({
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    nowIso,
    runJob: runPromptAutomationJob,
    onLaneChanged(droneId, chatName) {
      notifyPromptAutomationLaneChange?.(droneId, chatName);
    },
    onLaneIdle: enqueuePendingPromptPump,
  });

  const notifyPromptAutomationChatChanged = (droneId: string, chatName: string): void =>
    promptAutomationManager.notifyChatChanged(droneId, chatName);
  const promptAutomationJobKey = (droneId: string, chatName: string): string =>
    promptAutomationManager.key(droneId, chatName);
  const getPromptAutomationLane = (droneId: string, chatName: string) =>
    promptAutomationManager.get(droneId, chatName);
  const promptAutomationLaneBusy = (
    lane: PromptAutomationLaneState | null | undefined,
    opts?: { includeQueued?: boolean },
  ): boolean => promptAutomationManager.isBusy(lane, opts);
  const anyBusyPromptAutomationLaneForDrone = (droneId: string): boolean =>
    promptAutomationManager.anyBusyForDrone(droneId);
  const promptAutomationJobResponse = (lane: PromptAutomationLaneState | null) =>
    promptAutomationManager.response(lane);

  function appendPromptAutomationHistoryRows(
    list: PendingPrompt[],
    lane: PromptAutomationLaneState | null,
  ): PendingPrompt[] {
    const job = lane?.runningJob ?? lane?.lastJob ?? null;
    if (!job) return list;
    let out = list;
    const existingRunIndexes = new Set<number>();
    for (const item of out) {
      const automation = normalizePromptAutomationMeta((item as any)?.automation);
      if (
        automation &&
        String(automation.kind ?? '') === 'prompt-loop' &&
        String(automation.stage ?? '') === 'run' &&
        String(automation.jobKey ?? '') === job.executionKey &&
        typeof automation.runIndex === 'number'
      ) {
        existingRunIndexes.add(automation.runIndex);
      }
    }
    const updatedAt = String(job.updatedAt ?? nowIso());
    const safeJobId = job.executionKey.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-48) || 'automation';
    for (let runIndex = 1; runIndex <= job.runsCompleted; runIndex += 1) {
      if (existingRunIndexes.has(runIndex)) continue;
      out = [
        ...out,
        {
          id: `${safeJobId}-run-${runIndex}`,
          at: updatedAt,
          prompt: job.prompt,
          automation: {
            kind: 'prompt-loop',
            stage: 'run',
            jobKey: job.executionKey,
            automationId: job.automationId,
            automationLabel: job.automationLabel,
            runIndex,
            runsTotal: job.runsTotal,
            sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
            ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
            ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
            promptPreview: previewPromptAutomationPrompt(job.prompt),
          },
          state: 'sent',
          updatedAt,
        },
      ];
    }

    if (!job.onFailurePrompt || job.runsCompleted <= 0) return out.slice(-50);
    const id = String(job.lastPromptId ?? '').trim();
    if (!id || out.some((item) => item.id === id)) return out.slice(-50);
    const finalRow: PendingPrompt = {
      id,
      at: updatedAt,
      prompt: job.onFailurePrompt,
      automation: {
        kind: 'prompt-loop',
        stage: 'final-message',
        jobKey: job.executionKey,
        automationId: job.automationId,
        automationLabel: job.automationLabel,
        runsTotal: job.runsTotal,
        sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
        ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
        ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
        ...(typeof job.finishedEarlyRunIndex === 'number'
          ? { stopMatchedRunIndex: job.finishedEarlyRunIndex }
          : {}),
        promptPreview: previewPromptAutomationPrompt(job.onFailurePrompt),
      },
      state: 'sent',
      updatedAt,
    };
    return [...out, finalRow].slice(-50);
  }

  function parsePromptAutomationIsoMs(raw: string | null | undefined): number {
    const ms = Date.parse(String(raw ?? '').trim());
    return Number.isFinite(ms) ? ms : 0;
  }

  function readPromptAutomationFinalMessageSnapshot(
    regAny: any,
    job: PromptAutomationJobState,
  ): {
    hasFinalTranscriptTurn: boolean;
    pendingFinalState: string;
    pendingFinalUpdatedAt: string | null;
  } {
    const turns = Array.isArray(regAny?.drones?.[job.droneId]?.chats?.[job.chatName]?.turns)
      ? regAny.drones[job.droneId].chats[job.chatName].turns
      : [];
    const pending = Array.isArray(
      regAny?.drones?.[job.droneId]?.chats?.[job.chatName]?.pendingPrompts,
    )
      ? regAny.drones[job.droneId].chats[job.chatName].pendingPrompts
      : [];
    const jobKey = String(job.executionKey ?? '').trim();
    const hasFinalTranscriptTurn = turns.some((turn: any) => {
      const automation = normalizePromptAutomationMeta((turn as any)?.automation);
      if (!automation) return false;
      return (
        String(automation.kind ?? '').trim() === 'prompt-loop' &&
        String(automation.stage ?? '').trim() === 'final-message' &&
        String(automation.jobKey ?? '').trim() === jobKey
      );
    });
    const pendingFinal = pending.find((item: any) => {
      const automation = normalizePromptAutomationMeta((item as any)?.automation);
      if (!automation) return false;
      return (
        String(automation.kind ?? '').trim() === 'prompt-loop' &&
        String(automation.stage ?? '').trim() === 'final-message' &&
        String(automation.jobKey ?? '').trim() === jobKey
      );
    });
    return {
      hasFinalTranscriptTurn,
      pendingFinalState: String((pendingFinal as any)?.state ?? '')
        .trim()
        .toLowerCase(),
      pendingFinalUpdatedAt:
        typeof (pendingFinal as any)?.updatedAt === 'string'
          ? String((pendingFinal as any).updatedAt).trim() || null
          : typeof (pendingFinal as any)?.at === 'string'
            ? String((pendingFinal as any).at).trim() || null
            : null,
    };
  }

  function previewPromptAutomationPrompt(raw: string, maxLen: number = 280): string {
    const text = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1).trimEnd()}...`;
  }

  function chatHasActivePendingPrompts(
    entry: any,
    opts?: {
      ignoreQueuedBlockedByAutomation?: boolean;
    },
  ): boolean {
    const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (pending.length === 0) return false;
    const turns = Array.isArray(entry?.turns) ? entry.turns : [];
    const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
    for (const p of pending) {
      const state = String(p?.state ?? '').trim();
      if (state === 'failed') continue;
      if (
        opts?.ignoreQueuedBlockedByAutomation &&
        state === 'queued' &&
        Boolean((p as any)?.blockedByAutomation)
      ) {
        continue;
      }
      const id = String(p?.id ?? '').trim();
      if (!id) continue;
      if (doneIds.has(id)) continue;
      return true;
    }
    return false;
  }

  function chatHasTranscriptTurn(
    regAny: any,
    opts: { droneId: string; chatName: string; promptId: string },
  ): boolean {
    const stored = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
    const turns =
      stored.available && stored.chat
        ? stored.chat.turns
        : Array.isArray(regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName]?.turns)
          ? regAny.drones[opts.droneId].chats[opts.chatName].turns
          : [];
    return turns.some((t: any) => String(t?.id ?? '').trim() === opts.promptId);
  }

  async function waitForPromptAutomationChatIdle(opts: {
    droneId: string;
    chatName: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<void> {
    const timeoutMs = Math.max(
      5_000,
      Math.floor(opts.timeoutMs || PROMPT_AUTOMATION_WAIT_FOR_IDLE_TIMEOUT_MS),
    );
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (opts.signal.aborted) throw new Error('automation stopped');
      const regAny: any = await loadRegistry();
      const entry = regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName] ?? null;
      if (!entry) return;
      if (!chatHasActivePendingPrompts(entry, { ignoreQueuedBlockedByAutomation: true })) return;
      await reconcileChatFromDaemon({ droneId: opts.droneId, chatName: opts.chatName }).catch(
        () => {},
      );
      await sleepMs(PROMPT_AUTOMATION_WAIT_POLL_MS);
    }
    throw new Error('timed out waiting for chat to become idle');
  }

  async function waitForPromptAutomationPromptCompletion(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    timeoutMs: number;
    signal: AbortSignal;
    requireTranscript?: boolean;
  }): Promise<void> {
    const timeoutMs = Math.max(
      10_000,
      Math.floor(opts.timeoutMs || PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS),
    );
    const requireTranscript = opts.requireTranscript !== false;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (opts.signal.aborted) throw new Error('automation stopped');
      await reconcileChatFromDaemon({ droneId: opts.droneId, chatName: opts.chatName }).catch(
        () => {},
      );
      const pending = await readPendingPrompts({
        droneId: opts.droneId,
        chatName: opts.chatName,
      }).catch(() => []);
      const target = pending.find((p: any) => p.id === opts.promptId) ?? null;
      if (target) {
        if (target.state === 'failed')
          throw new Error(target.error || `prompt ${opts.promptId} failed`);
        if (target.state === 'sent') {
          if (!requireTranscript) return;
          const regAny: any = await loadRegistry();
          if (chatHasTranscriptTurn(regAny, opts)) return;
        }
      } else {
        const regAny: any = await loadRegistry();
        if (!requireTranscript || chatHasTranscriptTurn(regAny, opts)) return;
      }
      await sleepMs(PROMPT_AUTOMATION_WAIT_POLL_MS);
    }
    throw new Error(`timed out waiting for prompt ${opts.promptId} completion`);
  }

  async function waitForPromptAutomationInterRunSleep(opts: {
    sleepBetweenRunsSeconds: number;
    signal: AbortSignal;
  }): Promise<void> {
    const sleepSeconds = normalizePromptAutomationSleepBetweenRunsSeconds(
      opts.sleepBetweenRunsSeconds,
    );
    if (sleepSeconds <= 0) return;
    let remainingMs = sleepSeconds * 1000;
    while (remainingMs > 0) {
      if (opts.signal.aborted) throw new Error('automation stopped');
      const chunkMs = Math.min(PROMPT_AUTOMATION_INTER_RUN_SLEEP_CHUNK_MS, remainingMs);
      await sleepMs(chunkMs);
      remainingMs -= chunkMs;
    }
  }

  async function readPromptAutomationTurnOutput(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): Promise<string> {
    const found = getTranscriptTurnByPromptId(opts);
    if (!found) return '';
    const output = String(found?.output ?? '');
    const error = String(found?.error ?? '');
    return [output, error].filter(Boolean).join('\n');
  }

  function getTranscriptTurnByPromptId(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): TranscriptTurn | null {
    const stored = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
    const turns =
      stored.available && stored.chat && Array.isArray(stored.chat.turns) ? stored.chat.turns : [];
    return (turns.find((turn: any) => String(turn?.id ?? '').trim() === opts.promptId) ??
      null) as TranscriptTurn | null;
  }

  function getTranscriptTurnByPromptIdFromRegistry(
    regAny: any,
    opts: { droneId: string; chatName: string; promptId: string },
  ): TranscriptTurn | null {
    const turns = Array.isArray(regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName]?.turns)
      ? regAny.drones[opts.droneId].chats[opts.chatName].turns
      : [];
    return (turns.find((t: any) => String(t?.id ?? '').trim() === opts.promptId) ??
      null) as TranscriptTurn | null;
  }

  function chatAgentMessageAutoContinueEnabled(chatEntry: any): boolean {
    return chatEntry?.agentMessageAutoContinueEnabled === true;
  }

  function buildAgentMessageAutoContinueSourceMessageId(opts: {
    droneId: string;
    chatName: string;
    turn: TranscriptTurn | null | undefined;
  }): string {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const turnId = String(opts.turn?.id ?? '').trim();
    if (droneId && turnId) return `${droneId}:${turnId}`;
    const at = String(opts.turn?.completedAt ?? opts.turn?.promptAt ?? opts.turn?.at ?? '').trim();
    if (!droneId || !chatName || !at) return '';
    return `${droneId}:${chatName}:${at}`;
  }

  function buildAgentMessageAutoContinueChatLockId(opts: {
    droneId: string;
    chatName: string;
  }): string {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    if (!droneId || !chatName) return '';
    return `${droneId}:${chatName}`;
  }

  function normalizeAgentMessageAutoContinueTurnState(
    raw: TranscriptTurn['agentMessageAutoContinue'] | undefined,
  ): NonNullable<TranscriptTurn['agentMessageAutoContinue']> | null {
    if (!raw || typeof raw !== 'object') return null;
    const status = String(raw.status ?? '').trim();
    if (status !== 'pending' && status !== 'classified' && status !== 'failed') return null;
    const bucketRaw = String(raw.bucket ?? '').trim();
    const sourceRaw = String(raw.source ?? '').trim();
    const classifiedAt = String(raw.classifiedAt ?? '').trim();
    const continuedAt = String(raw.continuedAt ?? '').trim();
    const error = String(raw.error ?? '').trim();
    const updatedAt = String(raw.updatedAt ?? '').trim();
    return {
      status,
      ...(bucketRaw === 'user-turn' || bucketRaw === 'continue' ? { bucket: bucketRaw } : {}),
      ...(sourceRaw === 'llm' || sourceRaw === 'agent-copilot-json' || sourceRaw === 'heuristic'
        ? { source: sourceRaw }
        : {}),
      ...(classifiedAt ? { classifiedAt } : {}),
      ...(continuedAt ? { continuedAt } : {}),
      ...(error ? { error } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  }

  function normalizeAgentSuggestionTurnState(
    raw: TranscriptTurn['agentSuggestion'] | undefined,
  ): NonNullable<TranscriptTurn['agentSuggestion']> | null {
    if (!raw || typeof raw !== 'object') return null;
    const usedDirectAt = String(raw.usedDirectAt ?? '').trim();
    const suggestionHash = String(raw.suggestionHash ?? '').trim();
    const policyFingerprint = String(raw.policyFingerprint ?? '').trim();
    const updatedAt = String(raw.updatedAt ?? '').trim();
    if (!usedDirectAt && !suggestionHash && !policyFingerprint && !updatedAt) return null;
    return {
      ...(usedDirectAt ? { usedDirectAt } : {}),
      ...(suggestionHash ? { suggestionHash } : {}),
      ...(policyFingerprint ? { policyFingerprint } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  }

  function turnNeedsAgentMessageAutoContinueProcessing(
    turn: TranscriptTurn | null | undefined,
    enabledAtMs: number,
  ): boolean {
    if (!turn?.ok || turn?.inheritedFromClone === true) return false;
    if (!String(turn?.id ?? '').trim()) return false;
    const turnIso = String(turn?.completedAt ?? turn?.at ?? '').trim();
    const turnMs = turnIso ? new Date(turnIso).getTime() : Number.NaN;
    if (!Number.isFinite(turnMs) || turnMs < enabledAtMs) return false;
    const state = normalizeAgentMessageAutoContinueTurnState(turn.agentMessageAutoContinue);
    return !state || state.status === 'pending';
  }

  async function markTranscriptTurnAgentMessageAutoContinuePending(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
  }): Promise<void> {
    const updatedAt = nowIso();
    await updateTranscriptTurnById({
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      update: (turn: any) => ({
        ...turn,
        agentMessageAutoContinue: {
          status: 'pending',
          updatedAt,
        },
      }),
    });
  }

  async function markTranscriptTurnAgentMessageAutoContinueResult(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    classification: AgentMessageAutoContinueClassification;
    continuedAt?: string | null;
  }): Promise<void> {
    const updatedAt = nowIso();
    await updateTranscriptTurnById({
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      update: (turn: any) => ({
        ...turn,
        agentMessageAutoContinue: {
          status: 'classified',
          bucket: opts.classification.bucket,
          source: opts.classification.source,
          classifiedAt: updatedAt,
          ...(opts.continuedAt ? { continuedAt: opts.continuedAt } : {}),
          updatedAt,
        },
      }),
    });
  }

  async function markTranscriptTurnAgentMessageAutoContinueFailed(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    error: string;
  }): Promise<void> {
    const updatedAt = nowIso();
    await updateTranscriptTurnById({
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      update: (turn: any) => ({
        ...turn,
        agentMessageAutoContinue: {
          status: 'failed',
          error: opts.error,
          updatedAt,
        },
      }),
    });
  }

  async function markTranscriptTurnAgentSuggestionUsedDirect(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    suggestionHash: string;
    policyFingerprint: string;
  }): Promise<void> {
    const updatedAt = nowIso();
    await updateTranscriptTurnById({
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      update: (turn: any) => ({
        ...turn,
        agentSuggestion: {
          usedDirectAt: updatedAt,
          suggestionHash: String(opts.suggestionHash ?? '').trim(),
          policyFingerprint: String(opts.policyFingerprint ?? '').trim(),
          updatedAt,
        },
      }),
    });
  }

  async function processPendingAgentMessageAutoContinueTurns(opts: {
    droneId: string;
    chatName: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    if (!droneId || !chatName) return;
    const chatLockId = buildAgentMessageAutoContinueChatLockId({ droneId, chatName });
    if (!chatLockId || agentFollowupCoordinator.isAutoContinueChatActive(chatLockId)) return;

    const stored = readChatFromStore({ droneId, chatName });
    const chatEntry = stored.available ? stored.chat : null;
    if (!chatEntry || !chatAgentMessageAutoContinueEnabled(chatEntry)) return;
    const turns: TranscriptTurn[] = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
    if (turns.length === 0) return;
    const enabledAtIso = String(chatEntry?.agentMessageAutoContinueEnabledAt ?? '').trim();
    const enabledAtMs = enabledAtIso ? new Date(enabledAtIso).getTime() : Number.NaN;
    if (!Number.isFinite(enabledAtMs)) return;

    const llmProvider = await resolveEffectiveLlmProvider();
    const providerSettings = await resolveEffectiveProviderApiKeySettings(llmProvider.provider);
    const autoContinueSettings = await resolveEffectiveAgentMessageAutoContinueSettings();

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex] ?? null;
      if (!turnNeedsAgentMessageAutoContinueProcessing(turn, enabledAtMs)) continue;
      const promptId = String(turn?.id ?? '').trim();
      if (!promptId) continue;
      const sourceMessageId = buildAgentMessageAutoContinueSourceMessageId({
        droneId,
        chatName,
        turn,
      });
      if (!agentFollowupCoordinator.startAutoContinue(sourceMessageId, chatLockId)) continue;
      await markTranscriptTurnAgentMessageAutoContinuePending({
        droneId,
        chatName,
        promptId,
      });

      void (async () => {
        try {
          const output = stripAnsiFromCliOutput(String(turn?.output ?? ''));
          const classification = await classifyAgentMessageAutoContinue(output, {
            provider: llmProvider.provider,
            apiKey: providerSettings.apiKey ?? undefined,
          });

          await markTranscriptTurnAgentMessageAutoContinueResult({
            droneId,
            chatName,
            promptId,
            classification,
          });

          let continuedAt: string | null = null;
          if (classification.bucket === 'continue') {
            const enqueued = await createOrEnqueuePromptUnified({
              droneId,
              chatName,
              prompt: autoContinueSettings.prompt,
            });
            if (enqueued.kind === 'error') throw new Error(enqueued.error);
            continuedAt = nowIso();
          }

          await markTranscriptTurnAgentMessageAutoContinueResult({
            droneId,
            chatName,
            promptId,
            classification,
            ...(continuedAt ? { continuedAt } : {}),
          });
        } catch (error: any) {
          await markTranscriptTurnAgentMessageAutoContinueFailed({
            droneId,
            chatName,
            promptId,
            error: String(error?.message ?? error ?? 'Unknown error.'),
          });
        } finally {
          agentFollowupCoordinator.finishAutoContinue(sourceMessageId, chatLockId);
        }
      })();
      return;
    }
  }

  function buildAgentCopilotSourceMessageId(opts: {
    droneId: string;
    chatName: string;
    turn: TranscriptTurn | null | undefined;
    turnIndex: number;
  }): string {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const turnId = String(opts.turn?.id ?? '').trim();
    if (droneId && turnId) return `${droneId}:${turnId}`;
    const at = String(opts.turn?.completedAt ?? opts.turn?.promptAt ?? opts.turn?.at ?? '').trim();
    if (!droneId || !chatName || !at) return '';
    return `${droneId}:${chatName}:${opts.turnIndex}:${at}`;
  }

  function readHandledAgentCopilotSourceMessageIds(chatEntry: any): string[] {
    return Array.from(
      new Set(
        (Array.isArray(chatEntry?.agentCopilotHandledSourceMessageIds)
          ? chatEntry.agentCopilotHandledSourceMessageIds
          : []
        )
          .map((item: any) => String(item ?? '').trim())
          .filter(Boolean),
      ),
    );
  }

  function hasHandledAgentCopilotSourceMessage(
    chatEntry: any,
    sourceMessageIdRaw: string,
  ): boolean {
    const sourceMessageId = String(sourceMessageIdRaw ?? '').trim();
    if (!sourceMessageId) return false;
    return readHandledAgentCopilotSourceMessageIds(chatEntry).includes(sourceMessageId);
  }

  async function markAgentCopilotSourceMessageHandled(opts: {
    droneId: string;
    chatName: string;
    sourceMessageId: string;
  }): Promise<void> {
    const sourceMessageId = String(opts.sourceMessageId ?? '').trim();
    if (!sourceMessageId) return;
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const stored = readChatFromStore({ droneId, chatName });
    if (!stored.available || !stored.chat) return;
    const handledIds = readHandledAgentCopilotSourceMessageIds(stored.chat);
    if (handledIds.includes(sourceMessageId)) return;
    handledIds.push(sourceMessageId);
    await patchChatMetadataInStore({
      droneId,
      chatName,
      patch: {
        set: {
          agentCopilotHandledSourceMessageIds:
            handledIds.length > AGENT_COPILOT_HANDLED_CAP
              ? handledIds.slice(-AGENT_COPILOT_HANDLED_CAP)
              : handledIds,
        },
      },
    });
    await projectCanonicalChatToRegistry(droneId, chatName);
  }

  function buildAgentCopilotResponsePrompt(nameRaw: string, responseRaw: string): string {
    const name = String(nameRaw ?? '').trim();
    const response = String(responseRaw ?? '').trim();
    return `This is what copilot '${name}' responded with:\n${response}`;
  }

  function buildAgentCopilotErrorPrompt(errorRaw: string, nameRaw?: string): string {
    const error = String(errorRaw ?? '').trim() || 'Unknown error.';
    const name = String(nameRaw ?? '').trim();
    if (!name) return `Agent copilot error: ${error}`;
    return `Copilot '${name}' failed: ${error}`;
  }

  function buildAgentCopilotPromptId(opts: {
    sourceMessageId: string;
    stage: 'copilot' | 'source-result' | 'source-error' | 'source-parse-error';
  }): string {
    const sourceMessageId = String(opts.sourceMessageId ?? '').trim();
    const digest = crypto.createHash('sha1').update(sourceMessageId).digest('hex').slice(0, 24);
    return `agent-copilot-${opts.stage}-${digest}`;
  }

  function getPendingPromptByIdFromRegistry(
    regAny: any,
    opts: { droneId: string; chatName: string; promptId: string },
  ): PendingPrompt | null {
    const pending = Array.isArray(
      regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName]?.pendingPrompts,
    )
      ? regAny.drones[opts.droneId].chats[opts.chatName].pendingPrompts
      : [];
    return (pending.find((item: any) => String(item?.id ?? '').trim() === opts.promptId) ??
      null) as PendingPrompt | null;
  }

  async function ensureAgentCopilotPromptCompleted(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    prompt: string;
  }): Promise<TranscriptTurn> {
    const existingTurn = getTranscriptTurnByPromptId(opts);
    if (existingTurn) return existingTurn;

    const existingPending =
      (await readPendingPrompts({ droneId: opts.droneId, chatName: opts.chatName })).find(
        (pending: any) => pending.id === opts.promptId,
      ) ?? null;
    if (!existingPending || existingPending.state === 'failed') {
      const enqueued = await createOrEnqueuePromptUnified({
        id: opts.promptId,
        droneId: opts.droneId,
        chatName: opts.chatName,
        prompt: opts.prompt,
      });
      if (enqueued.kind === 'error') throw new Error(enqueued.error);
    }

    await waitForPromptAutomationPromptCompletion({
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
      signal: new AbortController().signal,
    });

    const turn = getTranscriptTurnByPromptId(opts);
    if (turn) return turn;
    const pending =
      (await readPendingPrompts({ droneId: opts.droneId, chatName: opts.chatName })).find(
        (item: any) => item.id === opts.promptId,
      ) ?? null;
    if (pending?.state === 'failed') {
      throw new Error(
        String(pending.error ?? `prompt ${opts.promptId} failed`).trim() ||
          `prompt ${opts.promptId} failed`,
      );
    }
    throw new Error(`Timed out waiting for prompt ${opts.promptId} completion`);
  }

  async function ensureAgentCopilotSourcePromptCompleted(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    prompt: string;
  }): Promise<void> {
    await ensureAgentCopilotPromptCompleted(opts);
  }

  async function processAgentCopilotRequest(opts: {
    sourceDroneId: string;
    sourceChatName: string;
    sourceMessageId: string;
    copilot: AgentCopilotRequest | null;
    parseError: string | null;
  }): Promise<void> {
    if (opts.parseError) {
      const parseErrorPromptId = buildAgentCopilotPromptId({
        sourceMessageId: opts.sourceMessageId,
        stage: 'source-parse-error',
      });
      await ensureAgentCopilotSourcePromptCompleted({
        droneId: opts.sourceDroneId,
        chatName: opts.sourceChatName,
        promptId: parseErrorPromptId,
        prompt: buildAgentCopilotErrorPrompt(opts.parseError),
      });
      await markAgentCopilotSourceMessageHandled({
        droneId: opts.sourceDroneId,
        chatName: opts.sourceChatName,
        sourceMessageId: opts.sourceMessageId,
      });
      return;
    }

    if (!opts.copilot) return;

    const copilotChatName = parseChatNameForMutation(opts.copilot.name, 'agent copilot name');
    const copilotPromptId = buildAgentCopilotPromptId({
      sourceMessageId: opts.sourceMessageId,
      stage: 'copilot',
    });
    const sourceResultPromptId = buildAgentCopilotPromptId({
      sourceMessageId: opts.sourceMessageId,
      stage: 'source-result',
    });

    await ensureChatEntryCopiedFromChat({
      droneId: opts.sourceDroneId,
      chatName: copilotChatName,
      copyFromChatName: opts.sourceChatName,
    });
    const responseTurn = await ensureAgentCopilotPromptCompleted({
      droneId: opts.sourceDroneId,
      chatName: copilotChatName,
      promptId: copilotPromptId,
      prompt: opts.copilot.message,
    });

    const followupPrompt = responseTurn.ok
      ? buildAgentCopilotResponsePrompt(
          copilotChatName,
          stripAnsiFromCliOutput(String(responseTurn.output ?? '')),
        )
      : buildAgentCopilotErrorPrompt(
          String(responseTurn.error ?? 'Copilot failed.'),
          copilotChatName,
        );
    await ensureAgentCopilotSourcePromptCompleted({
      droneId: opts.sourceDroneId,
      chatName: opts.sourceChatName,
      promptId: sourceResultPromptId,
      prompt: followupPrompt,
    });

    await markAgentCopilotSourceMessageHandled({
      droneId: opts.sourceDroneId,
      chatName: opts.sourceChatName,
      sourceMessageId: opts.sourceMessageId,
    });
  }

  async function processPendingAgentCopilotTurns(opts: {
    droneId: string;
    chatName: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    if (!droneId || !chatName) return;

    const stored = readChatFromStore({ droneId, chatName });
    const chatEntry = stored.available ? stored.chat : null;
    if (!chatEntry) return;
    const turns: TranscriptTurn[] = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex] ?? null;
      if (!turn?.ok || turn?.inheritedFromClone === true) continue;
      const sourceMessageId = buildAgentCopilotSourceMessageId({
        droneId,
        chatName,
        turn,
        turnIndex,
      });
      if (!sourceMessageId) continue;
      if (hasHandledAgentCopilotSourceMessage(chatEntry, sourceMessageId)) continue;

      const extracted = extractAgentCopilotFromAgentMessage(
        stripAnsiFromCliOutput(String(turn.output ?? '')),
      );
      if (!extracted.copilot && !extracted.error) continue;
      if (!agentFollowupCoordinator.startCopilot(sourceMessageId)) continue;

      void processAgentCopilotRequest({
        sourceDroneId: droneId,
        sourceChatName: chatName,
        sourceMessageId,
        copilot: extracted.copilot,
        parseError: extracted.error,
      })
        .catch(async (error: any) => {
          try {
            const sourceErrorPromptId = buildAgentCopilotPromptId({
              sourceMessageId,
              stage: 'source-error',
            });
            await ensureAgentCopilotSourcePromptCompleted({
              droneId,
              chatName,
              promptId: sourceErrorPromptId,
              prompt: buildAgentCopilotErrorPrompt(
                String(error?.message ?? error ?? 'Unknown error.'),
                extracted.copilot?.name,
              ),
            });
            await markAgentCopilotSourceMessageHandled({
              droneId,
              chatName,
              sourceMessageId,
            });
          } catch {
            // Leave the source message unhandled so a later reconcile can retry.
          }
        })
        .finally(() => {
          agentFollowupCoordinator.finishCopilot(sourceMessageId);
        });
    }
  }

  function promptAutomationOutputContainsStopPhrase(opts: {
    output: string;
    stopPhrase: string;
    caseSensitive: boolean;
  }): boolean {
    const phrase = normalizePromptAutomationStopPhrase(opts.stopPhrase);
    if (!phrase) return false;
    const output = String(opts.output ?? '');
    if (!output) return false;
    const normalizedOutput = stripAnsiFromCliOutput(output);
    if (opts.caseSensitive) return output.includes(phrase) || normalizedOutput.includes(phrase);
    const lowerPhrase = phrase.toLowerCase();
    return (
      output.toLowerCase().includes(lowerPhrase) ||
      normalizedOutput.toLowerCase().includes(lowerPhrase)
    );
  }

  async function preservePromptAutomationPendingHistory(opts: {
    droneId: string;
    chatName: string;
    promptId: string;
    prompt: string;
    automation: PromptAutomationMeta;
  }): Promise<void> {
    const now = nowIso();
    await pushPendingPrompt({
      droneId: opts.droneId,
      chatName: opts.chatName,
      pending: {
        id: opts.promptId,
        at: now,
        prompt: opts.prompt,
        automation: normalizePromptAutomationMeta(opts.automation),
        state: 'sent',
        updatedAt: now,
      },
    }).catch(() => {});
  }

  async function sendPromptAutomationFinalMessage(
    job: PromptAutomationJobState,
    opts?: { ignoreAbortSignal?: boolean },
  ): Promise<void> {
    const finalPrompt = String(job.onFailurePrompt ?? '').trim();
    if (!finalPrompt) return;
    const ignoreAbortSignal = opts?.ignoreAbortSignal === true;
    const signal = ignoreAbortSignal ? null : job.abortController?.signal;
    if (!ignoreAbortSignal && signal?.aborted) return;
    const automation: PromptAutomationMeta = {
      kind: 'prompt-loop',
      stage: 'final-message',
      jobKey: job.executionKey,
      automationId: job.automationId,
      automationLabel: job.automationLabel,
      runsTotal: job.runsTotal,
      sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
      ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
      ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
      ...(typeof job.finishedEarlyRunIndex === 'number'
        ? { stopMatchedRunIndex: job.finishedEarlyRunIndex }
        : {}),
      promptPreview: previewPromptAutomationPrompt(finalPrompt),
    };
    const enqueued = await createOrEnqueuePromptUnified({
      droneId: job.droneId,
      chatName: job.chatName,
      prompt: finalPrompt,
      automation,
    });
    if (enqueued.kind === 'error') throw new Error(enqueued.error);
    job.lastPromptId = enqueued.id;
    job.updatedAt = nowIso();
    const nativeChatId = await nativeAutomationChatId(job.droneId, job.chatName);
    if (nativeChatId) {
      await waitForNativeAutomationCompletion(
        nativeChatId,
        PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
        signal ?? new AbortController().signal,
      );
    } else {
      await waitForPromptAutomationPromptCompletion({
        droneId: job.droneId,
        chatName: job.chatName,
        promptId: enqueued.id,
        timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
        signal: signal ?? new AbortController().signal,
        requireTranscript: false,
      });
      await preservePromptAutomationPendingHistory({
        droneId: job.droneId,
        chatName: job.chatName,
        promptId: enqueued.id,
        prompt: finalPrompt,
        automation,
      });
    }
    job.updatedAt = nowIso();
  }

  async function nativeAutomationChatId(
    droneId: string,
    chatName: string,
  ): Promise<string> {
    const { d, chat } = await getChatEntry({ droneId, chatName });
    return inferChatAgent(chat, d).kind === 'native' ? String(chat?.id ?? '').trim() : '';
  }

  async function waitForNativeAutomationCompletion(
    nativeChatId: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (signal.aborted) throw new Error('automation stopped');
      if (!(await nativeChatIsBusy(nativeChatId))) {
        const error = await nativeChatError(nativeChatId);
        if (error) throw new Error(error);
        return;
      }
      await sleepMs(250);
    } while (Date.now() < deadline);
    throw new Error('Timed out waiting for the Built-in agent to finish');
  }

  async function runPromptAutomationJob(job: PromptAutomationJobState): Promise<void> {
    let lastRunError = '';
    let hadRunFailure = false;
    try {
      for (let runIdx = 0; runIdx < job.runsTotal; runIdx++) {
        const signal = job.abortController?.signal;
        if (signal?.aborted) throw new Error('automation stopped');
        try {
          await waitForPromptAutomationChatIdle({
            droneId: job.droneId,
            chatName: job.chatName,
            timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_IDLE_TIMEOUT_MS,
            signal: signal ?? new AbortController().signal,
          });

          const automation: PromptAutomationMeta = {
            kind: 'prompt-loop',
            stage: 'run',
            jobKey: job.executionKey,
            automationId: job.automationId,
            automationLabel: job.automationLabel,
            runIndex: runIdx + 1,
            runsTotal: job.runsTotal,
            sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
            ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
            ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
            promptPreview: previewPromptAutomationPrompt(job.prompt),
          };
          const enqueued = await createOrEnqueuePromptUnified({
            droneId: job.droneId,
            chatName: job.chatName,
            prompt: job.prompt,
            automation,
          });
          if (enqueued.kind === 'error') throw new Error(enqueued.error);
          job.lastPromptId = enqueued.id;
          job.updatedAt = nowIso();
          notifyPromptAutomationChatChanged(job.droneId, job.chatName);
          const nativeChatId = await nativeAutomationChatId(job.droneId, job.chatName);
          if (nativeChatId) {
            await waitForNativeAutomationCompletion(
              nativeChatId,
              PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
              signal ?? new AbortController().signal,
            );
          } else {
            await waitForPromptAutomationPromptCompletion({
              droneId: job.droneId,
              chatName: job.chatName,
              promptId: enqueued.id,
              timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
              signal: signal ?? new AbortController().signal,
            });
            await preservePromptAutomationPendingHistory({
              droneId: job.droneId,
              chatName: job.chatName,
              promptId: enqueued.id,
              prompt: job.prompt,
              automation,
            });
          }
          job.runsCompleted += 1;
          job.updatedAt = nowIso();
          notifyPromptAutomationChatChanged(job.droneId, job.chatName);

          if (job.stopPhrase) {
            let output = '';
            try {
              output = nativeChatId
                ? await nativeChatLatestAssistantText(nativeChatId)
                : await readPromptAutomationTurnOutput({
                    droneId: job.droneId,
                    chatName: job.chatName,
                    promptId: enqueued.id,
                  });
            } catch {
              output = '';
            }
            if (
              promptAutomationOutputContainsStopPhrase({
                output,
                stopPhrase: job.stopPhrase,
                caseSensitive: job.stopPhraseCaseSensitive,
              })
            ) {
              job.finishedEarly = true;
              job.finishedEarlyReason = 'stop-phrase';
              job.finishedEarlyRunIndex = job.runsCompleted;
              job.runsTotal = job.runsCompleted;
              job.updatedAt = nowIso();
              notifyPromptAutomationChatChanged(job.droneId, job.chatName);
              break;
            }
          }
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? '').trim();
          if (job.abortController?.signal.aborted || /automation stopped/i.test(msg)) throw e;
          hadRunFailure = true;
          lastRunError = msg || 'automation run failed';
          job.updatedAt = nowIso();
          notifyPromptAutomationChatChanged(job.droneId, job.chatName);
        }

        if (job.finishedEarly) break;
        if (runIdx < job.runsTotal - 1 && job.sleepBetweenRunsSeconds > 0) {
          const waitSignal = job.abortController?.signal ?? new AbortController().signal;
          await waitForPromptAutomationInterRunSleep({
            sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
            signal: waitSignal,
          });
          job.updatedAt = nowIso();
          notifyPromptAutomationChatChanged(job.droneId, job.chatName);
        }
      }

      if (job.runsCompleted > 0 && job.onFailurePrompt) {
        try {
          await sendPromptAutomationFinalMessage(job);
        } catch (followupError: any) {
          const followupMsg =
            String(followupError?.message ?? followupError ?? '').trim() ||
            'failed sending final message';
          hubLog('warn', 'prompt automation final message failed', {
            droneId: job.droneId,
            chatName: job.chatName,
            automationId: job.automationId,
            jobKey: job.executionKey,
            error: followupMsg,
          });
          if (!hadRunFailure) {
            hadRunFailure = true;
            lastRunError = `final message failed: ${followupMsg}`;
          } else {
            lastRunError = lastRunError
              ? `${lastRunError}; final message failed: ${followupMsg}`
              : `final message failed: ${followupMsg}`;
          }
        }
      }

      if (hadRunFailure) {
        job.status = 'failed';
        job.error = lastRunError || 'automation failed';
      } else {
        job.status = 'completed';
        job.error = null;
      }
      job.updatedAt = nowIso();
      notifyPromptAutomationChatChanged(job.droneId, job.chatName);
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '').trim();
      if (job.abortController?.signal.aborted || /automation stopped/i.test(msg)) {
        const stopMode = job.stopMode === 'runs-only' ? 'runs-only' : 'all';
        if (stopMode === 'runs-only') {
          let finalMessageError = '';
          if (job.runsCompleted > 0 && job.onFailurePrompt) {
            try {
              await sendPromptAutomationFinalMessage(job, { ignoreAbortSignal: true });
            } catch (followupError: any) {
              finalMessageError =
                String(followupError?.message ?? followupError ?? '').trim() ||
                'final message failed';
            }
          }
          job.finishedEarly = true;
          if (!job.finishedEarlyReason) job.finishedEarlyReason = 'manual-stop-runs-only';
          if (job.runsCompleted > 0) job.finishedEarlyRunIndex = job.runsCompleted;
          if (finalMessageError) {
            job.status = 'failed';
            job.error = `final message failed: ${finalMessageError}`;
          } else {
            job.status = 'stopped';
            job.error = null;
          }
          job.updatedAt = nowIso();
          notifyPromptAutomationChatChanged(job.droneId, job.chatName);
          return;
        }
        job.status = 'stopped';
        job.error = null;
        job.updatedAt = nowIso();
        notifyPromptAutomationChatChanged(job.droneId, job.chatName);
        return;
      }
      job.status = 'failed';
      job.error = msg || 'automation failed';
      job.updatedAt = nowIso();
      notifyPromptAutomationChatChanged(job.droneId, job.chatName);
    } finally {
      job.stopMode = null;
      job.abortController = null;
      job.task = null;
    }
  }

  function finalizePromptAutomationLaneJob(
    lane: PromptAutomationLaneState,
    job: PromptAutomationJobState,
  ): void {
    promptAutomationManager.finalize(lane, job);
  }

  async function recoverStalledPromptAutomationLane(
    lane: PromptAutomationLaneState | null | undefined,
  ): Promise<void> {
    if (!lane || !lane.runningJob) return;
    const job = lane.runningJob;
    if (job.status !== 'running') return;
    if (job.runsTotal <= 0 || job.runsCompleted < job.runsTotal) return;

    const updatedMs = parsePromptAutomationIsoMs(job.updatedAt || job.startedAt);
    if (!updatedMs) return;
    const ageMs = Date.now() - updatedMs;
    if (ageMs < PROMPT_AUTOMATION_COMPLETION_STALL_RECOVERY_GRACE_MS) return;

    const finalPrompt = String(job.onFailurePrompt ?? '').trim();
    if (!finalPrompt) {
      job.status = 'completed';
      job.error = null;
      job.updatedAt = nowIso();
      finalizePromptAutomationLaneJob(lane, job);
      return;
    }

    const regAny: any = await loadRegistry().catch(() => null);
    if (!regAny || typeof regAny !== 'object') return;
    const finalSnapshot = readPromptAutomationFinalMessageSnapshot(regAny, job);

    if (finalSnapshot.hasFinalTranscriptTurn) {
      job.status = 'completed';
      job.error = null;
      job.updatedAt = nowIso();
      finalizePromptAutomationLaneJob(lane, job);
      return;
    }

    if (finalSnapshot.pendingFinalState === 'failed') {
      job.status = 'failed';
      job.error = 'final message failed';
      job.updatedAt = nowIso();
      finalizePromptAutomationLaneJob(lane, job);
      return;
    }

    if (!finalSnapshot.pendingFinalState) {
      job.status = 'failed';
      job.error = 'final message was not enqueued after automation runs completed';
      job.updatedAt = nowIso();
      finalizePromptAutomationLaneJob(lane, job);
      return;
    }

    if (finalSnapshot.pendingFinalState === 'queued') {
      const queuedUpdatedMs = parsePromptAutomationIsoMs(finalSnapshot.pendingFinalUpdatedAt);
      const queuedAgeMs = queuedUpdatedMs > 0 ? Date.now() - queuedUpdatedMs : 0;
      const queuedStaleAfterMs = Math.max(defaultPromptEnqueueTimeoutMs() * 2, 5 * 60_000);
      if (queuedUpdatedMs > 0 && queuedAgeMs >= queuedStaleAfterMs) {
        job.status = 'failed';
        job.error = 'final message remained queued for too long';
        job.updatedAt = nowIso();
        finalizePromptAutomationLaneJob(lane, job);
      }
      return;
    }

    const staleFinalState = stalePendingPromptState({
      state: finalSnapshot.pendingFinalState,
      updatedAt: finalSnapshot.pendingFinalUpdatedAt,
      at: finalSnapshot.pendingFinalUpdatedAt,
      enqueueTimeoutMs: defaultPromptEnqueueTimeoutMs(),
    });
    if (staleFinalState === 'sending' || staleFinalState === 'sent') {
      job.status = 'failed';
      job.error = 'final message stalled before transcript reconciliation';
      job.updatedAt = nowIso();
      finalizePromptAutomationLaneJob(lane, job);
    }
  }

  function stopPromptAutomationJob(opts: {
    droneId: string;
    chatName: string;
    stopMode?: PromptAutomationStopMode;
    clearQueued?: boolean;
  }): PromptAutomationLaneState | null {
    return promptAutomationManager.stop(opts);
  }

  // Hub-side pump for `pendingPrompts` entries that are persisted but not yet enqueued
  // into the drone daemon (state: 'queued'). This is used to preserve session continuity
  // for agents where the continuation/session id is only known after the first turn.
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

  async function pumpQueuedPendingPromptsForChat(opts: {
    droneId: string;
    chatName: string;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = String(opts.chatName ?? '').trim() || 'default';
    if (!droneId) return;

    // Avoid unbounded loops if state keeps changing due to concurrent requests.
    for (let attempts = 0; attempts < 50; attempts++) {
      const { d, chat } = await getChatEntry({ droneId, chatName });
      if (isDraftChatEntry(chat)) return;
      const agent = inferChatAgent(chat, d);
      if (!agent || (agent.kind !== 'builtin' && agent.kind !== 'native')) return;

      const entry: any = chat;
      // Prompt rows are canonical in SQLite; the registry-backed chat projection
      // is compatibility metadata and can lag queue transitions.
      const pendingList: any[] = await readPendingPrompts({ droneId, chatName });
      if (pendingList.length === 0) return;

      const turns: any[] = Array.isArray(entry?.turns) ? entry.turns : [];
      const transcriptDoneIds = new Set(
        turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean),
      );

      const idx = pendingList.findIndex(
        (p: any) => String(p?.state ?? '') === 'queued' && String(p?.id ?? '').trim(),
      );
      if (idx === -1) return;

      const p = pendingList[idx] ?? {};
      const id = String(p?.id ?? '').trim();
      const prompt = String(p?.prompt ?? '');
      const cwd = typeof p?.cwd === 'string' ? String(p.cwd) : null;
      const blockedByAutomation = Boolean((p as any)?.blockedByAutomation);
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

      if (blockedByAutomation) {
        const lane = getPromptAutomationLane(droneId, chatName);
        if (promptAutomationLaneBusy(lane, { includeQueued: true })) {
          // Held intentionally behind automation lane completion.
          return;
        }
      }

      const sessionKnown = hasKnownBuiltinTranscriptSession(entry, agent.id);
      const prior = pendingList
        .slice(0, idx)
        .map((x: any) => ({ id: String(x?.id ?? '').trim(), state: String(x?.state ?? '') }))
        .filter((x: any) => x.id);
      // Keep manual follow-ups cancellable until the earlier response reaches the transcript.
      // A known agent session makes continuation possible, but does not make concurrent delivery safe.
      const defer = shouldDeferQueuedPendingPrompt({
        agentId: agent.id,
        sessionKnown,
        priorPendingPrompts: prior,
        transcriptDoneIds,
      });
      if (defer) return;

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
            skipManagedRepoSync:
              String((p as any)?.automation?.kind ?? '').trim() === 'prompt-loop',
          });
        } catch (e: any) {
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

      // Transition queued -> sending before we attempt any daemon work.
      // This claim is atomic to prevent a race where a user cancels a queued row.
      const claimed = await claimQueuedPendingPromptForSending({ droneId, chatName, id });
      if (!claimed) {
        continue;
      }

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
            skipManagedRepoSync:
              String((p as any)?.automation?.kind ?? '').trim() === 'prompt-loop',
          }),
          enqueueTimeoutMs,
          `queued prompt enqueue failed for ${droneId}/${chatName}`,
        );
        if (r?.turnOk === false) {
          await updatePendingPrompt({
            droneId,
            chatName,
            id,
            patch: { state: 'failed', error: String(r?.error ?? 'failed') },
          });
        } else {
          if (agent.kind === 'native') {
            const nativeChatId = String((chat as any)?.id ?? '').trim();
            if (!nativeChatId) throw new Error('native chat has no stable identity');
            await waitForNativeAutomationCompletion(
              nativeChatId,
              PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
              new AbortController().signal,
            );
          }
          await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sent' } });
          if (agent.kind === 'builtin') {
            // Best-effort: reconcile soon after enqueue to keep UI fresh.
            enqueueReconcile(droneId, chatName);
          }
        }
      } catch (e: any) {
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
      }
    }
  }

  const pendingPromptPump = new PendingPromptPump({
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    concurrencyLimit: pendingPromptPumpConcurrencyLimit,
    defaultRetryDelayMs: defaultPendingPromptEnqueueRetryDelayMs,
    run: pumpQueuedPendingPromptsForChat,
  });

  async function resetPromptAutomationStateForTests(): Promise<void> {
    await promptAutomationManager.reset();
    await pendingPromptPump.reset();
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

    promptAutomationManager.delete(opts.droneId, opts.chatName);

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

    promptAutomationManager.migrate(opts.droneId, opts.fromChatName, opts.toChatName);

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
        })
      )
        return true;
    }
    return false;
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
    if (
      promptAutomationLaneBusy(getPromptAutomationLane(droneId, chatName), { includeQueued: true })
    ) {
      reasons.push('prompt-automation');
    }
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
    normalizePromptAutomationMeta,
    nowIso,
    parseBlipJobTranscript,
    parseCodexJobTranscript,
    parsePiJobTranscript,
    parseStructuredAgentJobTranscript,
    processPendingAgentCopilotTurns,
    processPendingAgentMessageAutoContinueTurns,
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
  });
  const { reconcileChatFromDaemon } = chatReconciliationExecutor;

  async function enqueuePrompt(opts: {
    id?: string;
    droneId: string;
    chatName: string;
    prompt: string;
    attachments?: ChatImageAttachment[];
    automation?: PromptAutomationMeta | null;
    cwd?: string | null;
    submittedAt?: string | null;
    waitForDaemonMs?: number;
    deliveryMode?: 'background' | 'immediate';
    mark?: (name: string) => void;
  }): Promise<{ id: string; pendingState: PendingPromptState; blockedByAutomation: boolean }> {
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
    const disposition = getPromptEnqueueDisposition({
      droneId,
      chatName,
      droneEntry: d,
      chatEntry: { ...chat, pendingPrompts: canonicalPendingPrompts },
      automation: opts.automation,
    });
    const { defer, blockedByAutomation } = disposition;
    opts.mark?.('disposition');

    const cwd = normalizeDroneCwdForRuntime(d, typeof opts.cwd === 'string' ? opts.cwd : null);
    const rawAttachments = Array.isArray(opts.attachments) ? opts.attachments : [];
    const attachmentsStorageRoot = chatAttachmentsStorageRootForDrone(d);
    const attachmentsForPending = buildChatImageAttachmentRefs({
      attachments: rawAttachments,
      cwd,
      chatName,
      promptId: id,
      storageRoot: attachmentsStorageRoot,
    });

    await pushPendingPrompt({
      droneId,
      chatName,
      pending: {
        id,
        at,
        prompt: opts.prompt,
        ...(configuredModel ? { model: configuredModel } : {}),
        cwd: opts.cwd ?? null,
        ...(attachmentsForPending.length > 0 ? { attachments: attachmentsForPending } : {}),
        ...(opts.automation ? { automation: normalizePromptAutomationMeta(opts.automation) } : {}),
        ...(blockedByAutomation ? { blockedByAutomation: true } : {}),
        state: defer || opts.deliveryMode === 'background' ? 'queued' : 'sending',
        updatedAt: at,
      },
    });
    opts.mark?.('persistPending');

    if (defer || opts.deliveryMode === 'background') {
      if (rawAttachments.length > 0 && attachmentsForPending.length > 0) {
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
      enqueuePendingPromptPump(droneId, chatName);
      opts.mark?.('queuePump');
      return { id, pendingState: 'queued', blockedByAutomation };
    }

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
          cwd: opts.cwd ?? null,
          waitForDaemonMs: opts.waitForDaemonMs,
          skipManagedRepoSync: Boolean(
            opts.automation &&
            String((opts.automation as any)?.kind ?? '').trim() === 'prompt-loop',
          ),
          mark: opts.mark,
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
          const nextMs = retry.nextAttemptAt ? Date.parse(retry.nextAttemptAt) : NaN;
          schedulePendingPromptPumpRetry(
            droneId,
            chatName,
            Number.isFinite(nextMs) ? Math.max(1_000, nextMs - Date.now()) : undefined,
          );
        }
      } else {
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: errorText },
        });
      }
    }

    // Best-effort: if there are any deferred follow-ups, try to enqueue now.
    enqueuePendingPromptPump(droneId, chatName);
    return { id, pendingState: 'sending', blockedByAutomation };
  }

  type PromptEnqueueDisposition = {
    defer: boolean;
    blockedByAutomation: boolean;
    hasPriorActive: boolean;
    hasPriorQueued: boolean;
    waitingForSession: boolean;
  };

  function getPromptEnqueueDisposition(opts: {
    droneId: string;
    chatName: string;
    droneEntry: any;
    chatEntry: any;
    automation?: PromptAutomationMeta | null;
  }): PromptEnqueueDisposition {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(opts.chatName);
    const agent = inferChatAgent(opts.chatEntry, opts.droneEntry);
    const turns: any[] = Array.isArray((opts.chatEntry as any)?.turns)
      ? (opts.chatEntry as any).turns
      : [];
    const transcriptDoneIds = new Set(
      turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean),
    );
    const priorPending: any[] = Array.isArray((opts.chatEntry as any)?.pendingPrompts)
      ? (opts.chatEntry as any).pendingPrompts
      : [];
    const sessionKnown =
      agent.kind !== 'builtin' ? true : hasKnownBuiltinTranscriptSession(opts.chatEntry, agent.id);
    const automationLane = getPromptAutomationLane(droneId, chatName);
    const automationLaneBusy = promptAutomationLaneBusy(automationLane, { includeQueued: true });
    const isAutomationPrompt = Boolean(
      opts.automation && String((opts.automation as any)?.kind ?? '').trim() === 'prompt-loop',
    );
    const blockedByAutomation = automationLaneBusy && !isAutomationPrompt;
    const hasPriorActive = !isAutomationPrompt
      ? hasActivePriorPendingPrompt({
          priorPendingPrompts: priorPending
            .map((p: any) => ({ id: String(p?.id ?? '').trim(), state: String(p?.state ?? '') }))
            .filter((p: any) => p.id),
          transcriptDoneIds,
        })
      : false;
    const hasPriorQueued = priorPending.some((p: any) => {
      if (String(p?.state ?? '') !== 'queued') return false;
      if (isAutomationPrompt) return !Boolean((p as any)?.blockedByAutomation);
      return true;
    });
    const waitingForSession =
      agent.kind === 'builtin'
        ? shouldDeferQueuedTranscriptPrompt({
            agentId: agent.id,
            sessionKnown,
            priorPendingPrompts: priorPending
              .map((p: any) => ({ id: String(p?.id ?? '').trim(), state: String(p?.state ?? '') }))
              .filter((p: any) => p.id),
            transcriptDoneIds,
          })
        : false;
    return {
      defer: blockedByAutomation || hasPriorActive || hasPriorQueued || waitingForSession,
      blockedByAutomation,
      hasPriorActive,
      hasPriorQueued,
      waitingForSession,
    };
  }

  type UnifiedPromptCreateOpts = {
    group?: string | null;
    repoPath?: string | null;
    build?: boolean;
    containerPort?: number | null;
  };

  async function createOrEnqueuePromptUnified(opts: {
    id?: string;
    droneId: string;
    chatName: string;
    prompt: string;
    attachments?: ChatImageAttachment[];
    automation?: PromptAutomationMeta | null;
    cwd?: string | null;
    submittedAt?: string | null;
    mark?: (name: string) => void;
  }): Promise<
    | {
        kind: 'enqueued';
        id: string;
        pendingState: PendingPromptState;
        blockedByAutomation: boolean;
      }
    | { kind: 'error'; status: number; error: string }
  > {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = normalizeChatName(String(opts.chatName ?? '').trim() || 'default');
    const prompt = String(opts.prompt ?? '').trim();
    const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
    const preferredIdRaw = typeof opts.id === 'string' ? opts.id.trim() : '';
    if (preferredIdRaw && !isSafePromptId(preferredIdRaw)) {
      return { kind: 'error', status: 400, error: 'invalid promptId' };
    }
    const fallbackId = preferredIdRaw || crypto.randomBytes(9).toString('hex');

    if (!droneId) return { kind: 'error', status: 400, error: 'missing drone id' };
    if (!prompt) return { kind: 'error', status: 400, error: 'missing prompt' };

    const isAutomationPrompt = Boolean(
      opts.automation && String((opts.automation as any)?.kind ?? '').trim() === 'prompt-loop',
    );
    let regSnap: any = await loadRegistry();
    opts.mark?.('loadRegistry');
    if (regSnap?.drones?.[droneId]) {
      let liveDroneEntry = regSnap?.drones?.[droneId] ?? null;
      if (!liveDroneEntry)
        return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
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
        await promptNativeChat({
          droneId,
          chatName,
          chatId: String(chatEntry?.id ?? '').trim(),
          promptId: fallbackId,
          provider: String(chatEntry?.nativeProvider ?? '').trim(),
          model: String(chatEntry?.model ?? '').trim(),
          thinkingLevel: String(chatEntry?.reasoning ?? '').trim(),
          prompt,
          attachments,
        });
        return {
          kind: 'enqueued',
          id: fallbackId,
          pendingState: 'sending',
          blockedByAutomation: false,
        };
      }
      const r = await enqueuePrompt({
        id: fallbackId,
        droneId,
        chatName,
        prompt,
        attachments,
        automation: opts.automation,
        cwd: opts.cwd ?? null,
        submittedAt: opts.submittedAt ?? null,
        deliveryMode: isAutomationPrompt ? 'immediate' : 'background',
        mark: opts.mark,
      });
      return {
        kind: 'enqueued',
        id: r.id,
        pendingState: r.pendingState,
        blockedByAutomation: r.blockedByAutomation,
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
        state: 'queued',
        updatedAt: submittedAt,
      };
      const queuedStatus = await pushPendingStartupPrompt({
        droneId,
        chatName,
        pending: queuedPending,
      });
      if (queuedStatus === 'active') {
        const r = await enqueuePrompt({
          id: fallbackId,
          droneId,
          chatName,
          prompt,
          attachments,
          automation: opts.automation ?? null,
          cwd: opts.cwd ?? null,
          submittedAt: opts.submittedAt ?? null,
          deliveryMode: isAutomationPrompt ? 'immediate' : 'background',
          mark: opts.mark,
        });
        return {
          kind: 'enqueued',
          id: r.id,
          pendingState: r.pendingState,
          blockedByAutomation: r.blockedByAutomation,
        };
      }
      if (queuedStatus !== 'queued') {
        return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
      }
      return {
        kind: 'enqueued',
        id: fallbackId,
        pendingState: 'queued',
        blockedByAutomation: false,
      };
    }
    return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
  }

  const { dequeueProvisioning, enqueueProvisioning, enqueueProvisioningForAllPending } =
    createDroneProvisioningController({
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
      normalizeDroneEntryKind,
      normalizeDroneEntryVisibility,
      normalizePlaybookRunQueueGate,
      normalizePendingStartupPrompts,
      nowIso,
      parseSeedAgent,
      playbookMetaFromEntry,
      resolveAgentSuggestionEnabledByDefault: async () =>
        (await resolveEffectiveAgentSuggestionSettings()).enabledByDefault,
      resolveDroneCliPath,
      resolvePendingDroneDisplayName,
      runNodeCli,
      setChatAgentConfig,
      startupPromptToPendingPrompt,
      syncMcpServersForDrone,
      syncRepoAgentsInstructionsForDrone,
      syncSkillLibraryForDrone,
      syncSharedPathsToDrone: (opts: any) => syncSetService.applyAllSyncSetsToDrone(opts),
    });

  return {
    activePromptAutomationPendingPromptIds,
    appendPromptAutomationHistoryRows,
    attachmentOnlyPromptLabel,
    busyChatNamesForDrone,
    cancelQueuedPendingPrompt,
    chatHasActivePendingPromptsForSummary,
    chatHasReconcilablePendingPrompts,
    chatReconciliationQueue,
    clearAgentFollowupState: () => agentFollowupCoordinator.clear(),
    createOrEnqueuePromptUnified,
    daemonPromptEventMonitor,
    dequeueProvisioning,
    enqueuePendingPromptPump,
    enqueueProvisioning,
    enqueueProvisioningForAllPending,
    enqueueReconcile,
    ensureDaemonPromptEventSubscription,
    getPromptAutomationLane,
    isSafePromptId,
    looksLikeContainerAlreadyRunningError,
    looksLikeContainerNotRunningError,
    looksLikeMissingContainerError,
    looksLikeRepoUnavailableError,
    markTranscriptTurnAgentSuggestionUsedDirect,
    migrateInMemoryChatStateForRename,
    normalizeAgentMessageAutoContinueTurnState,
    normalizeAgentSuggestionTurnState,
    normalizeChatImageAttachmentRefs,
    normalizePromptAutomationMeta,
    pendingPromptsFromChatEntry,
    promptAutomationJobKey,
    promptAutomationJobResponse,
    promptAutomationLaneBusy,
    promptAutomationManager,
    pruneCompletedPendingPrompts,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    readPendingPrompts,
    readPendingStartupPrompts,
    recoverStalledPromptAutomationLane,
    resetPromptAutomationStateForTests,
    resumePendingPromptChats,
    runDroneLifecycleAction,
    stopAllDroneChatActivity,
    stopChatResponse,
    stopSingleDroneChatActivity,
    stopTranscriptPendingPrompts,
    transcriptTurnIdsFromEntry,
  };
}
