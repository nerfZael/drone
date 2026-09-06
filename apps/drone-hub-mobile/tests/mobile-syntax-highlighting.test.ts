import { describe, expect, test } from 'bun:test';
import {
  highlightMobileCode,
  highlightMobileCodeFence,
  highlightMobileEditorCode,
  MOBILE_EDITOR_HIGHLIGHT_MAX_CHARS,
  MOBILE_SYNTAX_HIGHLIGHT_MAX_CHARS,
  mobileSyntaxLanguageForFence,
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

  test('highlights fenced chat code using common language aliases', () => {
    expect(mobileSyntaxLanguageForFence('ts')).toBe('typescript');
    expect(mobileSyntaxLanguageForFence('shell')).toBe('bash');
    expect(mobileSyntaxLanguageForFence('plaintext')).toBeNull();

    const source = 'const ready: boolean = true;';
    const result = highlightMobileCodeFence(source, 'ts');
    expect(result.highlighted).toBe(true);
    expect(result.language).toBe('typescript');
    expect(result.tokens.map((token) => token.text).join('')).toBe(source);
    expect(result.tokens).toContainEqual({ text: 'const', types: ['keyword'] });
    expect(result.tokens).toContainEqual({ text: 'true', types: ['boolean'] });
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

describe('mobile editor highlighting', () => {
  test('recognises the added languages by extension and filename', () => {
    expect(mobileSyntaxLanguageForFile('README.md')).toBe('markdown');
    expect(mobileSyntaxLanguageForFile('notes.markdown')).toBe('markdown');
    expect(mobileSyntaxLanguageForFile('App.swift')).toBe('swift');
    expect(mobileSyntaxLanguageForFile('main.dart')).toBe('dart');
    expect(mobileSyntaxLanguageForFile('init.lua')).toBe('lua');
    expect(mobileSyntaxLanguageForFile('deploy.ps1')).toBe('powershell');
    expect(mobileSyntaxLanguageForFile('main.tf')).toBe('hcl');
    expect(mobileSyntaxLanguageForFile('api.proto')).toBe('protobuf');
    expect(mobileSyntaxLanguageForFile('.gitignore')).toBe('ignore');
    expect(mobileSyntaxLanguageForFile('index.html')).toBe('markup');
    expect(mobileSyntaxLanguageForFile('styles.css')).toBe('css');
    expect(mobileSyntaxLanguageForFile('notes.txt')).toBeNull();
  });

  test('highlights markdown headings and code while preserving the source', () => {
    const source = '# Title\n\nSome **bold** text and `code`.\n';
    const result = highlightMobileEditorCode(source, 'doc.md');
    expect(result.highlighted).toBe(true);
    expect(result.tokens.map((token) => token.text).join('')).toBe(source);
    expect(result.tokens.some((token) => token.types.includes('title'))).toBe(true);
    expect(result.tokens.some((token) => token.types.includes('bold'))).toBe(true);
  });

  test('keeps large editor buffers plain so typing stays responsive', () => {
    const small = highlightMobileEditorCode('const a = 1;', 'a.ts');
    expect(small.highlighted).toBe(true);
    const large = highlightMobileEditorCode(
      'x'.repeat(MOBILE_EDITOR_HIGHLIGHT_MAX_CHARS + 1),
      'a.ts',
    );
    expect(large.highlighted).toBe(false);
    expect(large.tokens.map((token) => token.text).join('')).toHaveLength(
      MOBILE_EDITOR_HIGHLIGHT_MAX_CHARS + 1,
    );
  });
});
