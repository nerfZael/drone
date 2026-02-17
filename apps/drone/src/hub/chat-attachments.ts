import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { dvmCopyToContainer, dvmExec } from '../host/dvm';
import { bashQuote, normalizeContainerPath } from './hub-format';

const CHAT_ATTACHMENTS_MAX_IMAGES = 8;
const CHAT_ATTACHMENTS_MAX_BYTES_EACH = 6 * 1024 * 1024;
const CHAT_ATTACHMENTS_MAX_BYTES_TOTAL = 20 * 1024 * 1024;

type ChatImageAttachmentInput = {
  name?: unknown;
  mime?: unknown;
  size?: unknown;
  dataBase64?: unknown;
};

export type ChatImageAttachment = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
  fileName: string;
};

function base64DecodedByteLength(b64Raw: string): number {
  const b64 = String(b64Raw ?? '').replace(/\s+/g, '');
  if (!b64) return 0;
  const len = b64.length;
  // Each 4 chars -> 3 bytes, minus padding.
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  const n = Math.floor((len * 3) / 4) - padding;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function extForImageMime(mimeRaw: string): string {
  const mime = String(mimeRaw ?? '').trim().toLowerCase();
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpg':
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/avif':
      return 'avif';
    case 'image/tif':
    case 'image/tiff':
      return 'tiff';
    default:
      return 'png';
  }
}

function sanitizeAttachmentFileName(nameRaw: string, fallbackBase: string, ext: string): string {
  const base = path.posix.basename(String(nameRaw ?? '').trim()).replace(/[\0\r\n\t]/g, '');
  const withoutPath = base.replace(/[\/\\]+/g, '');
  const safeBase = withoutPath
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  const baseName = safeBase || fallbackBase;
  const lower = baseName.toLowerCase();
  const hasExt = /\.[a-z0-9]{1,6}$/.test(lower);
  const file = hasExt ? baseName : `${baseName}.${ext || 'png'}`;
  // Final guard: no leading dots, no empties.
  const cleaned = file.replace(/^\.+/g, '').slice(0, 96);
  return cleaned || `${fallbackBase}.${ext || 'png'}`;
}

export function normalizeChatImageAttachments(raw: unknown): ChatImageAttachment[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be an array');

  const out: ChatImageAttachment[] = [];
  let total = 0;

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as ChatImageAttachmentInput;
    if (!item || typeof item !== 'object') continue;

    const mime = String(item.mime ?? '').trim().toLowerCase();
    if (!mime.startsWith('image/')) throw new Error('only image attachments are supported');

    const dataBase64 = String(item.dataBase64 ?? '').replace(/\s+/g, '');
    if (!dataBase64) throw new Error('attachment is missing dataBase64');

    // Basic sanity: avoid absurd payloads (and obvious non-base64).
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64.slice(0, Math.min(4096, dataBase64.length)))) {
      throw new Error('attachment dataBase64 looks invalid');
    }

    const sizeFromB64 = base64DecodedByteLength(dataBase64);
    const declared = Number(item.size);
    const size = Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : sizeFromB64;
    const effectiveSize = sizeFromB64 > 0 ? sizeFromB64 : size;
    if (!effectiveSize || effectiveSize <= 0) throw new Error('attachment size is invalid');
    if (effectiveSize > CHAT_ATTACHMENTS_MAX_BYTES_EACH) {
      throw new Error(`attachment too large (${effectiveSize} bytes, max ${CHAT_ATTACHMENTS_MAX_BYTES_EACH})`);
    }
    if (out.length >= CHAT_ATTACHMENTS_MAX_IMAGES) {
      throw new Error(`too many attachments (max ${CHAT_ATTACHMENTS_MAX_IMAGES})`);
    }
    total += effectiveSize;
    if (total > CHAT_ATTACHMENTS_MAX_BYTES_TOTAL) {
      throw new Error(`attachments too large in total (max ${CHAT_ATTACHMENTS_MAX_BYTES_TOTAL} bytes)`);
    }

    const ext = extForImageMime(mime);
    const fallbackBase = `image-${out.length + 1}`;
    const name = String(item.name ?? '').trim() || `${fallbackBase}.${ext}`;
    const fileName = sanitizeAttachmentFileName(name, fallbackBase, ext);

    out.push({ name, mime, size: effectiveSize, dataBase64, fileName });
  }

  return out;
}

export function promptWithImageAttachments(
  promptRaw: string,
  files: Array<{ name: string; mime: string; size: number; path: string }>
): string {
  const prompt = String(promptRaw ?? '').trim();
  if (!files || files.length === 0) return prompt;
  const header = files.length === 1 ? 'Image attachment:' : 'Image attachments:';
  const lines = files.map((f, i) => `${i + 1}. ${f.name} (${f.mime}, ${f.size} bytes): ${f.path}`);
  const block = `${header}\n${lines.join('\n')}`;
  return prompt ? `${prompt}\n\n${block}` : block;
}

export async function copyChatAttachmentsToContainer(opts: {
  containerName: string;
  containerDir: string;
  attachments: ChatImageAttachment[];
}): Promise<void> {
  const list = Array.isArray(opts.attachments) ? opts.attachments : [];
  if (list.length === 0) return;

  const containerDir = normalizeContainerPath(opts.containerDir);
  if (!containerDir || containerDir === '/') throw new Error('invalid attachments directory');

  // Write files locally, then `dvm copy` them into the container.
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `drone-hub-attachments-${process.pid}-`));
  try {
    for (const a of list) {
      const filePath = path.join(tmpRoot, a.fileName);
      const buf = Buffer.from(String(a.dataBase64 ?? ''), 'base64');
      if (!buf || buf.length === 0) throw new Error('attachment decode failed');
      await fs.writeFile(filePath, buf, { mode: 0o600 });
    }

    // Ensure destination directory exists and is private-ish.
    await dvmExec(opts.containerName, 'bash', [
      '-lc',
      `set -euo pipefail; umask 077; mkdir -p ${bashQuote(containerDir)}; chmod 700 ${bashQuote(containerDir)} 2>/dev/null || true`,
    ]);

    await dvmCopyToContainer(opts.containerName, tmpRoot, containerDir);

    // Best-effort harden perms (some images run as root; chmod may fail under weird FS).
    await dvmExec(opts.containerName, 'bash', [
      '-lc',
      `chmod 700 ${bashQuote(containerDir)} 2>/dev/null || true; chmod 600 ${bashQuote(containerDir)}/* 2>/dev/null || true`,
    ]).catch(() => null);
  } finally {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

