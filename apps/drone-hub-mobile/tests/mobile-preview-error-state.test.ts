import { describe, expect, test } from 'bun:test';

import { mobilePreviewErrorMode } from '../src/drones/mobile-preview-error-state';

describe('mobile preview refresh errors', () => {
  test('keeps stale text and media previews usable when revalidation fails', () => {
    for (const previewKind of ['text', 'image', 'video'] as const) {
      expect(mobilePreviewErrorMode({ background: true, previewKind })).toBe('refresh');
    }
  });

  test('uses the blocking error state for cold loads and cleared contexts', () => {
    expect(mobilePreviewErrorMode({ background: false, previewKind: null })).toBe('blocking');
    expect(mobilePreviewErrorMode({ background: true, previewKind: null })).toBe('blocking');
  });
});
