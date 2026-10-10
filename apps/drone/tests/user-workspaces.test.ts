import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UserWorkspaces, folderNameFor, userWorkspaceTargetId, type UserWorkspaceStorage } from '../src/hub/user-workspaces';
import { buildHostWorkspaces } from '../src/hub/assistant/host-workspaces';

let root: string;
let saved: any;
const memory: UserWorkspaceStorage = {
  read: async () => structuredClone(saved ?? { directory: null, workspaces: [] }),
  write: async (value) => { saved = structuredClone(value); },
};
const service = () => new UserWorkspaces(memory, () => path.join(root, 'default'));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'user-ws-'));
  saved = null;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('creating a workspace makes its folder in the workspaces directory', async () => {
  const workspaces = service();
  const created = await workspaces.create('  Research notes ');
  expect(created).toMatchObject({ name: 'Research notes', kind: 'created', root: path.join(root, 'default', 'Research notes'), missing: false });
  expect(existsSync(created.root)).toBe(true);
  await expect(workspaces.create('Research notes')).rejects.toThrow('already uses the folder name');
  mkdirSync(path.join(root, 'default', 'Taken'));
  await expect(workspaces.create('Taken')).rejects.toThrow('Use Add folder');
  await expect(workspaces.create('   ')).rejects.toThrow('name');
});

test('folder names drop path separators and leading dots', () => {
  expect(folderNameFor('a/b\\c')).toBe('a-b-c');
  expect(folderNameFor('..hidden')).toBe('hidden');
  expect(() => folderNameFor('...')).toThrow();
});

test('linking adopts an existing folder anywhere, once', async () => {
  const workspaces = service();
  const folder = path.join(root, 'elsewhere', 'project');
  mkdirSync(folder, { recursive: true });
  const linked = await workspaces.link(folder);
  expect(linked).toMatchObject({ name: 'project', kind: 'linked', root: folder });
  await expect(workspaces.link(folder, 'Again')).rejects.toThrow('already the workspace');
  await expect(workspaces.link('relative/path')).rejects.toThrow('full path');
  await expect(workspaces.link(path.join(root, 'nope'))).rejects.toThrow('not a folder');
});

test('rename and remove change only the list; files stay', async () => {
  const workspaces = service();
  const created = await workspaces.create('Drafts');
  writeFileSync(path.join(created.root, 'a.md'), 'hi');
  await workspaces.rename(created.id, 'Old drafts');
  expect((await workspaces.state()).workspaces[0]).toMatchObject({ name: 'Old drafts', root: created.root });
  await workspaces.remove(created.id);
  expect((await workspaces.state()).workspaces).toEqual([]);
  expect(existsSync(path.join(created.root, 'a.md'))).toBe(true);
});

test('changing the directory moves created workspaces when asked, and leaves linked ones alone', async () => {
  const workspaces = service();
  const created = await workspaces.create('Notes');
  writeFileSync(path.join(created.root, 'n.md'), 'note');
  const folder = path.join(root, 'linked');
  mkdirSync(folder);
  await workspaces.link(folder);
  const next = path.join(root, 'moved');
  const result = await workspaces.setDirectory(next, true);
  expect(result).toEqual({ moved: ['Notes'], failed: [] });
  const state = await workspaces.state();
  expect(state).toMatchObject({ directory: next, customDirectory: true });
  expect(state.workspaces.map((item) => [item.name, item.root, item.missing])).toEqual([
    ['Notes', path.join(next, 'Notes'), false],
    ['linked', folder, false],
  ]);
  expect(existsSync(path.join(next, 'Notes', 'n.md'))).toBe(true);
  expect(existsSync(created.root)).toBe(false);
});

test('without moving, created workspaces go missing until the directory changes back', async () => {
  const workspaces = service();
  await workspaces.create('Notes');
  await workspaces.setDirectory(path.join(root, 'other'), false);
  expect((await workspaces.state()).workspaces[0].missing).toBe(true);
  expect(await workspaces.available()).toEqual([]);
  await workspaces.setDirectory(null, false);
  expect((await workspaces.state()).workspaces[0].missing).toBe(false);
  expect((await workspaces.state()).customDirectory).toBe(false);
});

test('a workspace whose name is taken in the new directory stays behind and is reported', async () => {
  const workspaces = service();
  await workspaces.create('Notes');
  const next = path.join(root, 'next');
  mkdirSync(path.join(next, 'Notes'), { recursive: true });
  const result = await workspaces.setDirectory(next, true);
  expect(result.moved).toEqual([]);
  expect(result.failed[0].name).toBe('Notes');
  await expect(workspaces.setDirectory(path.join(next, 'inner'), true)).rejects.toThrow('inside');
});

test('added workspaces join the host catalog under ids that survive a move', () => {
  const added = [{ id: 'abc', name: 'Notes', root: '/data/notes' }];
  const catalog = buildHostWorkspaces([], ['/repos/app'], added);
  expect(catalog).toContainEqual({
    id: userWorkspaceTargetId('abc'),
    workspaceId: 'workspace-abc',
    name: 'Notes',
    path: '/data/notes',
    repository: false,
    userWorkspace: true,
  });
  const moved = buildHostWorkspaces([], ['/repos/app'], [{ ...added[0], root: '/elsewhere/notes' }]);
  expect(moved.find((item) => item.userWorkspace)?.id).toBe(userWorkspaceTargetId('abc'));
});

test('the explorer can browse homes, added workspaces, repositories, host drone folders and container drones', async () => {
  const { browsableWorkspaces } = await import('../src/hub/routes/user-workspace-routes');
  const { registerFolderWorkspace } = await import('../src/hub/folder-workspaces');
  registerFolderWorkspace({ id: 'test-home', name: 'Test home', root: async () => '/data/home', listed: true });
  registerFolderWorkspace({ id: 'entity-files-x', name: 'Ad hoc', root: async () => '/data/adhoc' });
  const hostWorkspaces = buildHostWorkspaces(
    [{ id: 'h1', name: 'host-one', runtime: 'host', cwd: '/repos/app', repoPath: '/repos/app' }],
    ['/repos/app'],
    [{ id: 'abc', name: 'Notes', root: '/data/notes' }],
  );
  const drones = [
    { id: 'c1', name: 'box', runtime: 'container', status: 'running', repoPath: '' },
    { id: 'h1', name: 'host-one', runtime: 'host', cwd: '/repos/app', repoPath: '/repos/app' },
  ] as any;
  const list = await browsableWorkspaces(async () => ({ drones, hostWorkspaces }) as any);
  const by = (id: string) => list.find((item) => item.id === id);
  expect(by('test-home')).toMatchObject({ browseId: 'test-home', category: 'Home', path: '/data/home' });
  expect(list.some((item) => item.id === 'entity-files-x')).toBe(false);
  expect(by(userWorkspaceTargetId('abc'))).toMatchObject({ browseId: userWorkspaceTargetId('abc'), category: 'Workspaces', path: '/data/notes' });
  expect(list.find((item) => item.path === '/repos/app')).toMatchObject({ category: 'Repositories', kind: 'folder' });
  expect(by('drone:c1')).toMatchObject({ browseId: 'c1', kind: 'drone', category: 'Container drones', droneId: 'c1' });
  expect(by('drone:h1')).toBeUndefined();
});
