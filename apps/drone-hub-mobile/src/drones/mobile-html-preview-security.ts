export const MOBILE_HTML_PREVIEW_BASE_URL = 'https://drone-hub-preview.invalid/';

export const MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST = ['*'] as const;

export const MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "script-src-attr 'none'",
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
  javaScriptEnabled: false,
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

/**
 * The CSP is emitted before untrusted markup. Keeping that markup in the top
 * WebView document is deliberate: Android does not report inner-frame
 * navigation to onShouldStartLoadWithRequest, while top-document navigation is
 * denied by the native WebView callback.
 */
export function buildMobileHtmlPreviewDocument(source: string): string {
  return [
    '<!doctype html>',
    `<meta http-equiv="Content-Security-Policy" content="${MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    String(source ?? '').replace(/\u0000/g, '\uFFFD'),
  ].join('');
}

export function shouldAllowMobileHtmlPreviewNavigation(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    const target = new URL(url);
    const base = new URL(MOBILE_HTML_PREVIEW_BASE_URL);
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
