import crypto from 'node:crypto';

import {
  chatConfigBodySchema,
  chatCreateBodySchema,
  chatReadBodySchema,
  chatRenameBodySchema,
} from '../chat-route-schemas';
import type { AgentApprovalPolicy, AgentPermissionMode, ChatAgentConfig } from '../chat-types';
import { parseBoolParam } from '../hub-format';
import { readJsonBody, sendJson as json } from '../hub-http';
import { normalizeMcpChatAccessScope } from '../mcp-chat-access';
import { parseRequestSchema } from '../request-schema';
import { isWorkflowChatEntry } from '../workflows/workflow-chat-metadata';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type ChatManagementRouteDependencyName =
  | 'archiveChatById'
  | 'buildNewChatEntry'
  | 'cloneNativeChatSession'
  | 'collectDockerSnapshotImageRefsFromChatEntry'
  | 'createChatInStore'
  | 'createDroneChat'
  | 'createRequestTimer'
  | 'deleteActiveChatFromStore'
  | 'deleteNativeChatSession'
  | 'dockerSnapshotAfterAgentMessageEnabledForChat'
  | 'enqueuePendingPromptPump'
  | 'ensureChatEntry'
  | 'getChatEntry'
  | 'hubChatSessionName'
  | 'importDroneChatsFromRegistry'
  | 'importResolvedChatToStore'
  | 'importResolvedDroneChatsToStore'
  | 'inferChatAgent'
  | 'isManagedChatMcpAvailable'
  | 'isManagedChatMcpAvailableForRead'
  | 'isDraftChatEntry'
  | 'listChatReadStatesFromStore'
  | 'listChatsFromStore'
  | 'listResourceSubscriptionsForChatId'
  | 'logSlowHubRequest'
  | 'markChatReadInStore'
  | 'markChatUnreadInStore'
  | 'migrateInMemoryChatStateForRename'
  | 'nativeChatHasHistory'
  | 'normalizeAgentPermissionMode'
  | 'normalizeAgentApprovalPolicy'
  | 'normalizeBuiltinAgentId'
  | 'normalizeChatName'
  | 'normalizeChatReasoning'
  | 'normalizePendingStartupPrompts'
  | 'nowIso'
  | 'parseAgentPermissionModeForUpdate'
  | 'parseAgentApprovalPolicyForUpdate'
  | 'parseChatModelForUpdate'
  | 'parseChatReasoningForUpdate'
  | 'parseChatNameForMutation'
  | 'parseDraftFlag'
  | 'projectCanonicalChatToRegistry'
  | 'projectCanonicalChatsToRegistry'
  | 'readChatFromStore'
  | 'readChatMetadataFromStore'
  | 'readChatReadStateFromStore'
  | 'removeDockerSnapshotImagesBestEffort'
  | 'renameNativeChatSession'
  | 'renameChatInStore'
  | 'resolveCanonicalDroneOrPendingForReadRef'
  | 'resolveChatTmuxCommand'
  | 'resolveCodexPromptApproval'
  | 'resolveDroneDaemonClientForEntry'
  | 'resolveDroneOrRespond'
  | 'resolveEffectiveDeleteActionSettings'
  | 'setChatAgentConfig'
  | 'stopSingleDroneChatActivity'
  | 'updateChatInStore';

export type ChatManagementRouteDependencies =
  LegacyRouteDependencyContract<ChatManagementRouteDependencyName>;

export function resolveReadStateChatEntry(input: {
  droneId: string;
  chatName: string;
  droneEntry: any;
  readChatFromStore: (opts: { droneId: string; chatName: string }) => {
    available: boolean;
    chat: any | null;
  };
}): { chatEntry: any | null; fromStore: boolean } {
  const stored = input.readChatFromStore({
    droneId: input.droneId,
    chatName: input.chatName,
  });
  if (stored.available) return { chatEntry: stored.chat, fromStore: true };
  return {
    chatEntry: input.droneEntry?.chats?.[input.chatName] ?? null,
    fromStore: false,
  };
}

export function createChatManagementRouteHandler(
  deps: ChatManagementRouteDependencies,
): LegacyRouteHandler {
  const {
    archiveChatById,
    buildNewChatEntry,
    cloneNativeChatSession,
    collectDockerSnapshotImageRefsFromChatEntry,
    createChatInStore,
    createDroneChat,
    createRequestTimer,
    deleteActiveChatFromStore,
    deleteNativeChatSession,
    dockerSnapshotAfterAgentMessageEnabledForChat,
    enqueuePendingPromptPump,
    ensureChatEntry,
    getChatEntry,
    hubChatSessionName,
    importDroneChatsFromRegistry,
    importResolvedChatToStore,
    importResolvedDroneChatsToStore,
    inferChatAgent,
    isManagedChatMcpAvailable,
    isManagedChatMcpAvailableForRead,
    isDraftChatEntry,
    listChatReadStatesFromStore,
    listChatsFromStore,
    listResourceSubscriptionsForChatId,
    logSlowHubRequest,
    markChatReadInStore,
    markChatUnreadInStore,
    migrateInMemoryChatStateForRename,
    nativeChatHasHistory,
    normalizeAgentPermissionMode,
    normalizeAgentApprovalPolicy,
    normalizeBuiltinAgentId,
    normalizeChatName,
    normalizeChatReasoning,
    normalizePendingStartupPrompts,
    nowIso,
    parseAgentPermissionModeForUpdate,
    parseAgentApprovalPolicyForUpdate,
    parseChatModelForUpdate,
    parseChatReasoningForUpdate,
    parseChatNameForMutation,
    parseDraftFlag,
    projectCanonicalChatToRegistry,
    projectCanonicalChatsToRegistry,
    readChatFromStore,
    readChatMetadataFromStore,
    readChatReadStateFromStore,
    removeDockerSnapshotImagesBestEffort,
    renameNativeChatSession,
    renameChatInStore,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveChatTmuxCommand,
    resolveCodexPromptApproval,
    resolveDroneDaemonClientForEntry,
    resolveDroneOrRespond,
    resolveEffectiveDeleteActionSettings,
    setChatAgentConfig,
    stopSingleDroneChatActivity,
    updateChatInStore,
  } = deps;

  const sameChatAgent = (current: ChatAgentConfig, next: ChatAgentConfig): boolean => {
    if (current.kind !== next.kind) return false;
    if (current.kind === 'native' && next.kind === 'native') return true;
    if (current.kind === 'builtin' && next.kind === 'builtin') return current.id === next.id;
    return (
      current.kind === 'custom' &&
      next.kind === 'custom' &&
      current.id === next.id &&
      current.label === next.label &&
      current.command === next.command
    );
  };

  const chatHasAgentLockingHistory = async (
    chat: any,
    currentAgent: ChatAgentConfig,
  ): Promise<boolean> => {
    const transcriptHasHistory =
      (Array.isArray(chat?.turns) && chat.turns.length > 0) ||
      (Array.isArray(chat?.pendingPrompts) && chat.pendingPrompts.length > 0);
    if (transcriptHasHistory) return true;
    const nativeChatId = currentAgent.kind === 'native' ? String(chat?.id ?? '').trim() : '';
    return nativeChatId ? await nativeChatHasHistory(nativeChatId) : false;
  };

  const prepareAgentChange = async (
    droneId: string,
    chatName: string,
    drone: any,
    nextAgent: ChatAgentConfig,
  ): Promise<string | null> => {
    const { chat } = await getChatEntry({ droneId, chatName });
    const currentAgent = inferChatAgent(chat, drone);
    if (sameChatAgent(currentAgent, nextAgent)) return null;
    const nativeChatId = currentAgent.kind === 'native' ? String(chat?.id ?? '').trim() : '';
    if (await chatHasAgentLockingHistory(chat, currentAgent)) {
      const error: Error & { statusCode?: number } = new Error(
        'The agent cannot be changed after this chat has history. Create a new chat to use a different agent.',
      );
      error.statusCode = 409;
      throw error;
    }
    return nativeChatId || null;
  };

  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones/:id/chats/:chat/approvals/:promptId/:approvalId/:decision
      if (
        method === 'POST' &&
        parts.length === 9 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'approvals'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const promptId = decodeURIComponent(parts[6]);
        const approvalId = decodeURIComponent(parts[7]);
        const decision = decodeURIComponent(parts[8]);
        if (
          decision !== 'accept' &&
          decision !== 'acceptForSession' &&
          decision !== 'decline' &&
          decision !== 'cancel'
        ) {
          json(res, 400, { ok: false, error: 'invalid Codex approval decision' });
          return;
        }
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        try {
          const result = await resolveCodexPromptApproval({
            droneId: resolved.id,
            chatName,
            promptId,
            approvalId,
            decision,
          });
          json(res, 200, { ok: true, approvalId, decision, result });
        } catch (error: any) {
          const message = String(error?.message ?? error);
          const status = /unknown Codex approval|not found/i.test(message) ? 404 : 409;
          json(res, status, { ok: false, error: message });
        }
        return;
      }

      // POST /api/drones/:id/chats
      // Create a new chat entry on a drone.
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        let body: any = null;
        try {
          body = parseRequestSchema(chatCreateBodySchema, await readJsonBody(req), 'chat create');
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        let chatName = '';
        try {
          chatName = parseChatNameForMutation(
            body?.name ?? body?.chatName ?? body?.chat,
            'chat name',
          );
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        const copyFromRaw = String(
          body?.copyFrom ?? body?.copyFromChat ?? body?.fromChat ?? '',
        ).trim();
        const copyFrom = copyFromRaw ? normalizeChatName(copyFromRaw) : '';
        if (body?.mode && !copyFrom) {
          json(res, 400, { ok: false, error: `${body.mode} chat creation requires a source chat` });
          return;
        }
        const creationMode = copyFrom
          ? body?.mode === 'copy-config'
            ? 'copy-config'
            : 'clone-history'
          : 'empty';
        const createAsDraft = parseDraftFlag(body?.draft ?? body?.isDraft);
        try {
          const created = await createDroneChat({
            droneId,
            chatName,
            droneEntry: resolved.drone,
            creationMode,
            ...(copyFrom ? { sourceChatName: copyFrom } : {}),
            draft: createAsDraft,
          });

          json(res, 201, {
            ok: true,
            id: droneId,
            name: droneName,
            chat: chatName,
            chatId: String((created.chat as any)?.id ?? '').trim() || null,
            draft: createAsDraft,
            chats: created.chats,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /unknown drone|unknown chat/i.test(msg)
            ? 404
            : /already exists|stop this chat|not supported/i.test(msg)
              ? 409
              : /missing |requires a source|cannot specify a source|unsupported chat creation mode/i.test(msg)
                ? 400
                : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/rename
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'rename'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        let body: any = null;
        try {
          body = parseRequestSchema(chatRenameBodySchema, await readJsonBody(req), 'chat rename');
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        let newChatName = '';
        try {
          newChatName = parseChatNameForMutation(body?.newName ?? body?.name, 'new chat name');
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        if (chatName === 'default') {
          json(res, 400, { ok: false, error: 'cannot rename default chat' });
          return;
        }

        try {
          await importDroneChatsFromRegistry({ droneId, chats: resolved.drone?.chats });
          const renamed = await renameChatInStore({ droneId, chatName, newChatName });
          if (renamed) {
            migrateInMemoryChatStateForRename({
              droneId,
              fromChatName: chatName,
              toChatName: newChatName,
            });
            await projectCanonicalChatsToRegistry(droneId);
            const { chat: renamedChat } = await getChatEntry({
              droneId,
              chatName: newChatName,
            });
            if (inferChatAgent(renamedChat, resolved.drone).kind === 'native') {
              const nativeChatId = String(renamedChat?.id ?? '').trim();
              if (nativeChatId) {
                await renameNativeChatSession({
                  id: nativeChatId,
                  droneId,
                  chatName: newChatName,
                });
              }
            }
          }
          await projectCanonicalChatsToRegistry(droneId);

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            oldChat: chatName,
            chat: newChatName,
            chats: listChatsFromStore({ droneId }).chats,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /unknown drone|unknown chat/i.test(msg)
            ? 404
            : /already exists/i.test(msg)
              ? 409
              : /cannot rename|missing /i.test(msg)
                ? 400
                : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/publish
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'publish'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        try {
          await importDroneChatsFromRegistry({ droneId, chats: resolved.drone?.chats });
          let pendingCount = 0;
          await updateChatInStore({
            droneId,
            chatName,
            update: (current: any) => {
              const entry = { ...current };
              if (!isDraftChatEntry(entry)) throw new Error(`chat is not a draft: ${chatName}`);
              pendingCount = Array.isArray(entry.pendingPrompts) ? entry.pendingPrompts.length : 0;
              delete entry.draft;
              entry.updatedAt = nowIso();
              return entry;
            },
          });
          await projectCanonicalChatToRegistry(droneId, chatName);
          enqueuePendingPromptPump(droneId, chatName);
          json(res, 202, {
            ok: true,
            id: droneId,
            name: droneName,
            chat: chatName,
            draft: false,
            published: true,
            pendingCount,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /unknown drone|unknown chat/i.test(msg)
            ? 404
            : /not a draft/i.test(msg)
              ? 409
              : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/archive
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'archive'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        if (chatName === 'default') {
          json(res, 400, { ok: false, error: 'cannot archive default chat' });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        const deleteSettings = await resolveEffectiveDeleteActionSettings();
        const archiveRetention = deleteSettings.archiveRetention;

        try {
          await stopSingleDroneChatActivity({
            droneId,
            chatName,
            droneEntry: resolved.drone,
          });
          const result = await archiveChatById({ droneId, chatName, archiveRetention });
          if (!result.hadDrone || !result.hadChat || !result.archived) {
            json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
            return;
          }

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            archivedChat: chatName,
            archiveRetention: result.archiveRetention,
            archivedAt: result.archivedAt,
            deleteAt: result.deleteAt,
            chats: result.chats,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /unknown drone|unknown chat/i.test(msg)
            ? 404
            : /cannot archive|missing /i.test(msg)
              ? 400
              : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // DELETE /api/drones/:id/chats/:chat
      if (
        method === 'DELETE' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        if (chatName === 'default') {
          json(res, 400, { ok: false, error: 'cannot delete default chat' });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
        const deleteSettings = await resolveEffectiveDeleteActionSettings();

        try {
          const chatWasDraft = isDraftChatEntry(resolved.drone?.chats?.[chatName]);
          await stopSingleDroneChatActivity({
            droneId,
            chatName,
            droneEntry: resolved.drone,
          });

          if (deleteSettings.mode === 'archive' && !chatWasDraft) {
            const result = await archiveChatById({
              droneId,
              chatName,
              archiveRetention: deleteSettings.archiveRetention,
            });
            if (!result.hadDrone || !result.hadChat || !result.archived) {
              json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
              return;
            }

            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              archivedChat: chatName,
              archiveRetention: result.archiveRetention,
              archivedAt: result.archivedAt,
              deleteAt: result.deleteAt,
              chats: result.chats,
            });
            return;
          }

          await importDroneChatsFromRegistry({ droneId, chats: resolved.drone?.chats });
          const deleted = await deleteActiveChatFromStore({
            droneId,
            chatName,
            fallbackChat: {
              chatName: 'default',
              chatEntry: buildNewChatEntry({
                droneEntry: resolved.drone,
                createdAt: nowIso(),
              }),
            },
          });
          const snapshotImageRefs = collectDockerSnapshotImageRefsFromChatEntry(
            deleted.deletedChat,
          );
          if (inferChatAgent(deleted.deletedChat, resolved.drone).kind === 'native') {
            const nativeChatId = String(deleted.deletedChat?.id ?? '').trim();
            if (nativeChatId) await deleteNativeChatSession(nativeChatId);
          }
          await projectCanonicalChatsToRegistry(droneId);
          await removeDockerSnapshotImagesBestEffort(snapshotImageRefs, {
            droneId,
            chatName,
            reason: 'delete-chat',
          });

          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            deletedChat: chatName,
            chats: deleted.chats,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /unknown drone|unknown chat/i.test(msg)
            ? 404
            : /cannot delete|missing /i.test(msg)
              ? 400
              : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:id/chats
      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const timer = createRequestTimer();
        try {
          const resolved = await resolveCanonicalDroneOrPendingForReadRef(droneRef);
          timer.mark('resolve');
          if (!resolved) {
            timer.setHeader(res);
            logSlowHubRequest('chat list', timer, { droneRef, status: 404 });
            json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
            return;
          }
          const droneId = resolved.id;
          if (resolved.kind === 'pending') {
            const droneName = String(resolved.pending?.name ?? droneRef).trim() || droneRef;
            const startupChats = [
              ...new Set(
                normalizePendingStartupPrompts((resolved.pending as any)?.startupQueuedPrompts).map(
                  (item: any) => item.chatName,
                ),
              ),
            ].filter(Boolean);
            timer.mark('format');
            timer.setHeader(res);
            logSlowHubRequest('chat list', timer, {
              droneId,
              kind: 'pending',
              chatCount: startupChats.length || 1,
              status: 200,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chats: startupChats.length > 0 ? startupChats : ['default'],
            });
            return;
          }
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
          let storeChats = listChatsFromStore({ droneId });
          let importedChats: string[] = [];
          // Bun's compatibility store is in-memory and reports itself available
          // before legacy registry chats have been imported. Node's SQLite store
          // is canonical and must not re-import stale lifecycle chat snapshots.
          if ((globalThis as any).Bun || !storeChats.available) {
            importedChats = await importResolvedDroneChatsToStore(droneId, resolved.drone);
            storeChats = listChatsFromStore({ droneId });
          }
          timer.mark('import');
          timer.mark('store');
          const allChats = storeChats.available ? storeChats.chats : importedChats;
          const storedChats = new Map<string, ReturnType<typeof readChatFromStore>>();
          const chats = allChats.filter((chatName: string) => {
            const stored = readChatFromStore({ droneId, chatName });
            storedChats.set(chatName, stored);
            return !isWorkflowChatEntry(stored?.chat);
          });
          const readStates = listChatReadStatesFromStore({ droneId });
          const chatDetails = chats.map((chatName: string) => {
            const stored = storedChats.get(chatName);
            const chatEntry = stored?.chat;
            const agent = chatEntry ? inferChatAgent(chatEntry, resolved.drone) : null;
            const agentSummary = agent?.kind === 'custom'
              ? { kind: agent.kind, id: agent.id, label: agent.label }
              : agent;
            return {
              chat: chatName,
              chatId: String((chatEntry as any)?.id ?? '').trim() || null,
              draft: isDraftChatEntry(chatEntry),
              agent: agentSummary,
              provider: agent?.kind === 'native'
                ? String((chatEntry as any)?.nativeProvider ?? '').trim() || null
                : null,
              model: String((chatEntry as any)?.model ?? '').trim() || null,
              reasoning: normalizeChatReasoning((chatEntry as any)?.reasoning),
              unread: readStates[chatName]?.unread === true,
              latestAgentTurnId: readStates[chatName]?.latestAgentTurnId ?? null,
              latestAgentRevision: readStates[chatName]?.latestAgentRevision ?? 0,
            };
          });
          const draftChats = Object.fromEntries(
            chatDetails.filter((item: any) => item.draft).map((item: any) => [item.chat, true]),
          );
          timer.mark('format');
          timer.setHeader(res);
          logSlowHubRequest('chat list', timer, {
            droneId,
            chatCount: chats.length,
            storeAvailable: storeChats.available,
            status: 200,
          });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            chats,
            chatDetails,
            draftChats,
            unreadChats: chatDetails
              .filter((item: any) => item.unread)
              .map((item: any) => item.chat),
            chatReadStates: Object.fromEntries(
              chatDetails.map((item: any) => [
                item.chat,
                {
                  unread: item.unread,
                  latestAgentTurnId: item.latestAgentTurnId,
                  latestAgentRevision: item.latestAgentRevision,
                },
              ]),
            ),
          });
          return;
        } catch (e: any) {
          timer.setHeader(res);
          logSlowHubRequest('chat list', timer, {
            droneRef,
            status: 500,
            error: e?.message ?? String(e),
          });
          json(res, 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      // GET|PUT /api/drones/:id/chats/:chat/mcp-access
      if (
        (method === 'GET' || method === 'PUT') &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'mcp-access'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        if (method === 'GET') {
          const timer = createRequestTimer();
          try {
            const resolved = await resolveCanonicalDroneOrPendingForReadRef(droneRef);
            timer.mark('resolve');
            if (!resolved || resolved.kind === 'pending') {
              const status = resolved?.kind === 'pending' ? 409 : 404;
              const error =
                resolved?.kind === 'pending'
                  ? `drone "${droneRef}" is still starting`
                  : `unknown drone: ${droneRef}`;
              timer.setHeader(res);
              logSlowHubRequest('chat MCP access', timer, { droneRef, chatName, status });
              json(res, status, { ok: false, error });
              return;
            }
            const droneId = resolved.id;
            const stored = readChatMetadataFromStore({ droneId, chatName });
            timer.mark('read');
            if (!stored.available) {
              throw new Error('canonical chat store is unavailable');
            }
            if (!stored.chat) {
              timer.setHeader(res);
              logSlowHubRequest('chat MCP access', timer, {
                droneId,
                chatName,
                status: 404,
              });
              json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
              return;
            }
            const available = await isManagedChatMcpAvailableForRead();
            timer.mark('availability');
            timer.setHeader(res);
            logSlowHubRequest('chat MCP access', timer, { droneId, chatName, status: 200 });
            json(res, 200, {
              ok: true,
              available,
              accessScope: normalizeMcpChatAccessScope(
                stored.chat.droneHubMcpAccessScope,
                droneId,
              ),
            });
            return;
          } catch (error: any) {
            const message = error?.message ?? String(error);
            const status = /unknown drone|unknown chat/i.test(message) ? 404 : 500;
            timer.setHeader(res);
            logSlowHubRequest('chat MCP access', timer, {
              droneRef,
              chatName,
              status,
              error: message,
            });
            json(res, status, { ok: false, error: message });
            return;
          }
        }
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          await ensureChatEntry({ droneId, chatName });
          if (method === 'PUT') {
            const body = await readJsonBody(req);
            const addDroneIds = Array.isArray(body?.addDroneIds)
              ? body.addDroneIds.map((id: unknown) => String(id ?? '').trim()).filter(Boolean)
              : [];
            const replacesAccessScope = body?.accessScope && typeof body.accessScope === 'object';
            if (!replacesAccessScope && addDroneIds.length === 0) {
              json(res, 400, {
                ok: false,
                error: 'accessScope must be an object or addDroneIds must be non-empty',
              });
              return;
            }
            await setChatAgentConfig({
              droneId,
              chatName,
              ...(addDroneIds.length > 0
                ? { addDroneHubMcpAccessDroneIds: addDroneIds }
                : {
                    setDroneHubMcpAccessScope: true,
                    droneHubMcpAccessScope: {
                      ...body.accessScope,
                      updatedAt: new Date().toISOString(),
                    },
                  }),
            });
          }
          const { chat } = await getChatEntry({ droneId, chatName });
          const available = await isManagedChatMcpAvailable();
          json(res, 200, {
            ok: true,
            available,
            accessScope: normalizeMcpChatAccessScope(chat?.droneHubMcpAccessScope, droneId),
          });
          return;
        } catch (error: any) {
          const message = error?.message ?? String(error);
          json(
            res,
            /unknown drone|unknown chat/i.test(message)
              ? 404
              : /accessScope must be an object|addDroneIds must be non-empty/i.test(message)
                ? 400
                : 500,
            { ok: false, error: message },
          );
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat
      if (
        method === 'GET' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]);
        const timer = createRequestTimer();
        try {
          const includeTurns = parseBoolParam(u.searchParams.get('turns'), true);
          const resolvedTarget = await resolveCanonicalDroneOrPendingForReadRef(droneRef);
          timer.mark('resolve');
          if (!resolvedTarget || resolvedTarget.kind === 'pending') {
            const rejectStatus = resolvedTarget?.kind === 'pending' ? 409 : 404;
            const rejectError =
              resolvedTarget?.kind === 'pending'
                ? `drone "${droneRef}" is still starting`
                : `unknown drone: ${droneRef}`;
            timer.setHeader(res);
            logSlowHubRequest('chat metadata', timer, { droneRef, chatName, status: rejectStatus });
            json(res, rejectStatus, { ok: false, error: rejectError });
            return;
          }
          const droneId = resolvedTarget.id;
          const drone = resolvedTarget.drone;
          const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
          const storedChat = readChatFromStore({ droneId, chatName });
          const c = storedChat.chat ?? (drone as any)?.chats?.[chatName];
          if (!c) {
            timer.setHeader(res);
            logSlowHubRequest('chat metadata', timer, { droneId, chatName, status: 404 });
            json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
            return;
          }
          const chatEntry =
            storedChat.chat ?? (await importResolvedChatToStore(droneId, chatName, c)) ?? c;
          const durableChatId =
            String((c as any)?.id ?? '').trim() || String((chatEntry as any)?.id ?? '').trim();
          const subscriptions = durableChatId
            ? listResourceSubscriptionsForChatId(durableChatId)
            : [];
          timer.mark('import');
          const agent = inferChatAgent(chatEntry as any, drone);
          const agentLocked = await chatHasAgentLockingHistory(chatEntry, agent);
          const readState = readChatReadStateFromStore({ droneId, chatName });
          timer.mark('format');
          timer.setHeader(res);
          logSlowHubRequest('chat metadata', timer, {
            droneId,
            chatName,
            turnCount: Array.isArray((chatEntry as any).turns)
              ? (chatEntry as any).turns.length
              : 0,
            status: 200,
          });
          json(res, 200, {
            ok: true,
            id: droneId,
            chatId: durableChatId || null,
            subscriptions,
            name: droneName,
            chat: chatName,
            agent,
            agentLocked,
            provider: agent.kind === 'native'
              ? String((chatEntry as any).nativeProvider ?? '').trim() || null
              : null,
            model: (chatEntry as any).model ?? null,
            reasoning: normalizeChatReasoning((chatEntry as any).reasoning),
            agentPermissionMode: normalizeAgentPermissionMode(
              (chatEntry as any).agentPermissionMode,
            ),
            approvalPolicy: normalizeAgentApprovalPolicy((chatEntry as any).approvalPolicy),
            dockerSnapshotAfterAgentMessageEnabled: dockerSnapshotAfterAgentMessageEnabledForChat(
              drone,
              chatEntry,
            ),
            ...(includeTurns ? { turns: (chatEntry as any).turns ?? [] } : {}),
            readState,
            sessionName: hubChatSessionName(chatName || 'default'),
            createdAt: chatEntry.createdAt,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg)
            ? 409
            : /unknown drone|unknown chat/i.test(msg)
              ? 404
              : 500;
          timer.setHeader(res);
          logSlowHubRequest('chat metadata', timer, {
            droneRef,
            chatName,
            status: code,
            error: msg,
          });
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/read
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'read'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        let body: any = null;
        try {
          body = parseRequestSchema(chatReadBodySchema, await readJsonBody(req), 'chat read');
        } catch (error: any) {
          json(res, 400, { ok: false, error: error?.message ?? String(error) });
          return;
        }
        const markUnread = body?.unread === true;
        const hasLatestAgentTurnId = Object.prototype.hasOwnProperty.call(
          body ?? {},
          'latestAgentTurnId',
        );
        const hasLatestAgentRevision = Object.prototype.hasOwnProperty.call(
          body ?? {},
          'latestAgentRevision',
        );
        if (
          !markUnread &&
          (!hasLatestAgentTurnId ||
            !hasLatestAgentRevision ||
            (body.latestAgentTurnId !== null && typeof body.latestAgentTurnId !== 'string') ||
            !Number.isSafeInteger(body.latestAgentRevision) ||
            body.latestAgentRevision < 0)
        ) {
          json(res, 400, {
            ok: false,
            error: 'latestAgentTurnId and latestAgentRevision are required to mark a chat read',
          });
          return;
        }
        const updatedByDeviceId =
          String(body?.updatedByDeviceId ?? '')
            .trim()
            .slice(0, 128) || null;
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const { chatEntry, fromStore } = resolveReadStateChatEntry({
          droneId,
          chatName,
          droneEntry: resolved.drone,
          readChatFromStore,
        });
        if (!chatEntry) {
          json(res, 404, { ok: false, error: `unknown chat: ${chatName}` });
          return;
        }
        try {
          if (!fromStore) await importResolvedChatToStore(droneId, chatName, chatEntry);
          const readState = markUnread
            ? await markChatUnreadInStore({ droneId, chatName, updatedByDeviceId })
            : await markChatReadInStore({
                droneId,
                chatName,
                latestAgentTurnId: String(body.latestAgentTurnId ?? '').trim() || null,
                latestAgentRevision: body.latestAgentRevision,
                updatedByDeviceId,
              });
          json(res, 200, { ok: true, id: droneId, chat: chatName, readState });
        } catch (error: any) {
          json(res, 500, { ok: false, error: error?.message ?? String(error) });
        }
        return;
      }

      // POST /api/drones/:id/chats/:chat/config
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'config'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;

        let body: any = null;
        try {
          body = parseRequestSchema(chatConfigBodySchema, await readJsonBody(req), 'chat config');
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const agentRaw = body?.agent;
        const kind = String(agentRaw?.kind ?? agentRaw?.type ?? '')
          .trim()
          .toLowerCase();
        const hasModelField =
          Boolean(
            body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'model'),
          ) ||
          Boolean(
            body &&
            typeof body === 'object' &&
            Object.prototype.hasOwnProperty.call(body, 'chatModel'),
          );
        const hasProviderField = Boolean(
          body &&
          typeof body === 'object' &&
          Object.prototype.hasOwnProperty.call(body, 'provider'),
        );
        const hasAgentPermissionModeField = Boolean(
          body &&
          typeof body === 'object' &&
          Object.prototype.hasOwnProperty.call(body, 'agentPermissionMode'),
        );
        const hasApprovalPolicyField = Boolean(
          body &&
          typeof body === 'object' &&
          Object.prototype.hasOwnProperty.call(body, 'approvalPolicy'),
        );
        const hasReasoningField = Boolean(
          body &&
          typeof body === 'object' &&
          Object.prototype.hasOwnProperty.call(body, 'reasoning'),
        );
        const hasDockerSnapshotField = Boolean(
          body &&
          typeof body === 'object' &&
          Object.prototype.hasOwnProperty.call(body, 'dockerSnapshotAfterAgentMessageEnabled'),
        );
        let model: string | null = null;
        let provider: 'openai' | 'codex' | 'gemini' | 'openrouter' | null = null;
        let reasoning: string | null = null;
        let agentPermissionMode: AgentPermissionMode = 'execute';
        let approvalPolicy: AgentApprovalPolicy = 'ask';
        let dockerSnapshotAfterAgentMessageEnabled = false;
        if (hasModelField) {
          try {
            model = parseChatModelForUpdate(
              body &&
                typeof body === 'object' &&
                Object.prototype.hasOwnProperty.call(body, 'model')
                ? body.model
                : body?.chatModel,
            );
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
        }
        if (hasProviderField) {
          const candidate = String(body?.provider ?? '').trim().toLowerCase();
          if (candidate !== 'openai' && candidate !== 'codex' && candidate !== 'gemini' && candidate !== 'openrouter') {
            json(res, 400, { ok: false, error: 'provider must be openai, codex, gemini, or openrouter' });
            return;
          }
          provider = candidate;
        }
        if (hasReasoningField) {
          try {
            reasoning = parseChatReasoningForUpdate(body?.reasoning);
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
        }
        if (hasAgentPermissionModeField) {
          try {
            agentPermissionMode = parseAgentPermissionModeForUpdate(body?.agentPermissionMode);
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
        }
        if (hasApprovalPolicyField) {
          try {
            approvalPolicy = parseAgentApprovalPolicyForUpdate(body?.approvalPolicy);
          } catch (e: any) {
            json(res, 400, { ok: false, error: e?.message ?? String(e) });
            return;
          }
        }
        if (hasDockerSnapshotField) {
          if (
            body?.dockerSnapshotAfterAgentMessageEnabled !== true &&
            body?.dockerSnapshotAfterAgentMessageEnabled !== false
          ) {
            json(res, 400, {
              ok: false,
              error: 'dockerSnapshotAfterAgentMessageEnabled must be a boolean',
            });
            return;
          }
          dockerSnapshotAfterAgentMessageEnabled =
            body.dockerSnapshotAfterAgentMessageEnabled === true;
        }
        try {
          await ensureChatEntry({ droneId, chatName });
          if (kind === 'native') {
            const agent: ChatAgentConfig = { kind: 'native' };
            await prepareAgentChange(droneId, chatName, resolved.drone, agent);
            await setChatAgentConfig({
              droneId,
              chatName,
              agent,
              setProvider: hasProviderField,
              provider,
              setModel: hasModelField,
              model,
              setReasoning: hasReasoningField,
              reasoning,
              setAgentPermissionMode: hasAgentPermissionModeField,
              agentPermissionMode,
              setApprovalPolicy: hasApprovalPolicyField,
              approvalPolicy,
              setDockerSnapshotAfterAgentMessageEnabled: hasDockerSnapshotField,
              dockerSnapshotAfterAgentMessageEnabled,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chat: chatName,
              agent,
              ...(hasProviderField ? { provider } : {}),
              ...(hasModelField ? { model } : {}),
              ...(hasReasoningField ? { reasoning } : {}),
              ...(hasAgentPermissionModeField ? { agentPermissionMode } : {}),
              ...(hasApprovalPolicyField ? { approvalPolicy } : {}),
            });
            return;
          }
          const builtinId = normalizeBuiltinAgentId(kind === 'builtin' ? agentRaw?.id : kind);
          if (builtinId) {
            const agent: ChatAgentConfig = { kind: 'builtin', id: builtinId };
            const nativeChatIdToDelete = await prepareAgentChange(
              droneId,
              chatName,
              resolved.drone,
              agent,
            );
            await setChatAgentConfig({
              droneId,
              chatName,
              agent,
              setProvider: hasProviderField,
              provider,
              setModel: hasModelField,
              model,
              setReasoning: hasReasoningField,
              reasoning,
              setAgentPermissionMode: hasAgentPermissionModeField,
              agentPermissionMode,
              setApprovalPolicy: hasApprovalPolicyField,
              approvalPolicy,
              setDockerSnapshotAfterAgentMessageEnabled: hasDockerSnapshotField,
              dockerSnapshotAfterAgentMessageEnabled,
            });
            if (nativeChatIdToDelete) await deleteNativeChatSession(nativeChatIdToDelete);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chat: chatName,
              agent,
              ...(hasProviderField ? { provider } : {}),
              ...(hasModelField ? { model } : {}),
              ...(hasReasoningField ? { reasoning } : {}),
              ...(hasAgentPermissionModeField ? { agentPermissionMode } : {}),
              ...(hasApprovalPolicyField ? { approvalPolicy } : {}),
              ...(hasDockerSnapshotField ? { dockerSnapshotAfterAgentMessageEnabled } : {}),
            });
            return;
          }
          if (kind === 'custom') {
            const id = String(agentRaw?.id ?? '').trim();
            const label = String(agentRaw?.label ?? '').trim();
            const command = String(agentRaw?.command ?? '').trim();
            if (!id) throw new Error('missing agent.id');
            if (!label) throw new Error('missing agent.label');
            if (!command) throw new Error('missing agent.command');
            const agent: ChatAgentConfig = { kind: 'custom', id, label, command };
            const nativeChatIdToDelete = await prepareAgentChange(
              droneId,
              chatName,
              resolved.drone,
              agent,
            );
            await setChatAgentConfig({
              droneId,
              chatName,
              agent,
              setProvider: hasProviderField,
              provider,
              setModel: hasModelField,
              model,
              setReasoning: hasReasoningField,
              reasoning,
              setAgentPermissionMode: hasAgentPermissionModeField,
              agentPermissionMode,
              setApprovalPolicy: hasApprovalPolicyField,
              approvalPolicy,
              setDockerSnapshotAfterAgentMessageEnabled: hasDockerSnapshotField,
              dockerSnapshotAfterAgentMessageEnabled,
            });
            if (nativeChatIdToDelete) await deleteNativeChatSession(nativeChatIdToDelete);
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chat: chatName,
              agent,
              ...(hasProviderField ? { provider } : {}),
              ...(hasModelField ? { model } : {}),
              ...(hasReasoningField ? { reasoning } : {}),
              ...(hasAgentPermissionModeField ? { agentPermissionMode } : {}),
              ...(hasApprovalPolicyField ? { approvalPolicy } : {}),
              ...(hasDockerSnapshotField ? { dockerSnapshotAfterAgentMessageEnabled } : {}),
            });
            return;
          }
          if (
            hasProviderField ||
            hasModelField ||
            hasReasoningField ||
            hasAgentPermissionModeField ||
            hasApprovalPolicyField ||
            hasDockerSnapshotField
          ) {
            await setChatAgentConfig({
              droneId,
              chatName,
              setProvider: hasProviderField,
              provider,
              setModel: hasModelField,
              model,
              setReasoning: hasReasoningField,
              reasoning,
              setAgentPermissionMode: hasAgentPermissionModeField,
              agentPermissionMode,
              setApprovalPolicy: hasApprovalPolicyField,
              approvalPolicy,
              setDockerSnapshotAfterAgentMessageEnabled: hasDockerSnapshotField,
              dockerSnapshotAfterAgentMessageEnabled,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chat: chatName,
              ...(hasProviderField ? { provider } : {}),
              ...(hasModelField ? { model } : {}),
              ...(hasReasoningField ? { reasoning } : {}),
              ...(hasAgentPermissionModeField ? { agentPermissionMode } : {}),
              ...(hasApprovalPolicyField ? { approvalPolicy } : {}),
              ...(hasDockerSnapshotField ? { dockerSnapshotAfterAgentMessageEnabled } : {}),
            });
            return;
          }
          json(res, 400, {
            ok: false,
            error: `invalid request (expected agent native|cursor|codex|claude|opencode|pi|blip|custom, provider, model, reasoning, agentPermissionMode, approvalPolicy, dockerSnapshotAfterAgentMessageEnabled)`,
          });
          return;
        } catch (e: any) {
          const status = Number((e as any)?.statusCode ?? 0);
          json(res, status > 0 ? status : 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      return false;
    })();
    return handled !== false;
  };
}
