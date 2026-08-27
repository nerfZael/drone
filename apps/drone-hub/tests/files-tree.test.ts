import { describe, expect, test } from 'bun:test';
import type { DroneFsEntry } from '../src/droneHub/types';
import {
  buildFileExplorerTree,
  fileAncestorDirectoryPaths,
  flattenVisibleFileExplorerRows,
  summarizeRootEntries,
} from '../src/droneHub/files/tree';

function entry(seed: Partial<DroneFsEntry> & Pick<DroneFsEntry, 'name' | 'path' | 'kind'>): DroneFsEntry {
  return {
    name: seed.name,
    path: seed.path,
    kind: seed.kind,
    size: seed.size ?? null,
    mtimeMs: seed.mtimeMs ?? null,
    ext: seed.ext ?? null,
    isImage: seed.isImage ?? false,
    isVideo: seed.isVideo ?? false,
  };
}

describe('file explorer tree', () => {
  test('finds directories to expand for a file while keeping the workspace root', () => {
    expect(
      fileAncestorDirectoryPaths('/work/repo', '/work/repo/src/components/App.tsx'),
    ).toEqual(['/work/repo/src', '/work/repo/src/components']);
    expect(fileAncestorDirectoryPaths('/work/repo', '/work/repo/README.md')).toEqual([]);
    expect(fileAncestorDirectoryPaths('/', '/etc/nginx/nginx.conf')).toEqual([
      '/etc',
      '/etc/nginx',
    ]);
    expect(fileAncestorDirectoryPaths('/work/repo', '/work/repository/file.ts')).toEqual([]);
  });

  test('builds nested nodes from loaded child directories', () => {
    const tree = buildFileExplorerTree({
      rootEntries: [
        entry({ name: 'src', path: '/work/repo/src', kind: 'directory' }),
        entry({ name: 'README.md', path: '/work/repo/README.md', kind: 'file', size: 128, ext: 'md' }),
      ],
      childEntriesByPath: {
        '/work/repo/src': [
          entry({ name: 'lib', path: '/work/repo/src/lib', kind: 'directory' }),
          entry({ name: 'main.ts', path: '/work/repo/src/main.ts', kind: 'file', size: 42, ext: 'ts' }),
        ],
        '/work/repo/src/lib': [entry({ name: 'util.ts', path: '/work/repo/src/lib/util.ts', kind: 'file', size: 99, ext: 'ts' })],
      },
    });

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      kind: 'directory',
      path: '/work/repo/src',
      count: 2,
    });
    expect(tree[0].children?.[0]).toMatchObject({
      kind: 'directory',
      path: '/work/repo/src/lib',
      count: 1,
    });
    expect(tree[0].children?.[0].children?.[0]).toMatchObject({
      kind: 'file',
      path: '/work/repo/src/lib/util.ts',
    });
  });

  test('only flattens rows for expanded directories', () => {
    const tree = buildFileExplorerTree({
      rootEntries: [entry({ name: 'src', path: '/work/repo/src', kind: 'directory' })],
      childEntriesByPath: {
        '/work/repo/src': [entry({ name: 'main.ts', path: '/work/repo/src/main.ts', kind: 'file', size: 42, ext: 'ts' })],
      },
    });

    expect(flattenVisibleFileExplorerRows(tree, {})).toEqual([
      { kind: 'directory', depth: 0, name: 'src', count: 1 },
    ]);
    expect(flattenVisibleFileExplorerRows(tree, { '/work/repo/src': true })).toEqual([
      { kind: 'directory', depth: 0, name: 'src', count: 1 },
      { kind: 'file', depth: 1, name: 'main.ts', count: 1 },
    ]);
  });

  test('hides Git metadata directories', () => {
    const tree = buildFileExplorerTree({
      rootEntries: [
        entry({ name: '.git', path: '/work/repo/.git', kind: 'directory' }),
        entry({ name: '.github', path: '/work/repo/.github', kind: 'directory' }),
        entry({ name: '.gitignore', path: '/work/repo/.gitignore', kind: 'file' }),
      ],
    });

    expect(tree.map((node) => node.name)).toEqual(['.github', '.gitignore']);
  });

  test('summarizes root entry kinds', () => {
    expect(
      summarizeRootEntries([
        entry({ name: 'src', path: '/work/repo/src', kind: 'directory' }),
        entry({ name: 'README.md', path: '/work/repo/README.md', kind: 'file' }),
        entry({ name: 'socket', path: '/work/repo/socket', kind: 'other' }),
      ]),
    ).toEqual({
      directories: 1,
      files: 1,
      others: 1,
    });
  });
});
