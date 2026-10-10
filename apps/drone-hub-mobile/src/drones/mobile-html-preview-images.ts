import { fromByteArray } from 'base64-js';
import { throwIfAborted } from '@drone/device-protocol';

// The preview WebView has no network access and no bridge to the app, so local
// images referenced by <img src> are read here and embedded as data URLs.
export const MOBILE_HTML_PREVIEW_MAX_IMAGES = 48;
export const MOBILE_HTML_PREVIEW_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
// The page crosses the native bridge as one string; base64 makes 8 MiB about 11 MB.
export const MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES = 8 * 1024 * 1024;

const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
// Markup inside scripts and comments is text, not an image to load or rewrite.
const OPAQUE = /<script\b[\s\S]*?(?:<\/script\s*>|$)|<!--[\s\S]*?(?:-->|$)/gi;

function markupOutsideScripts(source: string, rewrite: (markup: string) => string): string {
  let out = '';
  let last = 0;
  for (const match of source.matchAll(OPAQUE)) {
    out += rewrite(source.slice(last, match.index)) + match[0];
    last = match.index! + match[0].length;
  }
  return out + rewrite(source.slice(last));
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** A file path for a relative or root-relative src; null for URLs, fragments and data. */
export function resolveMobileHtmlImagePath(htmlPath: string, rawSrc: string): string | null {
  const src = decodeAttribute(rawSrc).trim();
  if (!src || src.startsWith('#') || src.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  let target = src.split(/[?#]/, 1)[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep names that are not valid URI text as written.
  }
  if (!target) return null;
  const segments = target.startsWith('/') ? [] : htmlPath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.filter(Boolean).join('/')}`;
}

/** Distinct local image paths in document order. */
export function mobileHtmlLocalImagePaths(source: string, htmlPath: string): string[] {
  const paths = new Set<string>();
  markupOutsideScripts(source, (markup) => {
    for (const match of markup.matchAll(IMG_SRC)) {
      const path = resolveMobileHtmlImagePath(htmlPath, match[2] ?? match[3] ?? match[4] ?? '');
      if (path) paths.add(path);
    }
    return markup;
  });
  return [...paths];
}

export function embedMobileHtmlImages(source: string, htmlPath: string, images: ReadonlyMap<string, string>): string {
  if (!images.size) return source;
  return markupOutsideScripts(source, (markup) =>
    markup.replace(IMG_SRC, (whole, prefix: string, double?: string, single?: string, bare?: string) => {
      const path = resolveMobileHtmlImagePath(htmlPath, double ?? single ?? bare ?? '');
      const dataUrl = path ? images.get(path) : undefined;
      if (!dataUrl) return whole;
      return single != null ? `${prefix}'${dataUrl}'` : `${prefix}"${dataUrl}"`;
    }),
  );
}

export function imageDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${fromByteArray(bytes)}`;
}

export type MobileHtmlImageReader = (path: string, maxBytes: number, signal: AbortSignal) => Promise<{ mime: string; bytes: Uint8Array }>;

/** Reads local images within the per-image and per-page budgets; misses are counted, not fatal. */
export async function loadMobileHtmlImages(
  source: string,
  htmlPath: string,
  readImage: MobileHtmlImageReader,
  signal: AbortSignal,
): Promise<{ images: Map<string, string>; failed: number }> {
  const paths = mobileHtmlLocalImagePaths(source, htmlPath);
  const images = new Map<string, string>();
  let failed = Math.max(0, paths.length - MOBILE_HTML_PREVIEW_MAX_IMAGES);
  let budget = MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES;
  const queue = paths.slice(0, MOBILE_HTML_PREVIEW_MAX_IMAGES);
  // Two reads at a time keeps the mesh responsive for the rest of the app.
  await Promise.all([0, 1].map(async () => {
    while (queue.length) {
      const path = queue.shift()!;
      throwIfAborted(signal);
      try {
        const limit = Math.min(MOBILE_HTML_PREVIEW_IMAGE_MAX_BYTES, budget);
        if (limit <= 0) throw new Error('Image budget exhausted');
        const { mime, bytes } = await readImage(path, limit, signal);
        if (bytes.length > budget) throw new Error('Image budget exhausted');
        budget -= bytes.length;
        images.set(path, imageDataUrl(mime, bytes));
      } catch (error) {
        if (signal.aborted) throw error;
        failed += 1;
      }
    }
  }));
  return { images, failed };
}
