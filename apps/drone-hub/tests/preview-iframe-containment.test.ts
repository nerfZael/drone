import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  isPreviewFocusUserRequested,
  NO_PREVIEW_POINTER_TIME,
  PREVIEW_FOCUS_INTENT_MS,
  PREVIEW_IFRAME_STORAGE_SANDBOX,
  PREVIEW_IFRAME_STRICT_SANDBOX,
  previewIframeSandboxForUrl,
} from '../src/droneHub/overview/preview-iframe-containment';

describe('preview iframe containment', () => {
  test('sets the Browser iframe sandbox from the selected preview URL', () => {
    const dockSource = readFileSync(new URL('../src/droneHub/overview/DronePreviewDock.tsx', import.meta.url), 'utf8');

    expect(dockSource).toContain('sandbox={previewIframeSandbox}');
    expect(dockSource).toContain("document.addEventListener('focusout'");
    expect(dockSource).toContain("window.addEventListener('blur'");
    expect(PREVIEW_IFRAME_STRICT_SANDBOX).toContain('allow-scripts');
    expect(PREVIEW_IFRAME_STRICT_SANDBOX).not.toContain('allow-same-origin');
    expect(PREVIEW_IFRAME_STRICT_SANDBOX).not.toContain('allow-top-navigation');
    expect(PREVIEW_IFRAME_STORAGE_SANDBOX).toContain('allow-same-origin');
    expect(PREVIEW_IFRAME_STORAGE_SANDBOX).not.toContain('allow-top-navigation');
  });

  test('preserves app storage only for isolated preview origins', () => {
    const hubOrigin = 'http://localhost:5173';

    expect(previewIframeSandboxForUrl('http://localhost:45123/', hubOrigin)).toBe(PREVIEW_IFRAME_STORAGE_SANDBOX);
    expect(previewIframeSandboxForUrl('https://example.com/app', hubOrigin)).toBe(PREVIEW_IFRAME_STORAGE_SANDBOX);
    expect(previewIframeSandboxForUrl('/api/drones/drone-1/preview/3000/', hubOrigin)).toBe(PREVIEW_IFRAME_STRICT_SANDBOX);
    expect(previewIframeSandboxForUrl('http://localhost:5173/api/drones/drone-1/preview/3000/', hubOrigin)).toBe(PREVIEW_IFRAME_STRICT_SANDBOX);
  });

  test('does not treat startup iframe focus as user-requested focus', () => {
    expect(isPreviewFocusUserRequested(100, NO_PREVIEW_POINTER_TIME)).toBe(false);
    expect(isPreviewFocusUserRequested(1000, 1000 - PREVIEW_FOCUS_INTENT_MS + 1)).toBe(true);
    expect(isPreviewFocusUserRequested(1000, 1000 - PREVIEW_FOCUS_INTENT_MS)).toBe(false);
  });
});
