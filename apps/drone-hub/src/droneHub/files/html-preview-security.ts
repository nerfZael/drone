export const HTML_PREVIEW_IFRAME_SANDBOX = 'allow-scripts';

export const HTML_PREVIEW_PERMISSIONS_POLICY = [
  "camera 'none'",
  "microphone 'none'",
  "geolocation 'none'",
  "clipboard-read 'none'",
  "clipboard-write 'none'",
  "display-capture 'none'",
  "payment 'none'",
  "usb 'none'",
  "serial 'none'",
  "bluetooth 'none'",
  "hid 'none'",
  "fullscreen 'none'",
  "autoplay 'none'",
].join('; ');

/**
 * HTML previews are intentionally self-contained. In addition to the iframe's
 * opaque sandbox origin, this policy prevents preview code from using the Hub
 * as a network oracle or leaking data through subresources.
 */
export const HTML_PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  // data: and blob: scripts come from the document itself, like inline ones. Single-file
  // pages map their bundled modules to data: URLs in an import map.
  "script-src 'unsafe-inline' data: blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
].join('; ');

// Opt-in resource access retains the opaque origin and all non-network restrictions.
export const HTML_PREVIEW_EXTERNAL_CONTENT_SECURITY_POLICY = HTML_PREVIEW_CONTENT_SECURITY_POLICY
  .replace("script-src 'unsafe-inline' data: blob:", "script-src 'unsafe-inline' data: blob: 'unsafe-eval' http: https:")
  .replace("style-src 'unsafe-inline'", "style-src 'unsafe-inline' http: https:")
  .replace('img-src data: blob:', 'img-src data: blob: http: https:')
  .replace('font-src data:', 'font-src data: http: https:')
  .replace('media-src data: blob:', 'media-src data: blob: http: https:')
  .replace("connect-src 'none'", 'connect-src http: https: ws: wss:');

/** Posted by the preview frame when the user clicks a link that leaves the document. */
export const HTML_PREVIEW_LINK_MESSAGE = 'drone-hub:html-preview-link';

const HTML_PREVIEW_LINK_GUARD = `<script>
(() => {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const element = event.target;
    if (!(element instanceof Element)) return;
    const anchor = element.closest('a[href]');
    if (!anchor) return;
    const rawHref = anchor.getAttribute('href')?.trim() ?? '';
    if (!rawHref || rawHref.startsWith('#')) return;

    let target = null;
    try {
      target = new URL(rawHref, document.baseURI);
    } catch {
      // The Hub resolves the authored href against the file itself.
    }

    if (target?.hash) {
      let fragment = target.hash.slice(1);
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        // Keep the encoded fragment when it is not valid URI text.
      }
      const destination =
        document.getElementById(fragment) ||
        Array.from(document.getElementsByName(fragment)).find((candidate) => candidate instanceof Element);
      if (destination) {
        event.preventDefault();
        event.stopImmediatePropagation();
        location.hash = target.hash;
        destination.scrollIntoView();
        return;
      }
    }

    // A preview must never navigate away from its isolated document. The Hub
    // decides what a clicked link opens, such as another file in the editor.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.isTrusted) parent.postMessage({ type: '${HTML_PREVIEW_LINK_MESSAGE}', href: rawHref, from: document.baseURI }, '*');
  }, true);

  // A page framed inside this one has its own guard, which posts here. Its
  // link goes on to the Hub with the framed page's URL to resolve against.
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!event.source || event.source === window || event.source.parent !== window) return;
    if (data?.type !== '${HTML_PREVIEW_LINK_MESSAGE}' || typeof data.href !== 'string' || typeof data.from !== 'string') return;
    parent.postMessage({ type: '${HTML_PREVIEW_LINK_MESSAGE}', href: data.href, from: data.from }, '*');
  });
})();
</script>`;

/**
 * Local images, video and framed pages load from the Hub's preview route for this
 * drone, nothing else. The route serves framed pages from the previewed file's
 * folder only, each with this same policy.
 */
export function htmlPreviewContentSecurityPolicy(allowExternalResources: boolean, localBase?: string): string {
  const policy = allowExternalResources
    ? HTML_PREVIEW_EXTERNAL_CONTENT_SECURITY_POLICY
    : HTML_PREVIEW_CONTENT_SECURITY_POLICY;
  if (!localBase) return policy;
  return policy
    .replace(/(^|; )(img-src [^;]*)/, `$1$2 ${localBase}`)
    .replace(/(^|; )(media-src [^;]*)/, `$1$2 ${localBase}`)
    .replace("frame-src 'none'", `frame-src ${localBase}`);
}

/**
 * The file a preview route URL serves, such as the page a link was clicked in,
 * or null for any other URL. Preview URLs are `<base><token><absolute path>`.
 */
export function htmlPreviewUrlFilePath(url: string, localBase: string): string | null {
  if (!url.startsWith(localBase)) return null;
  const rest = url.slice(localBase.length).split(/[?#]/)[0];
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  try {
    return rest.slice(slash).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

/**
 * The policy is emitted before any user-authored markup so it applies before a
 * script can run. The link guard preserves in-document fragments from absolute
 * development URLs while preventing the iframe from leaving the preview page.
 * A later meta policy in the file can only further restrict the initial policy.
 * A base URL precedes the policy, whose `base-uri 'none'` blocks any later one.
 */
export function htmlPreviewDocumentPrefix(policy: string, baseHref?: string): string {
  return [
    '<!doctype html>',
    baseHref ? `<base href="${baseHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` : '',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    HTML_PREVIEW_LINK_GUARD,
  ].join('');
}

export function buildIsolatedHtmlPreviewDocument(
  source: string,
  allowExternalResources = false,
  local?: { baseHref: string; mediaBase: string },
): string {
  const policy = htmlPreviewContentSecurityPolicy(allowExternalResources, local?.mediaBase);
  return htmlPreviewDocumentPrefix(policy, local?.baseHref) + String(source ?? '');
}
