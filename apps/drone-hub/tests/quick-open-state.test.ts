import { describe, expect, test } from 'bun:test';
import {
  buildQuickOpenItems,
  parseQuickOpenQuery,
  quickOpenSelectionToOpenTarget,
  remapRecentQuickOpenFilesForPathChange,
  removeRecentQuickOpenFilesForPaths,
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
      line: null,
      column: null,
    });
  });

  test('fuzzy-matches filename characters and ranks filename matches ahead of path-only matches', () => {
    const searchFiles: QuickOpenFile[] = [
      { path: '/work/repo/sidebar/drone/tree/list.ts', name: 'list.ts', relativePath: 'sidebar/drone/tree/list.ts', size: null, mtimeMs: null },
      { path: '/work/repo/src/SidebarDroneTreeList.tsx', name: 'SidebarDroneTreeList.tsx', relativePath: 'src/SidebarDroneTreeList.tsx', size: null, mtimeMs: null },
      { path: '/work/repo/src/unrelated.ts', name: 'unrelated.ts', relativePath: 'src/unrelated.ts', size: null, mtimeMs: null },
    ];

    const items = buildQuickOpenItems({ query: 'sdtl', recentFiles: [], searchFiles });

    expect(items.map((item) => item.relativePath)).toEqual([
      'src/SidebarDroneTreeList.tsx',
      'sidebar/drone/tree/list.ts',
    ]);
  });

  test('parses VS Code-style line and column suffixes into the open target', () => {
    expect(parseQuickOpenQuery('src/main.ts:42:7')).toEqual({
      searchTerm: 'src/main.ts',
      line: 42,
      column: 7,
    });
    expect(parseQuickOpenQuery('src/main.ts:')).toEqual({
      searchTerm: 'src/main.ts',
      line: null,
      column: null,
    });
    const [item] = buildQuickOpenItems({
      query: 'main:42:7',
      recentFiles: [],
      searchFiles: [{ path: '/work/repo/src/main.ts', name: 'main.ts', relativePath: 'src/main.ts', size: null, mtimeMs: null }],
    });
    expect(quickOpenSelectionToOpenTarget(item!, 'main:42:7')).toMatchObject({ line: 42, column: 7 });
  });

  test('remaps recent files under renamed or moved paths', () => {
    let recent = trackRecentQuickOpenFile([], { path: '/work/repo/src/main.ts', relativePath: 'src/main.ts' }, 100);
    recent = trackRecentQuickOpenFile(recent, { path: '/work/repo/src/nested/helper.ts' }, 200);
    recent = trackRecentQuickOpenFile(recent, { path: '/work/repo/README.md' }, 300);

    const remapped = remapRecentQuickOpenFilesForPathChange(recent, '/work/repo/src', '/work/repo/lib');

    expect(remapped.map((file) => file.path)).toEqual([
      '/work/repo/README.md',
      '/work/repo/lib/nested/helper.ts',
      '/work/repo/lib/main.ts',
    ]);
    expect(remapped[1]?.name).toBe('helper.ts');
    expect(remapped[1]?.relativePath).toBeNull();
  });

  test('removes recent files under deleted paths', () => {
    let recent = trackRecentQuickOpenFile([], { path: '/work/repo/src/main.ts' }, 100);
    recent = trackRecentQuickOpenFile(recent, { path: '/work/repo/src/nested/helper.ts' }, 200);
    recent = trackRecentQuickOpenFile(recent, { path: '/work/repo/README.md' }, 300);

    const filtered = removeRecentQuickOpenFilesForPaths(recent, ['/work/repo/src']);

    expect(filtered.map((file) => file.path)).toEqual(['/work/repo/README.md']);
  });
});
