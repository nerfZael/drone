import { describe, expect, test } from 'bun:test';
import {
  buildExplorerTree,
  estimateExplorerSidebarWidth,
  flattenVisibleExplorerRows,
  resolveExplorerSidebarWidthBounds,
} from '../src/droneHub/changes/helpers';
import type { RepoChangeEntry } from '../src/droneHub/types';

function change(path: string): RepoChangeEntry {
  return {
    path,
    originalPath: null,
    code: '??',
    stagedChar: '.',
    unstagedChar: '?',
    stagedType: null,
    unstagedType: 'untracked',
    isUntracked: true,
    isIgnored: false,
    isConflicted: false,
  };
}

describe('changes explorer tree', () => {
  test('collapses linear directory chains while keeping files as leaf nodes', () => {
    const tree = buildExplorerTree([change('src/web/index.html'), change('src/web/main.ts')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'dir',
      name: 'src/web',
      path: 'src/web',
      count: 2,
    });
    const top = tree[0];
    if (top.kind !== 'dir' || !top.children) throw new Error('expected top-level directory node');
    expect(top.children.map((node) => node.name)).toEqual(['index.html', 'main.ts']);
    expect(top.children.every((node) => node.kind === 'file')).toBe(true);
  });

  test('does not collapse a directory that has both files and subdirectories', () => {
    const tree = buildExplorerTree([change('src/readme.md'), change('src/web/index.html')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'dir',
      name: 'src',
      path: 'src',
      count: 2,
    });
    const src = tree[0];
    if (src.kind !== 'dir' || !src.children) throw new Error('expected src directory node');
    expect(src.children.map((node) => node.name)).toEqual(['web', 'readme.md']);
  });

  test('collapses only through non-branching segments', () => {
    const tree = buildExplorerTree([change('a/b/c/one.ts'), change('a/b/d/two.ts')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      kind: 'dir',
      name: 'a/b',
      path: 'a/b',
      count: 2,
    });
    const top = tree[0];
    if (top.kind !== 'dir' || !top.children) throw new Error('expected top-level directory node');
    expect(top.children.map((node) => node.name)).toEqual(['c', 'd']);
  });

  test('flattens only visible rows based on expanded directories', () => {
    const tree = buildExplorerTree([change('src/deep/a/alpha.ts'), change('src/deep/b/bravo.ts'), change('top.ts')]);
    const rows = flattenVisibleExplorerRows(tree, { 'src/deep': false });
    expect(rows.map((row) => `${row.kind}:${row.depth}:${row.name}`)).toEqual(['dir:0:src/deep', 'file:0:top.ts']);
  });

  test('estimates width and respects ratio + diff-pane constraints', () => {
    const rows = [
      { kind: 'file' as const, depth: 0, name: 'very-long-file-name-that-needs-room.ts', count: 1 },
      { kind: 'dir' as const, depth: 2, name: 'nested/deep/path', count: 4 },
    ];
    const constrained = estimateExplorerSidebarWidth(rows, 700, {
      minWidthPx: 180,
      maxWidthPx: 360,
      maxWidthRatio: 0.36,
      minDiffWidthPx: 420,
    });
    // 700px panel => max by ratio = 252 and max by min-diff = 280, so hard max is 252.
    expect(constrained).toBeLessThanOrEqual(252);
    expect(constrained).toBeGreaterThanOrEqual(180);

    const veryNarrow = estimateExplorerSidebarWidth(rows, 520, {
      minWidthPx: 180,
      maxWidthPx: 360,
      maxWidthRatio: 0.36,
      minDiffWidthPx: 420,
    });
    // 520px panel leaves only 100px by diff budget, and function keeps a hard floor of 120.
    expect(veryNarrow).toBe(120);
  });

  test('resolves manual width bounds from ratio and diff constraints', () => {
    expect(
      resolveExplorerSidebarWidthBounds(700, {
        minWidthPx: 180,
        maxWidthPx: 360,
        maxWidthRatio: 0.36,
        minDiffWidthPx: 420,
      }),
    ).toEqual({ minWidthPx: 180, maxWidthPx: 252 });

    expect(
      resolveExplorerSidebarWidthBounds(520, {
        minWidthPx: 180,
        maxWidthPx: 360,
        maxWidthRatio: 0.36,
        minDiffWidthPx: 420,
      }),
    ).toEqual({ minWidthPx: 120, maxWidthPx: 120 });
  });
});
