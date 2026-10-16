import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { describe, expect, test } from 'bun:test';
import {
  closeFileTabsForPaths,
  dirtyFileTabsForPaths,
  openFileTab,
  remapFileTabsForPathChange,
  type OpenedFileTabsState,
} from '../src/droneHub/app/opened-file-tabs';
import { explorerRootsFor, type DroneRoots } from '../src/droneHub/workspaces/explorer-roots';
import { useFileEditorState } from '../src/droneHub/app/use-file-editor-state';
import type { BrowsableWorkspace } from '../src/droneHub/workspaces/workspaces-client';
import type { DroneSummary } from '../src/droneHub/types';

const mech = { id: 'mech', name: 'Mech', runtime: 'container', repoAttached: true, repoPath: '/repo' } as DroneSummary;
const local = { id: 'local', name: 'local', runtime: 'host', cwd: '/home/me/dev/local' } as DroneSummary;
const workspaces: BrowsableWorkspace[] = [
  { id: 'host:guides', browseId: 'host:guides', name: 'Guides', kind: 'folder', category: 'Workspaces', path: '/home/me/hub/Guides' },
  { id: 'host:graphics', browseId: 'host:graphics', name: 'Game Graphics', kind: 'folder', category: 'Workspaces', path: '/home/me/hub/Graphics' },
  { id: 'host:local', browseId: 'host:local', name: 'local', kind: 'folder', category: 'Host drones', path: '/home/me/dev/local' },
  { id: 'drone:mech', browseId: 'mech', name: 'Mech', kind: 'drone', category: 'Container drones', droneId: 'mech' },
  { id: 'drone:terrain', browseId: 'terrain', name: 'Terrain', kind: 'drone', category: 'Container drones', droneId: 'terrain' },
];
const terrain = { id: 'terrain', name: 'Terrain', runtime: 'container', repoAttached: false } as DroneSummary;
const droneById = { mech, local, terrain };
const none: DroneRoots = { pinned: [], hidden: [], open: {} };
const pin = (id: string) => {
  const { category: _category, ...workspace } = workspaces.find((item) => item.id === id)!;
  return workspace;
};

describe('explorer roots', () => {
  test("the chat's workspaces come first and start collapsed; added ones follow, open", () => {
    const roots = explorerRootsFor({
      drone: mech, chatIds: ['host:guides', 'drone:mech'], workspaces, droneById,
      state: { ...none, pinned: [pin('drone:terrain')] },
    });
    // The drone's own container is never a root of its own.
    expect(roots.map((root) => [root.workspace.name, root.fromChat, root.pinned, root.open])).toEqual([
      ['Guides', true, false, false],
      ['Terrain', false, true, true],
    ]);
    expect(roots[0]!.drone).toMatchObject({ id: 'host:guides', runtime: 'host', cwd: '/home/me/hub/Guides' });
    expect(roots[1]!.drone).toBe(terrain);
  });

  test('a host drone does not list its own folder; a removed chat workspace stays away; a choice to open sticks', () => {
    const roots = explorerRootsFor({
      drone: local, chatIds: ['host:local', 'host:guides', 'host:graphics'], workspaces, droneById,
      state: { pinned: [pin('host:graphics')], hidden: ['host:guides'], open: { 'host:graphics': false } },
    });
    expect(roots.map((root) => [root.workspace.name, root.fromChat, root.pinned, root.open])).toEqual([
      ['Game Graphics', true, true, false],
    ]);
  });

  test('added roots list before the workspaces load, and drop out once they are gone', () => {
    const state = { ...none, pinned: [pin('host:guides'), { ...pin('host:graphics'), id: 'host:removed' }] };
    expect(explorerRootsFor({ drone: mech, chatIds: [], workspaces: null, state, droneById }).map((root) => root.workspace.id))
      .toEqual(['host:guides', 'host:removed']);
    expect(explorerRootsFor({ drone: mech, chatIds: [], workspaces, state, droneById }).map((root) => root.workspace.id))
      .toEqual(['host:guides']);
  });
});

describe('tabs of several workspaces in one editor', () => {
  const tab = (state: OpenedFileTabsState, droneId: string, path: string) =>
    openFileTab(state, { droneId, path, name: path.split('/').pop()!, targetLine: null, targetColumn: null, navigationSeq: 1 });

  test('closing, renaming and dirty checks touch only the workspace they name', () => {
    let state: OpenedFileTabsState = { tabs: [], activeTabId: null };
    state = tab(state, 'mech', '/docs/a.md');
    state = tab(state, 'host:guides', '/docs/a.md');
    state.tabs[1] = { ...state.tabs[1]!, kind: 'text', content: 'changed', savedContent: '' };
    expect(dirtyFileTabsForPaths(state.tabs, ['/docs'], 'mech')).toEqual([]);
    expect(dirtyFileTabsForPaths(state.tabs, ['/docs'], 'host:guides').map((entry) => entry.droneId)).toEqual(['host:guides']);
    const renamed = remapFileTabsForPathChange(state, '/docs', '/notes', 'mech');
    expect(renamed.tabs.map((entry) => `${entry.droneId}:${entry.path}`)).toEqual(['mech:/notes/a.md', 'host:guides:/docs/a.md']);
    const closed = closeFileTabsForPaths(state, ['/docs/a.md'], 'host:guides');
    expect(closed.tabs.map((entry) => entry.droneId)).toEqual(['mech']);
  });

  test("another workspace's file opens beside the drone's own, and Back returns to the drone's file", async () => {
    const dom = new Window({ url: 'http://localhost' });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({ window: dom, document: dom.document, localStorage: dom.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    const reads: string[] = [];
    const requestJson = async <T,>(url: string): Promise<T> => {
      reads.push(decodeURIComponent(url));
      const path = new URL(url, 'http://localhost').searchParams.get('path') ?? '';
      return { ok: true, kind: 'text', content: `content of ${path}`, path, size: 1, mtimeMs: 1, revision: 'r1' } as T;
    };
    let editor!: ReturnType<typeof useFileEditorState>;
    function Probe() {
      editor = useFileEditorState({ currentDrone: mech, requestJson, onRefreshFsList: () => {}, rememberOpenedFiles: false });
      return null;
    }
    const element = dom.document.createElement('div');
    dom.document.body.appendChild(element);
    const root = createRoot(element as unknown as HTMLElement);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    try {
      await act(async () => { root.render(<Probe />); await settle(); });
      await act(async () => { editor.openEditorFile({ path: '/repo/README.md', name: 'README.md' }); await settle(); });
      await act(async () => { editor.openEditorFile({ path: '/home/me/hub/Guides/loop.md', name: 'loop.md', line: 4, droneId: 'host:guides' }); await settle(); });
      expect(editor.openedFileTabs.map((entry) => `${entry.droneId}:${entry.path}`)).toEqual([
        'mech:/repo/README.md',
        'host:guides:/home/me/hub/Guides/loop.md',
      ]);
      expect(editor.openedFile).toMatchObject({ droneId: 'host:guides', path: '/home/me/hub/Guides/loop.md', targetLine: 4 });
      expect(editor.content).toBe('content of /home/me/hub/Guides/loop.md');
      expect(reads.some((url) => url.startsWith('/api/drones/host:guides/'))).toBe(true);
      // Quick Open's recent files are the drone's own.
      expect(editor.recentFiles.map((file) => file.path)).toEqual(['/repo/README.md']);

      let back: ReturnType<typeof editor.goBackLocation> = null;
      await act(async () => { back = editor.goBackLocation(); await settle(); });
      expect(back).toMatchObject({ droneId: 'mech', path: '/repo/README.md' });
      expect(editor.openedFile).toMatchObject({ droneId: 'mech', path: '/repo/README.md' });
      expect(editor.openedFileTabs).toHaveLength(2);
      await act(async () => { editor.goForwardLocation(); await settle(); });
      expect(editor.openedFile).toMatchObject({ droneId: 'host:guides' });

      // Deleting /home/me/hub/Guides in the drone's own files would not close the Guides tab.
      await act(async () => { editor.closeOpenedFileTabsForPaths(['/home/me/hub/Guides']); await settle(); });
      expect(editor.openedFileTabs).toHaveLength(2);
      await act(async () => { editor.closeOpenedFileTabsForPaths(['/home/me/hub/Guides'], 'host:guides'); await settle(); });
      expect(editor.openedFileTabs.map((entry) => entry.droneId)).toEqual(['mech']);
      await act(async () => root.unmount());
    } finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.happyDOM.abort();
    }
  });
});
