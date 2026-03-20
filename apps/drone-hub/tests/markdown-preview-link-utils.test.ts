import { describe, expect, test } from 'bun:test';
import { resolveMarkdownPreviewLinkTarget } from '../src/droneHub/files/markdown-preview-link-utils';

describe('resolveMarkdownPreviewLinkTarget', () => {
  test('resolves sibling markdown links relative to the current file', () => {
    expect(resolveMarkdownPreviewLinkTarget('/work/repo/docs/guide.md', './intro.md')).toEqual({
      path: '/work/repo/docs/intro.md',
      line: null,
      column: null,
    });
  });

  test('resolves parent-directory links and preserves line anchors', () => {
    expect(resolveMarkdownPreviewLinkTarget('/work/repo/docs/setup/guide.md', '../README.md#L12')).toEqual({
      path: '/work/repo/docs/README.md',
      line: 12,
      column: null,
    });
  });

  test('opens cross-file heading links by stripping the fragment', () => {
    expect(resolveMarkdownPreviewLinkTarget('/work/repo/docs/setup/guide.md', '../README.md#getting-started')).toEqual({
      path: '/work/repo/docs/README.md',
      line: null,
      column: null,
    });
  });

  test('ignores external and in-document anchors', () => {
    expect(resolveMarkdownPreviewLinkTarget('/work/repo/docs/guide.md', 'https://example.com')).toBeNull();
    expect(resolveMarkdownPreviewLinkTarget('/work/repo/docs/guide.md', '#local-heading')).toBeNull();
  });
});
