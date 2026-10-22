import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileTabMenuItems, OpenedDroneFileTabs } from '../src/droneHub/files/OpenedDroneFileTabs';

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
    expect(html).toContain('group-hover/tab:opacity-70');
    expect(html).not.toContain('cursor-grab');
  });

  describe('tab menu', () => {
    const tab = (name: string, dirty = false) => ({
      tabId: name, droneId: 'drone-1', path: `/work/${name}`, name, loading: false, saving: false, error: null,
      kind: 'text' as const, mime: null, size: 0, content: '', dirty, mtimeMs: null,
      targetLine: null, targetColumn: null, navigationSeq: 1,
    });
    const tabs = [tab('a.ts'), tab('b.ts', true), tab('c.ts'), tab('d.ts')];

    function run(tabId: string, itemId: string, list = tabs) {
      const calls: Array<{ ids: string[]; keep?: string; single?: string }> = [];
      const items = fileTabMenuItems(
        list,
        tabId,
        (single) => calls.push({ ids: [], single }),
        (ids, keep) => calls.push({ ids, keep }),
      );
      const item = items.find((entry) => entry.id === itemId);
      if (!item?.disabled) item?.onSelect();
      return { item, call: calls[0] };
    }

    test('lists the VS Code close actions plus Close to the Left', () => {
      expect(fileTabMenuItems(tabs, 'b.ts', () => {}, () => {}).map((item) => item.label)).toEqual([
        'Close', 'Close Others', 'Close to the Left', 'Close to the Right', 'Close Saved', 'Close All',
      ]);
    });

    test('each action closes the tabs it names and keeps the clicked tab active', () => {
      expect(run('b.ts', 'close').call).toEqual({ ids: [], single: 'b.ts' });
      expect(run('b.ts', 'close-others').call).toEqual({ ids: ['a.ts', 'c.ts', 'd.ts'], keep: 'b.ts' });
      expect(run('c.ts', 'close-left').call).toEqual({ ids: ['a.ts', 'b.ts'], keep: 'c.ts' });
      expect(run('b.ts', 'close-right').call).toEqual({ ids: ['c.ts', 'd.ts'], keep: 'b.ts' });
      expect(run('c.ts', 'close-saved').call).toEqual({ ids: ['a.ts', 'c.ts', 'd.ts'], keep: 'c.ts' });
      expect(run('c.ts', 'close-all').call).toEqual({ ids: ['a.ts', 'b.ts', 'c.ts', 'd.ts'], keep: 'c.ts' });
    });

    test('disables actions that would close nothing', () => {
      expect(run('a.ts', 'close-left').item?.disabled).toBe(true);
      expect(run('d.ts', 'close-right').item?.disabled).toBe(true);
      expect(run('a.ts', 'close-others', [tab('a.ts')]).item?.disabled).toBe(true);
      expect(run('a.ts', 'close-saved', [tab('a.ts', true)]).item?.disabled).toBe(true);
    });
  });
});
