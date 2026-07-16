import crypto from 'node:crypto';

import type { ChatImageAttachment } from '../chat-attachments';
import type { AgentPermissionMode, ChatAgentConfig } from '../chat-types';
import { describeHubError } from '../domain-errors';
import { parseBoolParam } from '../hub-format';
import { readJsonBody, sendJson as json } from '../hub-http';
import type { PendingPromptState } from '../pendingPromptEnqueue';
import type { PromptAutomationService } from '../prompt-automation-service';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

export type PromptAutomationRouteService = PromptAutomationService;

import type { ChatAutomationRouteDependencies } from './chat-automation-routes';

export function createPromptAutomationRouteHandler(
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
      // GET /api/drones/:id/chats/:chat/automations/events
      if (
        method === 'GET' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'automations' &&
        parts[6] === 'events'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        promptAutomation.subscribe({ req, res, droneId, chatName, name: droneName });
        return;
      }

      // GET /api/drones/:id/chats/:chat/automations/status
      if (
        method === 'GET' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'automations' &&
        parts[6] === 'status'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        const lane = await promptAutomation.status(droneId, chatName);
        json(res, 200, {
          ok: true,
          automation: 'prompt-loop',
          id: droneId,
          name: droneName,
          chat: chatName,
          job: promptAutomation.response(lane),
        });
        return;
      }

      // POST /api/drones/:id/chats/:chat/automations/start
      if (
        method === 'POST' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'automations' &&
        parts[6] === 'start'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        try {
          const request = promptAutomation.parseStartRequest(droneId, chatName, body);
          const lane = await promptAutomation.start(request);
          json(res, 202, {
            ok: true,
            automation: 'prompt-loop',
            id: droneId,
            name: droneName,
            chat: chatName,
            job: promptAutomation.response(lane),
          });
          return;
        } catch (e: any) {
          const descriptor = describeHubError(e);
          json(res, descriptor.statusCode, descriptor.body);
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/automations/stop
      if (
        method === 'POST' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'automations' &&
        parts[6] === 'stop'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        let body: any = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        try {
          const { stopMode, clearQueued } = promptAutomation.parseStopRequest(body);
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
          const runningJob = promptAutomation.getLane(droneId, chatName)?.runningJob ?? null;
          const runningPromptId = String(runningJob?.lastPromptId ?? '').trim();
          const runningJobKey = String(runningJob?.executionKey ?? '').trim();
          const lane = promptAutomation.stop({ droneId, chatName, stopMode, clearQueued });
          const promptIds =
            stopMode === 'all'
              ? runningPromptId
                ? [runningPromptId]
                : await promptAutomation.activePendingPromptIds({
                    droneId,
                    chatName,
                    jobKey: runningJobKey,
                  })
              : [];
          if (promptIds.length > 0) {
            await stopTranscriptPendingPrompts({
              droneId,
              chatName,
              droneEntry: resolved.drone,
              promptIds,
              includeAutomation: true,
            });
          }
          json(res, 200, {
            ok: true,
            automation: 'prompt-loop',
            id: droneId,
            name: droneName,
            chat: chatName,
            job: promptAutomation.response(lane),
          });
          return;
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? '').trim();
          const code = /still starting/i.test(msg)
            ? 409
            : /unknown drone/i.test(msg) || /unknown chat/i.test(msg)
              ? 404
              : /drone daemon not reachable/i.test(msg)
                ? 409
                : 500;
          const descriptor = describeHubError(e, code);
          json(res, descriptor.statusCode, descriptor.body);
          return;
        }
      }

      // DELETE /api/drones/:id/chats/:chat/automations/queued/:queueId
      if (
        method === 'DELETE' &&
        parts.length === 8 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'automations' &&
        parts[6] === 'queued'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const queueId = String(decodeURIComponent(parts[7] ?? '')).trim();
        if (!queueId) {
          json(res, 400, { ok: false, error: 'missing queueId' });
          return;
        }
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        const cancelled = promptAutomation.cancelQueued({ droneId, chatName, queueId });
        if (cancelled.status === 'not-found') {
          json(res, 404, {
            ok: false,
            error: `unknown queued automation: ${queueId}`,
            id: droneId,
            name: droneName,
            chat: chatName,
            queueId,
            alreadySubmitted: false,
          });
          return;
        }
        json(res, 200, {
          ok: true,
          automation: 'prompt-loop',
          id: droneId,
          name: droneName,
          chat: chatName,
          queueId,
          cancelled: cancelled.status === 'cancelled',
          alreadySubmitted: cancelled.status === 'already-submitted',
          job: promptAutomation.response(cancelled.lane),
        });
        return;
      }

      return false;
    })();
    return handled !== false;
  };
}
