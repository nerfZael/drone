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

type ChatAutomationDependencyName =
  | 'archiveChatById'
  | 'attachmentOnlyPromptLabel'
  | 'autoRenameGeneratedChatFromFirstPrompt'
  | 'buildNewChatEntry'
  | 'cancelQueuedPendingPrompt'
  | 'chatSnapshotResponseBody'
  | 'claimChatAutoRenameFromFirstPrompt'
  | 'cloneNativeChatSession'
  | 'collectDockerSnapshotImageRefsFromChatEntry'
  | 'createChatInStore'
  | 'createOrEnqueuePromptUnified'
  | 'createRequestTimer'
  | 'defaultDaemonReadyTimeoutMs'
  | 'deleteActiveChatFromStore'
  | 'deleteNativeChatSession'
  | 'discoverAndRememberModelsForBuiltinAgent'
  | 'dockerSnapshotAfterAgentMessageEnabledForChat'
  | 'droneRuntime'
  | 'droneTerminalOutput'
  | 'droneTerminalPrompt'
  | 'dvmExec'
  | 'dvmSessionRead'
  | 'enqueuePendingPromptPump'
  | 'ensureChatEntry'
  | 'ensureHubChatSessionRunning'
  | 'getChatEntry'
  | 'hubChatSessionName'
  | 'importDroneChatsFromRegistry'
  | 'importResolvedChatToStore'
  | 'importResolvedDroneChatsToStore'
  | 'inferChatAgent'
  | 'isDraftChatEntry'
  | 'isSafePromptId'
  | 'isStaleDockerExecErrorMessage'
  | 'jsonWithEtag'
  | 'jsonWithKnownEtag'
  | 'listChatReadStatesFromStore'
  | 'listChatsFromStore'
  | 'logSlowHubRequest'
  | 'markChatReadInStore'
  | 'markChatUnreadInStore'
  | 'markTranscriptTurnAgentSuggestionUsedDirect'
  | 'migrateInMemoryChatStateForRename'
  | 'nativeChatHasHistory'
  | 'normalizeAgentPermissionMode'
  | 'normalizeBuiltinAgentId'
  | 'normalizeChatImageAttachments'
  | 'normalizeChatModel'
  | 'normalizeChatName'
  | 'normalizeChatReasoning'
  | 'normalizeDroneIdentity'
  | 'normalizePendingStartupPrompts'
  | 'normalizeSubmittedAtIso'
  | 'nowIso'
  | 'parseAgentPermissionModeForUpdate'
  | 'parseChatModelForUpdate'
  | 'parseChatNameForMutation'
  | 'parseDraftFlag'
  | 'projectCanonicalChatToRegistry'
  | 'projectCanonicalChatsToRegistry'
  | 'pushPendingPrompt'
  | 'pushPendingStartupPrompt'
  | 'readChatFromStore'
  | 'readChatReadStateFromStore'
  | 'readChatSnapshot'
  | 'removeDockerSnapshotImagesBestEffort'
  | 'renameNativeChatSession'
  | 'renameChatInStore'
  | 'resolveChatTmuxCommand'
  | 'resolveDroneDaemonClientForEntry'
  | 'resolveDroneFromRegistryRef'
  | 'resolveDroneOrPendingForReadRef'
  | 'resolveDroneOrRespond'
  | 'resolveEffectiveAgentMessageAutoContinueSettings'
  | 'resolveEffectiveAgentSuggestionSettings'
  | 'resolveEffectiveDeleteActionSettings'
  | 'restoreDockerSnapshotForTranscriptTurn'
  | 'setChatAgentConfig'
  | 'shouldAutoRenameChatOnPrompt'
  | 'stopChatResponse'
  | 'stopSingleDroneChatActivity'
  | 'stopTranscriptPendingPrompts'
  | 'updateChatInStore'
  | 'waitForDroneDaemonReady'
  | 'withLockedDroneContainer';

export type ChatAutomationRouteDependencies =
  LegacyRouteDependencyContract<ChatAutomationDependencyName> & {
    promptAutomation: PromptAutomationRouteService;
  };

import { createPromptAutomationRouteHandler } from './prompt-automation-routes';
import { createChatPromptRouteHandler } from './chat-prompt-routes';
import { createChatManagementRouteHandler } from './chat-management-routes';
import { createChatTranscriptRouteHandler } from './chat-transcript-routes';
import { createChatSnapshotRouteHandler } from './chat-snapshot-routes';

export function createChatAutomationRouteHandler(
  deps: ChatAutomationRouteDependencies,
): LegacyRouteHandler {
  const handlers = [
    createPromptAutomationRouteHandler(deps),
    createChatPromptRouteHandler(deps),
    createChatManagementRouteHandler(deps),
    createChatTranscriptRouteHandler(deps),
    createChatSnapshotRouteHandler(deps),
  ];
  return async (request) => {
    for (const handler of handlers) {
      if (await handler(request)) return true;
    }
    return false;
  };
}
