import { describe, expect, test } from 'bun:test';
import {
  desktopSyntaxLanguageForFence,
  highlightDesktopCodeFence,
} from '../src/droneHub/chat/desktop-syntax-highlighting';

describe('desktop chat syntax highlighting', () => {
  test('normalizes common fenced language aliases', () => {
    expect(desktopSyntaxLanguageForFence('ts')).toBe('typescript');
    expect(desktopSyntaxLanguageForFence('sh')).toBe('bash');
    expect(desktopSyntaxLanguageForFence('unknown')).toBeNull();
  });

  test('preserves source text while assigning syntax token classes', () => {
    const source = 'const answer: number = 42;';
    const result = highlightDesktopCodeFence(source, 'ts');
    expect(result.highlighted).toBe(true);
    expect(result.tokens.map((token) => token.text).join('')).toBe(source);
    expect(result.tokens.some((token) => token.types.includes('keyword'))).toBe(true);
    expect(result.tokens.some((token) => token.types.includes('number'))).toBe(true);
  });
});
