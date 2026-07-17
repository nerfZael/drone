import path from 'node:path';

import { normalizeContainerPath } from './hub-format';

export const IMAGE_FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
  'tif',
  'tiff',
]);
export const VIDEO_FILE_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
  'ogv',
  'ogg',
  'avi',
  'mkv',
  'wmv',
]);
export const FS_THUMB_MAX_BYTES = 8 * 1024 * 1024;
export const FS_MEDIA_MAX_BYTES = 96 * 1024 * 1024;
export const FS_EDITOR_MAX_BYTES = 2 * 1024 * 1024;
export const FS_TEXT_CHUNK_MAX_BYTES = 512 * 1024;
export const FS_QUICK_OPEN_MAX_RESULTS = 200;
export const FS_LIST_TIMEOUT_MS = 10_000;
export const ASSISTANT_BASH_DEFAULT_TIMEOUT_MS = 30 * 60_000;
export const ASSISTANT_BASH_MAX_TIMEOUT_MS = 60 * 60_000;
export const ASSISTANT_BASH_MAX_OUTPUT_BYTES = 64 * 1024;
export const ASSISTANT_BASH_MAX_COMMAND_BYTES = 20 * 1024;
export const ASSISTANT_SEARCH_MAX_CONTEXT_LINES = 10;
export const ASSISTANT_CHANGED_FILES_LIMIT = 200;

export type ContainerFsEntry = {
  name: string;
  path: string;
  relativePath?: string | null;
  kind: 'directory' | 'file' | 'other';
  size: number | null;
  mtimeMs: number | null;
  ext: string | null;
  isImage: boolean;
  isVideo: boolean;
};

export function extensionLower(rawPathOrName: string): string {
  const base = path.posix.basename(
    String(rawPathOrName ?? '')
      .trim()
      .toLowerCase(),
  );
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1);
}

export function isLikelyImagePath(rawPathOrName: string): boolean {
  const ext = extensionLower(rawPathOrName);
  return ext ? IMAGE_FILE_EXTENSIONS.has(ext) : false;
}

export function isLikelyVideoPath(rawPathOrName: string): boolean {
  const ext = extensionLower(rawPathOrName);
  return ext ? VIDEO_FILE_EXTENSIONS.has(ext) : false;
}

export function guessImageMimeType(rawPathOrName: string): string {
  const ext = extensionLower(rawPathOrName);
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    case 'avif':
      return 'image/avif';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

export function guessVideoMimeType(rawPathOrName: string): string {
  const ext = extensionLower(rawPathOrName);
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'ogv':
    case 'ogg':
      return 'video/ogg';
    case 'avi':
      return 'video/x-msvideo';
    case 'mkv':
      return 'video/x-matroska';
    case 'wmv':
      return 'video/x-ms-wmv';
    default:
      return 'application/octet-stream';
  }
}

export function isLikelyTextMimeType(rawMimeType: string): boolean {
  const mime = String(rawMimeType ?? '')
    .trim()
    .toLowerCase();
  if (!mime) return true;
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  if (mime === 'application/xml') return true;
  if (mime === 'application/yaml') return true;
  if (mime === 'application/x-yaml') return true;
  if (mime === 'application/x-sh') return true;
  if (mime === 'application/x-shellscript') return true;
  if (mime === 'application/javascript') return true;
  if (mime === 'application/x-javascript') return true;
  if (mime === 'application/typescript') return true;
  if (mime === 'application/x-typescript') return true;
  if (mime === 'application/sql') return true;
  return false;
}

export function isImageMimeType(rawMimeType: string): boolean {
  return String(rawMimeType ?? '').trim().toLowerCase().startsWith('image/');
}

export function bufferLooksBinary(buf: Buffer): boolean {
  if (!buf || buf.length === 0) return false;
  if (buf.includes(0)) return true;
  let suspicious = 0;
  for (const byte of buf.values()) {
    if ((byte >= 0 && byte <= 8) || byte === 11 || byte === 12 || (byte >= 14 && byte <= 31)) {
      suspicious += 1;
    }
  }
  return suspicious / buf.length > 0.08;
}

export function parseContainerFsListOutput(text: string): {
  resolvedPath: string;
  entries: ContainerFsEntry[];
} {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  let resolvedPath = '/';
  const entries: ContainerFsEntry[] = [];

  for (const line of lines) {
    if (line.startsWith('__PATH__\t')) {
      const p = normalizeContainerPath(line.slice('__PATH__\t'.length));
      resolvedPath = p || '/';
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [nameRaw, typeRaw, sizeRaw, mtimeRaw] = parts;
    const name = String(nameRaw ?? '');
    if (!name || name === '.' || name === '..') continue;

    const type = String(typeRaw ?? '');
    const kind: ContainerFsEntry['kind'] =
      type === 'd' ? 'directory' : type === 'f' ? 'file' : 'other';
    const sizeNum = Number(sizeRaw);
    const mtimeSec = Number(mtimeRaw);

    const fullPath =
      resolvedPath === '/'
        ? path.posix.join('/', name)
        : path.posix.join(resolvedPath.replace(/\/+$/g, ''), name);
    const ext = kind === 'file' ? extensionLower(name) || null : null;
    const isImage = kind === 'file' ? isLikelyImagePath(name) : false;
    const isVideo = kind === 'file' ? isLikelyVideoPath(name) : false;

    entries.push({
      name,
      path: fullPath,
      kind,
      size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : null,
      mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
      ext,
      isImage,
      isVideo,
    });
  }

  sortFsEntries(entries);

  return { resolvedPath, entries };
}

export function sortFsEntries(entries: ContainerFsEntry[]): void {
  const rank = (k: ContainerFsEntry['kind']) => (k === 'directory' ? 0 : k === 'file' ? 1 : 2);
  entries.sort((a, b) => {
    const r = rank(a.kind) - rank(b.kind);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
