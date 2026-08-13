import { describe, expect, test } from 'bun:test';
import {
  appendFileDictationLine,
  formatFileDictationLine,
  formatFileDictationTimestamp,
} from '../src/droneHub/files/file-dictation-text';

describe('file dictation text', () => {
  test('places each thought on the next line without adding a blank paragraph', () => {
    expect(appendFileDictationLine('', 'First thought.')).toBe('First thought.');
    expect(appendFileDictationLine('Existing content', 'First thought.')).toBe(
      'Existing content\nFirst thought.',
    );
    expect(appendFileDictationLine('Existing content\n', 'First thought.')).toBe(
      'Existing content\nFirst thought.',
    );
  });

  test('does not change content for an empty thought', () => {
    expect(appendFileDictationLine('Existing content  ', '   ')).toBe('Existing content  ');
  });

  test('formats local timestamps without seconds', () => {
    const date = new Date(2026, 7, 13, 9, 5, 42);
    expect(formatFileDictationTimestamp(date)).toBe('2026-08-13 09:05');
    expect(formatFileDictationLine('A timestamped thought.', date)).toBe(
      '[2026-08-13 09:05] A timestamped thought.',
    );
    expect(formatFileDictationLine('A plain thought.', null)).toBe('A plain thought.');
  });
});
