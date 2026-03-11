import type { ChatImageAttachmentPayload } from '../chat';
import type { ChatImageAttachmentRef } from '../types';

export function normalizeChatImageAttachmentPayloads(raw: unknown): ChatImageAttachmentPayload[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ChatImageAttachmentPayload[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as any).name ?? '').trim();
    const mime = String((item as any).mime ?? '').trim().toLowerCase();
    const sizeNum = Number((item as any).size ?? 0);
    const dataBase64 = String((item as any).dataBase64 ?? '').trim();
    if (!name || !mime.startsWith('image/') || !Number.isFinite(sizeNum) || sizeNum <= 0 || !dataBase64) continue;
    out.push({
      name,
      mime,
      size: Math.floor(sizeNum),
      dataBase64,
    });
  }
  return out.slice(0, 8);
}

export function attachmentRefsFromPayload(raw: unknown): ChatImageAttachmentRef[] {
  return normalizeChatImageAttachmentPayloads(raw).map((item) => ({
    name: item.name,
    mime: item.mime,
    size: item.size,
    previewDataUrl: `data:${item.mime};base64,${item.dataBase64}`,
  }));
}
