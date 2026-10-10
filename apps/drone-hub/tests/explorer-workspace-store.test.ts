import { expect, test } from 'bun:test';
import { explorerWorkspaceFor, setExplorerWorkspace } from '../src/droneHub/workspaces/explorer-workspace-store';

const folder = { id: 'host:workspace-a', browseId: 'host:workspace-a', name: 'Notes', kind: 'folder' as const, path: '/old/notes' };

test('a moved workspace updates the remembered path, not just its name', () => {
  setExplorerWorkspace('drone-1', folder);
  setExplorerWorkspace('drone-1', { ...folder, path: '/new/notes' });
  expect(explorerWorkspaceFor('drone-1')?.path).toBe('/new/notes');
  setExplorerWorkspace('drone-1', null);
  expect(explorerWorkspaceFor('drone-1')).toBeNull();
});

test('a desktop window keeps its own choice, and choosing its drone means the drone itself', () => {
  const key = 'desktop:editor:1\u0000drone-1';
  setExplorerWorkspace(key, folder, 'drone-1');
  expect(explorerWorkspaceFor(key)?.id).toBe(folder.id);
  expect(explorerWorkspaceFor('drone-1')).toBeNull();
  setExplorerWorkspace(key, { id: 'drone:drone-1', browseId: 'drone-1', name: 'one', kind: 'drone', droneId: 'drone-1' }, 'drone-1');
  expect(explorerWorkspaceFor(key)).toBeNull();
});
