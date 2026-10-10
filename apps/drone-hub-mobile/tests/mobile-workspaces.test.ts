import { expect, test } from 'bun:test';
import { explorerWorkspaceDrone, isOwnWorkspace, workspaceSections, type BrowsableWorkspace } from '../src/drones/mobile-workspaces';

const drone = { id: 'host-1', runtime: 'host', cwd: '/repos/app', repoPath: '/repos/app' } as const;
const folder = (id: string, name: string, category: BrowsableWorkspace['category'], path: string): BrowsableWorkspace =>
  ({ id, browseId: id, name, kind: 'folder', category, path });
const box = (n: number): BrowsableWorkspace =>
  ({ id: `drone:c${n}`, browseId: `c${n}`, name: `box-${n}`, kind: 'drone', category: 'Container drones', droneId: `c${n}` });

const list: BrowsableWorkspace[] = [
  folder('companion-home', 'Companion home', 'Home', '/hub/companion/home'),
  folder('host:workspace-a', 'Notes', 'Workspaces', '/hub/workspaces/Notes'),
  folder('host:own', 'app', 'Repositories', '/repos/app'),
  ...Array.from({ length: 8 }, (_, index) => box(index + 1)),
];

test('the drone\'s own folder is not offered twice, and drones show five until asked for more', () => {
  const sections = workspaceSections(list, { drone, chatIds: [], query: '', expanded: new Set(), currentId: null });
  expect(sections.groups.map((group) => group.category)).toEqual(['Home', 'Workspaces', 'Container drones']);
  const boxes = sections.groups.find((group) => group.category === 'Container drones')!;
  expect(boxes.items).toHaveLength(5);
  expect(boxes.hidden).toBe(3);
  const expanded = workspaceSections(list, { drone, chatIds: [], query: '', expanded: new Set(['Container drones']), currentId: null });
  expect(expanded.groups.at(-1)!.items).toHaveLength(8);
});

test('a search looks through every drone, and the workspace shown now stays visible past the cap', () => {
  expect(workspaceSections(list, { drone, chatIds: [], query: 'box', expanded: new Set(), currentId: null }).groups[0].items).toHaveLength(8);
  const withCurrent = workspaceSections(list, { drone, chatIds: [], query: '', expanded: new Set(), currentId: 'drone:c8' });
  expect(withCurrent.groups.at(-1)!.items.map((item) => item.name)).toContain('box-8');
});

test('the chat\'s workspaces come first, in the order the chat lists them', () => {
  const sections = workspaceSections(list, { drone, chatIds: ['drone:c2', 'host:workspace-a', 'host:own', 'remote:x'], query: '', expanded: new Set(), currentId: null });
  expect(sections.chat.map((item) => item.name)).toEqual(['box-2', 'Notes']);
});

test('a folder choice is shown as a host folder under its id; a drone choice as that drone', () => {
  const other = { id: 'c1', name: 'box-1', runtime: 'container' } as any;
  expect(explorerWorkspaceDrone({ id: 'host:workspace-a', browseId: 'host:workspace-a', name: 'Notes', kind: 'folder', path: '/hub/workspaces/Notes' }, [])).toMatchObject({
    id: 'host:workspace-a', name: 'Notes', runtime: 'host', cwd: '/hub/workspaces/Notes',
  });
  expect(explorerWorkspaceDrone({ id: 'drone:c1', browseId: 'c1', name: 'box-1', kind: 'drone', droneId: 'c1' }, [other])).toBe(other);
  expect(explorerWorkspaceDrone({ id: 'drone:gone', browseId: 'gone', name: 'gone', kind: 'drone', droneId: 'gone' }, [other])).toBeNull();
  expect(explorerWorkspaceDrone(null, [other])).toBeNull();
});

test('only a host drone\'s own folder counts as its own; a container drone matches by id', () => {
  expect(isOwnWorkspace({ kind: 'folder', path: '/repos/app/' }, drone)).toBe(true);
  expect(isOwnWorkspace({ kind: 'folder', path: '/work/repo' }, { id: 'c1', runtime: 'container', cwd: '/work/repo', repoPath: '' })).toBe(false);
  expect(isOwnWorkspace({ kind: 'drone', droneId: 'c1' }, { id: 'c1', runtime: 'container', cwd: '', repoPath: '' })).toBe(true);
});
