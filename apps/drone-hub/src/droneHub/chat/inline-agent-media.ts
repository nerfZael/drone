import type { MarkdownFileReference } from './MarkdownMessage';

export type InlineAgentMediaKind = 'image' | 'video';

export type InlineAgentMedia = {
  id: string;
  kind: InlineAgentMediaKind;
  src: string;
  linkHref: string | null;
  fileRef: MarkdownFileReference | null;
  label: string;
};

const IMAGE_EXTENSIONS = new Set([
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

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg']);
const MEDIA_EXTENSION_PATTERN = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].join('|');

function mediaKindForPath(rawPath: string): InlineAgentMediaKind | null {
  const pathOnly = String(rawPath ?? '').split('?')[0].split('#')[0].trim();
  if (!pathOnly) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(pathOnly);
    } catch {
      return pathOnly;
    }
  })();
  const lower = decoded.toLowerCase();
  const slash = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\'));
  const base = slash >= 0 ? lower.slice(slash + 1) : lower;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function mediaKindForUrl(u: URL): InlineAgentMediaKind | null {
  return (
    mediaKindForPath(u.pathname) ||
    mediaKindForPath(u.searchParams.get('path') ?? '') ||
    mediaKindForPath(u.searchParams.get('file') ?? '') ||
    mediaKindForPath(u.searchParams.get('url') ?? '')
  );
}

function normalizeInlineMediaBasePath(rawBase: string | undefined): string {
  let base = String(rawBase ?? '').trim().replace(/\\/g, '/');
  if (!base) return '/work/repo';
  if (!base.startsWith('/')) base = `/${base.replace(/^\/+/, '')}`;
  base = base.replace(/\/+/g, '/');
  if (base.length > 1 && base.endsWith('/')) base = base.slice(0, -1);
  return base || '/work/repo';
}

function normalizeInlineMediaFilePath(
  rawRef: string,
  basePathRaw?: string,
): { path: string; kind: InlineAgentMediaKind } | null {
  const trimmed = String(rawRef ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('\0')) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.startsWith('~')) return null;

  let token = trimmed.replace(/\\/g, '/');
  const hashMatch = /^(.*)#L\d+(?:C\d+)?$/i.exec(token);
  if (hashMatch) token = String(hashMatch[1] ?? '').trim();
  const lineSuffix = /:(\d+)(?::(\d+))?$/.exec(token);
  if (lineSuffix && typeof lineSuffix.index === 'number') {
    token = token.slice(0, lineSuffix.index).trim();
  }

  if (!token) return null;
  if (token.startsWith('./')) token = token.slice(2);
  token = token.replace(/\/+/g, '/');
  if (!token) return null;
  if (token.includes('/../') || token.startsWith('../') || token.endsWith('/..')) return null;
  const kind = mediaKindForPath(token);
  if (!kind) return null;
  const basePath = normalizeInlineMediaBasePath(basePathRaw);
  if (token.startsWith('/')) return { path: token, kind };
  if (token.startsWith('work/repo/') || token.startsWith('dvm-data/home/')) return { path: `/${token}`, kind };
  return { path: `${basePath}/${token}`, kind };
}

function inlineMediaLabelFromPath(rawPath: string, kind: InlineAgentMediaKind): string {
  const pathOnly = String(rawPath ?? '').split('?')[0].split('#')[0].trim();
  if (!pathOnly) return kind;
  const slash = Math.max(pathOnly.lastIndexOf('/'), pathOnly.lastIndexOf('\\'));
  const base = slash >= 0 ? pathOnly.slice(slash + 1) : pathOnly;
  return base || pathOnly;
}

function mediaHttpUrlLabel(u: URL, kind: InlineAgentMediaKind): string {
  const fromPath = inlineMediaLabelFromPath(u.pathname, kind);
  if (fromPath && fromPath !== '/') return fromPath;
  return u.hostname || kind;
}

export function collectInlineAgentMedia(textRaw: string, droneIdRaw?: string, basePathRaw?: string): InlineAgentMedia[] {
  const text = String(textRaw ?? '');
  if (!text.trim()) return [];
  const droneId = String(droneIdRaw ?? '').trim();
  const out: InlineAgentMedia[] = [];
  const seen = new Set<string>();
  const push = (entry: InlineAgentMedia) => {
    if (!entry.src || seen.has(entry.src)) return;
    seen.add(entry.src);
    out.push(entry);
  };

  const urlCandidatePatterns = [/https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*/gi];
  for (const pattern of urlCandidatePatterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = String(match[0] ?? '').trim();
      if (!raw) continue;
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        continue;
      }
      const kind = mediaKindForUrl(parsed);
      if (!kind) continue;
      const href = parsed.toString();
      push({
        id: href,
        kind,
        src: href,
        linkHref: href,
        fileRef: null,
        label: mediaHttpUrlLabel(parsed, kind),
      });
    }
  }

  const markdownHrefRegex = /\[[^\]]*]\(([^)\s]+)\)/g;
  for (const match of text.matchAll(markdownHrefRegex)) {
    const rawHref = String(match[1] ?? '').trim().replace(/^<|>$/g, '');
    if (!rawHref) continue;
    if (/^https?:\/\//i.test(rawHref)) {
      let parsed: URL;
      try {
        parsed = new URL(rawHref);
      } catch {
        continue;
      }
      const kind = mediaKindForUrl(parsed);
      if (!kind) continue;
      const href = parsed.toString();
      push({
        id: href,
        kind,
        src: href,
        linkHref: href,
        fileRef: null,
        label: mediaHttpUrlLabel(parsed, kind),
      });
      continue;
    }
    if (!droneId) continue;
    const mediaRef = normalizeInlineMediaFilePath(rawHref, basePathRaw);
    if (!mediaRef) continue;
    const src = `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(mediaRef.path)}`;
    push({
      id: `${droneId}:${mediaRef.path}`,
      kind: mediaRef.kind,
      src,
      linkHref: rawHref,
      fileRef: { raw: rawHref, path: mediaRef.path, line: null, column: null },
      label: inlineMediaLabelFromPath(mediaRef.path, mediaRef.kind),
    });
  }

  const inlineCodeRegex = /`([^`\n]+)`/g;
  for (const match of text.matchAll(inlineCodeRegex)) {
    if (!droneId) continue;
    const raw = String(match[1] ?? '').trim();
    if (!raw) continue;
    const mediaRef = normalizeInlineMediaFilePath(raw, basePathRaw);
    if (!mediaRef) continue;
    const src = `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(mediaRef.path)}`;
    push({
      id: `${droneId}:${mediaRef.path}`,
      kind: mediaRef.kind,
      src,
      linkHref: raw,
      fileRef: { raw, path: mediaRef.path, line: null, column: null },
      label: inlineMediaLabelFromPath(mediaRef.path, mediaRef.kind),
    });
  }

  const bareMediaPathRegex = new RegExp(
    `(?:^|[\\s"'(<[{])((?:\\.{1,2}\\/)?(?:[^\\s"'\\\`<>()[\\]{}:]+\\/)*[^\\s"'\\\`<>()[\\]{}:]+\\.(?:${MEDIA_EXTENSION_PATTERN})(?:\\?[^\\s"'\\\`<>()[\\]{}]+)?(?:#[^\\s"'\\\`<>()[\\]{}]+)?)`,
    'gi',
  );
  const textWithoutMarkdownLinks = text.replace(/\[[^\]]*]\(([^)\s]+)\)/g, ' ');
  for (const match of textWithoutMarkdownLinks.matchAll(bareMediaPathRegex)) {
    if (!droneId) continue;
    const rawPath = String(match[1] ?? '').trim();
    if (!rawPath) continue;
    const mediaRef = normalizeInlineMediaFilePath(rawPath, basePathRaw);
    if (!mediaRef) continue;
    const src = `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(mediaRef.path)}`;
    push({
      id: `${droneId}:${mediaRef.path}`,
      kind: mediaRef.kind,
      src,
      linkHref: rawPath,
      fileRef: { raw: rawPath, path: mediaRef.path, line: null, column: null },
      label: inlineMediaLabelFromPath(mediaRef.path, mediaRef.kind),
    });
  }

  return out.slice(0, 8);
}
