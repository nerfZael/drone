import { describe, expect, test } from 'bun:test';
import { normalizeDesktopZoomPercent } from '../src/droneHub/app/DesktopZoomToast';

describe('desktop zoom toast', () => {
  test('accepts valid desktop zoom notifications', () => {
    expect(normalizeDesktopZoomPercent(110)).toBe(110);
    expect(normalizeDesktopZoomPercent('125')).toBe(125);
  });

  test('ignores malformed or implausible notifications', () => {
    expect(normalizeDesktopZoomPercent(undefined)).toBeNull();
    expect(normalizeDesktopZoomPercent('not-a-number')).toBeNull();
    expect(normalizeDesktopZoomPercent(400)).toBeNull();
  });
});
