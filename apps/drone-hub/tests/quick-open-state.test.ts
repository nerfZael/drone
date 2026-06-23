import { describe, expect, test } from 'bun:test';
import {
  buildQuickOpenItems,
  quickOpenSelectionToOpenTarget,
  trackRecentQuickOpenFile,
  type QuickOpenFile,
} from '../src/droneHub/files/quick-open-state';

describe('quick open state', () => {
  test('tracks recent files by newest open and de-duplicates paths', () => {
    let recent = trackRecentQuickOpenFile([], { path: '/work/repo/src/a.ts' }, 100);
    recent = trackRecentQuickOpenFile(recent, { path: '/work/repo/src/b.ts' }, 200);
    recent = trackRecentQuickOpenFile(recent, { path: '/work/repo/src/a.ts', name: 'a.ts' }, 300);

    expect(recent.map((file) => file.path)).toEqual(['/work/repo/src/a.ts', '/work/repo/src/b.ts']);
    expect(recent[0]?.openedAt).toBe(300);
  });

  test('puts matching recent files before search results', () => {
    const recent = trackRecentQuickOpenFile([], { path: '/work/repo/src/recent.ts' }, 100);
    const searchFiles: QuickOpenFile[] = [
      { path: '/work/repo/src/recent.ts', name: 'recent.ts', relativePath: 'src/recent.ts', size: null, mtimeMs: null },
      { path: '/work/repo/src/other.ts', name: 'other.ts', relativePath: 'src/other.ts', size: null, mtimeMs: null },
    ];

    const items = buildQuickOpenItems({ query: 'src', recentFiles: recent, searchFiles });

    expect(items.map((item) => `${item.source}:${item.path}`)).toEqual([
      'recent:/work/repo/src/recent.ts',
      'search:/work/repo/src/other.ts',
    ]);
  });

  test('returns a clean open target for the selected item', () => {
    const [item] = buildQuickOpenItems({
      query: 'main',
      recentFiles: [],
      searchFiles: [{ path: '/work/repo/src/main.ts', name: '', relativePath: 'src/main.ts', size: null, mtimeMs: null }],
    });

    expect(item).toBeTruthy();
    expect(quickOpenSelectionToOpenTarget(item!)).toEqual({
      path: '/work/repo/src/main.ts',
      name: 'main.ts',
    });
  });
});
