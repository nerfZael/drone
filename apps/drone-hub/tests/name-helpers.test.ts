import { describe, expect, test } from 'bun:test';
import { allocateUntitledDisplayName, isUntitledLikeDroneName, normalizeDraftDroneName } from '../src/droneHub/app/name-helpers';

describe('name helpers', () => {
  test('allocates the next available untitled display name', () => {
    expect(allocateUntitledDisplayName(['Untitled 1', 'billing', 'untitled 3'])).toBe('Untitled 2');
    expect(allocateUntitledDisplayName(['Untitled', 'Untitled 1', 'Untitled 2'])).toBe('Untitled 3');
  });

  test('detects untitled-like draft names', () => {
    expect(isUntitledLikeDroneName('untitled')).toBe(true);
    expect(isUntitledLikeDroneName('untitled-2')).toBe(true);
    expect(isUntitledLikeDroneName('billing')).toBe(false);
  });

  test('normalizes draft drone names', () => {
    expect(normalizeDraftDroneName(' Billing Fix  ')).toBe('billing-fix');
  });
});
