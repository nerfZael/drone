import type { ChatSendPayload } from '../chat';
import type { PendingPrompt } from '../types';
import type { DraftChatState } from './app-types';
import { attachmentRefsFromPayload, normalizeChatImageAttachmentPayloads } from './chat-attachment-payloads';
import { makeId } from './helpers';

export function sameDraftAttachmentList(aRaw: PendingPrompt['attachments'], bRaw: PendingPrompt['attachments']): boolean {
  const a = Array.isArray(aRaw) ? aRaw : [];
  const b = Array.isArray(bRaw) ? bRaw : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.name !== right.name || left.mime !== right.mime || left.size !== right.size) return false;
  }
  return true;
}

export function createDraftQueuedPrompt(payload: ChatSendPayload): DraftChatState['queuedPrompts'][number] | null {
  const prompt = String(payload?.prompt ?? '').trim();
  const attachmentPayloads = normalizeChatImageAttachmentPayloads(payload?.attachments);
  if (!prompt && attachmentPayloads.length === 0) return null;
  return {
    id: `draft-queued-${makeId()}`,
    at: new Date().toISOString(),
    prompt,
    state: 'queued',
    ...(attachmentPayloads.length > 0 ? { attachments: attachmentRefsFromPayload(attachmentPayloads), attachmentPayloads } : {}),
  };
}

export function visibleDraftQueuedPrompts(args: {
  pendingPrompt: PendingPrompt | null;
  localQueuedPrompts: DraftChatState['queuedPrompts'];
  stagedQueuedPrompts: DraftChatState['queuedPrompts'];
}): DraftChatState['queuedPrompts'] {
  const pending = args.pendingPrompt;
  const merged = [
    ...(Array.isArray(args.localQueuedPrompts) ? args.localQueuedPrompts : []),
    ...(Array.isArray(args.stagedQueuedPrompts) ? args.stagedQueuedPrompts : []),
  ];
  if (!pending) return merged;
  let skippedMirror = false;
  return merged.filter((item) => {
    if (skippedMirror) return true;
    if (String(item.prompt ?? '') !== String(pending.prompt ?? '')) return true;
    if (!sameDraftAttachmentList(item.attachments, pending.attachments)) return true;
    skippedMirror = true;
    return false;
  });
}
