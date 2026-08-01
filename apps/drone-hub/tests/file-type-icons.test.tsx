import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileIconSvg, folderIconIdForPath } from '@drone/file-icons';
import { FileTypeIcon, FolderTypeIcon } from '../src/droneHub/files/FileTypeIcon';

function svgFromRenderedImage(html: string): string {
  const src = html.match(/src="(data:image\/svg\+xml,[^"]+)"/)?.[1];
  if (!src) throw new Error('Rendered file icon is missing its SVG data URI');
  return decodeURIComponent(src.slice('data:image/svg+xml,'.length));
}

describe('desktop file type icons', () => {
  test('renders file icons as decorative, non-draggable images', () => {
    const html = renderToStaticMarkup(<FileTypeIcon path="src/view.tsx" size={16} />);

    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('draggable="false"');
  });

  test('uses the calm closed-folder silhouette on desktop', () => {
    const html = renderToStaticMarkup(<FolderTypeIcon path="src" size={15} />);

    expect(svgFromRenderedImage(html)).toBe(fileIconSvg(folderIconIdForPath('src')));
    expect(svgFromRenderedImage(html)).not.toBe(fileIconSvg(folderIconIdForPath('src', true)));
  });
});
