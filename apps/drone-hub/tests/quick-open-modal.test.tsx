import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { QuickOpenModal } from '../src/droneHub/files/QuickOpenModal';

describe('QuickOpenModal', () => {
  test('renders a compact VS Code-style single-line file palette', () => {
    const html = renderToStaticMarkup(
      <QuickOpenModal
        open
        query=""
        files={[]}
        recentFiles={[
          {
            path: '/work/repo/src/QuickOpenModal.tsx',
            name: 'QuickOpenModal.tsx',
            relativePath: 'src/QuickOpenModal.tsx',
            size: 42,
            mtimeMs: 100,
            openedAt: 200,
          },
        ]}
        loading={false}
        error={null}
        onQueryChange={() => {}}
        onClose={() => {}}
        onOpenFile={() => {}}
      />,
    );

    expect(html).toContain('max-w-[600px]');
    expect(html).toContain('h-[22px]');
    expect(html).toContain('bg-[#0e639c]');
    expect(html).toContain('QuickOpenModal.tsx');
    expect(html).toContain('src');
    expect(html).toContain('recently opened');
    expect(html).not.toContain('42 B');
    expect(html).not.toContain('result<!-- -->');
  });
});
