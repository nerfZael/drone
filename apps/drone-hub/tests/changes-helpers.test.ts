import { describe, expect, test } from 'bun:test';
import { buildExplorerTree } from '../src/droneHub/changes/helpers';
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
});
