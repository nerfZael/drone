import { describe, expect, test } from 'bun:test';
import { resolveNextRightPanelShortcutWidth } from '../src/droneHub/app/right-panel-shortcut-width';
import {
  clampCustomRightPanelWidthPx,
  resolveRightPanelWidthModeFromWidth,
  resolveRightPanelWidthPx,
  resolveRightPanelWidthStyleValue,
  rightPanelVisibleMaxWidthPx,
} from '../src/droneHub/app/right-panel-width';

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

  test('preset widths stay proportional when workspace width changes', () => {
    expect(resolveRightPanelWidthPx('two-thirds', 460, 1200)).toBe(800);
    expect(resolveRightPanelWidthPx('two-thirds', 460, 900)).toBe(600);
    expect(resolveRightPanelWidthPx('full', 460, 1200)).toBe(1200);
    expect(resolveRightPanelWidthPx('full', 460, 900)).toBe(900);
  });

  test('custom widths keep chat from being squeezed below the reserved third', () => {
    expect(clampCustomRightPanelWidthPx(950, 1200)).toBe(800);
    expect(clampCustomRightPanelWidthPx(720, 900)).toBe(600);
    expect(rightPanelVisibleMaxWidthPx(1200)).toBe(800);
  });

  test('matches preset modes from current rendered width', () => {
    expect(resolveRightPanelWidthModeFromWidth(1200, 1200)).toBe('full');
    expect(resolveRightPanelWidthModeFromWidth(800, 1200)).toBe('two-thirds');
    expect(resolveRightPanelWidthModeFromWidth(400, 1200)).toBe('one-third');
    expect(resolveRightPanelWidthModeFromWidth(517, 1200)).toBe('custom');
  });

  test('preset styles use percentages so they track sidebar animation continuously', () => {
    expect(resolveRightPanelWidthStyleValue('full', 1200)).toBe('100%');
    expect(resolveRightPanelWidthStyleValue('two-thirds', 800)).toBe(`${(2 / 3) * 100}%`);
    expect(resolveRightPanelWidthStyleValue('one-third', 400)).toBe(`${(1 / 3) * 100}%`);
    expect(resolveRightPanelWidthStyleValue('custom', 517)).toBe(517);
  });
});
