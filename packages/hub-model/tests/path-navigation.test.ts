import { expect, test } from 'bun:test';
import {
  workspaceLinkIsDirectory,
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
