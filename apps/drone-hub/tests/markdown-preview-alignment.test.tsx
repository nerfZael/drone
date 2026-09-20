import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownOutlinePreview } from '../src/droneHub/files/MarkdownOutlinePreview';
import {
  getMarkdownPreviewAlignment,
  normalizeMarkdownPreviewAlignment,
  setMarkdownPreviewAlignment,
  toggleMarkdownPreviewAlignment,
} from '../src/droneHub/files/markdown-preview-alignment';

describe('markdown preview alignment', () => {
  test('centres by default and only accepts known values', () => {
    expect(normalizeMarkdownPreviewAlignment(null)).toBe('center');
    expect(normalizeMarkdownPreviewAlignment('sideways')).toBe('center');
    expect(normalizeMarkdownPreviewAlignment('left')).toBe('left');
  });

  test('toggles between the centred column and the editor-aligned one', () => {
    setMarkdownPreviewAlignment('center');
    toggleMarkdownPreviewAlignment();
    expect(getMarkdownPreviewAlignment()).toBe('left');
    toggleMarkdownPreviewAlignment();
    expect(getMarkdownPreviewAlignment()).toBe('center');
  });

  test('marks both preview layouts with the alignment the styles key on', () => {
    const plain = renderToStaticMarkup(<MarkdownOutlinePreview text="1. one" alignment="left" />);
    const outlined = renderToStaticMarkup(
      <MarkdownOutlinePreview text={'# Title\n\nBody\n\n## Part\n\nMore'} alignment="left" />,
    );
    expect(plain).toContain('data-preview-alignment="left"');
    expect(outlined).toContain('data-preview-alignment="left"');
    expect(renderToStaticMarkup(<MarkdownOutlinePreview text="1. one" />)).toContain(
      'data-preview-alignment="center"',
    );
  });
});
