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
  "script-src 'unsafe-inline'",
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

    let target;
    try {
      target = new URL(rawHref, document.baseURI);
    } catch {
      event.preventDefault();
      return;
    }

    if (target.hash) {
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

    // A preview must never navigate away from its isolated srcdoc document.
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
</script>`;

/**
 * The policy is emitted before any user-authored markup so it applies before a
 * script can run. The link guard preserves in-document fragments from absolute
 * development URLs while preventing the iframe from leaving the srcdoc page.
 * A later meta policy in the file can only further restrict the initial policy.
 */
export function buildIsolatedHtmlPreviewDocument(source: string): string {
  return [
    '<!doctype html>',
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CONTENT_SECURITY_POLICY}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    HTML_PREVIEW_LINK_GUARD,
    String(source ?? ''),
  ].join('');
}
