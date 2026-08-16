import { describe, expect, test } from 'bun:test';
import {
  COMPANION_SHORTCUT_DOUBLE_TAP_MS,
  isCompanionShortcutDoubleTap,
} from '../src/droneHub/companion/companion-shortcut';

describe('Companion shortcut double tap', () => {
  test('closes only when the second press is relatively quick', () => {
    expect(isCompanionShortcutDoubleTap(1_000, 1_000 + COMPANION_SHORTCUT_DOUBLE_TAP_MS)).toBe(true);
    expect(isCompanionShortcutDoubleTap(1_000, 1_001 + COMPANION_SHORTCUT_DOUBLE_TAP_MS)).toBe(false);
    expect(isCompanionShortcutDoubleTap(0, 100)).toBe(false);
  });
});
