import type { MobileDroneSummary } from './drone-sidebar-model';

export type MobileFilePreviewKind = 'text' | 'image' | 'video' | 'binary';
export type MobileHtmlPreviewMode = 'rendered' | 'source';

export type MobileFilePreview = {
  path: string;
  name: string;
  kind: MobileFilePreviewKind;
  mime: string;
  size: number;
  mtimeMs: number | null;
  revision?: string | null;
  content?: string;
  uri?: string;
};

export const MOBILE_MEDIA_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;
export const MOBILE_TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const MOBILE_SVG_PREVIEW_MAX_BYTES = 512 * 1024;
export const MOBILE_FORMATTED_TEXT_PREVIEW_MAX_CHARS = 120_000;
export const MOBILE_RENDERED_TEXT_PREVIEW_MAX_CHARS = 400_000;
export const MOBILE_RENDERED_HTML_PREVIEW_MAX_CHARS = 400_000;
export const MOBILE_FILE_EDIT_MAX_BYTES = 180 * 1024;
export const MOBILE_FILE_WRITE_PAYLOAD_MAX_BYTES = 220 * 1024;

export function mobileUtf8ByteLength(raw: unknown): number {
  return new TextEncoder().encode(String(raw ?? '')).length;
}

export function mobileFileCanEdit(preview: MobileFilePreview | null): boolean {
  return Boolean(
    preview?.kind === 'text' &&
    typeof preview.content === 'string' &&
    preview.size <= MOBILE_FILE_EDIT_MAX_BYTES &&
    mobileUtf8ByteLength(preview.content) <= MOBILE_FILE_EDIT_MAX_BYTES,
  );
}

export function mobileTextPreviewContent(raw: unknown): {
  content: string;
  formatted: boolean;
  truncated: boolean;
} {
  const source = String(raw ?? '');
  const truncated = source.length > MOBILE_RENDERED_TEXT_PREVIEW_MAX_CHARS;
  return {
    content: truncated ? source.slice(0, MOBILE_RENDERED_TEXT_PREVIEW_MAX_CHARS) : source,
    formatted: !truncated && source.length <= MOBILE_FORMATTED_TEXT_PREVIEW_MAX_CHARS,
    truncated,
  };
}

function normalizedPath(raw: unknown): string {
  const value = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  if (value === '/') return value;
  return value.replace(/\/+$/g, '');
}

function inside(path: string, root: string): boolean {
  return Boolean(path && root && (path === root || path.startsWith(`${root}/`)));
}

export function mobileDroneWorkspaceRoot(
  drone: Pick<MobileDroneSummary, 'runtime' | 'repoPath' | 'cwd' | 'repoAttached'>,
): string {
  const hostRuntime = String(drone.runtime ?? '').toLowerCase() === 'host';
  const repoPath = normalizedPath(drone.repoPath);
  const cwd = normalizedPath(drone.cwd);
  const repoAttached =
    typeof drone.repoAttached === 'boolean' ? drone.repoAttached : Boolean(repoPath);
  if (hostRuntime) return cwd || repoPath || '/';
  return repoAttached ? '/work/repo' : '/dvm-data/home';
}

export function resolveMobileDroneFilePath(
  drone: Pick<MobileDroneSummary, 'runtime' | 'repoPath' | 'cwd' | 'repoAttached'>,
  rawPath: string,
): string {
  let filePath = normalizedPath(rawPath);
  if (filePath.startsWith('./')) filePath = filePath.slice(2);
  const hostRuntime = String(drone.runtime ?? '').toLowerCase() === 'host';
  const repoPath = normalizedPath(drone.repoPath);
  const cwd = normalizedPath(drone.cwd);
  const repoAttached =
    typeof drone.repoAttached === 'boolean' ? drone.repoAttached : Boolean(repoPath);
  const runtimeRoot = mobileDroneWorkspaceRoot(drone);

  if (!filePath.startsWith('/')) {
    return normalizedPath(`${runtimeRoot === '/' ? '' : runtimeRoot}/${filePath}`);
  }
  if (hostRuntime && repoPath && inside(filePath, '/work/repo')) {
    return normalizedPath(`${repoPath}${filePath.slice('/work/repo'.length)}`);
  }
  if (hostRuntime && cwd && inside(filePath, '/dvm-data/home')) {
    return normalizedPath(`${cwd}${filePath.slice('/dvm-data/home'.length)}`);
  }
  if (!hostRuntime && repoAttached && repoPath && inside(filePath, repoPath)) {
    return normalizedPath(`/work/repo${filePath.slice(repoPath.length)}`);
  }
  if (!hostRuntime && cwd && inside(filePath, cwd)) {
    return normalizedPath(`${runtimeRoot}${filePath.slice(cwd.length)}`);
  }
  return filePath;
}

export function mobileFileName(path: string): string {
  return normalizedPath(path).split('/').filter(Boolean).at(-1) || path;
}

export function mobileWorkspaceRelativeFilePath(
  drone: Pick<MobileDroneSummary, 'runtime' | 'repoPath' | 'cwd' | 'repoAttached'>,
  rawPath: string,
): string {
  const filePath = normalizedPath(rawPath);
  if (!filePath || !filePath.startsWith('/')) return filePath.replace(/^\.\//, '');

  const hostRuntime = String(drone.runtime ?? '').toLowerCase() === 'host';
  const repoPath = normalizedPath(drone.repoPath);
  const cwd = normalizedPath(drone.cwd);
  const repoAttached =
    typeof drone.repoAttached === 'boolean' ? drone.repoAttached : Boolean(repoPath);
  const roots = hostRuntime
    ? [repoAttached ? repoPath : '', cwd]
    : [repoAttached ? '/work/repo' : '/dvm-data/home'];

  for (const root of roots.filter(Boolean)) {
    if (filePath === root) return mobileFileName(filePath);
    if (inside(filePath, root)) return filePath.slice(root.length + 1);
  }
  return filePath;
}

export function isMarkdownPreview(path: string, mime: string): boolean {
  return (
    /(?:^|\/)readme$/i.test(path) ||
    /\.(?:md|mdown|markdown)$/i.test(path) ||
    mime === 'text/markdown'
  );
}

export function isHtmlPreview(path: string, mime: string): boolean {
  const normalizedMime = String(mime ?? '')
    .trim()
    .toLowerCase();
  return (
    /\.(?:html?|xhtml)$/i.test(mobileFileName(path)) ||
    normalizedMime === 'text/html' ||
    normalizedMime === 'application/xhtml+xml' ||
    normalizedMime.startsWith('text/html;') ||
    normalizedMime.startsWith('application/xhtml+xml;')
  );
}

export function isRenderedHtmlPreviewAvailable(platform: string): boolean {
  return platform === 'android' || platform === 'ios';
}

export function mobileHtmlPreviewMode({
  path,
  mime,
  renderingAvailable,
  selection,
}: {
  path: string;
  mime: string;
  renderingAvailable: boolean;
  selection: { path: string; mode: MobileHtmlPreviewMode } | null;
}): MobileHtmlPreviewMode {
  if (!renderingAvailable || !isHtmlPreview(path, mime)) return 'source';
  return selection?.path === path ? selection.mode : 'rendered';
}

const PLAIN_TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'tsv']);

export function isCodePreview(path: string, mime: string): boolean {
  const name = mobileFileName(path);
  const extension = name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : '';
  if (PLAIN_TEXT_EXTENSIONS.has(extension) || isMarkdownPreview(path, mime)) return false;
  return (
    Boolean(extension) ||
    mime !== 'text/plain' ||
    /^(?:Dockerfile|Gemfile|Makefile|Procfile)$/i.test(name)
  );
}

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mkv: 'video/x-matroska',
  m4v: 'video/mp4',
  md: 'text/markdown',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  ogg: 'video/ogg',
  ogv: 'video/ogg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  webp: 'image/webp',
  wmv: 'video/x-ms-wmv',
  xhtml: 'application/xhtml+xml',
};

export function inferMobilePreviewMime(path: string): string {
  const extension = mobileFileName(path).split('.').at(-1)?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'text/plain';
}
