import { describe, expect, test } from 'bun:test';
import {
  COMPANION_SHORTCUT_DOUBLE_TAP_MS,
  isCompanionShortcutDoubleTap,
  shouldCancelCompanionRecordingWithEscape,
} from '../src/droneHub/companion/companion-shortcut';

describe('Companion shortcut double tap', () => {
  test('closes only when the second press is relatively quick', () => {
    expect(isCompanionShortcutDoubleTap(1_000, 1_000 + COMPANION_SHORTCUT_DOUBLE_TAP_MS)).toBe(true);
    expect(isCompanionShortcutDoubleTap(1_000, 1_001 + COMPANION_SHORTCUT_DOUBLE_TAP_MS)).toBe(false);
    expect(isCompanionShortcutDoubleTap(0, 100)).toBe(false);
  });
});

describe('Companion recording Escape shortcut', () => {
  test('cancels only an active recording lifecycle', () => {
    for (const voiceStatus of ['starting', 'recording', 'paused']) {
      expect(shouldCancelCompanionRecordingWithEscape({
        key: 'Escape',
        repeat: false,
        isComposing: false,
        voiceStatus,
      })).toBe(true);
    }
    for (const voiceStatus of ['idle', 'transcribing']) {
      expect(shouldCancelCompanionRecordingWithEscape({
        key: 'Escape',
        repeat: false,
        isComposing: false,
        voiceStatus,
      })).toBe(false);
    }
  });

  test('leaves repeated, composing, and unrelated key presses alone', () => {
    expect(shouldCancelCompanionRecordingWithEscape({
      key: 'Enter',
      repeat: false,
      isComposing: false,
      voiceStatus: 'recording',
    })).toBe(false);
    expect(shouldCancelCompanionRecordingWithEscape({
      key: 'Escape',
      repeat: true,
      isComposing: false,
      voiceStatus: 'recording',
    })).toBe(false);
    expect(shouldCancelCompanionRecordingWithEscape({
      key: 'Escape',
      repeat: false,
      isComposing: true,
      voiceStatus: 'recording',
    })).toBe(false);
  });
});
