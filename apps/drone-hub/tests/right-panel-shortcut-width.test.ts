import { describe, expect, test } from 'bun:test';
import { resolveNextRightPanelShortcutWidth } from '../src/droneHub/app/right-panel-shortcut-width';

describe('right panel width shortcut cycle', () => {
  test('cycles full -> two-thirds -> one-third -> full', () => {
    const maxWidth = 900;
    const full = resolveNextRightPanelShortcutWidth(300, maxWidth);
    const twoThirds = resolveNextRightPanelShortcutWidth(full, maxWidth);
    const oneThird = resolveNextRightPanelShortcutWidth(twoThirds, maxWidth);
    const backToFull = resolveNextRightPanelShortcutWidth(oneThird, maxWidth);

    expect(full).toBe(900);
    expect(twoThirds).toBe(600);
    expect(oneThird).toBe(360);
    expect(backToFull).toBe(900);
  });

  test('falls back to full width when current width is not on a shortcut stop', () => {
    expect(resolveNextRightPanelShortcutWidth(517, 1200)).toBe(1200);
  });

  test('deduplicates stops when workspace is narrow', () => {
    const maxWidth = 400;
    const full = resolveNextRightPanelShortcutWidth(360, maxWidth);
    const next = resolveNextRightPanelShortcutWidth(full, maxWidth);
    expect(full).toBe(400);
    expect(next).toBe(360);
  });
});
