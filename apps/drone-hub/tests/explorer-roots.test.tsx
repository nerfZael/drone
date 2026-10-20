import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { Window } from 'happy-dom';
import { describe, expect, test } from 'bun:test';
import {
  closeFileTabsForPaths,
  closeFileTabsOfWorkspaces,
  dirtyFileTabsForPaths,
  openFileTab,
  remapFileTabsForPathChange,
  type OpenedFileTabsState,
} from '../src/droneHub/app/opened-file-tabs';
import {
  addExplorerRoot,
  explorerRootsFor,
  explorerRootsState,
  mergeExplorerRootOrder,
  orderExplorerRoots,
  type DroneRoots,
} from '../src/droneHub/workspaces/explorer-roots';
import { ExplorerRootsColumn } from '../src/droneHub/files/ExplorerRootsColumn';
import { closeGoneChatHomes } from '../src/droneHub/workspaces/chat-home-cleanup';
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
const none: DroneRoots = { pinned: [], open: {}, order: [] };
const pin = (id: string) => {
  const { category: _category, ...workspace } = workspaces.find((item) => item.id === id)!;
  return workspace;
};

describe('explorer roots', () => {
  test('the roots are the workspaces added to the drone, open, in the order they were added', () => {
    const roots = explorerRootsFor({
      drone: mech, workspaces, droneById,
      state: { ...none, pinned: [pin('host:guides'), pin('drone:mech'), pin('drone:terrain')] },
    });
    // The drone's own container is never a root of its own.
    expect(roots.map((root) => [root.workspace.name, root.open])).toEqual([
      ['Guides', true],
      ['Terrain', true],
    ]);
    expect(roots[0]!.drone).toMatchObject({ id: 'host:guides', runtime: 'host', cwd: '/home/me/hub/Guides' });
    expect(roots[1]!.drone).toBe(terrain);
  });

  test('a host drone does not list its own folder; a choice to collapse sticks', () => {
    const roots = explorerRootsFor({
      drone: local, workspaces, droneById,
      state: { pinned: [pin('host:local'), pin('host:graphics')], open: { 'host:graphics': false }, order: [] },
    });
    expect(roots.map((root) => [root.workspace.name, root.open])).toEqual([
      ['Game Graphics', false],
    ]);
  });

  test('added roots list before the workspaces load, and drop out once they are gone', () => {
    const state = { ...none, pinned: [pin('host:guides'), { ...pin('host:graphics'), id: 'host:removed' }] };
    expect(explorerRootsFor({ drone: mech, workspaces: null, state, droneById }).map((root) => root.workspace.id))
      .toEqual(['host:guides', 'host:removed']);
    expect(explorerRootsFor({ drone: mech, workspaces, state, droneById }).map((root) => root.workspace.id))
      .toEqual(['host:guides']);
  });

  test("a deleted or archived chat's home leaves every drone's explorer; other roots stay", () => {
    const home = (chatId: string) => ({ id: `host:chat-home-${chatId}`, browseId: `host:chat-home-${chatId}`, name: `${chatId} home`, kind: 'folder' as const, path: `/homes/${chatId}` });
    addExplorerRoot('homes-a', home('c1'));
    addExplorerRoot('homes-a', pin('host:guides'));
    addExplorerRoot('homes-a', home('c2'));
    addExplorerRoot('homes-b', home('c1'));
    closeGoneChatHomes(new Set(['c2', 'c3']));
    expect(explorerRootsState('homes-a').pinned.map((item) => item.id)).toEqual(['host:guides', 'host:chat-home-c2']);
    expect(explorerRootsState('homes-a').open).toEqual({ 'host:guides': true, 'host:chat-home-c2': true });
    expect(explorerRootsState('homes-b').pinned).toEqual([]);
  });
});

describe('reordering roots', () => {
  test('the saved order comes first; roots it does not name keep their order after it', () => {
    expect(orderExplorerRoots(['own', 'a', 'b', 'c'], (id) => id, ['c', 'own'])).toEqual(['c', 'own', 'a', 'b']);
  });

  test('a move keeps roots that are not shown after the root they followed', () => {
    expect(mergeExplorerRootOrder(['own', 'x', 'a', 'b'], ['b', 'own', 'a'])).toEqual(['b', 'own', 'x', 'a']);
    expect(mergeExplorerRootOrder(['x', 'own', 'a'], ['a', 'own'])).toEqual(['x', 'a', 'own']);
    expect(mergeExplorerRootOrder([], ['a', 'own'])).toEqual(['a', 'own']);
  });

  test('dragging a header moves its root, the drone\'s own files too; a drop that changes nothing shows no line', async () => {
    const dom = new Window({ url: 'http://localhost' });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom, document: dom.document, localStorage: dom.localStorage, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    // Collapsed, so no root lists its files.
    const roots = explorerRootsFor({
      drone: mech, workspaces, droneById,
      state: { ...none, pinned: [pin('host:guides'), pin('host:graphics')], open: { 'host:guides': false, 'host:graphics': false } },
    });
    const editor = {
      activeFile: null, onOpenFile() {}, onConfirmCloseOpenedFilesForPaths: () => true, onCloseOpenedFilesForPaths() {},
      onRemapOpenedFilesForPathChange() {},
    };
    const element = dom.document.createElement('div');
    dom.document.body.appendChild(element);
    const root = createRoot(element as unknown as HTMLElement);
    const order = () => Array.from(element.querySelectorAll('[data-explorer-root]')).map((section) => section.getAttribute('data-explorer-root'));
    const section = (title: string) => element.querySelector(`[data-explorer-root="${title}"]`) as unknown as Element;
    const header = (title: string) => section(title).querySelector('[draggable="true"]') as unknown as Element;
    const line = (title: string) => section(title).querySelector('.bg-\\[var\\(--accent\\)\\]');
    const transfer = () => {
      const types: string[] = [];
      return { types, effectAllowed: '', dropEffect: '', setData: (type: string) => { types.push(type); }, getData: () => '' };
    };
    const drag = async (from: string, to: string, clientY: number, dropIt = true) => {
      const dataTransfer = transfer();
      // Each header as if laid out at the top, 24px tall: above its middle is before it, below after.
      Object.assign(section(to), { getBoundingClientRect: () => ({ top: 0, bottom: 24, height: 24, left: 0, right: 200, width: 200 }) });
      await act(async () => { Simulate.dragStart(header(from), { dataTransfer } as never); });
      await act(async () => { Simulate.dragOver(section(to), { dataTransfer, clientY } as never); });
      const shown = Boolean(line(to));
      if (dropIt) await act(async () => { Simulate.drop(section(to), { dataTransfer, clientY } as never); });
      await act(async () => { Simulate.dragEnd(header(from), { dataTransfer } as never); });
      return shown;
    };
    try {
      await act(async () => {
        root.render(<ExplorerRootsColumn droneId="mech-reorder" ownName="Mech" ownOpen={false} roots={roots} editor={editor} own={null} zoom={1} />);
      });
      expect(order()).toEqual(['Mech', 'Guides', 'Game Graphics']);
      expect(await drag('Game Graphics', 'Mech', 4)).toBe(true);
      expect(order()).toEqual(['Game Graphics', 'Mech', 'Guides']);
      expect(await drag('Mech', 'Game Graphics', 20)).toBe(false);
      expect(await drag('Game Graphics', 'Guides', 20)).toBe(true);
      expect(order()).toEqual(['Mech', 'Guides', 'Game Graphics']);
      // A drop goes where the pointer is, even with no drag-over drawn before it.
      {
        const dataTransfer = transfer();
        Object.assign(section('Mech'), { getBoundingClientRect: () => ({ top: 0, bottom: 24, height: 24, left: 0, right: 200, width: 200 }) });
        await act(async () => { Simulate.dragStart(header('Game Graphics'), { dataTransfer } as never); });
        dataTransfer.types.splice(0);
        dataTransfer.types.push('application/x-drone-explorer-root');
        await act(async () => { Simulate.drop(section('Mech'), { dataTransfer, clientY: 4 } as never); });
        await act(async () => { Simulate.dragEnd(header('Game Graphics'), { dataTransfer } as never); });
      }
      expect(order()).toEqual(['Game Graphics', 'Mech', 'Guides']);
      await drag('Game Graphics', 'Guides', 20);
      expect(order()).toEqual(['Mech', 'Guides', 'Game Graphics']);
      // Alt+Up on a header moves it too.
      await act(async () => { Simulate.keyDown(header('Guides').querySelector('button')!, { key: 'ArrowUp', altKey: true }); });
      expect(order()).toEqual(['Guides', 'Mech', 'Game Graphics']);
      // The header keeps the focus as it moves, so Alt+Down can move it on: Chrome drops the focus of a node moved in the
      // page, and React gives it back after the commit. happy-dom keeps it, so it is made to drop it here.
      const nodeProto = dom.Node.prototype as any;
      const insertBefore = nodeProto.insertBefore;
      const appendChild = nodeProto.appendChild;
      const blurMoved = (node: any) => {
        const focused = dom.document.activeElement as any;
        if (node?.isConnected && focused && node.contains(focused)) focused.blur();
      };
      nodeProto.insertBefore = function (node: any, ref: any) { blurMoved(node); return insertBefore.call(this, node, ref); };
      nodeProto.appendChild = function (node: any) { blurMoved(node); return appendChild.call(this, node); };
      const guidesButton = header('Guides').querySelector('button') as unknown as HTMLElement;
      guidesButton.focus();
      for (const expected of [['Mech', 'Guides', 'Game Graphics'], ['Mech', 'Game Graphics', 'Guides']]) {
        await act(async () => {
          const focused = dom.document.activeElement as unknown as Element;
          if (focused) Simulate.keyDown(focused, { key: 'ArrowDown', altKey: true });
        });
        expect(order()).toEqual(expected);
        expect(dom.document.activeElement as unknown).toBe(guidesButton);
      }
      nodeProto.insertBefore = insertBefore;
      nodeProto.appendChild = appendChild;
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

  test("closing a workspace's tabs keeps those with unsaved changes and moves the active tab to a neighbour", () => {
    let state: OpenedFileTabsState = { tabs: [], activeTabId: null };
    state = tab(state, 'mech', '/a.md');
    state = tab(state, 'host:chat-home-c1', '/edited.md');
    state = tab(state, 'host:chat-home-c1', '/notes.md');
    state.tabs[1] = { ...state.tabs[1]!, kind: 'text', content: 'changed', savedContent: '' };
    const closed = closeFileTabsOfWorkspaces(state, (routeId) => routeId === 'host:chat-home-c1');
    expect(closed.tabs.map((entry) => `${entry.droneId}:${entry.path}`)).toEqual(['mech:/a.md', 'host:chat-home-c1:/edited.md']);
    expect(closed.activeTabId).toBe(closed.tabs[1]!.tabId);
    expect(closeFileTabsOfWorkspaces(closed, (routeId) => routeId === 'host:other')).toBe(closed);
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
