import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceTransferAdapter } from '@blip/tools';

import { droneRootPath } from '../host/paths';
import { isAssistantTransferTemporaryName } from './assistant/is-assistant-transfer-temporary-name';

export type AssistantArtifactFileSummary = {
  path: string;
  size: number;
  updatedAt: string;
  revision: string;
  mimeType?: string;
  binary?: boolean;
};

export type AssistantArtifactFile = AssistantArtifactFileSummary & {
  content: string;
  contentBase64?: string;
};

export type AssistantArtifactPatch = {
  oldText: string;
  newText: string;
};

export type AssistantArtifactActionInput = {
  action: 'list' | 'read' | 'write' | 'append' | 'patch' | 'delete' | 'create_directory';
  path?: unknown;
  content?: unknown;
  baseRevision?: unknown;
  patches?: unknown;
  recursive?: unknown;
  mode?: unknown;
};

const ARTIFACT_MAX_FILE_BYTES = 500_000;
const ARTIFACT_MAX_UPLOAD_BYTES_EACH = 6 * 1024 * 1024;
const ARTIFACT_MAX_UPLOAD_BYTES_TOTAL = 20 * 1024 * 1024;
const ARTIFACT_MAX_UPLOAD_FILES = 8;
const ARTIFACT_MAX_PATH_CHARS = 180;

async function readTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<boolean> {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (result.bytesRead <= 0) return false;
    read += result.bytesRead;
  }
  return true;
}

async function writeTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(
      buffer,
      written,
      buffer.length - written,
      position + written,
    );
    if (result.bytesWritten <= 0) throw new Error('destination stopped writing transfer data');
    written += result.bytesWritten;
  }
}

export type AssistantArtifactUploadInput = {
  name?: unknown;
  mime?: unknown;
  size?: unknown;
  dataBase64?: unknown;
};

export type AssistantArtifactUploadRef = AssistantArtifactFileSummary & {
  name: string;
  mime: string;
  dataBase64?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function errorWithStatus(message: string, statusCode: number): Error & { statusCode?: number } {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function safeThreadSegment(threadIdRaw: unknown): string {
  const raw = String(threadIdRaw ?? '').trim();
  if (!raw) throw errorWithStatus('missing assistant thread id', 400);
  const cleaned = String(threadIdRaw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 88);
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `${cleaned || 'thread'}-${hash}`;
}

export function normalizeAssistantArtifactPath(raw: unknown): string {
  const input = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/');
  const withoutLeadingSlash = input.replace(/^\/+/, '');
  const collapsed = withoutLeadingSlash.replace(/\/+/g, '/');
  if (!collapsed) throw errorWithStatus('missing artifact path', 400);
  if (collapsed.length > ARTIFACT_MAX_PATH_CHARS)
    throw errorWithStatus('artifact path is too long', 400);
  if (collapsed.endsWith('/')) throw errorWithStatus('artifact path must be a file', 400);
  const segments = collapsed.split('/').filter(Boolean);
  if (segments.length === 0) throw errorWithStatus('missing artifact path', 400);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.startsWith('.') || segment.includes('\0')) {
      throw errorWithStatus(`invalid artifact path: ${collapsed}`, 400);
    }
  }
  return segments.join('/');
}

function artifactsRoot(threadId: string): string {
  return droneRootPath('assistant-artifacts', safeThreadSegment(threadId));
}

function resolveArtifactPath(
  threadId: string,
  artifactPathRaw: unknown,
): { root: string; artifactPath: string; filePath: string } {
  const root = artifactsRoot(threadId);
  const artifactPath = normalizeAssistantArtifactPath(artifactPathRaw);
  const filePath = path.resolve(root, artifactPath);
  const rootResolved = path.resolve(root);
  if (filePath !== rootResolved && !filePath.startsWith(`${rootResolved}${path.sep}`)) {
    throw errorWithStatus(`invalid artifact path: ${artifactPath}`, 400);
  }
  return { root, artifactPath, filePath };
}

function resolveArtifactDirectoryPath(
  threadId: string,
  directoryPathRaw: unknown,
): { root: string; artifactPath: string; directoryPath: string } {
  const input = String(directoryPathRaw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
  if (!input) throw errorWithStatus('missing artifact directory path', 400);
  if (input.length > ARTIFACT_MAX_PATH_CHARS)
    throw errorWithStatus('artifact directory path is too long', 400);
  const segments = input.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.startsWith('.') || segment.includes('\0')) {
      throw errorWithStatus(`invalid artifact directory path: ${input}`, 400);
    }
  }
  const artifactPath = segments.join('/');
  const root = artifactsRoot(threadId);
  const directoryPath = path.resolve(root, artifactPath);
  const rootResolved = path.resolve(root);
  if (!directoryPath.startsWith(`${rootResolved}${path.sep}`)) {
    throw errorWithStatus(`invalid artifact directory path: ${artifactPath}`, 400);
  }
  return { root, artifactPath, directoryPath };
}

function revisionForContent(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function mimeTypeForPath(artifactPath: string): string {
  const ext = path.extname(artifactPath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    case '.avif':
      return 'image/avif';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.md':
      return 'text/markdown';
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.pdf':
      return 'application/pdf';
    case '.zip':
      return 'application/zip';
    case '.gz':
      return 'application/gzip';
    case '.wasm':
      return 'application/wasm';
    case '.css':
      return 'text/css';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'text/javascript';
    case '.ts':
    case '.tsx':
      return 'text/typescript';
    default:
      return 'application/octet-stream';
  }
}

export function createAssistantArtifactTransferAdapter(threadId: string): WorkspaceTransferAdapter {
  const tempPath = (filePath: string, transferId: string) =>
    path.join(path.dirname(filePath), `.blip-transfer-${transferId}.part`);
  const resolve = (raw: unknown) =>
    String(raw ?? '').trim() === '.'
      ? artifactsRoot(threadId)
      : resolveArtifactPath(threadId, raw).filePath;
  const isInsideRoot = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  const existing = async (raw: unknown) => {
    const root = await fs.realpath(artifactsRoot(threadId));
    const target = await fs.realpath(resolve(raw));
    if (!isInsideRoot(root, target)) throw errorWithStatus('artifact path leaves its root', 400);
    return target;
  };
  const writable = async (raw: unknown) => {
    await fs.mkdir(artifactsRoot(threadId), { recursive: true });
    const root = await fs.realpath(artifactsRoot(threadId));
    const target =
      String(raw ?? '').trim() === '.'
        ? root
        : path.resolve(root, normalizeAssistantArtifactPath(raw));
    if (target === root) return target;
    let ancestor = path.dirname(target);
    while (ancestor !== root) {
      try {
        const resolvedAncestor = await fs.realpath(ancestor);
        if (!isInsideRoot(root, resolvedAncestor)) throw new Error('outside artifact root');
        break;
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw errorWithStatus('artifact path leaves its root', 400);
        ancestor = path.dirname(ancestor);
      }
    }
    const current = await fs.realpath(target).catch((error: any) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (current && !isInsideRoot(root, current))
      throw errorWithStatus('artifact path leaves its root', 400);
    return target;
  };
  return {
    source: {
      stat: async (artifactPath) => {
        const info = await fs.stat(await existing(artifactPath));
        if (!info.isFile() && !info.isDirectory())
          throw new Error('artifact transfer source is not a file or directory');
        return {
          type: info.isDirectory() ? 'directory' : 'file',
          size: info.isFile() ? info.size : 0,
          mtimeMs: info.mtimeMs,
        };
      },
      list: async (artifactPath) => {
        const directory = await existing(artifactPath);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        return await Promise.all(
          entries
            .filter(
              (entry) =>
                (entry.isFile() || entry.isDirectory()) &&
                !isAssistantTransferTemporaryName(entry.name),
            )
            .map(async (entry) => {
              const info = await fs.stat(path.join(directory, entry.name));
              return {
                name: entry.name,
                type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
                size: entry.isFile() ? info.size : 0,
                mtimeMs: info.mtimeMs,
              };
            }),
        );
      },
      readChunk: async (artifactPath, offset, length) => {
        const handle = await fs.open(await existing(artifactPath), 'r');
        try {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          return { dataBase64: buffer.subarray(0, bytesRead).toString('base64'), bytes: bytesRead };
        } finally {
          await handle.close();
        }
      },
    },
    destination: {
      createDirectory: async (artifactPath) => {
        await fs.mkdir(await writable(artifactPath), { recursive: true });
      },
      prepareFile: async ({ path: artifactPath, transferId, size, overwrite }) => {
        const target = await writable(artifactPath);
        const existing = await fs
          .stat(target)
          .catch((error: any) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
        if (existing && !existing.isFile())
          throw Object.assign(new Error('destination artifact path is not a file'), {
            code: 'INVALID_REQUEST',
          });
        if (existing && !overwrite)
          throw Object.assign(new Error('destination artifact already exists'), {
            code: 'FILE_EXISTS',
          });
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temp = tempPath(target, transferId);
        let partial = await fs
          .lstat(temp)
          .catch((error: any) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
        if (partial && (!partial.isFile() || partial.size > size)) {
          await fs.rm(temp, { force: true });
          partial = null;
        }
        if (!partial) {
          const handle = await fs.open(temp, 'wx');
          await handle.close();
        }
        return { offset: partial?.size ?? 0 };
      },
      writeChunk: async ({ path: artifactPath, transferId, offset, dataBase64 }) => {
        const data = Buffer.from(dataBase64, 'base64');
        const temp = tempPath(await writable(artifactPath), transferId);
        const tempInfo = await fs.lstat(temp);
        if (!tempInfo.isFile())
          throw Object.assign(new Error('transfer temporary path is not a file'), {
            code: 'INVALID_REQUEST',
          });
        const handle = await fs.open(temp, 'r+');
        try {
          const info = await handle.stat();
          if (info.size === offset + data.length) {
            const existing = Buffer.alloc(data.length);
            if ((await readTransferBytes(handle, existing, offset)) && existing.equals(data))
              return { offset: info.size };
          }
          if (info.size !== offset)
            throw new Error(`transfer offset mismatch: expected ${info.size}, received ${offset}`);
          await writeTransferBytes(handle, data, offset);
          await handle.sync();
          return { offset: offset + data.length };
        } finally {
          await handle.close();
        }
      },
      commitFile: async ({ path: artifactPath, transferId, size, overwrite }) => {
        const target = await writable(artifactPath);
        const temp = tempPath(target, transferId);
        const info = await fs
          .lstat(temp)
          .catch((error: any) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
        if (!info) {
          const committed = await fs.stat(target).catch(() => null);
          if (committed?.isFile() && committed.size === size) return;
          throw new Error('transfer temporary file was not found');
        }
        if (!info.isFile())
          throw Object.assign(new Error('transfer temporary path is not a file'), {
            code: 'INVALID_REQUEST',
          });
        if (info.size !== size) throw new Error('transfer is incomplete');
        if (!overwrite && (await fs.stat(target).catch(() => null)))
          throw Object.assign(new Error('destination artifact already exists'), {
            code: 'FILE_EXISTS',
          });
        await fs.rename(temp, target);
      },
      abortFile: async ({ path: artifactPath, transferId }) => {
        await fs.rm(tempPath(await writable(artifactPath), transferId), { force: true });
      },
    },
  };
}

function isTextMimeType(mimeType: string): boolean {
  const mime = String(mimeType ?? '')
    .trim()
    .toLowerCase();
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/x-javascript'
  );
}

function isImageMimeType(mimeType: string): boolean {
  return String(mimeType ?? '')
    .trim()
    .toLowerCase()
    .startsWith('image/');
}

function isUploadedArtifactPath(artifactPath: string): boolean {
  return String(artifactPath ?? '')
    .replace(/\\/g, '/')
    .startsWith('uploads/');
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

async function summaryForFile(
  root: string,
  artifactPath: string,
): Promise<AssistantArtifactFileSummary> {
  const filePath = path.resolve(root, artifactPath);
  const [stat, content] = await Promise.all([fs.stat(filePath), fs.readFile(filePath)]);
  const mimeType = mimeTypeForPath(artifactPath);
  const binary =
    !isTextMimeType(mimeType) &&
    (isImageMimeType(mimeType) ||
      mimeType !== 'application/octet-stream' ||
      !isLikelyTextBuffer(content));
  return {
    path: artifactPath,
    size: Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : content.length,
    updatedAt: Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs).toISOString() : nowIso(),
    revision: revisionForContent(content),
    mimeType,
    binary,
  };
}

async function walkFiles(root: string, dir: string, out: string[]): Promise<void> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e: any) {
    if (e?.code === 'ENOENT') return;
    throw e;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(path.relative(root, full).replace(/\\/g, '/'));
  }
}

export async function listAssistantArtifactFiles(
  threadId: string,
): Promise<AssistantArtifactFileSummary[]> {
  const root = artifactsRoot(threadId);
  const paths: string[] = [];
  await walkFiles(root, root, paths);
  const files = await Promise.all(
    paths.sort((a, b) => a.localeCompare(b)).map((item) => summaryForFile(root, item)),
  );
  return files;
}

export async function listAssistantArtifactEntries(
  threadId: string,
  directoryPathRaw?: unknown,
  limitRaw?: unknown,
): Promise<{
  entries: Array<{ path: string; type: 'directory' | 'file'; size: number; modifiedAt: string }>;
  truncated: boolean;
}> {
  const root = artifactsRoot(threadId);
  const rawPath = String(directoryPathRaw ?? '').trim();
  const artifactPath =
    rawPath && rawPath !== '.' ? resolveArtifactDirectoryPath(threadId, rawPath).artifactPath : '';
  const directoryPath = artifactPath ? path.resolve(root, artifactPath) : root;
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT' && !artifactPath) return { entries: [], truncated: false };
    if (error?.code === 'ENOENT')
      throw errorWithStatus(`artifact directory not found: ${artifactPath}`, 404);
    if (error?.code === 'ENOTDIR')
      throw errorWithStatus(`artifact path is not a directory: ${artifactPath}`, 400);
    throw error;
  }
  const requestedLimit = Number(limitRaw);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
    : 200;
  const visible = entries
    .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isFile()))
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
  const selected = visible.slice(0, limit);
  const details = await Promise.all(
    selected.map(async (entry) => {
      const entryPath = [artifactPath, entry.name].filter(Boolean).join('/');
      const stat = await fs.stat(path.join(directoryPath, entry.name));
      return {
        path: entryPath,
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }),
  );
  return { entries: details, truncated: visible.length > selected.length };
}

export async function deleteAssistantArtifactsForThread(threadId: string): Promise<void> {
  await fs.rm(artifactsRoot(threadId), { recursive: true, force: true });
}

export async function readAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
): Promise<AssistantArtifactFile> {
  const { root, artifactPath, filePath } = resolveArtifactPath(threadId, artifactPathRaw);
  let data: Buffer;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw errorWithStatus(`artifact is not a file: ${artifactPath}`, 404);
    const mimeType = mimeTypeForPath(artifactPath);
    const maxBytes =
      isTextMimeType(mimeType) && !isUploadedArtifactPath(artifactPath)
        ? ARTIFACT_MAX_FILE_BYTES
        : ARTIFACT_MAX_UPLOAD_BYTES_EACH;
    if (stat.size > maxBytes) {
      throw errorWithStatus(`artifact is too large (${stat.size} bytes, max ${maxBytes})`, 413);
    }
    data = await fs.readFile(filePath);
  } catch (e: any) {
    if (e?.statusCode) throw e;
    if (e?.code === 'ENOENT') throw errorWithStatus(`artifact not found: ${artifactPath}`, 404);
    throw e;
  }
  const summary = await summaryForFile(root, artifactPath);
  if (summary.binary) return { ...summary, content: '', contentBase64: data.toString('base64') };
  return { ...summary, content: data.toString('utf8') };
}

export async function readAssistantArtifactBytes(
  threadId: string,
  artifactPathRaw: unknown,
): Promise<{ path: string; mime: string; size: number; dataBase64: string }> {
  const { artifactPath, filePath } = resolveArtifactPath(threadId, artifactPathRaw);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw errorWithStatus(`artifact is not a file: ${artifactPath}`, 404);
  if (stat.size > ARTIFACT_MAX_UPLOAD_BYTES_EACH) {
    throw errorWithStatus(
      `artifact is too large (${stat.size} bytes, max ${ARTIFACT_MAX_UPLOAD_BYTES_EACH})`,
      413,
    );
  }
  const data = await fs.readFile(filePath);
  return {
    path: artifactPath,
    mime: mimeTypeForPath(artifactPath),
    size: data.length,
    dataBase64: data.toString('base64'),
  };
}

async function writeAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
  contentRaw: unknown,
  baseRevisionRaw?: unknown,
  modeRaw?: unknown,
): Promise<AssistantArtifactFile> {
  const { artifactPath, filePath } = resolveArtifactPath(threadId, artifactPathRaw);
  const content = String(contentRaw ?? '');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > ARTIFACT_MAX_FILE_BYTES) {
    throw errorWithStatus(
      `artifact is too large (${bytes} bytes, max ${ARTIFACT_MAX_FILE_BYTES})`,
      413,
    );
  }
  const baseRevision = String(baseRevisionRaw ?? '').trim();
  const mode = String(modeRaw ?? '').trim();
  let exists = false;
  try {
    const stat = await fs.stat(filePath);
    exists = stat.isFile();
    if (!exists) throw errorWithStatus(`artifact is not a file: ${artifactPath}`, 409);
  } catch (error: any) {
    if (error?.statusCode) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  if (mode === 'create' && exists)
    throw errorWithStatus(`artifact already exists: ${artifactPath}`, 409);
  if (mode === 'overwrite' && !exists)
    throw errorWithStatus(`artifact not found: ${artifactPath}`, 404);
  if (baseRevision) {
    const existing = await readAssistantArtifactFile(threadId, artifactPath);
    if (existing.revision !== baseRevision) {
      throw errorWithStatus(`artifact revision changed: ${artifactPath}`, 409);
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
  return await readAssistantArtifactFile(threadId, artifactPath);
}

async function appendAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
  contentRaw: unknown,
  baseRevisionRaw?: unknown,
): Promise<AssistantArtifactFile> {
  let current = '';
  try {
    current = (await readAssistantArtifactFile(threadId, artifactPathRaw)).content;
  } catch (e: any) {
    if (e?.statusCode !== 404) throw e;
  }
  return await writeAssistantArtifactFile(
    threadId,
    artifactPathRaw,
    `${current}${String(contentRaw ?? '')}`,
    baseRevisionRaw,
  );
}

function normalizePatches(raw: unknown): AssistantArtifactPatch[] {
  const list = Array.isArray(raw) ? raw : [];
  const patches = list
    .map((item) => ({
      oldText: String((item as any)?.oldText ?? ''),
      newText: String((item as any)?.newText ?? ''),
    }))
    .filter((item) => item.oldText);
  if (patches.length === 0) throw errorWithStatus('missing patches', 400);
  return patches;
}

async function patchAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
  patchesRaw: unknown,
  baseRevisionRaw?: unknown,
): Promise<AssistantArtifactFile> {
  const current = await readAssistantArtifactFile(threadId, artifactPathRaw);
  const baseRevision = String(baseRevisionRaw ?? '').trim();
  if (baseRevision && current.revision !== baseRevision) {
    throw errorWithStatus(`artifact revision changed: ${current.path}`, 409);
  }
  let nextContent = current.content;
  for (const patch of normalizePatches(patchesRaw)) {
    const first = nextContent.indexOf(patch.oldText);
    if (first < 0) throw errorWithStatus(`patch text not found in ${current.path}`, 409);
    const second = nextContent.indexOf(patch.oldText, first + patch.oldText.length);
    if (second >= 0) throw errorWithStatus(`patch text is ambiguous in ${current.path}`, 409);
    nextContent = `${nextContent.slice(0, first)}${patch.newText}${nextContent.slice(first + patch.oldText.length)}`;
  }
  return await writeAssistantArtifactFile(threadId, current.path, nextContent);
}

async function deleteAssistantArtifactFile(
  threadId: string,
  artifactPathRaw: unknown,
  baseRevisionRaw?: unknown,
): Promise<{ path: string; deleted: boolean }> {
  const { artifactPath, filePath } = resolveArtifactPath(threadId, artifactPathRaw);
  try {
    const baseRevision = String(baseRevisionRaw ?? '').trim();
    if (baseRevision) {
      const existing = await readAssistantArtifactFile(threadId, artifactPath);
      if (existing.revision !== baseRevision)
        throw errorWithStatus(`artifact revision changed: ${artifactPath}`, 409);
    }
    await fs.rm(filePath, { force: false });
    return { path: artifactPath, deleted: true };
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { path: artifactPath, deleted: false };
    throw e;
  }
}

async function createAssistantArtifactDirectory(
  threadId: string,
  directoryPathRaw: unknown,
  recursiveRaw: unknown,
): Promise<{ path: string; recursive: boolean }> {
  const { root, artifactPath, directoryPath } = resolveArtifactDirectoryPath(
    threadId,
    directoryPathRaw,
  );
  const recursive = recursiveRaw === true;
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(directoryPath, { recursive });
  return { path: artifactPath, recursive };
}

function base64DecodedByteLength(b64Raw: string): number {
  const b64 = String(b64Raw ?? '').replace(/\s+/g, '');
  if (!b64) return 0;
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  const n = Math.floor((b64.length * 3) / 4) - padding;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function validateAssistantPromptImages(
  raw: unknown,
): Array<{ type: 'image'; data: string; mimeType: string }> {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > ARTIFACT_MAX_UPLOAD_FILES) {
    throw errorWithStatus(`too many prompt images (max ${ARTIFACT_MAX_UPLOAD_FILES})`, 413);
  }
  let total = 0;
  return list.map((item: any) => {
    const mimeType = String(item?.mimeType ?? item?.mime ?? '')
      .trim()
      .toLowerCase();
    if (!isImageMimeType(mimeType))
      throw errorWithStatus(`invalid prompt image type: ${mimeType || '(empty)'}`, 400);
    const data = String(item?.data ?? item?.dataBase64 ?? '').replace(/\s+/g, '');
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw errorWithStatus('prompt image dataBase64 looks invalid', 400);
    }
    const size = base64DecodedByteLength(data);
    if (!size || size > ARTIFACT_MAX_UPLOAD_BYTES_EACH) {
      throw errorWithStatus(
        `prompt image size is invalid or exceeds ${ARTIFACT_MAX_UPLOAD_BYTES_EACH} bytes`,
        413,
      );
    }
    const decoded = Buffer.from(data, 'base64');
    if (decoded.length !== size)
      throw errorWithStatus('prompt image size does not match payload', 400);
    total += size;
    if (total > ARTIFACT_MAX_UPLOAD_BYTES_TOTAL) {
      throw errorWithStatus(
        `prompt images are too large in total (max ${ARTIFACT_MAX_UPLOAD_BYTES_TOTAL} bytes)`,
        413,
      );
    }
    return { type: 'image' as const, data, mimeType };
  });
}

function extForUploadMime(mimeRaw: string): string {
  const mime = String(mimeRaw ?? '')
    .trim()
    .toLowerCase();
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
      return 'bin';
  }
}

function sanitizeUploadFileName(nameRaw: string, fallbackBase: string, ext: string): string {
  const base = path.posix.basename(String(nameRaw ?? '').trim()).replace(/[\0\r\n\t]/g, '');
  const safeBase = base
    .replace(/[\/\\]+/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  const baseName = safeBase || fallbackBase;
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(baseName);
  return (
    (hasExt ? baseName : `${baseName}.${ext || 'bin'}`).replace(/^\.+/g, '').slice(0, 96) ||
    `${fallbackBase}.${ext || 'bin'}`
  );
}

function uniqueUploadPath(fileNameRaw: string, usedPaths: Set<string>, index: number): string {
  const prefix = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = fileNameRaw || `attachment-${index + 1}.bin`;
  let candidate = `uploads/${prefix}-${fileName}`;
  let n = 2;
  const keyFor = (value: string) => value.toLowerCase();
  while (usedPaths.has(keyFor(candidate))) {
    const parsed = path.posix.parse(fileName);
    candidate = `uploads/${prefix}-${parsed.name || 'attachment'}-${n}${parsed.ext || ''}`;
    n += 1;
  }
  usedPaths.add(keyFor(candidate));
  return candidate;
}

export async function saveAssistantArtifactUploads(
  threadId: string,
  raw: unknown,
): Promise<AssistantArtifactUploadRef[]> {
  const inputList = Array.isArray(raw) ? raw : [];
  if (inputList.length > ARTIFACT_MAX_UPLOAD_FILES) {
    throw errorWithStatus(`too many attachments (max ${ARTIFACT_MAX_UPLOAD_FILES})`, 413);
  }
  const list = inputList.slice(0, ARTIFACT_MAX_UPLOAD_FILES);
  const out: AssistantArtifactUploadRef[] = [];
  const usedPaths = new Set<string>();
  const validated: Array<{
    name: string;
    mime: string;
    dataBase64: string;
    bytes: Buffer;
    artifactPath: string;
  }> = [];
  let total = 0;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] as AssistantArtifactUploadInput;
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name ?? '').trim() || `attachment-${i + 1}`;
    const mime =
      String(item.mime ?? '')
        .trim()
        .toLowerCase() || 'application/octet-stream';
    const dataBase64 = String(item.dataBase64 ?? '').replace(/\s+/g, '');
    if (!dataBase64) throw errorWithStatus('attachment is missing dataBase64', 400);
    if (dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
      throw errorWithStatus('attachment dataBase64 looks invalid', 400);
    }
    const declared = Number(item.size);
    const decodedSize = base64DecodedByteLength(dataBase64);
    const size =
      decodedSize || (Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : 0);
    if (!size) throw errorWithStatus('attachment size is invalid', 400);
    if (size > ARTIFACT_MAX_UPLOAD_BYTES_EACH) {
      throw errorWithStatus(
        `attachment too large (${size} bytes, max ${ARTIFACT_MAX_UPLOAD_BYTES_EACH})`,
        413,
      );
    }
    total += size;
    if (total > ARTIFACT_MAX_UPLOAD_BYTES_TOTAL) {
      throw errorWithStatus(
        `attachments too large in total (max ${ARTIFACT_MAX_UPLOAD_BYTES_TOTAL} bytes)`,
        413,
      );
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(dataBase64, 'base64');
    } catch {
      throw errorWithStatus('invalid base64 payload', 400);
    }
    if (bytes.length !== size && decodedSize > 0)
      throw errorWithStatus('attachment size does not match payload', 400);

    const ext = extForUploadMime(mime);
    const fileName = sanitizeUploadFileName(
      name,
      isImageMimeType(mime) ? `image-${i + 1}` : `attachment-${i + 1}`,
      ext,
    );
    const artifactPath = uniqueUploadPath(fileName, usedPaths, i);
    validated.push({ name, mime, dataBase64, bytes, artifactPath });
  }

  for (const upload of validated) {
    const { root, filePath } = resolveArtifactPath(threadId, upload.artifactPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, upload.bytes);
    const summary = await summaryForFile(root, upload.artifactPath);
    const effectiveMime = isImageMimeType(upload.mime)
      ? upload.mime
      : summary.mimeType || upload.mime;
    out.push({
      ...summary,
      name: upload.name,
      mime: effectiveMime,
      dataBase64: isImageMimeType(effectiveMime) ? upload.dataBase64 : undefined,
    });
  }
  return out;
}

export async function runAssistantArtifactAction(
  threadId: string,
  input: AssistantArtifactActionInput,
): Promise<any> {
  const action = String(input?.action ?? '')
    .trim()
    .toLowerCase();
  if (action === 'list') {
    return { ok: true, files: await listAssistantArtifactFiles(threadId) };
  }
  if (action === 'read') {
    return { ok: true, file: await readAssistantArtifactFile(threadId, input.path) };
  }
  if (action === 'write') {
    return {
      ok: true,
      file: await writeAssistantArtifactFile(
        threadId,
        input.path,
        input.content,
        input.baseRevision,
        input.mode,
      ),
    };
  }
  if (action === 'append') {
    return {
      ok: true,
      file: await appendAssistantArtifactFile(
        threadId,
        input.path,
        input.content,
        input.baseRevision,
      ),
    };
  }
  if (action === 'patch') {
    return {
      ok: true,
      file: await patchAssistantArtifactFile(
        threadId,
        input.path,
        input.patches,
        input.baseRevision,
      ),
    };
  }
  if (action === 'delete') {
    return {
      ok: true,
      ...(await deleteAssistantArtifactFile(threadId, input.path, input.baseRevision)),
    };
  }
  if (action === 'create_directory') {
    return {
      ok: true,
      ...(await createAssistantArtifactDirectory(threadId, input.path, input.recursive)),
    };
  }
  throw errorWithStatus(`unknown artifact action: ${action || '(empty)'}`, 400);
}
