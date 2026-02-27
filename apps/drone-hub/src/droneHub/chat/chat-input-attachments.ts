export const CHAT_INPUT_MAX_IMAGES = 8;
export const CHAT_INPUT_MAX_BYTES_EACH = 6 * 1024 * 1024;
export const CHAT_INPUT_MAX_BYTES_TOTAL = 20 * 1024 * 1024;

export type DraftImageAttachment = {
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  previewUrl: string;
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
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('Failed reading file'));
    r.onload = () => {
      const res = String(r.result ?? '');
      // data:<mime>;base64,<data>
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.readAsDataURL(file);
  });
}

export function revokeDraftImagePreviewUrls(items: DraftImageAttachment[]): void {
  for (const item of items) {
    try {
      URL.revokeObjectURL(item.previewUrl);
    } catch {
      // ignore
    }
  }
}
