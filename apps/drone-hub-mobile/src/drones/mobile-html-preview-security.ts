export const MOBILE_HTML_PREVIEW_BASE_URL = 'https://drone-hub-preview.invalid/';

/**
 * The page's own URL mirrors its file path, so relative image URLs resolve the
 * way they do on desktop and map back to files in the same workspace.
 */
export function mobileHtmlPreviewDocumentUrl(htmlPath: string): string {
  const encoded = String(htmlPath ?? '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${MOBILE_HTML_PREVIEW_BASE_URL}${encoded}`;
}

/** Posted by the page when it tries to load a local image, which the policy blocks. */
export const MOBILE_HTML_PREVIEW_IMAGE_REQUEST = 'drone-hub:preview-image';
/** The page function the app calls with an image it read, as a data URL. */
export const MOBILE_HTML_PREVIEW_IMAGE_DELIVERY = '__droneHubPreviewImage';

/**
 * Every local image load breaks the policy, which names the URL. That finds
 * images wherever the browser would load them: CSS backgrounds, srcset,
 * <picture>, SVG and images added by scripts. Once the app sends an image back,
 * every reference to that URL is swapped for it, including ones added later.
 */
const MOBILE_HTML_PREVIEW_IMAGE_SCRIPT = `<script>
(() => {
  const ready = new Map();
  const asked = new Set();
  const resolve = (value) => {
    try { return new URL(value, document.baseURI).href.split('#')[0]; } catch { return null; }
  };
  const swapStyle = (style, url, data) => {
    for (let i = 0; i < style.length; i += 1) {
      const name = style[i];
      const value = style.getPropertyValue(name);
      if (!value.includes('url(')) continue;
      const next = value.replace(/url\\(\\s*(["']?)(.*?)\\1\\s*\\)/g, (whole, quote, ref) =>
        resolve(ref) === url ? 'url("' + data + '")' : whole);
      if (next !== value) style.setProperty(name, next, style.getPropertyPriority(name));
    }
  };
  const swapRules = (rules, url, data) => {
    for (const rule of Array.from(rules || [])) {
      if (rule.style) swapStyle(rule.style, url, data);
      if (rule.cssRules) swapRules(rule.cssRules, url, data);
    }
  };
  const swap = (url, data) => {
    for (const element of Array.from(document.querySelectorAll('[src], [srcset], [poster], image'))) {
      for (const name of ['src', 'poster', 'href', 'xlink:href']) {
        const value = element.getAttribute(name);
        if (value && resolve(value) === url) element.setAttribute(name, data);
      }
      const srcset = element.getAttribute('srcset');
      if (srcset && srcset.split(',').some((candidate) => resolve(candidate.trim().split(/\\s+/)[0]) === url)) {
        // The browser picked this candidate; it becomes the only one.
        if (element.localName === 'img') {
          element.removeAttribute('srcset');
          element.setAttribute('src', data);
        } else {
          element.setAttribute('srcset', data);
        }
      }
    }
    for (const element of Array.from(document.querySelectorAll('[style]'))) swapStyle(element.style, url, data);
    for (const sheet of Array.from(document.styleSheets)) {
      try { swapRules(sheet.cssRules, url, data); } catch {}
    }
  };
  Object.defineProperty(window, '${MOBILE_HTML_PREVIEW_IMAGE_DELIVERY}', {
    value: (url, data) => {
      ready.set(url, data);
      swap(url, data);
    },
  });
  document.addEventListener('securitypolicyviolation', (event) => {
    const directive = event.effectiveDirective || event.violatedDirective || '';
    if (!directive.startsWith('img-src')) return;
    const url = resolve(event.blockedURI);
    if (!url || new URL(url).origin !== location.origin) return;
    if (ready.has(url)) {
      swap(url, ready.get(url));
      return;
    }
    if (asked.has(url)) return;
    asked.add(url);
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: '${MOBILE_HTML_PREVIEW_IMAGE_REQUEST}', url }));
  }, true);
})();
</script>`;

export const MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST = ['*'] as const;

export const MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  // Inline, data: and blob: scripts run as on desktop. Network, frames, forms and navigation stay blocked.
  // A page with a media session may load images and video from that session only; a
  // page without one gets one message to the app instead: a request for a local image.
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

const MOBILE_HTML_PREVIEW_SHARED_WEBVIEW_POLICY = {
  javaScriptEnabled: true,
  javaScriptCanOpenWindowsAutomatically: false,
  cacheEnabled: false,
  incognito: true,
  mediaPlaybackRequiresUserAction: true,
  webviewDebuggingEnabled: false,
};

const MOBILE_HTML_PREVIEW_ANDROID_WEBVIEW_POLICY = {
  domStorageEnabled: false,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  mixedContentMode: 'never' as const,
  thirdPartyCookiesEnabled: false,
  geolocationEnabled: false,
  allowsFullscreenVideo: false,
  saveFormDataDisabled: true,
  setSupportMultipleWindows: true,
  paymentRequestEnabled: false,
  allowsProtectedMedia: false,
};

const MOBILE_HTML_PREVIEW_IOS_WEBVIEW_POLICY = {
  sharedCookiesEnabled: false,
  allowsInlineMediaPlayback: false,
  allowsAirPlayForMediaPlayback: false,
  allowsBackForwardNavigationGestures: false,
  dataDetectorTypes: ['none'] as Array<'none'>,
  keyboardDisplayRequiresUserAction: true,
  mediaCapturePermissionGrantType: 'deny' as const,
};

export function mobileHtmlPreviewWebViewPolicy(platform: string) {
  return platform === 'ios'
    ? {
        ...MOBILE_HTML_PREVIEW_SHARED_WEBVIEW_POLICY,
        ...MOBILE_HTML_PREVIEW_IOS_WEBVIEW_POLICY,
      }
    : {
        ...MOBILE_HTML_PREVIEW_SHARED_WEBVIEW_POLICY,
        ...MOBILE_HTML_PREVIEW_ANDROID_WEBVIEW_POLICY,
      };
}

/** A session URL is safe to place in the policy and a base element, or null. */
export function mobileHtmlPreviewMediaBase(value: unknown): string | null {
  const text = String(value ?? '');
  if (!/^https:\/\/[A-Za-z0-9.\-:[\]]+\/[A-Za-z0-9._~\-/]*\/$/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.href === text && !url.username && !url.password ? text : null;
  } catch {
    return null;
  }
}

/** The policy, admitting images and video from the page's media session when it has one. */
export function mobileHtmlPreviewContentSecurityPolicy(mediaBase?: string | null): string {
  if (!mediaBase) return MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY;
  return MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY
    .replace('img-src data: blob:', `img-src data: blob: ${mediaBase}`)
    .replace('media-src data: blob:', `media-src data: blob: ${mediaBase}`);
}

/**
 * The CSP is emitted before untrusted markup. Keeping that markup in the top
 * WebView document is deliberate: Android does not report inner-frame
 * navigation to onShouldStartLoadWithRequest, while top-document navigation is
 * denied by the native WebView callback.
 */
export function buildMobileHtmlPreviewDocument(
  source: string,
  media?: { mediaBase: string; htmlPath: string },
): string {
  // With a media session the WebView loads, caches and evicts media itself, as a
  // browser does. The base precedes the policy, whose base-uri 'none' blocks any later one.
  const mediaBase = mobileHtmlPreviewMediaBase(media?.mediaBase);
  const base = mediaBase
    ? `<base href="${mediaBase}${mobileHtmlPreviewDocumentUrl(media!.htmlPath).slice(MOBILE_HTML_PREVIEW_BASE_URL.length)}">`
    : '';
  return [
    '<!doctype html>',
    base,
    `<meta http-equiv="Content-Security-Policy" content="${mobileHtmlPreviewContentSecurityPolicy(mediaBase)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    mediaBase ? '' : MOBILE_HTML_PREVIEW_IMAGE_SCRIPT,
    String(source ?? '').replace(/\u0000/g, '\uFFFD'),
  ].join('');
}

export function shouldAllowMobileHtmlPreviewNavigation(
  url: string,
  documentUrl: string = MOBILE_HTML_PREVIEW_BASE_URL,
): boolean {
  if (url === 'about:blank') return true;
  try {
    const target = new URL(url);
    const base = new URL(documentUrl);
    return (
      target.origin === base.origin &&
      target.pathname === base.pathname &&
      target.search === '' &&
      target.username === '' &&
      target.password === ''
    );
  } catch {
    return false;
  }
}
