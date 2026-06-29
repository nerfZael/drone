import { describe, expect, test } from 'bun:test';
import { normalizeWakeConfirmationText, wakeConfirmationMatches } from './wake-confirmation.js';

describe('wake confirmation', () => {
  test('normalizes punctuation, case, whitespace, and accents', () => {
    expect(normalizeWakeConfirmationText('  Wáke,   UP now!! ')).toBe('wake up now');
  });

  test('confirms only exact normalized phrase matches', () => {
    expect(wakeConfirmationMatches('Wake up now.', 'wake up now')).toBe(true);
    expect(wakeConfirmationMatches('please wake up now', 'wake up now')).toBe(false);
    expect(wakeConfirmationMatches('wake up', 'wake up now')).toBe(false);
  });
});
