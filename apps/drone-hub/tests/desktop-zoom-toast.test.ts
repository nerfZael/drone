import { describe, expect, test } from 'bun:test';
import {
  nextNavigationExplorerZoom,
  navigationZoomActionForKeyboardEvent,
  normalizeNavigationZoomAction,
} from '../src/droneHub/app/NavigationSizeController';

describe('desktop navigation sizing', () => {
  test('accepts only supported shortcut actions', () => {
    expect(normalizeNavigationZoomAction('in')).toBe('in');
    expect(normalizeNavigationZoomAction('out')).toBe('out');
    expect(normalizeNavigationZoomAction('reset')).toBe('reset');
    expect(normalizeNavigationZoomAction('larger')).toBeNull();
  });

  test('captures browser zoom keys for navigation sizing', () => {
    expect(navigationZoomActionForKeyboardEvent({
      altKey: false,
      code: 'Equal',
      ctrlKey: true,
      key: '+',
      metaKey: false,
    })).toBe('in');
    expect(navigationZoomActionForKeyboardEvent({
      altKey: false,
      code: 'Minus',
      ctrlKey: false,
      key: '-',
      metaKey: true,
    })).toBe('out');
    expect(navigationZoomActionForKeyboardEvent({
      altKey: false,
      code: 'Digit0',
      ctrlKey: true,
      key: '0',
      metaKey: false,
    })).toBe('reset');
    expect(navigationZoomActionForKeyboardEvent({
      altKey: false,
      code: 'Equal',
      ctrlKey: false,
      key: '=',
      metaKey: false,
    })).toBeNull();
  });

  test('steps, clamps, and resets navigation item zoom', () => {
    expect(nextNavigationExplorerZoom(1, 'in')).toBe(1.05);
    expect(nextNavigationExplorerZoom(1, 'out')).toBe(0.95);
    expect(nextNavigationExplorerZoom(2, 'in')).toBe(2);
    expect(nextNavigationExplorerZoom(0.5, 'out')).toBe(0.5);
    expect(nextNavigationExplorerZoom(0.5, 'reset')).toBe(1);
  });
});
