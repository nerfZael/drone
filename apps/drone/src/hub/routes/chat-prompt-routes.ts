import crypto from 'node:crypto';

import { normalizePromptQueueInterruptionResolution } from '@drone/assistant-chat';
import type { ChatImageAttachment } from '../chat-attachments';
import { chatPromptBodySchema } from '../chat-route-schemas';
import { parseBoolParam } from '../hub-format';
import { readJsonBody, sendJson as json } from '../hub-http';
import type { PendingPromptState } from '../pendingPromptEnqueue';
import { parseRequestSchema } from '../request-schema';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type ChatPromptRouteDependencyName =
  | 'attachmentOnlyPromptLabel'
  | 'autoRenameGeneratedChatFromFirstPrompt'
  | 'cancelQueuedPendingPrompt'
  | 'chatSnapshotResponseBody'
  | 'claimChatAutoRenameFromFirstPrompt'
  | 'createOrEnqueuePromptUnified'
  | 'createOrEnqueueNewChatAction'
  | 'createRequestTimer'
  | 'defaultDaemonReadyTimeoutMs'
  | 'discoverAndRememberModelsForBuiltinAgent'
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
  | 'inferChatAgent'
  | 'isDraftChatEntry'
  | 'isSafePromptId'
  | 'isStaleDockerExecErrorMessage'
  | 'jsonWithEtag'
  | 'jsonWithKnownEtag'
  | 'listResourceSubscriptionsForChatId'
  | 'logSlowHubRequest'
  | 'normalizeChatImageAttachments'
  | 'normalizeChatModel'
  | 'normalizeChatName'
  | 'normalizeDroneIdentity'
  | 'normalizePendingStartupPrompts'
  | 'normalizeSubmittedAtIso'
  | 'nowIso'
  | 'pushPendingPrompt'
  | 'pushPendingStartupPrompt'
  | 'promoteQueuedNewChatAction'
  | 'readChatReadStateFromStore'
  | 'readChatSnapshot'
  | 'resolveInterruptedPendingPrompt'
  | 'resolveChatTmuxCommand'
  | 'resolveDroneDaemonClientForEntry'
  | 'resolveDroneOrPendingForReadRef'
  | 'resolveDroneOrRespond'
  | 'shouldAutoRenameChatOnPrompt'
  | 'stopChatResponse'
  | 'updateStoredUserTimeZone'
  | 'waitForDroneDaemonReady'
  | 'withLockedDroneContainer';

export type ChatPromptRouteDependencies =
  LegacyRouteDependencyContract<ChatPromptRouteDependencyName>;

export function createChatPromptRouteHandler(
  deps: ChatPromptRouteDependencies,
): LegacyRouteHandler {
  const {
    attachmentOnlyPromptLabel,
    autoRenameGeneratedChatFromFirstPrompt,
    cancelQueuedPendingPrompt,
    chatSnapshotResponseBody,
    claimChatAutoRenameFromFirstPrompt,
    createOrEnqueuePromptUnified,
    createOrEnqueueNewChatAction,
    createRequestTimer,
    defaultDaemonReadyTimeoutMs,
    discoverAndRememberModelsForBuiltinAgent,
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
    inferChatAgent,
    isDraftChatEntry,
    isSafePromptId,
    isStaleDockerExecErrorMessage,
    jsonWithEtag,
    jsonWithKnownEtag,
    listResourceSubscriptionsForChatId,
    logSlowHubRequest,
    normalizeChatImageAttachments,
    normalizeChatModel,
    normalizeChatName,
    normalizeDroneIdentity,
    normalizePendingStartupPrompts,
    normalizeSubmittedAtIso,
    nowIso,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    promoteQueuedNewChatAction,
    readChatReadStateFromStore,
    readChatSnapshot,
    resolveInterruptedPendingPrompt,
    resolveChatTmuxCommand,
    resolveDroneDaemonClientForEntry,
    resolveDroneOrPendingForReadRef,
    resolveDroneOrRespond,
    shouldAutoRenameChatOnPrompt,
    stopChatResponse,
    updateStoredUserTimeZone,
    waitForDroneDaemonReady,
    withLockedDroneContainer,
  } = deps;
  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones/:id/chats/:chat/prompt
      // Chat input. For builtin transcript agents (cursor/codex/claude/opencode/pi/blip):
      // record a clean transcript turn.
      // For custom agents: send input into a tmux session (full CLI view).
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'prompt'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]);
        const timer = createRequestTimer();
        let body: any = null;
        try {
          body = parseRequestSchema(chatPromptBodySchema, await readJsonBody(req), 'chat prompt');
          timer.mark('body');
        } catch (e: any) {
          timer.setHeader(res);
          logSlowHubRequest('chat prompt', timer, {
            droneRef,
            chatName,
            status: 400,
            error: e?.message ?? String(e),
          });
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        if (body?.userTimeZone != null) {
          await updateStoredUserTimeZone(body.userTimeZone).catch(() => undefined);
        }

        let prompt = String(body?.prompt ?? '').trim();
        let attachments: ChatImageAttachment[] = [];
        try {
          attachments = normalizeChatImageAttachments(body?.attachments);
          timer.mark('validate');
        } catch (e: any) {
          timer.setHeader(res);
          logSlowHubRequest('chat prompt', timer, {
            droneRef,
            chatName,
            status: 400,
            error: e?.message ?? String(e),
          });
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }
        if (!prompt && attachments.length === 0) {
          timer.setHeader(res);
          logSlowHubRequest('chat prompt', timer, {
            droneRef,
            chatName,
            status: 400,
            error: 'missing prompt',
          });
          json(res, 400, { ok: false, error: 'missing prompt' });
          return;
        }
        if (!prompt && attachments.length > 0) {
          prompt = attachmentOnlyPromptLabel(attachments);
        }
        const deliveryMode =
          body?.deliveryMode === 'asap'
            ? 'asap'
            : body?.deliveryMode === 'queue'
              ? 'queue'
              : undefined;
        const submissionSource =
          body?.submissionSource === 'assistant-tool' ||
          body?.submissionSource === 'workflow' ||
          body?.submissionSource === 'subscription' ||
          body?.submissionSource === 'queue-action' ||
          body?.submissionSource === 'system'
            ? body.submissionSource
            : 'human';

        try {
          const resolved = await resolveDroneOrPendingForReadRef(droneRef);
          timer.mark('resolve');
          if (!resolved) {
            timer.setHeader(res);
            logSlowHubRequest('chat prompt', timer, { droneRef, chatName, status: 404 });
            json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
            return;
          }
          const droneId = resolved.id;
          const drone = resolved.kind === 'real' ? resolved.drone : resolved.pending;
          const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
          const chat = normalizeChatName(chatName);
          const existingChatEntry =
            resolved.kind === 'real' ? ((drone as any)?.chats?.[chat] ?? null) : null;
          if (body?.requireExistingChat === true && resolved.kind === 'pending') {
            const startupChatNames = [
              ...new Set(
                normalizePendingStartupPrompts((drone as any)?.startupQueuedPrompts).map(
                  (item: any) => item.chatName,
                ),
              ),
            ].filter(Boolean);
            const existingPendingChat =
              startupChatNames.includes(chat) ||
              (chat === 'default' && startupChatNames.length === 0);
            if (!existingPendingChat) {
              timer.setHeader(res);
              logSlowHubRequest('chat prompt', timer, {
                droneId,
                chatName: chat,
                status: 404,
                error: `unknown chat: ${chat}`,
              });
              json(res, 404, { ok: false, error: `unknown chat: ${chat}` });
              return;
            }
          }
          const autoRenameCandidateFromFirstPrompt = existingChatEntry
            ? await shouldAutoRenameChatOnPrompt({
                droneId,
                chatName: chat,
                chatEntry: existingChatEntry,
              })
            : false;
          const autoRenameExpectedCreatedAt = String(existingChatEntry?.createdAt ?? '');
          const promptIdRaw = String(body?.promptId ?? body?.prompt_id ?? body?.id ?? '').trim();
          if (promptIdRaw && !isSafePromptId(promptIdRaw)) {
            timer.setHeader(res);
            logSlowHubRequest('chat prompt', timer, {
              droneId,
              chatName: chat,
              status: 400,
              error: 'invalid promptId',
            });
            json(res, 400, { ok: false, error: 'invalid promptId' });
            return;
          }

          const submittedAt = normalizeSubmittedAtIso(
            body?.submittedAt ?? body?.clientSubmittedAt ?? body?.at,
          );
          let r:
            | {
                kind: 'enqueued';
                id: string;
                pendingState: PendingPromptState;
              }
            | { kind: 'error'; status: number; error: string };
          if (resolved.kind === 'pending') {
            if (attachments.length > 0) {
              r = {
                kind: 'error',
                status: 409,
                error: `drone "${droneId}" is still starting (attachments require an active drone)`,
              };
            } else {
              const pendingPromptId = promptIdRaw || crypto.randomBytes(9).toString('hex');
              const queuedStatus = await pushPendingStartupPrompt({
                droneId,
                chatName: chat,
                pending: {
                  id: pendingPromptId,
                  at: submittedAt,
                  prompt,
                  ...(typeof body?.cwd === 'string' ? { cwd: body.cwd } : {}),
                  ...(deliveryMode ? { deliveryMode } : {}),
                  state: 'queued',
                  updatedAt: submittedAt,
                },
              });
              if (queuedStatus === 'queued') {
                r = {
                  kind: 'enqueued',
                  id: pendingPromptId,
                  pendingState: 'queued',
                };
              } else {
                r = await createOrEnqueuePromptUnified({
                  id: pendingPromptId,
                  droneId,
                  chatName: chat,
                  prompt,
                  attachments,
                  cwd: typeof body?.cwd === 'string' ? body.cwd : null,
                  submittedAt,
                  deliveryMode,
                  submissionSource,
                  requireExistingChat: body?.requireExistingChat === true,
                  mark: (name: string) => timer.mark(name),
                });
              }
            }
          } else {
            const liveChatEntry = (drone as any)?.chats?.[chat] ?? null;
            if (isDraftChatEntry(liveChatEntry)) {
              if (attachments.length > 0) {
                r = {
                  kind: 'error',
                  status: 409,
                  error: 'draft chats do not support attachments until they are published',
                };
              } else {
                const draftPromptId = promptIdRaw || crypto.randomBytes(9).toString('hex');
                await pushPendingPrompt({
                  droneId,
                  chatName: chat,
                  submissionSource,
                  pending: {
                    id: draftPromptId,
                    at: submittedAt,
                    prompt,
                    ...(typeof body?.cwd === 'string' ? { cwd: body.cwd } : {}),
                    ...(deliveryMode ? { deliveryMode } : {}),
                    state: 'queued',
                    updatedAt: submittedAt,
                  },
                });
                r = {
                  kind: 'enqueued',
                  id: draftPromptId,
                  pendingState: 'queued',
                };
              }
            } else {
              r = await createOrEnqueuePromptUnified({
                id: promptIdRaw || undefined,
                droneId,
                chatName: chat,
                prompt,
                attachments,
                cwd: typeof body?.cwd === 'string' ? body.cwd : null,
                submittedAt,
                deliveryMode,
                submissionSource,
                requireExistingChat: body?.requireExistingChat === true,
                mark: (name: string) => timer.mark(name),
              });
            }
          }
          timer.mark('enqueue');

          if (r.kind === 'error') {
            timer.setHeader(res);
            logSlowHubRequest('chat prompt', timer, {
              droneId,
              chatName: chat,
              status: r.status,
              error: r.error,
            });
            json(res, r.status, { ok: false, error: r.error });
            return;
          }
          const autoRenameFromFirstPrompt = autoRenameCandidateFromFirstPrompt
            ? await claimChatAutoRenameFromFirstPrompt({ droneId, chatName: chat })
            : false;
          if (autoRenameFromFirstPrompt && autoRenameExpectedCreatedAt) {
            if (body?.autoRenameHandledByClient !== true) {
              void autoRenameGeneratedChatFromFirstPrompt({
                droneId,
                chatName: chat,
                prompt,
                expectedCreatedAt: autoRenameExpectedCreatedAt,
              });
            }
          }
          timer.mark('format');
          timer.setHeader(res);
          logSlowHubRequest('chat prompt', timer, {
            droneId,
            chatName: chat,
            promptId: r.id,
            pendingState: r.pendingState,
            status: 202,
          });
          json(res, 202, {
            ok: true,
            accepted: true,
            id: droneId,
            name: droneName,
            chat,
            promptId: r.id,
            pendingState: r.pendingState,
            autoRenameChat: autoRenameFromFirstPrompt,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg)
            ? 409
            : /unknown drone|unknown chat/i.test(msg)
              ? 404
              : /invalid promptId/i.test(msg)
                ? 400
                : 500;
          timer.setHeader(res);
          logSlowHubRequest('chat prompt', timer, { droneRef, chatName, status: code, error: msg });
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/new-chat-action
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'new-chat-action'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        try {
          const body: any = parseRequestSchema(
            chatPromptBodySchema,
            await readJsonBody(req),
            'new chat action',
          );
          let prompt = String(body?.prompt ?? '').trim();
          const attachments = normalizeChatImageAttachments(body?.attachments);
          if (!prompt && attachments.length === 0) {
            json(res, 400, { ok: false, error: 'missing prompt' });
            return;
          }
          if (!prompt) prompt = attachmentOnlyPromptLabel(attachments);
          const promptId = String(body?.promptId ?? body?.id ?? '').trim();
          if (promptId && !isSafePromptId(promptId)) {
            json(res, 400, { ok: false, error: 'invalid promptId' });
            return;
          }
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const result = await createOrEnqueueNewChatAction({
            id: promptId || undefined,
            droneId: resolved.id,
            chatName,
            prompt,
            attachments,
            cwd: typeof body?.cwd === 'string' ? body.cwd : null,
            submittedAt: body?.submittedAt ?? body?.clientSubmittedAt ?? body?.at,
          });
          if (result.kind === 'error') {
            json(res, result.status, { ok: false, error: result.error });
            return;
          }
          json(res, 202, {
            ok: true,
            accepted: true,
            id: resolved.id,
            chat: chatName,
            actionId: result.id,
            pendingState: result.pendingState,
            ...(result.targetChatName ? { targetChatName: result.targetChatName } : {}),
          });
          return;
        } catch (error: any) {
          const message = error?.message ?? String(error);
          json(res, /unknown drone|unknown chat/i.test(message) ? 404 : 500, {
            ok: false,
            error: message,
          });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/pending/:actionId/create-now
      if (
        method === 'POST' &&
        parts.length === 8 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'pending' &&
        parts[7] === 'create-now'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const actionId = decodeURIComponent(parts[6]);
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const result = await promoteQueuedNewChatAction({
            droneId: resolved.id,
            chatName,
            actionId,
          });
          if (result.kind === 'error') {
            json(res, result.status, { ok: false, error: result.error });
            return;
          }
          json(res, result.kind === 'created' ? 200 : 202, {
            ok: true,
            status: result.kind,
            actionId,
            ...(result.targetChatName ? { targetChatName: result.targetChatName } : {}),
          });
          return;
        } catch (error: any) {
          json(res, 500, { ok: false, error: error?.message ?? String(error) });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/stop
      // Interrupt the active response for the current chat.
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'stop'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const drone = resolved.drone;
          const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
          const result = await stopChatResponse({ droneId, chatName, droneEntry: drone });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            chat: chatName,
            mode: result.mode,
            stopped: result.stopped,
            stoppedPromptIds: result.stoppedPromptIds,
            clearedPromptIds: result.clearedPromptIds,
            ...(result.sessionName ? { sessionName: result.sessionName } : {}),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg)
            ? 409
            : /unknown drone/i.test(msg)
              ? 404
              : /unknown chat/i.test(msg)
                ? 404
                : /drone daemon not reachable/i.test(msg)
                  ? 409
                  : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat/state?transcript=selected|tail|page|full|none&pending=none
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'state'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const timer = createRequestTimer();
        try {
          const transcriptMode = String(u.searchParams.get('transcript') ?? 'selected')
            .trim()
            .toLowerCase();
          if (!['selected', 'tail', 'page', 'full', 'none'].includes(transcriptMode)) {
            json(res, 400, {
              ok: false,
              error: 'invalid transcript mode (expected selected, tail, page, full, or none)',
            });
            return;
          }
          const beforeText = String(u.searchParams.get('before') ?? '').trim();
          const limitText = String(u.searchParams.get('limit') ?? '100').trim();
          if (
            transcriptMode === 'page' &&
            ((beforeText &&
              (!Number.isSafeInteger(Number(beforeText)) || Number(beforeText) < 0)) ||
              !Number.isSafeInteger(Number(limitText)) ||
              Number(limitText) < 1 ||
              Number(limitText) > 100)
          ) {
            json(res, 400, {
              ok: false,
              error: 'invalid chat page (before must be non-negative and limit must be 1 to 100)',
            });
            return;
          }
          const pendingMode = String(u.searchParams.get('pending') ?? '')
            .trim()
            .toLowerCase();
          if (pendingMode && !['all', 'true', '1', 'none', 'false', '0'].includes(pendingMode)) {
            json(res, 400, {
              ok: false,
              error: 'invalid pending mode (expected all, true, 1, none, false, or 0)',
            });
            return;
          }
          const includeTranscript = transcriptMode !== 'none';
          const includePending = !['none', 'false', '0'].includes(pendingMode);
          const includeSubscriptions = parseBoolParam(u.searchParams.get('subscriptions'), false);
          const includeReadState = parseBoolParam(
            u.searchParams.get('readState'),
            includeSubscriptions,
          );
          const includeVolatileState = includeSubscriptions || includeReadState;
          const includeTranscriptMeta = parseBoolParam(u.searchParams.get('transcriptMeta'), true);
          const selection =
            transcriptMode === 'full'
              ? 'all'
              : transcriptMode === 'page'
                ? `page:${beforeText}:${limitText}`
                : (u.searchParams.get('turn') ?? 'all');
          const tailRaw =
            transcriptMode === 'full' || transcriptMode === 'page'
              ? null
              : transcriptMode === 'tail'
                ? (u.searchParams.get('tail') ?? '50')
                : u.searchParams.get('tail');
          const snapshot = await readChatSnapshot({
            droneRef,
            chatName,
            selection,
            tailRaw,
            includeTranscript,
            includePending,
            maintenance: 'schedule',
            includeDockerSnapshotMaintenance: true,
            ifNoneMatch: includeVolatileState ? '' : String(req.headers['if-none-match'] ?? ''),
            mark: (name: string) => timer.mark(name),
          });
          if ((globalThis as any).Bun) timer.mark('read');
          if (!snapshot.ok) {
            timer.setHeader(res);
            logSlowHubRequest('chat state', timer, {
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
          logSlowHubRequest('chat state', timer, {
            droneId: snapshot.id,
            chatName,
            selection: snapshot.selection,
            turnCount: snapshot.turnCount,
            pendingCount: snapshot.pending.length,
            status: 200,
          });
          const responseBody = {
            ...chatSnapshotResponseBody(snapshot, { includeTranscriptMeta }),
            ...(includeReadState
              ? {
                  readState: readChatReadStateFromStore({
                    droneId: snapshot.id,
                    chatName,
                  }),
                }
              : {}),
            ...(includeSubscriptions
              ? {
                  subscriptions: snapshot.chatId
                    ? listResourceSubscriptionsForChatId(snapshot.chatId)
                    : [],
                }
              : {}),
          };
          if (includeVolatileState) {
            jsonWithEtag(req, res, 200, responseBody);
          } else if (snapshot.responseEtag) {
            jsonWithKnownEtag(req, res, 200, responseBody, snapshot.responseEtag);
          } else {
            jsonWithEtag(req, res, 200, responseBody);
          }
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg) ? 409 : /unknown drone/i.test(msg) ? 404 : 500;
          timer.setHeader(res);
          logSlowHubRequest('chat state', timer, { droneRef, chatName, status: code, error: msg });
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat/pending
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'pending'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const timer = createRequestTimer();
        try {
          const snapshot = await readChatSnapshot({
            droneRef,
            chatName,
            selection: 'all',
            tailRaw: null,
            includeTranscript: false,
            includePending: true,
            maintenance: 'run',
            mark: (name: string) => timer.mark(name),
          });
          if ((globalThis as any).Bun) timer.mark('read');
          if (!snapshot.ok) {
            timer.setHeader(res);
            logSlowHubRequest('chat pending', timer, {
              droneRef,
              chatName,
              status: snapshot.statusCode,
              error: snapshot.error,
            });
            json(res, snapshot.statusCode, { ok: false, error: snapshot.error });
            return;
          }
          timer.setHeader(res);
          logSlowHubRequest('chat pending', timer, { droneId: snapshot.id, chatName, status: 200 });
          json(res, 200, {
            ok: true,
            id: snapshot.id,
            name: snapshot.name,
            chat: snapshot.chat,
            pending: snapshot.pending,
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg) ? 409 : /unknown drone/i.test(msg) ? 404 : 500;
          timer.setHeader(res);
          logSlowHubRequest('chat pending', timer, {
            droneRef,
            chatName,
            status: code,
            error: msg,
          });
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // DELETE /api/drones/:id/chats/:chat/pending/:promptId
      if (
        method === 'DELETE' &&
        parts.length === 7 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'pending'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const promptId = String(decodeURIComponent(parts[6] ?? '')).trim();
        if (!isSafePromptId(promptId)) {
          json(res, 400, { ok: false, error: 'invalid promptId' });
          return;
        }
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const drone = resolved.drone;
          const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
          const result = await cancelQueuedPendingPrompt({ droneId, chatName, promptId });
          if (result.status === 'not-found') {
            json(res, 404, {
              ok: false,
              error: `unknown pending prompt: ${promptId}`,
              id: droneId,
              name: droneName,
              chat: chatName,
              promptId,
              cancelled: false,
              alreadySubmitted: false,
            });
            return;
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            chat: chatName,
            promptId,
            cancelled: result.status === 'cancelled',
            alreadySubmitted: result.status === 'already-submitted',
            pendingState: result.pendingState ?? null,
          });
          if (result.status === 'cancelled') {
            enqueuePendingPromptPump(droneId, chatName);
          }
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /still starting/i.test(msg) ? 409 : /unknown drone/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      // POST /api/drones/:id/chats/:chat/pending/:promptId/interruption
      if (
        method === 'POST' &&
        parts.length === 8 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'pending' &&
        parts[7] === 'interruption'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = normalizeChatName(decodeURIComponent(parts[4]));
        const promptId = String(decodeURIComponent(parts[6] ?? '')).trim();
        if (!isSafePromptId(promptId)) {
          json(res, 400, { ok: false, error: 'invalid promptId' });
          return;
        }
        try {
          const body = await readJsonBody(req);
          if (!normalizePromptQueueInterruptionResolution(body?.resolution)) {
            json(res, 400, { ok: false, error: 'resolution must be skip' });
            return;
          }
        } catch (error: any) {
          json(res, 400, { ok: false, error: error?.message ?? 'invalid request body' });
          return;
        }
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const result = await resolveInterruptedPendingPrompt({
            droneId: resolved.id,
            chatName,
            promptId,
          });
          if (result.status === 'not-found') {
            json(res, 404, { ok: false, error: `unknown pending prompt: ${promptId}` });
            return;
          }
          if (result.status === 'not-blocked') {
            json(res, 409, { ok: false, error: 'prompt is not waiting for interruption recovery' });
            return;
          }
          enqueuePendingPromptPump(resolved.id, chatName);
          json(res, 200, {
            ok: true,
            id: resolved.id,
            name: String(resolved.drone?.name ?? droneRef).trim() || droneRef,
            chat: chatName,
            promptId,
            resolution: 'skip',
            ...result,
          });
          return;
        } catch (error: any) {
          const message = error?.message ?? String(error);
          const code = /still starting/i.test(message)
            ? 409
            : /unknown drone/i.test(message)
              ? 404
              : 500;
          json(res, code, { ok: false, error: message });
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat/output?since=<bytes>&maxBytes=<bytes>&tail=<lines>
      // Read the tmux session log for the given chat.
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'output'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatNameRaw = decodeURIComponent(parts[4]);
        const normalizedChat = normalizeChatName(chatNameRaw || 'default');
        const sessionName = hubChatSessionName(normalizedChat);

        const viewRaw = String(u.searchParams.get('view') ?? 'log')
          .trim()
          .toLowerCase();
        const view = viewRaw === 'screen' ? 'screen' : 'log';

        const sinceRaw = u.searchParams.get('since');
        const maxBytesRaw = u.searchParams.get('maxBytes');
        const tailRaw = u.searchParams.get('tail');
        const since = sinceRaw != null ? Number(sinceRaw) : undefined;
        const maxBytes = maxBytesRaw != null ? Number(maxBytesRaw) : undefined;
        const tailLines = tailRaw != null ? Number(tailRaw) : 200;
        const timer = createRequestTimer();

        try {
          const resolved = await resolveDroneOrPendingForReadRef(droneRef);
          timer.mark('resolve');
          if (!resolved) {
            timer.setHeader(res);
            logSlowHubRequest('chat output', timer, {
              droneRef,
              chatName: normalizedChat,
              view,
              status: 404,
            });
            json(res, 404, { ok: false, error: `unknown drone: ${droneRef}` });
            return;
          }
          if (resolved.kind === 'pending') {
            const droneName = String(resolved.pending?.name ?? droneRef).trim() || droneRef;
            if (view === 'screen') {
              timer.mark('format');
              timer.setHeader(res);
              logSlowHubRequest('chat output', timer, {
                droneId: resolved.id,
                chatName: normalizedChat,
                kind: 'pending',
                view,
                status: 200,
              });
              json(res, 200, {
                ok: true,
                id: resolved.id,
                name: droneName,
                chat: normalizedChat,
                sessionName,
                view,
                tailLines,
                text: '',
              });
              return;
            }
            timer.mark('format');
            timer.setHeader(res);
            logSlowHubRequest('chat output', timer, {
              droneId: resolved.id,
              chatName: normalizedChat,
              kind: 'pending',
              view,
              status: 200,
            });
            json(res, 200, {
              ok: true,
              id: resolved.id,
              name: droneName,
              chat: normalizedChat,
              sessionName,
              view,
              offsetBytes: 0,
              text: '',
            });
            return;
          }
          const droneId = resolved.id;
          const drone = resolved.drone;
          const runtime = droneRuntime(drone);
          const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(drone);
            timer.mark('daemon');
            if (!daemon) throw new Error('drone daemon not reachable (missing hostPort/token)');
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            timer.mark('ready');
            if (view === 'screen') {
              const r = await droneTerminalPrompt(daemon.client, { session: sessionName });
              const text = String((r as any)?.text ?? '');
              timer.mark('read');
              timer.setHeader(res);
              logSlowHubRequest('chat output', timer, {
                droneId,
                chatName: normalizedChat,
                runtime,
                view,
                tailLines,
                textBytes: Buffer.byteLength(text),
                status: 200,
              });
              json(res, 200, {
                ok: true,
                id: droneId,
                name: droneName,
                chat: normalizedChat,
                sessionName,
                view,
                tailLines,
                text,
              });
              return;
            }
            const out = await droneTerminalOutput(daemon.client, {
              session: sessionName,
              since: typeof since === 'number' && Number.isFinite(since) ? since : 0,
              max: typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? maxBytes : 200000,
            });
            const text = String((out as any)?.chunk ?? '');
            timer.mark('read');
            timer.setHeader(res);
            logSlowHubRequest('chat output', timer, {
              droneId,
              chatName: normalizedChat,
              runtime,
              view,
              offsetBytes: Number((out as any)?.nextOffset ?? 0),
              textBytes: Buffer.byteLength(text),
              status: 200,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chat: normalizedChat,
              sessionName,
              view,
              offsetBytes: Number((out as any)?.nextOffset ?? 0),
              text,
            });
            return;
          }

          await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: drone },
            async ({ containerName, droneId: lockedId }: any) => {
              timer.mark('lock');
              const idForOps = normalizeDroneIdentity(lockedId) || droneId;
              await ensureChatEntry({ droneId: idForOps, chatName: normalizedChat });
              timer.mark('ensure');
              const tmuxCmd = await resolveChatTmuxCommand({
                droneId: idForOps,
                chatName: normalizedChat,
              });
              timer.mark('command');
              await ensureHubChatSessionRunning({
                containerName,
                chatName: normalizedChat,
                command: tmuxCmd,
              });
              timer.mark('session');

              if (view === 'screen') {
                const nRaw = Number.isFinite(tailLines) ? Math.floor(tailLines) : 200;
                const n = Math.max(20, Math.min(5000, nRaw || 200));
                const script = [
                  'set -euo pipefail',
                  `session=${JSON.stringify(sessionName)}`,
                  `n=${JSON.stringify(String(n))}`,
                  'tmux capture-pane -p -t "$session" -S "-$n" 2>/dev/null || tmux capture-pane -p -t "$session" 2>/dev/null || true',
                ].join('\n');
                const r = await dvmExec(containerName, 'bash', ['-lc', script]);
                if (r.code !== 0)
                  throw new Error((r.stderr || r.stdout || 'tmux capture-pane failed').trim());
                timer.mark('read');
                timer.setHeader(res);
                logSlowHubRequest('chat output', timer, {
                  droneId: idForOps,
                  chatName: normalizedChat,
                  runtime,
                  view,
                  tailLines: n,
                  textBytes: Buffer.byteLength(r.stdout || ''),
                  status: 200,
                });
                json(res, 200, {
                  ok: true,
                  id: idForOps,
                  name: droneName,
                  chat: normalizedChat,
                  sessionName,
                  view,
                  tailLines: n,
                  text: r.stdout || '',
                });
                return;
              }

              const out = await dvmSessionRead({
                container: containerName,
                session: sessionName,
                since: typeof since === 'number' && Number.isFinite(since) ? since : undefined,
                maxBytes:
                  typeof maxBytes === 'number' && Number.isFinite(maxBytes) ? maxBytes : undefined,
                tailLines:
                  typeof since === 'number' && Number.isFinite(since) ? undefined : tailLines,
              });
              timer.mark('read');
              timer.setHeader(res);
              logSlowHubRequest('chat output', timer, {
                droneId: idForOps,
                chatName: normalizedChat,
                runtime,
                view,
                textBytes: Buffer.byteLength(
                  String((out as any)?.text ?? (out as any)?.chunk ?? ''),
                ),
                status: 200,
              });
              json(res, 200, {
                ok: true,
                id: idForOps,
                name: droneName,
                chat: normalizedChat,
                sessionName,
                view,
                ...out,
              });
            },
          );
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (isStaleDockerExecErrorMessage(msg)) {
            timer.mark('error');
            timer.setHeader(res);
            logSlowHubRequest('chat output', timer, {
              droneRef,
              chatName: normalizedChat,
              view,
              status: 409,
              error: msg,
            });
            json(res, 409, {
              ok: false,
              code: 'STALE_TERMINAL_SESSION',
              error:
                'Terminal session was interrupted by a container restart. Reopen the terminal session.',
              detail: msg,
              name: droneRef,
              chat: normalizedChat,
              sessionName,
            });
            return;
          }
          timer.mark('error');
          timer.setHeader(res);
          logSlowHubRequest('chat output', timer, {
            droneRef,
            chatName: normalizedChat,
            view,
            status: 500,
            error: msg,
          });
          json(res, 500, {
            ok: false,
            error: msg,
            name: droneRef,
            chat: normalizedChat,
            sessionName,
          });
          return;
        }
      }

      // GET /api/drones/:id/chats/:chat/models?refresh=1
      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'models'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        const forceRefresh = parseBoolParam(u.searchParams.get('refresh'), false);
        try {
          const resolved = await resolveDroneOrRespond(res, droneRef);
          if (!resolved) return;
          const droneId = resolved.id;
          const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
          await ensureChatEntry({ droneId, chatName });
          const { d, chat } = await getChatEntry({ droneId, chatName });
          const agent = inferChatAgent(chat, d);
          if (agent.kind !== 'builtin') {
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              chat: chatName,
              agent,
              model: normalizeChatModel((chat as any)?.model),
              models: [],
              source: 'none',
              discoveredAt: nowIso(),
              error: 'model discovery is only available for builtin agents',
            });
            return;
          }
          const discovered = await discoverAndRememberModelsForBuiltinAgent({
            containerName:
              String((d as any)?.containerName ?? (d as any)?.name ?? droneId).trim() || droneId,
            containerPort: Number((d as any)?.containerPort ?? 7777),
            runtime: droneRuntime(d),
            agentId: agent.id,
            forceRefresh,
          });
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            chat: chatName,
            draft: isDraftChatEntry(chat),
            agent,
            model: normalizeChatModel((chat as any)?.model),
            models: discovered.models,
            source: discovered.source,
            discoveredAt: discovered.discoveredAt,
            ...(discovered.error ? { error: discovered.error } : {}),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const code = /unknown drone/i.test(msg)
            ? 404
            : /unknown chat/i.test(msg)
              ? 404
              : /still starting/i.test(msg)
                ? 409
                : 500;
          json(res, code, { ok: false, error: msg });
          return;
        }
      }

      return false;
    })();
    return handled !== false;
  };
}
