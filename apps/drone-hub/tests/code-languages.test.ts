import { describe, expect, test } from 'bun:test';
import { defaultTextFileViewModeForPath, isMarkdownPath } from '../src/droneHub/code-languages';

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
});
