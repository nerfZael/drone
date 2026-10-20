import { describe, expect, test } from 'bun:test';
import {
  buildMobileHtmlPreviewDocument,
  mobileHtmlPreviewWebViewPolicy,
  mobileHtmlPreviewDocumentUrl,
  mobileHtmlPreviewMediaBase,
  MOBILE_HTML_PREVIEW_BASE_URL,
  MOBILE_HTML_PREVIEW_IMAGE_REQUEST,
  MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST,
  shouldAllowMobileHtmlPreviewFrameLoad,
  shouldAllowMobileHtmlPreviewNavigation,
} from '../src/drones/mobile-html-preview-security';

describe('mobile rendered HTML preview security', () => {
  test('runs page scripts but disables every other active WebView capability', () => {
    const androidPolicy = mobileHtmlPreviewWebViewPolicy('android');
    const iosPolicy = mobileHtmlPreviewWebViewPolicy('ios');

    expect(androidPolicy.javaScriptEnabled).toBe(true);
    expect(iosPolicy.javaScriptEnabled).toBe(true);
    expect(androidPolicy.javaScriptCanOpenWindowsAutomatically).toBe(false);
    expect(androidPolicy.domStorageEnabled).toBe(false);
    expect(androidPolicy.cacheEnabled).toBe(false);
    expect(androidPolicy.allowFileAccess).toBe(false);
    expect(androidPolicy.allowFileAccessFromFileURLs).toBe(false);
    expect(androidPolicy.allowUniversalAccessFromFileURLs).toBe(false);
    expect(androidPolicy.thirdPartyCookiesEnabled).toBe(false);
    expect(androidPolicy.geolocationEnabled).toBe(false);
    expect(androidPolicy.paymentRequestEnabled).toBe(false);
    expect(iosPolicy.sharedCookiesEnabled).toBe(false);
    expect(iosPolicy.mediaCapturePermissionGrantType).toBe('deny');
  });

  test('does not send iOS-only native props to the Android Fabric component', () => {
    const androidPolicy = mobileHtmlPreviewWebViewPolicy('android');
    const iosPolicy = mobileHtmlPreviewWebViewPolicy('ios');

    expect(androidPolicy).not.toHaveProperty('dataDetectorTypes');
    expect(androidPolicy).not.toHaveProperty('mediaCapturePermissionGrantType');
    expect(iosPolicy.dataDetectorTypes).toEqual(['none']);
  });

  test('allows inline scripts while blocking network, form, object, and navigation capabilities', () => {
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("script-src 'unsafe-inline' data: blob:;");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain('img-src data: blob:;');
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("frame-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("navigate-to 'none'");
  });

  test('places the security policy before user-authored markup', () => {
    const source = '<script>alert("no")</script><a href="https://example.com">Leave</a>';
    const document = buildMobileHtmlPreviewDocument(source);

    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf(source));
    expect(document).toContain('<meta name="referrer" content="no-referrer">');
    expect(document).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
    expect(document).toEndWith(source);
    expect(document).not.toContain('<iframe');
  });

  test('rebuilds the document when live preview content changes', () => {
    const before = buildMobileHtmlPreviewDocument('<h1>Before</h1>');
    const after = buildMobileHtmlPreviewDocument('<h1>After</h1>');

    expect(after).not.toBe(before);
    expect(after).toEndWith('<h1>After</h1>');
  });

  test('allows only the inert document and its in-document fragments', () => {
    expect(shouldAllowMobileHtmlPreviewNavigation(MOBILE_HTML_PREVIEW_BASE_URL)).toBe(true);
    expect(shouldAllowMobileHtmlPreviewNavigation(`${MOBILE_HTML_PREVIEW_BASE_URL}#details`)).toBe(
      true,
    );
    expect(shouldAllowMobileHtmlPreviewNavigation('about:blank')).toBe(true);
    expect(shouldAllowMobileHtmlPreviewNavigation('about:srcdoc')).toBe(false);
    expect(shouldAllowMobileHtmlPreviewNavigation('https://drone-hub-preview.invalid/other')).toBe(
      false,
    );
    expect(
      shouldAllowMobileHtmlPreviewNavigation('https://drone-hub-preview.invalid/?next=1'),
    ).toBe(false);
    expect(shouldAllowMobileHtmlPreviewNavigation('https://example.com')).toBe(false);
    expect(
      shouldAllowMobileHtmlPreviewNavigation('https://drone-hub-preview.invalid.evil.test/'),
    ).toBe(false);
    expect(shouldAllowMobileHtmlPreviewNavigation('file:///data/private/report.html')).toBe(false);
    expect(shouldAllowMobileHtmlPreviewNavigation('data:text/html,hello')).toBe(false);
  });

  test('routes every URL through the deny-by-default navigation callback', () => {
    // A narrower list makes react-native-webview open non-matching URLs with Linking.
    expect(MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST).toEqual(['*']);
  });

  test('gives each page a URL that mirrors its file path and allows only that page', () => {
    const page = mobileHtmlPreviewDocumentUrl('/work/my site/index.html');
    expect(page).toBe('https://drone-hub-preview.invalid/work/my%20site/index.html');
    expect(shouldAllowMobileHtmlPreviewNavigation(page, page)).toBe(true);
    expect(shouldAllowMobileHtmlPreviewNavigation(`${page}#top`, page)).toBe(true);
    expect(shouldAllowMobileHtmlPreviewNavigation('https://drone-hub-preview.invalid/work/my%20site/other.html', page)).toBe(false);
    expect(shouldAllowMobileHtmlPreviewNavigation(MOBILE_HTML_PREVIEW_BASE_URL, page)).toBe(false);
  });

  test('reports blocked local images from a script that runs before the page', () => {
    const source = '<script>window.mine = 1</script>';
    const document = buildMobileHtmlPreviewDocument(source);
    expect(document.indexOf('securitypolicyviolation')).toBeLessThan(document.indexOf(source));
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf('securitypolicyviolation'));
    expect(document).toContain(MOBILE_HTML_PREVIEW_IMAGE_REQUEST);
  });

  test('a page with a media session loads media from that session only, with no message channel', () => {
    const mediaBase = 'https://hub.tail.ts.net/api/device-mesh/v2/html-preview/tok_en-1/';
    const source = '<img src="shot.png">';
    const document = buildMobileHtmlPreviewDocument(source, { mediaBase, htmlPath: '/work/my site/index.html' });
    expect(document).toStartWith(`<!doctype html><base href="${mediaBase}work/my%20site/index.html"><meta http-equiv="Content-Security-Policy"`);
    expect(document).toContain(`img-src data: blob: ${mediaBase};`);
    expect(document).toContain(`media-src data: blob: ${mediaBase};`);
    expect(document).toContain(`frame-src ${mediaBase};`);
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).not.toContain('securitypolicyviolation');
    expect(document).toEndWith(source);
  });

  test('frames load only from the page\'s media session', () => {
    const mediaBase = 'https://hub.tail.ts.net/api/device-mesh/v2/html-preview/tok_en-1/';
    expect(shouldAllowMobileHtmlPreviewFrameLoad(`${mediaBase}work/site/viewer-3d.html`, mediaBase)).toBe(true);
    expect(shouldAllowMobileHtmlPreviewFrameLoad('about:blank', null)).toBe(true);
    expect(shouldAllowMobileHtmlPreviewFrameLoad(`${mediaBase}work/site/viewer-3d.html`, null)).toBe(false);
    expect(shouldAllowMobileHtmlPreviewFrameLoad('https://hub.tail.ts.net/api/device-mesh/v2/html-preview/other/a.html', mediaBase)).toBe(false);
    expect(shouldAllowMobileHtmlPreviewFrameLoad('https://example.com/', mediaBase)).toBe(false);
    expect(shouldAllowMobileHtmlPreviewFrameLoad('https://drone-hub-preview.invalid/work/site/viewer-3d.html', mediaBase)).toBe(false);
  });

  test('accepts only plain HTTPS session URLs that cannot alter the policy', () => {
    expect(mobileHtmlPreviewMediaBase('https://hub.ts.net/api/x/tok/')).toBe('https://hub.ts.net/api/x/tok/');
    expect(mobileHtmlPreviewMediaBase('https://hub.ts.net:8443/x/')).toBe('https://hub.ts.net:8443/x/');
    for (const value of ['http://hub/x/', 'https://hub/x', 'https://hub/x/t;k/', 'https://hub/x/"/', 'https://hub/x/ y/', 'https://u@hub/x/', 'https://hub/x/?q/', null]) {
      expect(mobileHtmlPreviewMediaBase(value)).toBeNull();
    }
  });
});
