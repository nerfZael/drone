import { describe, expect, test } from 'bun:test';
import { applyReadingDensity, normalizeReadingDensityMode } from '../src/reading-density';

describe('desktop reading density', () => {
  test('normalizes unknown preferences to the default scale', () => {
    expect(normalizeReadingDensityMode('comfortable')).toBe('comfortable');
    expect(normalizeReadingDensityMode('default')).toBe('default');
    expect(normalizeReadingDensityMode('large')).toBe('default');
  });

  test('can resolve density without a DOM', () => {
    expect(applyReadingDensity('comfortable')).toBe('comfortable');
  });
});
