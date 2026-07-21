import { describe, expect, test } from 'bun:test';
import {
  highlightMobileCode,
  MOBILE_SYNTAX_HIGHLIGHT_MAX_CHARS,
  mobileSyntaxLanguageForFile,
} from '../src/drones/mobile-syntax-highlighting';

describe('mobile syntax highlighting', () => {
  test('detects languages from filenames, extensions, and MIME types', () => {
    expect(mobileSyntaxLanguageForFile('/work/repo/src/App.tsx')).toBe('tsx');
    expect(mobileSyntaxLanguageForFile('/work/repo/src/Program.cs')).toBe('csharp');
    expect(mobileSyntaxLanguageForFile('/work/repo/Dockerfile')).toBe('docker');
    expect(mobileSyntaxLanguageForFile('/work/repo/.env.local')).toBe('bash');
    expect(mobileSyntaxLanguageForFile('/work/repo/data', 'application/json; charset=utf-8')).toBe(
      'json',
    );
    expect(mobileSyntaxLanguageForFile('/work/repo/notes.txt', 'text/plain')).toBeNull();
  });

  test('returns Prism tokens while preserving the source exactly', () => {
    const source = 'const answer: number = 42; // final\n';
    const result = highlightMobileCode(source, '/work/repo/src/answer.ts', 'text/plain');

    expect(result.highlighted).toBe(true);
    expect(result.language).toBe('typescript');
    expect(result.tokens.map((token) => token.text).join('')).toBe(source);
    expect(result.tokens).toContainEqual({ text: 'const', types: ['keyword'] });
    expect(result.tokens).toContainEqual({ text: '42', types: ['number'] });
    expect(result.tokens).toContainEqual({ text: '// final', types: ['comment'] });
  });

  test('keeps unknown and very large files as lightweight plain text', () => {
    expect(highlightMobileCode('hello', '/work/repo/notes.txt', 'text/plain')).toEqual({
      highlighted: false,
      language: null,
      tokens: [{ text: 'hello', types: [] }],
    });

    const largeSource = 'x'.repeat(MOBILE_SYNTAX_HIGHLIGHT_MAX_CHARS + 1);
    const large = highlightMobileCode(largeSource, '/work/repo/large.js');
    expect(large.highlighted).toBe(false);
    expect(large.language).toBe('javascript');
    expect(large.tokens).toEqual([{ text: largeSource, types: [] }]);
  });
});
