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

export function createChatTranscriptRouteHandler(
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
      // Compatibility read wrapper for GET /api/drones/:id/chats/:chat/state?pending=none
      // GET /api/drones/:id/chats/:chat/transcript?turn=last|all|N
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'transcript'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        const timer = createRequestTimer();
        try {
          const sel = u.searchParams.get('turn') ?? 'last';
          const snapshot = await readChatSnapshot({
            droneRef,
            chatName,
            selection: sel,
            tailRaw: u.searchParams.get('tail'),
            includeTranscript: true,
            includePending: false,
            maintenance: 'run',
            includeDockerSnapshotMaintenance: true,
            ifNoneMatch: String(req.headers['if-none-match'] ?? ''),
            mark: (name: string) => timer.mark(name),
          });
          if ((globalThis as any).Bun) timer.mark('read');
          if (!snapshot.ok) {
            timer.setHeader(res);
            logSlowHubRequest('chat transcript', timer, {
              droneRef,
              chatName,
              status: snapshot.statusCode,
              error: snapshot.error,
            });
            json(res, snapshot.statusCode, {
              ok: false,
              error: snapshot.error,
              ...(snapshot.agent ? { agent: snapshot.agent } : {}),
            });
            return;
          }
          if (snapshot.notModified && snapshot.responseEtag) {
            res.setHeader('etag', snapshot.responseEtag);
            res.setHeader('cache-control', 'no-store');
            timer.setHeader(res);
            res.statusCode = 304;
            res.end();
            return;
          }
          timer.setHeader(res);
          logSlowHubRequest('chat transcript', timer, {
            droneId: snapshot.id,
            chatName,
            selection: snapshot.selection,
            turnCount: snapshot.turnCount,
            status: 200,
          });
          const body = {
            ok: true,
            id: snapshot.id,
            name: snapshot.name,
            chat: snapshot.chat,
            selection: snapshot.selection,
            transcripts: snapshot.transcripts,
            ...(snapshot.agent ? { agent: snapshot.agent } : {}),
          };
          if (snapshot.transcriptEtag)
            jsonWithKnownEtag(req, res, 200, body, snapshot.transcriptEtag);
          else jsonWithEtag(req, res, 200, body);
          return;
        } catch (e: any) {
          timer.setHeader(res);
          logSlowHubRequest('chat transcript', timer, {
            droneRef,
            chatName,
            status: 500,
            error: e?.message ?? String(e),
          });
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      return false;
    })();
    return handled !== false;
  };
}
