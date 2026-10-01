import crypto from 'node:crypto';
import { statSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  CHAT_ATTACHMENT_POLICY,
  chatAttachmentKind,
  isValidChatAttachmentMime,
  normalizeChatAttachmentMime,
  promptWithChatAttachmentContext,
  validateChatAttachments,
} from '@drone/assistant-chat';

import { dvmCopyFromContainer, dvmCopyToContainer, dvmExec } from '../host/dvm';
import { bashQuote, normalizeContainerPath } from './hub-format';

type ChatImageAttachmentInput = {
  name?: unknown;
  mime?: unknown;
  size?: unknown;
  dataBase64?: unknown;
  uploadId?: unknown;
};

/** The bytes travel inline as `dataBase64`, or were uploaded ahead of the prompt and wait at `sourcePath` on the hub. */
export type ChatImageAttachment = {
  name: string;
  mime: string;
  size: number;
  fileName: string;
} & ({ dataBase64: string; sourcePath?: undefined } | { sourcePath: string; dataBase64?: undefined });

export type InlineChatImageAttachment = Extract<ChatImageAttachment, { dataBase64: string }>;

export type ChatImageAttachmentRef = {
  name: string;
  mime: string;
  size: number;
  fileName: string;
  path: string;
  relativePath: string;
};

const CHAT_ATTACHMENTS_DIR_NAME = '.drone-hub/attachments';

function isImageAttachmentMime(mimeRaw: string): boolean {
  return chatAttachmentKind({ mime: mimeRaw }) === 'image';
}

function isTextAttachmentMime(mimeRaw: string): boolean {
  return chatAttachmentKind({ mime: mimeRaw }) === 'text';
}

// Every attachment becomes a file in the drone's workspace that the agent is told about by path,
// so its type only decides how it is presented: images and text inline where the agent supports
// that, anything else as a file to open.
function isSupportedAttachmentMime(mimeRaw: string): boolean {
  return isValidChatAttachmentMime(mimeRaw);
}

function normalizeAttachmentsStorageRoot(storageRootRaw: string | undefined, cwd: string): string {
  const storageRoot = normalizeContainerPath(String(storageRootRaw ?? '').trim());
  if (storageRoot && storageRoot !== '/') return storageRoot;
  return normalizeContainerPath(path.posix.join(cwd, CHAT_ATTACHMENTS_DIR_NAME));
}

function sanitizePathSegment(raw: string, fallback: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

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

function extForAttachmentMime(mimeRaw: string): string {
  const mime = normalizeChatAttachmentMime(mimeRaw);
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
    case 'text/plain':
      return 'txt';
    default:
      return isImageAttachmentMime(mime) ? 'png' : isTextAttachmentMime(mime) ? 'txt' : 'bin';
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

function uniqueAttachmentFileName(fileNameRaw: string, usedNames: Set<string>): string {
  const fileName = String(fileNameRaw ?? '').trim() || 'attachment.bin';
  let candidate = fileName;
  let n = 2;
  const keyFor = (value: string) => value.toLowerCase();
  while (usedNames.has(keyFor(candidate))) {
    const parsed = path.posix.parse(fileName);
    const ext = parsed.ext || '';
    const suffix = `-${n}`;
    const maxBaseLength = Math.max(1, 96 - ext.length - suffix.length);
    const base =
      (parsed.name || 'attachment').slice(0, maxBaseLength).replace(/[-.]+$/g, '') || 'attachment';
    candidate = `${base}${suffix}${ext}`;
    n += 1;
  }
  usedNames.add(keyFor(candidate));
  return candidate;
}

/**
 * `allowUploads`: the caller copies attachments into the drone straight away, so plain files
 * uploaded ahead of the prompt (`uploadId`) are accepted and get the uploaded-file limits.
 * Everywhere else attachments must carry their bytes inline.
 */
export function normalizeChatImageAttachments(raw: unknown): InlineChatImageAttachment[];
export function normalizeChatImageAttachments(
  raw: unknown,
  opts: { allowUploads?: boolean },
): ChatImageAttachment[];
export function normalizeChatImageAttachments(
  raw: unknown,
  opts: { allowUploads?: boolean } = {},
): ChatImageAttachment[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('attachments must be an array');

  const out: ChatImageAttachment[] = [];
  const usedFileNames = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as ChatImageAttachmentInput;
    if (!item || typeof item !== 'object') continue;

    const mime = normalizeChatAttachmentMime(item.mime, item.name);
    if (!isSupportedAttachmentMime(mime))
      throw new Error('attachment type is not valid');

    let bytes: { dataBase64: string } | { sourcePath: string };
    let effectiveSize: number;
    const uploadId = String(item.uploadId ?? '').trim();
    if (uploadId) {
      if (!opts.allowUploads) throw new Error('uploaded attachments are not accepted here');
      if (chatAttachmentKind({ mime }) !== 'file') {
        throw new Error('only plain files can be uploaded ahead of a prompt');
      }
      const upload = resolveChatAttachmentUpload(uploadId);
      bytes = { sourcePath: upload.path };
      effectiveSize = upload.size;
    } else {
      const dataBase64 = String(item.dataBase64 ?? '').replace(/\s+/g, '');
      if (!dataBase64) throw new Error('attachment is missing dataBase64');

      // Basic sanity: avoid absurd payloads (and obvious non-base64).
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64.slice(0, Math.min(4096, dataBase64.length)))) {
        throw new Error('attachment dataBase64 looks invalid');
      }

      const sizeFromB64 = base64DecodedByteLength(dataBase64);
      const declared = Number(item.size);
      const size = Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : sizeFromB64;
      effectiveSize = sizeFromB64 > 0 ? sizeFromB64 : size;
      bytes = { dataBase64 };
    }
    if (!effectiveSize || effectiveSize <= 0) throw new Error('attachment size is invalid');
    const policy = validateChatAttachments([
      ...out.map((a) => ({ name: a.name, mime: a.mime, size: a.size, uploaded: Boolean(a.sourcePath) })),
      {
        name: String(item.name ?? '').trim(),
        mime,
        size: effectiveSize,
        uploaded: 'sourcePath' in bytes,
      },
    ]);
    if (!policy.ok) {
      if (policy.issue.code === 'too_many_attachments') {
        throw new Error(`too many attachments (max ${CHAT_ATTACHMENT_POLICY.maxCount})`);
      }
      if (policy.issue.code === 'attachment_too_large') {
        throw new Error(
          `attachment too large (${effectiveSize} bytes, max ${policy.issue.limit})`,
        );
      }
      if (policy.issue.code === 'attachments_too_large') {
        throw new Error(
          `attachments too large in total (max ${policy.issue.limit} bytes)`,
        );
      }
      if (policy.issue.code === 'invalid_mime') {
        throw new Error('attachment type is not valid');
      }
      throw new Error('attachment size is invalid');
    }

    const ext = extForAttachmentMime(mime);
    const fallbackBase = isImageAttachmentMime(mime)
      ? `image-${out.length + 1}`
      : isTextAttachmentMime(mime) ? `text-${out.length + 1}` : `file-${out.length + 1}`;
    const name = String(item.name ?? '').trim() || `${fallbackBase}.${ext}`;
    const fileName = uniqueAttachmentFileName(
      sanitizeAttachmentFileName(name, fallbackBase, ext),
      usedFileNames,
    );

    out.push({ name, mime, size: effectiveSize, fileName, ...bytes } as ChatImageAttachment);
  }

  return out;
}

/** The attachment's bytes, read from its upload when it was not sent inline. */
export async function chatAttachmentBytes(attachment: ChatImageAttachment): Promise<Buffer> {
  if (attachment.sourcePath) return await fs.readFile(attachment.sourcePath);
  const buf = Buffer.from(String(attachment.dataBase64 ?? ''), 'base64');
  if (!buf || buf.length === 0) throw new Error('attachment decode failed');
  return buf;
}

/**
 * Writes an attachment into a local directory. An uploaded file is copied, not moved: the same
 * upload can go out with several prompts (one message sent to many chats), and expires on its own.
 */
export async function writeChatAttachmentFile(
  attachment: ChatImageAttachment,
  filePath: string,
): Promise<void> {
  if (attachment.sourcePath) {
    await fs.copyFile(attachment.sourcePath, filePath);
    await fs.chmod(filePath, 0o600);
    return;
  }
  await fs.writeFile(filePath, await chatAttachmentBytes(attachment), { mode: 0o600 });
}

/** Attachments with their bytes inline, for consumers that hand them to a model or an API directly. */
export async function inlineChatAttachments(
  attachments: readonly ChatImageAttachment[],
): Promise<InlineChatImageAttachment[]> {
  if (!attachments.some((attachment) => attachment.sourcePath)) {
    return attachments as InlineChatImageAttachment[];
  }
  const inlined = await Promise.all(
    attachments.map(async (attachment) => ({
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      dataBase64: (await chatAttachmentBytes(attachment)).toString('base64'),
    })),
  );
  // Re-checked as inline attachments: an uploaded file too large to send inline is refused here.
  return normalizeChatImageAttachments(inlined);
}

// Plain files uploaded ahead of a prompt wait here until the prompt copies them into the drone.
const CHAT_ATTACHMENT_UPLOAD_TTL_MS = 24 * 60 * 60_000;
const CHAT_ATTACHMENT_UPLOAD_ID_PATTERN = /^chat-upload-[0-9a-f-]{36}$/;
let chatAttachmentUploadsDir: string | null = null;

export function configureChatAttachmentUploads(dir: string): void {
  chatAttachmentUploadsDir = path.resolve(dir);
  void pruneChatAttachmentUploads().catch(() => undefined);
}

function requireChatAttachmentUploadsDir(): string {
  if (!chatAttachmentUploadsDir) throw new Error('attachment uploads are not available');
  return chatAttachmentUploadsDir;
}

function resolveChatAttachmentUpload(uploadIdRaw: string): { path: string; size: number } {
  const uploadId = String(uploadIdRaw ?? '').trim();
  if (!CHAT_ATTACHMENT_UPLOAD_ID_PATTERN.test(uploadId)) throw new Error('attachment uploadId is invalid');
  const filePath = path.join(requireChatAttachmentUploadsDir(), uploadId);
  let size = 0;
  try {
    const stat = statSync(filePath);
    if (stat.isFile()) size = stat.size;
  } catch {
    // reported below
  }
  if (size <= 0) throw new Error('attachment upload was not found; it may have expired, attach the file again');
  return { path: filePath, size };
}

export async function pruneChatAttachmentUploads(now = Date.now()): Promise<void> {
  const dir = chatAttachmentUploadsDir;
  if (!dir) return;
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(dir, name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && now - stat.mtimeMs > CHAT_ATTACHMENT_UPLOAD_TTL_MS) {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
      }
    }),
  );
}

/** Streams one request body to the upload area; only plain files within the uploaded-file limit are kept. */
export async function stageChatAttachmentUpload(
  req: IncomingMessage,
  opts: { name: unknown; mime: unknown },
): Promise<{ uploadId: string; name: string; mime: string; size: number }> {
  const dir = requireChatAttachmentUploadsDir();
  const name = path.posix.basename(String(opts.name ?? '').replace(/[\0\r\n\t]/g, '').trim());
  if (!name) throw Object.assign(new Error('attachment name is required'), { statusCode: 400 });
  const mime = normalizeChatAttachmentMime(opts.mime, name);
  if (!isValidChatAttachmentMime(mime) || chatAttachmentKind({ mime }) !== 'file') {
    throw Object.assign(new Error('only plain files can be uploaded ahead of a prompt'), {
      statusCode: 400,
    });
  }
  const maxBytes = CHAT_ATTACHMENT_POLICY.maxUploadedFileBytesEach;
  const uploadId = `chat-upload-${crypto.randomUUID()}`;
  const filePath = path.join(dir, uploadId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  void pruneChatAttachmentUploads().catch(() => undefined);
  const handle = await fs.open(filePath, 'wx', 0o600);
  let size = 0;
  try {
    try {
      for await (const chunkRaw of req) {
        const chunk = Buffer.isBuffer(chunkRaw) ? chunkRaw : Buffer.from(chunkRaw as any);
        size += chunk.length;
        if (size > maxBytes) {
          throw Object.assign(new Error(`attachment too large (more than ${maxBytes} bytes)`), {
            statusCode: 413,
          });
        }
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }
    if (size <= 0) throw Object.assign(new Error('attachment upload body is empty'), { statusCode: 400 });
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { uploadId, name, mime, size };
}

export function promptWithImageAttachments(
  promptRaw: string,
  files: Array<{ name: string; mime: string; size: number; path: string; relativePath?: string }>,
): string {
  return promptWithChatAttachmentContext(promptRaw, files);
}

export function codexImageAttachmentFlags(files: Array<{ mime: string; path: string }>): string {
  const paths = (Array.isArray(files) ? files : [])
    .filter((item) => isImageAttachmentMime(item?.mime))
    .map((item) => normalizeContainerPath(String(item?.path ?? '').trim()))
    .filter((item) => item && item !== '/');
  if (paths.length === 0) return '';
  // Codex CLI treats `--image <FILE>...` as variadic, so terminate options before
  // the positional prompt/session args that the caller appends after these flags.
  return `${paths.map((filePath) => ` --image ${bashQuote(filePath)}`).join('')} --`;
}

export function buildChatAttachmentsDirectory(opts: {
  cwd: string;
  chatName: string;
  promptId: string;
  storageRoot?: string;
}): string {
  const cwd = normalizeContainerPath(String(opts.cwd ?? '').trim() || '/dvm-data');
  const storageRoot = normalizeAttachmentsStorageRoot(opts.storageRoot, cwd);
  const chatSegment = sanitizePathSegment(opts.chatName, 'chat');
  const promptSegment = sanitizePathSegment(opts.promptId, 'prompt');
  return normalizeContainerPath(path.posix.join(storageRoot, chatSegment, promptSegment));
}

export function buildChatImageAttachmentRefs(opts: {
  attachments: ChatImageAttachment[];
  cwd: string;
  chatName: string;
  promptId: string;
  storageRoot?: string;
}): ChatImageAttachmentRef[] {
  const list = Array.isArray(opts.attachments) ? opts.attachments : [];
  if (list.length === 0) return [];
  const cwd = normalizeContainerPath(String(opts.cwd ?? '').trim() || '/dvm-data');
  const dir = buildChatAttachmentsDirectory({
    cwd,
    chatName: opts.chatName,
    promptId: opts.promptId,
    storageRoot: opts.storageRoot,
  });
  return list.map((a) => {
    const absPath = normalizeContainerPath(path.posix.join(dir, a.fileName));
    const relPathRaw = path.posix.relative(cwd, absPath);
    const relPath =
      relPathRaw && relPathRaw !== '.' && !relPathRaw.startsWith('../') ? relPathRaw : absPath;
    return {
      name: a.name,
      mime: a.mime,
      size: a.size,
      fileName: a.fileName,
      path: absPath,
      relativePath: relPath,
    };
  });
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
      await writeChatAttachmentFile(a, path.join(tmpRoot, a.fileName));
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

export async function readChatAttachmentsFromRefs(opts: {
  runtime: 'host' | 'container';
  containerName?: string;
  attachments: ChatImageAttachmentRef[];
}): Promise<ChatImageAttachment[]> {
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  if (attachments.length === 0) return [];
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `drone-hub-read-attachments-${process.pid}-`),
  );
  try {
    const out: ChatImageAttachment[] = [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index]!;
      let bytes: Buffer;
      if (opts.runtime === 'host') {
        bytes = await fs.readFile(attachment.path);
      } else {
        const containerName = String(opts.containerName ?? '').trim();
        if (!containerName) throw new Error('missing attachment container');
        const localPath = path.join(tmpRoot, `${index}-${path.basename(attachment.fileName)}`);
        await dvmCopyFromContainer(containerName, attachment.path, localPath);
        bytes = await fs.readFile(localPath);
      }
      out.push({
        name: attachment.name,
        mime: attachment.mime,
        size: bytes.length,
        dataBase64: bytes.toString('base64'),
        fileName: attachment.fileName,
      });
    }
    return normalizeChatImageAttachments(out);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
