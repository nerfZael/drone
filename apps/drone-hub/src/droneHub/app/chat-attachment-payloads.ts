import {
  chatAttachmentKind,
  normalizeChatAttachmentMime,
  validateChatAttachments,
} from '@drone/assistant-chat';
import type { ChatImageAttachmentPayload } from '../chat';
import type { ChatImageAttachmentRef } from '../types';

function isSupportedAttachmentMime(mimeRaw: unknown): boolean {
  const kind = chatAttachmentKind({ mime: normalizeChatAttachmentMime(mimeRaw) });
  return kind === 'image' || kind === 'text';
}

function isImageAttachmentMime(mimeRaw: unknown): boolean {
  return chatAttachmentKind({ mime: normalizeChatAttachmentMime(mimeRaw) }) === 'image';
}

export function normalizeChatImageAttachmentPayloads(raw: unknown): ChatImageAttachmentPayload[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ChatImageAttachmentPayload[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as any).name ?? '').trim();
    const mime = normalizeChatAttachmentMime((item as any).mime, name);
    const sizeNum = Number((item as any).size ?? 0);
    const dataBase64 = String((item as any).dataBase64 ?? '').trim();
    if (!name || !isSupportedAttachmentMime(mime) || !Number.isFinite(sizeNum) || sizeNum <= 0 || !dataBase64) continue;
    const policy = validateChatAttachments([
      ...out.map(({ name, mime, size }) => ({ name, mime, size })),
      { name, mime, size: Math.floor(sizeNum) },
    ]);
    if (!policy.ok) {
      if (policy.issue.code === 'too_many_attachments') break;
      continue;
    }
    out.push({
      name,
      mime: policy.attachments[policy.attachments.length - 1]!.mime,
      size: Math.floor(sizeNum),
      dataBase64,
    });
  }
  return out;
}

export function attachmentRefsFromPayload(raw: unknown): ChatImageAttachmentRef[] {
  return normalizeChatImageAttachmentPayloads(raw).map((item) => ({
    name: item.name,
    mime: item.mime,
    size: item.size,
    ...(isImageAttachmentMime(item.mime) ? { previewDataUrl: `data:${item.mime};base64,${item.dataBase64}` } : {}),
  }));
}
