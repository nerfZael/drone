import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenedDroneFileTabs } from '../src/droneHub/files/OpenedDroneFileTabs';

describe('OpenedDroneFileTabs', () => {
  test('shows dirty state on the name and only reveals close controls contextually', () => {
    const html = renderToStaticMarkup(
      React.createElement(OpenedDroneFileTabs, {
        tabs: [
          {
            tabId: 'drone-1:/work/index.ts',
            droneId: 'drone-1',
            path: '/work/index.ts',
            name: 'index.ts',
            loading: false,
            saving: false,
            error: null,
            kind: 'text',
            mime: 'text/typescript',
            size: 18,
            content: 'const value = 1;',
            dirty: true,
            mtimeMs: null,
            targetLine: null,
            targetColumn: null,
            navigationSeq: 1,
          },
        ],
        activeTabId: 'drone-1:/work/index.ts',
        onActivateTab: () => undefined,
        onCloseTab: () => undefined,
        onReorderTabs: () => undefined,
      }),
    );

    expect(html).toContain('index.ts<span aria-hidden="true">*</span>');
    expect(html).toContain('opacity-0');
    expect(html).toContain('group-hover/tab:opacity-100');
    expect(html).not.toContain('cursor-grab');
  });
});
