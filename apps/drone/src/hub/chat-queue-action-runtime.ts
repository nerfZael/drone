import crypto from 'node:crypto';

import {
  allocateUntitledChatName,
  isSendInNewChatQueueAction,
  type SendInNewChatQueueAction,
} from '@drone/assistant-chat';

import type { ChatImageAttachment, ChatImageAttachmentRef } from './chat-attachments';
import type { CreateDroneChatInput, CreateDroneChatResult } from './chat-creation-service';
import type { PendingPromptState } from './drone-pending-state';
import type { PendingPrompt } from './drone-pending-prompts';

type PromptSubmissionResult =
  | { kind: 'enqueued'; id: string; pendingState: PendingPromptState }
  | { kind: 'error'; status: number; error: string };

type RetryResult = {
  disposition: 'retry' | 'terminal' | 'not-claimed';
  nextAttemptAt?: string;
};

export type SendInNewChatActionRuntimeDependencies = {
  attachmentOnlyPromptLabel: (attachments: ChatImageAttachment[]) => string;
  autoRenameGeneratedChatFromFirstPrompt: (input: {
    droneId: string;
    chatName: string;
    prompt: string;
    expectedCreatedAt: string;
  }) => Promise<unknown>;
  buildChatAttachmentsDirectory: (input: any) => string;
  buildChatImageAttachmentRefs: (input: any) => ChatImageAttachmentRef[];
  chatAttachmentsStorageRootForDrone: (drone: any) => string | undefined;
  claimQueuedPendingPromptForPromotion: (input: any) => Promise<PendingPrompt | null>;
  claimQueuedPendingPromptForSending: (input: any) => Promise<unknown>;
  copyChatAttachmentsToContainer: (input: any) => Promise<unknown>;
  copyChatAttachmentsToHost: (input: any) => Promise<unknown>;
  createDroneChat: (input: CreateDroneChatInput) => Promise<CreateDroneChatResult>;
  createOrEnqueuePrompt: (input: any) => Promise<PromptSubmissionResult>;
  droneRuntime: (drone: any) => string;
  enqueuePendingPromptPump: (droneId: string, chatName: string) => void;
  getChatEntry: (input: any) => Promise<{ d: any; chat: any }>;
  hasPendingWork: (chat: any, pending: PendingPrompt[]) => boolean;
  isSafePromptId: (id: string) => boolean;
  listChatsFromStore: (input: { droneId: string }) => { chats: string[] };
  loadRegistry: () => Promise<any>;
  normalizeChatImageAttachmentRefs: (raw: unknown) => ChatImageAttachmentRef[];
  normalizeChatName: (name: string) => string;
  normalizeDroneCwdForRuntime: (drone: any, cwd: string | null) => string;
  normalizeDroneIdentity: (id: string) => string;
  normalizeSubmittedAtIso: (value: string | null | undefined) => string;
  notifyDroneChatWrite?: (droneId: string, chatName: string) => void;
  pushPendingPrompt: (input: any) => Promise<unknown>;
  readChatFromStore: (input: { droneId: string; chatName: string }) => {
    available: boolean;
    chat: any | null;
  };
  readPendingPrompt: (input: any) => PendingPrompt | null;
  readPendingPrompts: (input: any) => Promise<PendingPrompt[]>;
  retryPendingPrompt: (input: any) => Promise<RetryResult>;
  schedulePendingPromptPumpRetry: (droneId: string, chatName: string, delayMs?: number) => void;
  updatePendingPrompt: (input: any) => Promise<void>;
};

export type CreateOrEnqueueNewChatActionResult =
  | {
      kind: 'accepted';
      id: string;
      pendingState: PendingPromptState;
      targetChatName?: string;
    }
  | { kind: 'error'; status: number; error: string };

export type PromoteQueuedNewChatActionResult =
  | { kind: 'created'; targetChatName: string }
  | { kind: 'executing'; targetChatName?: string }
  | { kind: 'error'; status: number; error: string };

export function createSendInNewChatActionRuntime(deps: SendInNewChatActionRuntimeDependencies) {
  async function stageAttachments(input: {
    droneId: string;
    chatName: string;
    promptId: string;
    drone: any;
    cwd: string | null;
    attachments: ChatImageAttachment[];
  }): Promise<ChatImageAttachmentRef[]> {
    if (input.attachments.length === 0) return [];
    const cwd = deps.normalizeDroneCwdForRuntime(input.drone, input.cwd);
    const storageRoot = deps.chatAttachmentsStorageRootForDrone(input.drone);
    const refs = deps.buildChatImageAttachmentRefs({
      attachments: input.attachments,
      cwd,
      chatName: input.chatName,
      promptId: input.promptId,
      storageRoot,
    });
    const directory = deps.buildChatAttachmentsDirectory({
      cwd,
      chatName: input.chatName,
      promptId: input.promptId,
      storageRoot,
    });
    if (deps.droneRuntime(input.drone) === 'host') {
      await deps.copyChatAttachmentsToHost({ hostDir: directory, attachments: input.attachments });
    } else {
      const containerName =
        String(input.drone?.containerName ?? input.drone?.name ?? input.droneId).trim() ||
        input.droneId;
      await deps.copyChatAttachmentsToContainer({
        containerName,
        containerDir: directory,
        attachments: input.attachments,
      });
    }
    return refs;
  }

  function targetPromptId(actionId: string): string {
    return `new-chat-${crypto.createHash('sha256').update(actionId).digest('hex').slice(0, 24)}`;
  }

  function findOwnedTarget(
    droneId: string,
    actionId: string,
    sourceChatId: string,
    sourceChatName: string,
  ): string {
    for (const chatName of deps.listChatsFromStore({ droneId }).chats) {
      const stored = deps.readChatFromStore({ droneId, chatName });
      if (!stored.chat) continue;
      const origin = stored.chat?.queuedChatOrigin;
      if (String(origin?.actionId ?? '').trim() !== actionId) continue;
      const storedSourceChatId = String(origin?.sourceChatId ?? '').trim();
      if (sourceChatId || storedSourceChatId) {
        if (sourceChatId && storedSourceChatId === sourceChatId) return chatName;
        continue;
      }
      if (String(origin?.sourceChatName ?? '') === sourceChatName) return chatName;
    }
    return '';
  }

  async function resolveRecordedTarget(input: {
    droneId: string;
    chatName: string;
    pending: PendingPrompt;
  }): Promise<string> {
    const action = input.pending.action;
    if (!isSendInNewChatQueueAction(action)) return '';
    const storedTargetChatName = String(action.targetChatName ?? '').trim();
    const targetChatName =
      findOwnedTarget(
        input.droneId,
        input.pending.id,
        String(action.sourceChatId ?? '').trim(),
        action.sourceChatName,
      ) || storedTargetChatName;
    if (targetChatName && targetChatName !== storedTargetChatName) {
      await deps.updatePendingPrompt({
        droneId: input.droneId,
        chatName: input.chatName,
        id: input.pending.id,
        patch: { action: { ...action, targetChatName } },
      });
    }
    return targetChatName;
  }

  async function existingSubmissionResult(input: {
    droneId: string;
    chatName: string;
    id: string;
  }): Promise<CreateOrEnqueueNewChatActionResult | null> {
    const pending = deps.readPendingPrompt({
      droneId: input.droneId,
      chatName: input.chatName,
      id: input.id,
    });
    if (!pending) return null;
    if (!isSendInNewChatQueueAction(pending.action)) {
      return { kind: 'error', status: 409, error: `prompt id is already in use: ${input.id}` };
    }
    if (pending.state === 'queued') {
      deps.enqueuePendingPromptPump(input.droneId, input.chatName);
      return { kind: 'accepted', id: input.id, pendingState: 'queued' };
    }
    const targetChatName = await resolveRecordedTarget({
      droneId: input.droneId,
      chatName: input.chatName,
      pending,
    });
    if (pending.state === 'sending') {
      return {
        kind: 'accepted',
        id: input.id,
        pendingState: 'sending',
        ...(targetChatName ? { targetChatName } : {}),
      };
    }
    if (pending.state === 'sent' && targetChatName) {
      return { kind: 'accepted', id: input.id, pendingState: 'sent', targetChatName };
    }
    return {
      kind: 'error',
      status: 409,
      error:
        pending.state === 'failed'
          ? String(pending.error ?? '').trim() || 'new-chat action failed'
          : 'new-chat action is no longer available',
    };
  }

  async function executeClaimed(input: {
    droneId: string;
    sourceChatName: string;
    pending: PendingPrompt;
  }): Promise<{ targetChatName: string }> {
    const actionId = String(input.pending.id ?? '').trim();
    const action = input.pending.action;
    if (!actionId || !isSendInNewChatQueueAction(action)) {
      throw new Error('invalid send-in-new-chat queue action');
    }
    const registry: any = await deps.loadRegistry();
    const drone = registry?.drones?.[input.droneId] ?? null;
    if (!drone) throw new Error(`unknown drone: ${input.droneId}`);
    const currentSource = deps.readChatFromStore({
      droneId: input.droneId,
      chatName: input.sourceChatName,
    });
    const sourceChatId =
      String(action.sourceChatId ?? '').trim() || String(currentSource.chat?.id ?? '').trim();
    const resolvedAction: SendInNewChatQueueAction = {
      ...action,
      sourceChatName: input.sourceChatName,
      ...(sourceChatId ? { sourceChatId } : {}),
    };

    let targetChatName =
      findOwnedTarget(input.droneId, actionId, sourceChatId, input.sourceChatName) ||
      String(action.targetChatName ?? '').trim();
    if (
      targetChatName !== String(action.targetChatName ?? '').trim() ||
      resolvedAction.sourceChatName !== action.sourceChatName ||
      resolvedAction.sourceChatId !== action.sourceChatId
    ) {
      await deps.updatePendingPrompt({
        droneId: input.droneId,
        chatName: input.sourceChatName,
        id: actionId,
        patch: { action: { ...resolvedAction, ...(targetChatName ? { targetChatName } : {}) } },
      });
    }
    let created: CreateDroneChatResult | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!targetChatName) {
        targetChatName = allocateUntitledChatName(
          deps.listChatsFromStore({ droneId: input.droneId }).chats,
        );
        const nextAction: SendInNewChatQueueAction = { ...resolvedAction, targetChatName };
        await deps.updatePendingPrompt({
          droneId: input.droneId,
          chatName: input.sourceChatName,
          id: actionId,
          patch: { action: nextAction },
        });
      }
      try {
        created = await deps.createDroneChat({
          droneId: input.droneId,
          droneEntry: drone,
          chatName: targetChatName,
          creationMode: 'copy-config',
          sourceChatName: input.sourceChatName,
          queuedOrigin: {
            sourceChatName: input.sourceChatName,
            ...(sourceChatId ? { sourceChatId } : {}),
            actionId,
          },
        });
        break;
      } catch (error: any) {
        if (!/already exists/i.test(String(error?.message ?? error))) throw error;
        targetChatName = '';
      }
    }
    if (!created || !targetChatName) throw new Error('could not allocate a new chat');

    const reviewPromptId = targetPromptId(actionId);
    const existingTargetPrompt = deps.readPendingPrompt({
      droneId: input.droneId,
      chatName: targetChatName,
      id: reviewPromptId,
    });
    if (existingTargetPrompt?.state === 'failed') {
      // Enqueue is idempotent by prompt id. Re-open an interrupted attempt so
      // native drains can claim the retained row instead of silently skipping it.
      await deps.updatePendingPrompt({
        droneId: input.droneId,
        chatName: targetChatName,
        id: reviewPromptId,
        patch: { state: 'queued', error: '' },
      });
    }
    if (!existingTargetPrompt || existingTargetPrompt.state === 'failed') {
      const submitted = await deps.createOrEnqueuePrompt({
        id: reviewPromptId,
        droneId: input.droneId,
        chatName: targetChatName,
        prompt: input.pending.prompt,
        attachmentRefs: deps.normalizeChatImageAttachmentRefs(input.pending.attachments),
        submittedAt: input.pending.at,
        deliveryMode: 'asap',
        submissionSource: 'queue-action',
      });
      if (submitted.kind === 'error') throw new Error(submitted.error);
      if (submitted.pendingState === 'failed') {
        throw new Error('failed to send message in new chat');
      }
    }

    await deps.updatePendingPrompt({
      droneId: input.droneId,
      chatName: input.sourceChatName,
      id: actionId,
      patch: { state: 'sent', action: { ...resolvedAction, targetChatName } },
    });
    const createdAt = String(created.chat?.createdAt ?? '').trim();
    if (createdAt) {
      void deps.autoRenameGeneratedChatFromFirstPrompt({
        droneId: input.droneId,
        chatName: targetChatName,
        prompt: input.pending.prompt,
        expectedCreatedAt: createdAt,
      });
    }
    deps.notifyDroneChatWrite?.(input.droneId, targetChatName);
    deps.enqueuePendingPromptPump(input.droneId, input.sourceChatName);
    return { targetChatName };
  }

  async function failOrRetry(input: {
    droneId: string;
    sourceChatName: string;
    actionId: string;
    error: unknown;
  }): Promise<void> {
    const message = String(
      (input.error as any)?.message ?? input.error ?? 'New chat action failed',
    );
    const retry = await deps.retryPendingPrompt({
      droneId: input.droneId,
      chatName: input.sourceChatName,
      id: input.actionId,
      error: message,
    });
    if (retry.disposition === 'retry') {
      const nextMs = retry.nextAttemptAt ? Date.parse(retry.nextAttemptAt) : NaN;
      deps.schedulePendingPromptPumpRetry(
        input.droneId,
        input.sourceChatName,
        Number.isFinite(nextMs) ? Math.max(1_000, nextMs - Date.now()) : undefined,
      );
    } else if (retry.disposition === 'terminal') {
      deps.enqueuePendingPromptPump(input.droneId, input.sourceChatName);
    }
  }

  async function createOrEnqueue(opts: {
    id?: string;
    droneId: string;
    chatName: string;
    prompt: string;
    attachments?: ChatImageAttachment[];
    cwd?: string | null;
    submittedAt?: string | null;
  }): Promise<CreateOrEnqueueNewChatActionResult> {
    const droneId = deps.normalizeDroneIdentity(opts.droneId);
    const chatName = deps.normalizeChatName(opts.chatName || 'default');
    const prompt = String(opts.prompt ?? '').trim();
    const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
    const id = String(opts.id ?? '').trim() || crypto.randomBytes(9).toString('hex');
    if (!droneId) return { kind: 'error', status: 400, error: 'missing drone id' };
    if (!deps.isSafePromptId(id)) {
      return { kind: 'error', status: 400, error: 'invalid promptId' };
    }
    if (!prompt && attachments.length === 0) {
      return { kind: 'error', status: 400, error: 'missing prompt' };
    }

    try {
      // Prompt ids are request idempotency keys. Resolve a prior request before
      // staging attachments so retries cannot overwrite an existing queue row.
      const existing = await existingSubmissionResult({ droneId, chatName, id });
      if (existing) return existing;
      const { d, chat } = await deps.getChatEntry({ droneId, chatName });
      const at = deps.normalizeSubmittedAtIso(opts.submittedAt);
      const attachmentRefs = await stageAttachments({
        droneId,
        chatName,
        promptId: id,
        drone: d,
        cwd: opts.cwd ?? null,
        attachments,
      });
      const action: SendInNewChatQueueAction = {
        type: 'send-in-new-chat',
        sourceChatName: chatName,
        ...(String(chat?.id ?? '').trim() ? { sourceChatId: String(chat.id).trim() } : {}),
      };
      await deps.pushPendingPrompt({
        droneId,
        chatName,
        pending: {
          id,
          at,
          prompt: prompt || deps.attachmentOnlyPromptLabel(attachments),
          cwd: opts.cwd ?? null,
          ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
          deliveryMode: 'queue',
          action,
          state: 'queued',
          updatedAt: at,
        },
      });
      // Decide only after the action has a durable sequence. Work inserted
      // before it must block immediate execution; work inserted after it must
      // stay behind the action barrier.
      const [{ chat: currentChat }, currentPending] = await Promise.all([
        deps.getChatEntry({ droneId, chatName }),
        deps.readPendingPrompts({ droneId, chatName }),
      ]);
      const actionIndex = currentPending.findIndex(
        (pending) => String(pending?.id ?? '').trim() === id,
      );
      const priorPending =
        actionIndex >= 0
          ? currentPending.slice(0, actionIndex)
          : currentPending.filter((pending) => String(pending?.id ?? '').trim() !== id);
      const defer = deps.hasPendingWork(currentChat, priorPending);
      if (defer) {
        deps.enqueuePendingPromptPump(droneId, chatName);
        return { kind: 'accepted', id, pendingState: 'queued' };
      }

      const acquired = await deps.claimQueuedPendingPromptForSending({ droneId, chatName, id });
      if (!acquired) {
        return (
          (await existingSubmissionResult({ droneId, chatName, id })) ?? {
            kind: 'error',
            status: 409,
            error: 'new-chat action is no longer available',
          }
        );
      }
      const claimed = deps.readPendingPrompt({ droneId, chatName, id });
      if (!claimed) throw new Error('new chat action was not persisted');
      const result = await executeClaimed({
        droneId,
        sourceChatName: chatName,
        pending: claimed,
      });
      return {
        kind: 'accepted',
        id,
        pendingState: 'sent',
        targetChatName: result.targetChatName,
      };
    } catch (error: any) {
      const current = deps.readPendingPrompt({ droneId, chatName, id });
      if (current?.state === 'sending') {
        await failOrRetry({ droneId, sourceChatName: chatName, actionId: id, error });
        const retried = deps.readPendingPrompt({ droneId, chatName, id });
        if (retried?.state === 'queued') {
          return { kind: 'accepted', id, pendingState: 'queued' };
        }
      }
      return { kind: 'error', status: 500, error: error?.message ?? String(error) };
    }
  }

  async function promote(opts: {
    droneId: string;
    chatName: string;
    actionId: string;
  }): Promise<PromoteQueuedNewChatActionResult> {
    const droneId = deps.normalizeDroneIdentity(opts.droneId);
    const chatName = deps.normalizeChatName(opts.chatName || 'default');
    const actionId = String(opts.actionId ?? '').trim();
    if (!droneId || !deps.isSafePromptId(actionId)) {
      return { kind: 'error', status: 400, error: 'invalid queued action' };
    }
    const before = deps.readPendingPrompt({ droneId, chatName, id: actionId });
    if (!before || !isSendInNewChatQueueAction(before.action)) {
      return { kind: 'error', status: 404, error: `unknown queued new-chat action: ${actionId}` };
    }
    const claimed = await deps.claimQueuedPendingPromptForPromotion({
      droneId,
      chatName,
      id: actionId,
    });
    if (!claimed) {
      const current = deps.readPendingPrompt({ droneId, chatName, id: actionId });
      const targetChatName = current
        ? await resolveRecordedTarget({ droneId, chatName, pending: current })
        : '';
      if (current?.state === 'sent' && targetChatName) {
        return { kind: 'created', targetChatName };
      }
      if (current?.state === 'sending') {
        return { kind: 'executing', ...(targetChatName ? { targetChatName } : {}) };
      }
      return { kind: 'error', status: 409, error: 'queued action is no longer available' };
    }
    try {
      const result = await executeClaimed({
        droneId,
        sourceChatName: chatName,
        pending: claimed,
      });
      return { kind: 'created', targetChatName: result.targetChatName };
    } catch (error: any) {
      await failOrRetry({ droneId, sourceChatName: chatName, actionId, error });
      return { kind: 'error', status: 500, error: error?.message ?? String(error) };
    }
  }

  return { createOrEnqueue, executeClaimed, failOrRetry, promote };
}
