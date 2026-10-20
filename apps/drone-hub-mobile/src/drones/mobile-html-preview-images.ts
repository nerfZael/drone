import { fromByteArray } from 'base64-js';
import { throwIfAborted } from '@drone/device-protocol';

// The preview WebView has no network access, so the app reads local images and
// hands them over as data URLs: <img src> ones embedded before the page renders,
// and any other the page asks for while it runs (CSS, srcset, script-added).
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

/** Opens a Hub session the page loads its media from by URL; null when there is none. */
export type MobileHtmlMediaSessionOpener = (htmlPath: string, signal: AbortSignal) => Promise<string | null>;

export type MobileHtmlImageReader = (path: string, maxBytes: number, signal: AbortSignal) => Promise<{ mime: string; bytes: Uint8Array }>;

/** One page's image allowance, shared by images embedded up front and those it asks for later. */
export type MobileHtmlImageBudget = { images: number; bytes: number };

export function createMobileHtmlImageBudget(): MobileHtmlImageBudget {
  return { images: MOBILE_HTML_PREVIEW_MAX_IMAGES, bytes: MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES };
}

async function readImageWithinBudget(
  path: string,
  readImage: MobileHtmlImageReader,
  budget: MobileHtmlImageBudget,
  signal: AbortSignal,
): Promise<string> {
  if (budget.images <= 0) throw new Error('Image count exhausted');
  budget.images -= 1;
  const limit = Math.min(MOBILE_HTML_PREVIEW_IMAGE_MAX_BYTES, budget.bytes);
  if (limit <= 0) throw new Error('Image budget exhausted');
  const { mime, bytes } = await readImage(path, limit, signal);
  if (bytes.length > budget.bytes) throw new Error('Image budget exhausted');
  budget.bytes -= bytes.length;
  return imageDataUrl(mime, bytes);
}

/** Reads local images within the per-image and per-page budgets; misses are counted, not fatal. */
export async function loadMobileHtmlImages(
  source: string,
  htmlPath: string,
  readImage: MobileHtmlImageReader,
  signal: AbortSignal,
  budget: MobileHtmlImageBudget = createMobileHtmlImageBudget(),
): Promise<{ images: Map<string, string>; failed: number }> {
  const queue = mobileHtmlLocalImagePaths(source, htmlPath);
  const images = new Map<string, string>();
  let failed = 0;
  // Two reads at a time keeps the mesh responsive for the rest of the app.
  await Promise.all([0, 1].map(async () => {
    while (queue.length) {
      const path = queue.shift()!;
      throwIfAborted(signal);
      try {
        images.set(path, await readImageWithinBudget(path, readImage, budget, signal));
      } catch (error) {
        if (signal.aborted) throw error;
        failed += 1;
      }
    }
  }));
  return { images, failed };
}

/** The file a blocked image URL names, or null when it is not on the preview's own origin. */
export function mobileHtmlPreviewImagePath(documentUrl: string, url: string): string | null {
  try {
    const target = new URL(url);
    if (target.origin !== new URL(documentUrl).origin || target.username || target.password) return null;
    const segments = target.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    return segments.length ? `/${segments.join('/')}` : null;
  } catch {
    return null;
  }
}

// A page asks once per URL; this bounds what a page that invents URLs can queue.
const MAX_RUNTIME_REQUESTS = 256;

/**
 * Serves the page's requests for local images it found while running. Messages
 * come from the page, so anything but a well-formed request on the page's own
 * origin is ignored, and reads share the page's budget.
 */
export function createMobileHtmlRuntimeImages(input: {
  documentUrl: string;
  readImage: MobileHtmlImageReader;
  budget: MobileHtmlImageBudget;
  signal: AbortSignal;
  requestType: string;
  deliver: (url: string, dataUrl: string) => void;
  onFailed: () => void;
}) {
  const seen = new Set<string>();
  const queue: Array<{ url: string; path: string }> = [];
  let active = 0;
  const pump = () => {
    while (active < 2 && queue.length && !input.signal.aborted) {
      const { url, path } = queue.shift()!;
      active += 1;
      void readImageWithinBudget(path, input.readImage, input.budget, input.signal)
        .then(
          (dataUrl) => { if (!input.signal.aborted) input.deliver(url, dataUrl); },
          () => { if (!input.signal.aborted) input.onFailed(); },
        )
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return {
    request(message: unknown) {
      if (typeof message !== 'string' || message.length > 8192) return;
      let data: { type?: unknown; url?: unknown };
      try {
        data = JSON.parse(message);
      } catch {
        return;
      }
      if (data?.type !== input.requestType || typeof data.url !== 'string') return;
      if (seen.has(data.url) || seen.size >= MAX_RUNTIME_REQUESTS) return;
      seen.add(data.url);
      const path = mobileHtmlPreviewImagePath(input.documentUrl, data.url);
      if (!path) return;
      queue.push({ url: data.url, path });
      pump();
    },
  };
}
