import {
  CHAT_ATTACHMENT_POLICY,
  normalizeChatAttachmentMime,
} from '@drone/assistant-chat';

export const CHAT_INPUT_MAX_IMAGES = CHAT_ATTACHMENT_POLICY.maxCount;
export const CHAT_INPUT_MAX_BYTES_EACH = CHAT_ATTACHMENT_POLICY.maxBytesEach;
export const CHAT_INPUT_MAX_BYTES_TOTAL = CHAT_ATTACHMENT_POLICY.maxBytesTotal;
export const CHAT_INPUT_PASTE_TEXT_AS_ATTACHMENT_MIN_CHARS = 50_000;

export type DraftImageAttachment = {
  kind: 'image';
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  previewUrl: string;
  disposition?: 'artifact' | 'prompt';
};

export type DraftTextAttachment = {
  kind: 'text';
  id: string;
  text: string;
  name: string;
  mime: 'text/plain';
  size: number;
  disposition?: 'artifact' | 'prompt';
};

export type DraftFileAttachment = {
  kind: 'file';
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  disposition?: 'artifact' | 'prompt';
};

export type DraftChatAttachment = DraftImageAttachment | DraftTextAttachment | DraftFileAttachment;

export type EncodedDraftChatAttachment = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
  disposition?: 'artifact' | 'prompt';
};

export function makeDraftImageAttachmentId(): string {
  // Non-crypto id; only used for React keys.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isLikelyImageFile(f: File): boolean {
  const mime = String((f as any)?.type ?? '').trim().toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = String((f as any)?.name ?? '').trim().toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|tiff?)$/.test(name);
}

export function mimeForChatAttachmentFile(file: File): string {
  return normalizeChatAttachmentMime(
    (file as any)?.type,
    (file as any)?.name,
  );
}

function fileIdentity(file: File): string {
  return [
    String((file as any)?.name ?? ''),
    String((file as any)?.type ?? ''),
    String((file as any)?.size ?? ''),
    String((file as any)?.lastModified ?? ''),
  ].join('\0');
}

export function imageFilesFromClipboardData(data: Pick<DataTransfer, 'files' | 'items'> | null | undefined): File[] {
  const fileList = Array.from(data?.files ?? []);
  // Browsers often expose the same pasted image on both `files` and `items`; merging both
  // duplicates attachments (and `lastModified` may differ between wrappers). Prefer the
  // FileList when it already contains images; fall back to `items` when it does not.
  const hasImageInFiles = fileList.some((f) => isLikelyImageFile(f));
  if (hasImageInFiles) {
    const out: File[] = [];
    const seen = new Set<string>();
    for (const file of fileList) {
      if (!isLikelyImageFile(file)) continue;
      const key = fileIdentity(file);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(file);
    }
    return out;
  }

  const out: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null | undefined) => {
    if (!file || !isLikelyImageFile(file)) return;
    const key = fileIdentity(file);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (const item of Array.from(data?.items ?? [])) {
    if (!item || item.kind !== 'file') continue;
    add(item.getAsFile());
  }
  return out;
}

export function filesFromClipboardData(data: Pick<DataTransfer, 'files' | 'items'> | null | undefined): File[] {
  const fileList = Array.from(data?.files ?? []);
  if (fileList.length > 0) {
    const out: File[] = [];
    const seen = new Set<string>();
    for (const file of fileList) {
      const key = fileIdentity(file);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(file);
    }
    return out;
  }

  const out: File[] = [];
  const seen = new Set<string>();
  for (const item of Array.from(data?.items ?? [])) {
    if (!item || item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    const key = fileIdentity(file);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

export function formatBytes(n: number): string {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = num;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? String(Math.floor(v)) : v.toFixed(v >= 10 ? 1 : 2);
  return `${rounded} ${units[i]}`;
}

export async function fileToBase64(file: File): Promise<string> {
  return await blobToBase64(file);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('Failed reading file'));
    r.onload = () => {
      const res = String(r.result ?? '');
      // data:<mime>;base64,<data>
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.readAsDataURL(blob);
  });
}

export async function encodeDraftChatAttachments(
  attachments: readonly DraftChatAttachment[],
): Promise<EncodedDraftChatAttachment[]> {
  return await Promise.all(
    attachments.map(async (attachment) => ({
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      dataBase64:
        attachment.kind === 'text'
          ? await blobToBase64(new Blob([attachment.text], { type: attachment.mime }))
          : await fileToBase64(attachment.file),
      disposition: attachment.disposition,
    })),
  );
}

export function textByteLength(text: string): number {
  return new TextEncoder().encode(String(text ?? '')).length;
}

export function revokeDraftImagePreviewUrls(items: DraftChatAttachment[]): void {
  for (const item of items) {
    if (item.kind !== 'image') continue;
    try {
      URL.revokeObjectURL(item.previewUrl);
    } catch {
      // ignore
    }
  }
}
