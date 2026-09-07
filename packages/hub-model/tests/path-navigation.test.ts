import { expect, test } from 'bun:test';
import {
  workspaceLinkIsDirectory,
  workspaceExplorerLocation,
  workspaceExplorerRevealDirectories,
  workspaceLinkParent,
  resolveWorkspacePreviewLink,
} from '../src/path-navigation';

test('resolves nested, parent, encoded-parser output and phone-relative preview targets', () => {
  expect(resolveWorkspacePreviewLink('/work/docs/readme.md', '../src/')).toBe('/work/src');
  expect(resolveWorkspacePreviewLink('docs/readme.md', '../assets/')).toBe('assets');
  expect(resolveWorkspacePreviewLink('readme.md', 'docs')).toBe('docs');
  expect(resolveWorkspacePreviewLink('/work/readme.md', '/other/my folder')).toBe(
    '/other/my folder',
  );
  expect(workspaceLinkParent('/work/src/')).toBe('/work');
});

test('routes according to actual entry kinds, never extensions', async () => {
  const parents: string[] = [];
  const list = async (parent: string) => {
    parents.push(parent);
    return {
      entries: [
        { path: '/work/folder.v2', kind: 'directory' },
        { path: '/work/LICENSE', kind: 'file' },
      ],
    };
  };
  expect(await workspaceLinkIsDirectory('/work/folder.v2/', list)).toBe(true);
  expect(await workspaceLinkIsDirectory('/work/LICENSE', list)).toBe(false);
  expect(await workspaceLinkIsDirectory('/work/missing', list)).toBe(false);
  expect(parents).toEqual(['/work', '/work', '/work']);
});

test('does not interpret a failed lookup as a directory', async () => {
  await expect(
    workspaceLinkIsDirectory('/work/private', async () => {
      throw new Error('denied');
    }),
  ).rejects.toThrow('denied');
});

test('reveals nested files within the workspace without loading the file as a directory', () => {
  expect(workspaceExplorerLocation('/work/repo/', '/work/repo/src/ui/App.tsx')).toEqual({ root: '/work/repo', outside: false });
  expect(workspaceExplorerRevealDirectories('/work/repo', '/work/repo/src/ui/App.tsx', 'file')).toEqual(['/work/repo/src', '/work/repo/src/ui']);
  expect(workspaceExplorerRevealDirectories('/work/repo', '/work/repo/README.md', 'file')).toEqual([]);
  expect(workspaceExplorerRevealDirectories('/work/repo', '/work/repo/src/ui', 'directory')).toEqual(['/work/repo/src', '/work/repo/src/ui']);
});

test('external files navigate to their parent and distinguish sibling path prefixes', () => {
  expect(workspaceExplorerLocation('/work/repo', '/work/repository/docs/readme.md')).toEqual({ root: '/work/repository/docs', outside: true });
  expect(workspaceExplorerLocation('/work/repo', '/work/other.txt')).toEqual({ root: '/work', outside: true });
  expect(workspaceExplorerLocation('/', '/etc/hosts')).toEqual({ root: '/', outside: false });
  expect(workspaceExplorerLocation('/work/repo', '/work/repo')).toEqual({ root: '/work', outside: false });
});

test('reveals phone-relative files and normalizes parent segments', () => {
  expect(workspaceExplorerLocation('', 'docs/readme.md')).toEqual({ root: '', outside: false });
  expect(workspaceExplorerRevealDirectories('', 'docs/nested/readme.md', 'file')).toEqual(['docs', 'docs/nested']);
  expect(workspaceExplorerLocation('/work/repo', '/work/repo/../other/file')).toEqual({ root: '/work/other', outside: true });
  expect(workspaceExplorerRevealDirectories('/work/repo', '/other/file', 'file')).toEqual([]);
});
