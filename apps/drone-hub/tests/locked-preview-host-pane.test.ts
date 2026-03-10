import { describe, expect, test } from 'bun:test';
import { resolveLockedPreviewHostPane } from '../src/droneHub/app/locked-preview-host-pane';

describe('resolveLockedPreviewHostPane', () => {
  test('returns single when the browser is locked in single-pane mode', () => {
    expect(
      resolveLockedPreviewHostPane({
        previewLocked: true,
        rightPanelSplit: false,
        rightPanelTab: 'preview',
        rightPanelBottomTab: 'terminal',
      }),
    ).toBe('single');
  });

  test('keeps the locked browser attached to the top preview pane in split mode', () => {
    expect(
      resolveLockedPreviewHostPane({
        previewLocked: true,
        rightPanelSplit: true,
        rightPanelTab: 'preview',
        rightPanelBottomTab: 'terminal',
      }),
    ).toBe('top');
  });

  test('falls back to the bottom preview pane when only the bottom pane is showing Browser', () => {
    expect(
      resolveLockedPreviewHostPane({
        previewLocked: true,
        rightPanelSplit: true,
        rightPanelTab: 'terminal',
        rightPanelBottomTab: 'preview',
      }),
    ).toBe('bottom');
  });

  test('prefers the top pane when both split panes are set to Browser', () => {
    expect(
      resolveLockedPreviewHostPane({
        previewLocked: true,
        rightPanelSplit: true,
        rightPanelTab: 'preview',
        rightPanelBottomTab: 'preview',
      }),
    ).toBe('top');
  });

  test('hides the locked browser host when no visible pane is on Browser', () => {
    expect(
      resolveLockedPreviewHostPane({
        previewLocked: true,
        rightPanelSplit: true,
        rightPanelTab: 'terminal',
        rightPanelBottomTab: 'files',
      }),
    ).toBeNull();
  });
});
