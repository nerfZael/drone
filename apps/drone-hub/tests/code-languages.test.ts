import { describe, expect, test } from 'bun:test';
import {
  defaultTextFileViewModeForFile,
  defaultTextFileViewModeForPath,
  isHtmlFile,
  isHtmlMime,
  isHtmlPath,
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

  test('detects HTML files and defaults them to preview mode', () => {
    expect(isHtmlPath('/work/repo/index.html')).toBe(true);
    expect(isHtmlPath('/work/repo/legacy.htm')).toBe(true);
    expect(isHtmlPath('/work/repo/index.ts')).toBe(false);
    expect(isHtmlMime('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlMime('application/xhtml+xml')).toBe(true);
    expect(isHtmlFile('/work/repo/page', 'text/html')).toBe(true);
    expect(defaultTextFileViewModeForPath('/work/repo/index.html')).toBe('preview');
    expect(defaultTextFileViewModeForFile('/work/repo/page', 'text/html')).toBe('preview');
  });
});
