import crypto from 'node:crypto';

import type { ChatImageAttachment } from '../chat-attachments';
import { agentSuggestionUsedBodySchema } from '../chat-route-schemas';
import type { AgentPermissionMode, ChatAgentConfig } from '../chat-types';
import { describeHubError } from '../domain-errors';
import { parseBoolParam } from '../hub-format';
import { readJsonBody, sendJson as json } from '../hub-http';
import type { PendingPromptState } from '../pendingPromptEnqueue';
import type { PromptAutomationService } from '../prompt-automation-service';
import { parseRequestSchema } from '../request-schema';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

export type PromptAutomationRouteService = PromptAutomationService;

import type { ChatAutomationRouteDependencies } from './chat-automation-routes';

export function createChatSnapshotRouteHandler(
  deps: ChatAutomationRouteDependencies,
): LegacyRouteHandler {
  const {
    archiveChatById,
    attachmentOnlyPromptLabel,
    autoRenameGeneratedChatFromFirstPrompt,
    buildNewChatEntry,
    cancelQueuedPendingPrompt,
    chatSnapshotResponseBody,
    claimChatAutoRenameFromFirstPrompt,
    collectDockerSnapshotImageRefsFromChatEntry,
    createChatInStore,
    createOrEnqueuePromptUnified,
    createRequestTimer,
    defaultDaemonReadyTimeoutMs,
    deleteActiveChatFromStore,
    discoverAndRememberModelsForBuiltinAgent,
    dockerSnapshotAfterAgentMessageEnabledForChat,
    droneRuntime,
    droneTerminalOutput,
    droneTerminalPrompt,
    dvmExec,
    dvmSessionRead,
    enqueuePendingPromptPump,
    ensureChatEntry,
    ensureHubChatSessionRunning,
    getChatEntry,
    hubChatSessionName,
    importDroneChatsFromRegistry,
    importResolvedChatToStore,
    importResolvedDroneChatsToStore,
    inferChatAgent,
    isDraftChatEntry,
    isSafePromptId,
    isStaleDockerExecErrorMessage,
    jsonWithEtag,
    jsonWithKnownEtag,
    listChatReadStatesFromStore,
    listChatsFromStore,
    logSlowHubRequest,
    markChatReadInStore,
    markChatUnreadInStore,
    markTranscriptTurnAgentSuggestionUsedDirect,
    migrateInMemoryChatStateForRename,
    normalizeAgentPermissionMode,
    normalizeBuiltinAgentId,
    normalizeChatImageAttachments,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeDroneIdentity,
    normalizePendingStartupPrompts,
    normalizeSubmittedAtIso,
    nowIso,
    parseAgentPermissionModeForUpdate,
    parseChatModelForUpdate,
    parseChatNameForMutation,
    parseDraftFlag,
    projectCanonicalChatToRegistry,
    projectCanonicalChatsToRegistry,
    promptAutomation,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    readChatReadStateFromStore,
    readChatSnapshot,
    removeDockerSnapshotImagesBestEffort,
    renameChatInStore,
    resolveChatTmuxCommand,
    resolveDroneDaemonClientForEntry,
    resolveDroneFromRegistryRef,
    resolveDroneOrPendingForReadRef,
    resolveDroneOrRespond,
    resolveEffectiveAgentMessageAutoContinueSettings,
    resolveEffectiveAgentSuggestionSettings,
    resolveEffectiveDeleteActionSettings,
    restoreDockerSnapshotForTranscriptTurn,
    setChatAgentConfig,
    shouldAutoRenameChatOnPrompt,
    stopChatResponse,
    stopSingleDroneChatActivity,
    stopTranscriptPendingPrompts,
    updateChatInStore,
    waitForDroneDaemonReady,
    withLockedDroneContainer,
  } = deps;
  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones/:id/chats/:chat/transcript/:promptId/docker-snapshot/:snapshotId/rollback
      if (
        method === 'POST' &&
        parts.length === 10 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'transcript' &&
        parts[7] === 'docker-snapshot' &&
        parts[9] === 'rollback'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        const promptId = String(decodeURIComponent(parts[6] ?? '')).trim();
        const snapshotId = String(decodeURIComponent(parts[8] ?? '')).trim();
        if (!isSafePromptId(promptId)) {
          json(res, 400, { ok: false, error: 'invalid promptId' });
          return;
        }
        if (!/^[0-9a-f]{8,64}$/i.test(snapshotId)) {
          json(res, 400, { ok: false, error: 'invalid snapshotId' });
          return;
        }
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        try {
          await restoreDockerSnapshotForTranscriptTurn({
            droneId: resolved.id,
            chatName,
            promptId,
            snapshotId,
          });
          json(res, 200, {
            ok: true,
            id: resolved.id,
            name: resolved.drone?.name ?? droneRef,
            chat: chatName,
            promptId,
            snapshotId,
          });
          return;
        } catch (e: any) {
          const status = Number((e as any)?.statusCode ?? 0);
          json(res, status > 0 ? status : 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/transcript/:promptId/agent-suggestion/used-direct
      if (
        method === 'POST' &&
        parts.length === 9 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'transcript' &&
        parts[7] === 'agent-suggestion' &&
        parts[8] === 'used-direct'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        const promptId = String(decodeURIComponent(parts[6] ?? '')).trim();
        if (!isSafePromptId(promptId)) {
          json(res, 400, { ok: false, error: 'invalid promptId' });
          return;
        }
        let body: any = null;
        try {
          body = parseRequestSchema(
            agentSuggestionUsedBodySchema,
            await readJsonBody(req),
            'agent suggestion',
          );
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const suggestion = String(body?.suggestion ?? '').trim();
        const suggestionHash =
          String(body?.suggestionHash ?? '').trim() ||
          (suggestion
            ? crypto.createHash('sha256').update(suggestion, 'utf8').digest('hex').slice(0, 24)
            : '');
        const policyFingerprint = String(body?.policyFingerprint ?? '').trim();
        if (!suggestionHash) {
          json(res, 400, { ok: false, error: 'missing suggestion' });
          return;
        }
        if (!policyFingerprint) {
          json(res, 400, { ok: false, error: 'missing policyFingerprint' });
          return;
        }
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        await markTranscriptTurnAgentSuggestionUsedDirect({
          droneId: resolved.id,
          chatName,
          promptId,
          suggestionHash,
          policyFingerprint,
        });
        json(res, 200, {
          ok: true,
          id: resolved.id,
          name: resolved.drone?.name ?? droneRef,
          chat: chatName,
          promptId,
        });
        return;
      }

      return false;
    })();
    return handled !== false;
  };
}
