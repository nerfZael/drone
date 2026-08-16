import { describe, expect, test } from 'bun:test';
import {
  COMPANION_SHORTCUT_DOUBLE_TAP_MS,
  isCompanionShortcutDoubleTap,
  shouldConsumeCompanionProposalShortcut,
  shouldCancelCompanionRecordingWithEscape,
} from '../src/droneHub/companion/companion-shortcut';

describe('Companion proposal shortcut', () => {
  test('consumes Caps Lock even while Apply is unavailable so capitalization is not toggled', () => {
    expect(shouldConsumeCompanionProposalShortcut({
      matched: true,
      shortcutKey: 'capslock',
      canApply: false,
    })).toBe(true);
    expect(shouldConsumeCompanionProposalShortcut({
      matched: true,
      shortcutKey: 'capslock',
      canApply: true,
    })).toBe(true);
  });

  test('does not swallow an unavailable custom binding or unrelated key', () => {
    expect(shouldConsumeCompanionProposalShortcut({
      matched: true,
      shortcutKey: 'k',
      canApply: false,
    })).toBe(false);
    expect(shouldConsumeCompanionProposalShortcut({
      matched: false,
      shortcutKey: 'capslock',
      canApply: true,
    })).toBe(false);
  });
});

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
