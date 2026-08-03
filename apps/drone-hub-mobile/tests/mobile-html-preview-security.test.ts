import { describe, expect, test } from 'bun:test';
import {
  buildMobileHtmlPreviewDocument,
  mobileHtmlPreviewWebViewPolicy,
  MOBILE_HTML_PREVIEW_BASE_URL,
  MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST,
  shouldAllowMobileHtmlPreviewNavigation,
} from '../src/drones/mobile-html-preview-security';

describe('mobile rendered HTML preview security', () => {
  test('disables active WebView capabilities', () => {
    const androidPolicy = mobileHtmlPreviewWebViewPolicy('android');
    const iosPolicy = mobileHtmlPreviewWebViewPolicy('ios');

    expect(androidPolicy.javaScriptEnabled).toBe(false);
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

  test('blocks script, network, form, object, and top navigation capabilities', () => {
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("script-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("navigate-to 'none'");
    expect(MOBILE_HTML_PREVIEW_CONTENT_SECURITY_POLICY).not.toContain("script-src 'unsafe-inline'");
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
});
