import { describe, expect, test } from 'bun:test';
import {
  defaultTextFileViewModeForFile,
  defaultTextFileViewModeForPath,
  isMarkdownFile,
  isMarkdownMime,
  isMarkdownPath,
} from '../src/droneHub/code-languages';

describe('code language helpers', () => {
  test('detects markdown paths', () => {
    expect(isMarkdownPath('/work/repo/README.md')).toBe(true);
    expect(isMarkdownPath('docs/guide.mdx')).toBe(true);
    expect(isMarkdownPath('src/index.ts')).toBe(false);
  });

  test('defaults markdown files to preview mode', () => {
    expect(defaultTextFileViewModeForPath('README.md')).toBe('preview');
    expect(defaultTextFileViewModeForPath('docs/guide.mdx')).toBe('preview');
    expect(defaultTextFileViewModeForPath('src/index.ts')).toBe('edit');
  });

  test('detects markdown by mime when the path is ambiguous', () => {
    expect(isMarkdownMime('text/markdown')).toBe(true);
    expect(isMarkdownMime('text/markdown; charset=utf-8')).toBe(true);
    expect(isMarkdownMime('text/plain')).toBe(false);
    expect(isMarkdownFile('/work/repo/README', 'text/markdown')).toBe(true);
    expect(defaultTextFileViewModeForFile('/work/repo/README', 'text/markdown')).toBe('preview');
    expect(defaultTextFileViewModeForFile('/work/repo/README', 'text/plain')).toBe('edit');
  });
});
