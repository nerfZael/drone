import type { ChatSendPayload } from '../chat';
import type { ChatImageAttachmentRef, PendingPrompt } from '../types';
import { attachmentRefsFromPayload, normalizeChatImageAttachmentPayloads } from './chat-attachment-payloads';
import { makeId } from './helpers';
import {
  isActivePendingPrompt,
  mergeOptimisticPendingPrompts,
  normalizePendingPromptState as normalizeSharedPendingPromptState,
  replaceOptimisticPendingPromptId,
} from '@drone/assistant-chat';

function attachmentOnlyPromptText(attachmentPayloads: ReturnType<typeof normalizeChatImageAttachmentPayloads>): string {
  if (attachmentPayloads.length === 0) return '';
  const imageCount = attachmentPayloads.filter((item) => item.mime.startsWith('image/')).length;
  const textCount = attachmentPayloads.filter((item) => item.mime === 'text/plain').length;
  if (imageCount === attachmentPayloads.length) {
    return imageCount === 1 ? '[image attachment]' : `[${imageCount} image attachments]`;
  }
  if (textCount === attachmentPayloads.length) {
    return textCount === 1 ? '[text attachment]' : `[${textCount} text attachments]`;
  }
  return attachmentPayloads.length === 1 ? '[attachment]' : `[${attachmentPayloads.length} attachments]`;
}

function pickPreferredArray<T>(primaryRaw: T[] | undefined, fallbackRaw: T[] | undefined): T[] | undefined {
  const primary = Array.isArray(primaryRaw) ? primaryRaw : [];
  if (primary.length > 0) return primary;
  const fallback = Array.isArray(fallbackRaw) ? fallbackRaw : [];
  return fallback.length > 0 ? fallback : undefined;
}

function mergeAttachmentRefs(
  primaryRaw: ChatImageAttachmentRef[] | undefined,
  fallbackRaw: ChatImageAttachmentRef[] | undefined,
): ChatImageAttachmentRef[] | undefined {
  const primary = Array.isArray(primaryRaw) ? primaryRaw : [];
  const fallback = Array.isArray(fallbackRaw) ? fallbackRaw : [];
  if (primary.length === 0) return fallback.length > 0 ? fallback : undefined;
  if (fallback.length === 0) return primary;
  const out: ChatImageAttachmentRef[] = [];
  const maxLen = Math.max(primary.length, fallback.length);
  for (let index = 0; index < maxLen; index += 1) {
    const item = primary[index];
    const backup = fallback[index];
    if (!item) {
      if (backup) out.push(backup);
      continue;
    }
    if (!backup) {
      out.push(item);
      continue;
    }
    const sameAttachment =
      item.name === backup.name &&
      item.mime === backup.mime &&
      item.size === backup.size;
    if (!sameAttachment) {
      out.push(item);
      continue;
    }
    out.push({
      ...backup,
      ...item,
      ...(item.path ? { path: item.path } : backup.path ? { path: backup.path } : {}),
      ...(item.relativePath ? { relativePath: item.relativePath } : backup.relativePath ? { relativePath: backup.relativePath } : {}),
      ...(item.previewDataUrl
        ? { previewDataUrl: item.previewDataUrl }
        : backup.previewDataUrl
          ? { previewDataUrl: backup.previewDataUrl }
          : {}),
    });
  }
  return out;
}

export function normalizePendingPromptState(
  raw: unknown,
  fallback: PendingPrompt['state'] = 'sending',
): PendingPrompt['state'] {
  return normalizeSharedPendingPromptState(raw, fallback);
}

export function optimisticPendingPromptState(
  isChatResponding: boolean,
): Extract<PendingPrompt['state'], 'queued' | 'sending'> {
  return isChatResponding ? 'queued' : 'sending';
}

export function pendingPromptShowsWorkingState(
  item: Pick<PendingPrompt, 'state'> | null | undefined,
): boolean {
  return isActivePendingPrompt(item);
}

export function selectedChatRespondingStatus(args: {
  includeDroneBusy: boolean;
  droneBusy: boolean;
  selectedIsResponding: boolean;
}): boolean {
  return args.includeDroneBusy
    ? args.droneBusy || args.selectedIsResponding
    : args.selectedIsResponding;
}

export function createOptimisticPendingPrompt(args: {
  prompt: string;
  attachments?: ChatSendPayload['attachments'];
  id?: string | null;
  at?: string | null;
  state?: unknown;
}): PendingPrompt | null {
  const attachmentPayloads = normalizeChatImageAttachmentPayloads(args.attachments);
  const prompt = pendingPromptPreviewText(args.prompt, attachmentPayloads);
  if (!prompt && attachmentPayloads.length === 0) return null;
  const id = String(args.id ?? '').trim() || `optimistic-${makeId()}`;
  const at = String(args.at ?? '').trim() || new Date().toISOString();
  return {
    id,
    at,
    prompt,
    ...(attachmentPayloads.length > 0
      ? {
          attachments: attachmentRefsFromPayload(attachmentPayloads),
          attachmentPayloads,
        }
      : {}),
    state: normalizePendingPromptState(args.state),
  };
}

export function pendingPromptPreviewText(
  promptRaw: string,
  attachmentsRaw?: ChatSendPayload['attachments'] | ReturnType<typeof normalizeChatImageAttachmentPayloads>,
): string {
  const prompt = String(promptRaw ?? '').trim();
  if (prompt) return prompt;
  const attachmentPayloads = normalizeChatImageAttachmentPayloads(attachmentsRaw);
  return attachmentOnlyPromptText(attachmentPayloads);
}

export function appendOptimisticPendingPrompt(prev: PendingPrompt[], item: PendingPrompt | null): PendingPrompt[] {
  if (!item) return prev;
  if (prev.some((entry) => entry.id === item.id)) return prev;
  return [...prev, item];
}

export function mergeDesktopOptimisticPendingPrompts(args: {
  serverPrompts: PendingPrompt[];
  optimisticPrompts: PendingPrompt[];
  nowMs: number;
}): PendingPrompt[] {
  return mergeOptimisticPendingPrompts({
    serverPrompts: args.serverPrompts,
    optimisticPrompts: args.optimisticPrompts,
    nowMs: args.nowMs,
    mergeMatched: ({ optimisticPrompt, serverPrompt, state }) =>
      mergeDesktopPendingPromptRecords(optimisticPrompt, serverPrompt, state),
  });
}

export function reconcileOptimisticPendingPrompt(
  prev: PendingPrompt[],
  args: {
    optimisticId: string;
    confirmedId?: string | null;
    state?: unknown;
    error?: string | null;
  },
): PendingPrompt[] {
  const optimisticId = String(args.optimisticId ?? '').trim();
  if (!optimisticId) return prev;
  const confirmedId = String(args.confirmedId ?? '').trim();
  const targetId = confirmedId || optimisticId;
  const optimisticIndex = prev.findIndex((item) => item?.id === optimisticId);
  const duplicateIndex = prev.findIndex((item, index) => index !== optimisticIndex && item?.id === targetId);
  if (optimisticIndex < 0 && duplicateIndex < 0) return prev;

  const now = new Date().toISOString();
  const optimisticItem = optimisticIndex >= 0 ? prev[optimisticIndex] : null;
  const duplicateItem = duplicateIndex >= 0 ? prev[duplicateIndex] : null;
  const base = duplicateItem ?? optimisticItem;
  if (!base) return prev;

  const nextState = normalizePendingPromptState(args.state, base.state);
  const replaced = replaceOptimisticPendingPromptId(prev, optimisticId, targetId);
  const replacedOptimisticItem =
    optimisticIndex >= 0 ? replaced[optimisticIndex] : null;
  const optimisticForMerge: PendingPrompt = {
    ...(replacedOptimisticItem ?? base),
    id: targetId,
    state: nextState,
    updatedAt: now,
  };
  const serverForMerge = duplicateItem
    ? [{ ...duplicateItem, id: targetId, state: nextState, updatedAt: now }]
    : [];
  const nextItem = mergeDesktopOptimisticPendingPrompts({
    serverPrompts: serverForMerge,
    optimisticPrompts: [optimisticForMerge],
    nowMs: Date.parse(now),
  })[0];
  if (!nextItem) return prev;

  const error = String(args.error ?? '').trim();
  if (error) nextItem.error = error;
  else if (nextState !== 'failed') delete nextItem.error;

  const next: PendingPrompt[] = [];
  for (let index = 0; index < prev.length; index += 1) {
    if (index === optimisticIndex || index === duplicateIndex) continue;
    next.push(prev[index]);
  }
  next.push(nextItem);
  return next;
}

function mergeDesktopPendingPromptRecords(
  optimisticPrompt: PendingPrompt,
  serverPrompt: PendingPrompt,
  state: PendingPrompt['state'],
): PendingPrompt {
  const next: PendingPrompt = {
    ...optimisticPrompt,
    ...serverPrompt,
    state,
  };
  const attachments = mergeAttachmentRefs(
    serverPrompt.attachments,
    optimisticPrompt.attachments,
  );
  const attachmentPayloads = pickPreferredArray(
    optimisticPrompt.attachmentPayloads,
    serverPrompt.attachmentPayloads,
  );
  if (attachments) next.attachments = attachments;
  else delete next.attachments;
  if (attachmentPayloads) next.attachmentPayloads = attachmentPayloads;
  else delete next.attachmentPayloads;
  return next;
}
