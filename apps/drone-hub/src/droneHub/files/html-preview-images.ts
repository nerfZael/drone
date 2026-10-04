import { resolveMarkdownPreviewLinkTarget } from './markdown-preview-link-utils';
import { checkHtmlPreviewSize, HtmlPreviewTooLargeError } from './html-preview-limits';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Resolve file URLs only; the parent never fetches a URL supplied by preview code. */
export function resolveHtmlPreviewImagePath(filePath: string, href: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  // Unlike Markdown links, colons and #L fragments in image names are not editor positions.
  const path = value.split(/[?#]/, 1)[0];
  if (!path || path.includes(':')) return null;
  return resolveMarkdownPreviewLinkTarget(filePath, path)?.path ?? null;
}

export async function embedHtmlPreviewImages(
  source: string,
  filePath: string,
  readImage: (path: string) => Promise<string>,
): Promise<{ source: string; failed: number }> {
  checkHtmlPreviewSize(source.length);
  let embeddedBytes = new TextEncoder().encode(source).byteLength;
  checkHtmlPreviewSize(embeddedBytes);
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const images = Array.from(parsed.querySelectorAll('img[src]'));
  const reads = new Map<string, Promise<string | null>>();
  let failed = 0;
  // Limit concurrent reads so image-heavy review sheets do not flood the filesystem API.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, images.length) }, async () => {
    while (next < images.length) {
      const image = images[next++];
      const path = resolveHtmlPreviewImagePath(filePath, image.getAttribute('src') ?? '');
      if (!path) continue;
      let read = reads.get(path);
      if (!read) {
        read = readImage(path).catch(error => {
          if (error instanceof HtmlPreviewTooLargeError) throw error;
          failed += 1; return null;
        });
        reads.set(path, read);
      }
      const dataUrl = await read;
      if (dataUrl) {
        embeddedBytes += dataUrl.length;
        checkHtmlPreviewSize(embeddedBytes);
        image.setAttribute('src', dataUrl);
      }
    }
  }));
  // Preserve the original text when no local images need rewriting.
  return { source: reads.size ? `<!doctype html>\n${parsed.documentElement.outerHTML}` : source, failed };
}

export async function readHtmlPreviewImage(droneId: string, path: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(
    `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(path)}&maxBytes=${IMAGE_MAX_BYTES}`,
    { signal },
  );
  if (response.status === 413) throw new HtmlPreviewTooLargeError();
  if (!response.ok) throw new Error('Could not load local image');
  const mime = response.headers.get('content-type') ?? '';
  if (!mime.startsWith('image/')) { await response.body?.cancel(); throw new Error('Not an image'); }
  if (Number(response.headers.get('content-length')) > IMAGE_MAX_BYTES) {
    await response.body?.cancel(); throw new HtmlPreviewTooLargeError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Could not load local image');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_MAX_BYTES) throw new HtmlPreviewTooLargeError();
      parts.push(value as Uint8Array<ArrayBuffer>);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const blob = new Blob(parts, { type: mime });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export const HTML_PREVIEW_IMAGE_REQUEST = 'drone-html-preview-image-request';
export const HTML_PREVIEW_IMAGE_RESPONSE = 'drone-html-preview-image-response';

/** Installed before authored scripts so image assignments use the same local file reader. */
export function htmlPreviewImageBridge(token: string): string {
  return `<script>
(() => {
  const token = ${JSON.stringify(token).replace(/</g, '\\u003c')};
  const requestType = ${JSON.stringify(HTML_PREVIEW_IMAGE_REQUEST)};
  const responseType = ${JSON.stringify(HTML_PREVIEW_IMAGE_RESPONSE)};
  const nativeSetAttribute = Element.prototype.setAttribute;
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const pending = new Map();
  const current = new WeakMap();
  let sequence = 0;
  function local(value) {
    return value && !value.startsWith('#') && !value.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(value);
  }
  function request(image, value) {
    const href = String(value).trim();
    const previous = current.get(image);
    if (previous) pending.delete(previous);
    current.delete(image);
    if (!local(href)) return false;
    const id = String(++sequence);
    current.set(image, id);
    pending.set(id, image);
    parent.postMessage({ type: requestType, token, id, href }, '*');
    return true;
  }
  Element.prototype.setAttribute = function(name, value) {
    if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src' && request(this, value)) return;
    return nativeSetAttribute.call(this, name, value);
  };
  if (src && src.set) Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...src,
    set(value) { if (!request(this, value)) src.set.call(this, value); },
  });
  function inspect(image) {
    const value = image.getAttribute('src') || '';
    if (local(value.trim())) request(image, value);
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') inspect(record.target);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) inspect(node);
        node.querySelectorAll('img[src]').forEach(inspect);
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== responseType || data.token !== token) return;
    const image = pending.get(data.id);
    if (!image || current.get(image) !== data.id) return;
    pending.delete(data.id);
    current.delete(image);
    if (typeof data.dataUrl === 'string' && data.dataUrl.startsWith('data:image/')) {
      nativeSetAttribute.call(image, 'src', data.dataUrl);
    }
  });
})();
</script>`;
}
