import { describe, expect, test } from 'bun:test';
import {
  buildIsolatedHtmlPreviewDocument,
  HTML_PREVIEW_CONTENT_SECURITY_POLICY,
  HTML_PREVIEW_IFRAME_SANDBOX,
  HTML_PREVIEW_PERMISSIONS_POLICY,
} from '../src/droneHub/files/html-preview-security';

describe('isolated HTML preview', () => {
  test('allows scripts without granting origin, navigation, form, or popup capabilities', () => {
    expect(HTML_PREVIEW_IFRAME_SANDBOX).toBe('allow-scripts');
    expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain('allow-top-navigation');
    expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain('allow-forms');
    expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain('allow-popups');
  });

  test('denies sensitive browser capabilities', () => {
    expect(HTML_PREVIEW_PERMISSIONS_POLICY).toContain("camera 'none'");
    expect(HTML_PREVIEW_PERMISSIONS_POLICY).toContain("microphone 'none'");
    expect(HTML_PREVIEW_PERMISSIONS_POLICY).toContain("geolocation 'none'");
    expect(HTML_PREVIEW_PERMISSIONS_POLICY).toContain("clipboard-read 'none'");
    expect(HTML_PREVIEW_PERMISSIONS_POLICY).toContain("display-capture 'none'");
  });

  test('blocks network and embedding while permitting inline HTML, CSS, and JavaScript', () => {
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("frame-src 'none'");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("form-action 'none'");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("navigate-to 'none'");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).toContain("script-src 'unsafe-inline'");
    expect(HTML_PREVIEW_CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
  });

  test('places the security policy before user-authored scripts', () => {
    const source = '<script>window.previewRan = true</script><h1>Hello</h1>';
    const document = buildIsolatedHtmlPreviewDocument(source);

    expect(document.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf(source));
    expect(document.indexOf("document.addEventListener('click'")).toBeLessThan(document.indexOf(source));
    expect(document).toContain('<meta name="referrer" content="no-referrer">');
    expect(document).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
    expect(document).toEndWith(source);
  });

  test('keeps absolute hash links inside the preview and blocks other navigation', () => {
    const document = buildIsolatedHtmlPreviewDocument(
      '<a href="http://localhost:5174/#map">Map</a><section id="map"></section>',
    );

    expect(document).toContain('document.getElementById(fragment)');
    expect(document).toContain('location.hash = target.hash');
    expect(document).toContain('destination.scrollIntoView()');
    expect(document).toContain('event.preventDefault()');
    expect(document).toContain('event.stopImmediatePropagation()');
  });
});
