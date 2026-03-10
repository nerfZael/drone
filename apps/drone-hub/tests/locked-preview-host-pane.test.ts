import { describe, expect, test } from 'bun:test';
import { resolvePreviewHostPane } from '../src/droneHub/app/locked-preview-host-pane';

describe('resolvePreviewHostPane', () => {
  test('returns single when Browser is visible in single-pane mode', () => {
    expect(
      resolvePreviewHostPane({
        previewVisible: true,
        rightPanelSplit: false,
        rightPanelTab: 'preview',
        rightPanelBottomTab: 'terminal',
      }),
    ).toBe('single');
  });

  test('keeps Browser attached to the top preview pane in split mode', () => {
    expect(
      resolvePreviewHostPane({
        previewVisible: true,
        rightPanelSplit: true,
        rightPanelTab: 'preview',
        rightPanelBottomTab: 'terminal',
      }),
    ).toBe('top');
  });

  test('falls back to the bottom preview pane when only the bottom pane is showing Browser', () => {
    expect(
      resolvePreviewHostPane({
        previewVisible: true,
        rightPanelSplit: true,
        rightPanelTab: 'terminal',
        rightPanelBottomTab: 'preview',
      }),
    ).toBe('bottom');
  });

  test('prefers the top pane when both split panes are set to Browser', () => {
    expect(
      resolvePreviewHostPane({
        previewVisible: true,
        rightPanelSplit: true,
        rightPanelTab: 'preview',
        rightPanelBottomTab: 'preview',
      }),
    ).toBe('top');
  });

  test('hides the Browser host when no visible pane is on Browser', () => {
    expect(
      resolvePreviewHostPane({
        previewVisible: true,
        rightPanelSplit: true,
        rightPanelTab: 'terminal',
        rightPanelBottomTab: 'files',
      }),
    ).toBeNull();
  });

  test('returns null when Browser is not visible at all', () => {
    expect(
      resolvePreviewHostPane({
        previewVisible: false,
        rightPanelSplit: false,
        rightPanelTab: 'preview',
        rightPanelBottomTab: 'terminal',
      }),
    ).toBeNull();
  });
});
