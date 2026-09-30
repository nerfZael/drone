import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  DockableDroneWorkspace,
  SHARED_WORKSPACE_LAYOUT_STORAGE_KEY,
  workspaceLayoutStorageKey,
} from '../src/droneHub/app/DockableDroneWorkspace';
import type { RightPanelTab } from '../src/droneHub/app/app-config';
import type { DroneSummary } from '../src/droneHub/types';
import { presentCompanionFiles } from '../src/droneHub/files/companion-file-presentation';
import { openedFileTabId } from '../src/droneHub/app/opened-file-tabs';

test('the shared layout keeps its windows across drones and loads each drone into them', async () => {
  const dom = new Window({ url: 'http://localhost', width: 1200, height: 800 });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'localStorage', 'navigator', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: (dom as any)[key] });
  }
  originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const droneA = { id: 'drone-a', name: 'A', chats: ['default'] } as DroneSummary;
  const droneB = { id: 'drone-b', name: 'B', chats: ['default'] } as DroneSummary;
  const mounts: string[] = [];
  const unmounts: string[] = [];
  const activations: string[] = [];
  const closedFiles: string[] = [];
  let ownedWindows = false;
  const fileFor = (drone: DroneSummary) => ({ tabId: openedFileTabId(drone.id, '/work/repo/test.ts'), path: '/work/repo/test.ts', name: 'test.ts' });
  function Tool({ drone, tab }: { drone: DroneSummary; tab: RightPanelTab }) {
    React.useEffect(() => {
      mounts.push(`${drone.id}:${tab}`);
      return () => { unmounts.push(`${drone.id}:${tab}`); };
    }, []);
    return <div data-test-tool={`${drone.id}:${tab}`}><input aria-label={`${tab} draft`} defaultValue="" /></div>;
  }
  const render = async (drone: DroneSummary, shared: boolean, open?: { tab: RightPanelTab; nonce: number }) => act(async () => {
    root.render(<DockableDroneWorkspace key={shared ? 'shared' : `drone:${drone.id}`} sharedLayout={shared}
      currentDrone={drone} paneHeaderMode="normal" activeToolTab={open?.tab ?? 'terminal'}
      openRequestNonce={open?.nonce ?? 0} previewTab="preview"
      onActiveToolTabChange={(tab) => { activations.push(`${drone.id}:${tab}`); }}
      sideChats={ownedWindows ? [{ name: 'fork', sourceChatName: 'default', checkpointId: 'checkpoint', agent: { kind: 'builtin', id: 'codex' } }] : []}
      renderSideChat={() => <div data-test-fork={drone.id} />}
      fileWindows={{ openTabIds: [fileFor(drone).tabId], render: () => <div data-test-file={drone.id} />,
        onClosed: (tabId) => { closedFiles.push(tabId); } }}
      renderToolPane={(tab) => <Tool drone={drone} tab={tab} />}
      chatContent={<div data-test-chat={drone.id} />} mainChatName="default" />);
  });
  const tools = () => [...host.querySelectorAll('[data-test-tool]')].map((element) => element.getAttribute('data-test-tool'));
  const stored = (key: string) => localStorage.getItem(key);
  try {
    await render(droneA, true);
    expect(tools()).toEqual([]);
    await render(droneA, true, { tab: 'terminal', nonce: 1 });
    expect(tools()).toEqual(['drone-a:terminal']);
    const dock = host.querySelector('.dh-dockview');
    const chatFrame = host.querySelector('[data-main-workspace-chat]');
    const terminalFrame = host.querySelector('[data-test-tool="drone-a:terminal"]')!.closest('.dv-groupview');
    expect(terminalFrame).not.toBeNull();
    await render(droneA, true, { tab: 'canvas', nonce: 2 });
    const canvas = host.querySelector('[aria-label="canvas draft"]') as HTMLInputElement;
    canvas.value = 'Keep this global draft';
    const canvasFrame = canvas.closest('.dv-groupview');

    await render(droneB, true);
    expect(tools().sort()).toEqual(['drone-b:canvas', 'drone-b:terminal']);
    expect(host.querySelector('.dh-dockview')).toBe(dock);
    expect(host.querySelector('[data-main-workspace-chat]')).toBe(chatFrame);
    expect(host.querySelector('[data-test-tool="drone-b:terminal"]')!.closest('.dv-groupview')).toBe(terminalFrame);
    expect(host.querySelector('[aria-label="canvas draft"]')).toBe(canvas);
    expect(canvas.closest('.dv-groupview')).toBe(canvasFrame);
    expect(canvas.value).toBe('Keep this global draft');
    expect(mounts.filter((id) => id.endsWith(':canvas'))).toEqual(['drone-a:canvas']);
    expect(unmounts).toEqual(['drone-a:terminal']);
    expect(host.querySelector('[data-test-chat="drone-b"]')).not.toBeNull();
    expect(Object.keys(JSON.parse(stored(SHARED_WORKSPACE_LAYOUT_STORAGE_KEY)!).panels)).toContain('tool:terminal');
    expect(stored(workspaceLayoutStorageKey('drone-a'))).toBeNull();
    expect(stored(workspaceLayoutStorageKey('drone-b'))).toBeNull();
    // Dockview listeners must follow B without being lost on the switch.
    await render(droneB, true, { tab: 'terminal', nonce: 3 });
    expect(activations.at(-1)).toBe('drone-b:terminal');
    await render(droneA, true, { tab: 'canvas', nonce: 4 });
    await render(droneA, true, { tab: 'canvas', nonce: 5 });
    expect(activations.at(-1)).toBe('drone-a:canvas');
    expect(host.querySelector('[aria-label="canvas draft"]')).toBe(canvas);
    expect(unmounts.filter((id) => id.endsWith(':canvas'))).toEqual([]);

    ownedWindows = true;
    await render(droneA, true);
    const forkA = host.querySelector('[data-test-fork="drone-a"]');
    expect(forkA).not.toBeNull();
    const workspace = host.querySelector('.dh-dockable-workspace') as HTMLElement;
    workspace.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} });
    await act(async () => { presentCompanionFiles(droneA.id, [fileFor(droneA)], 'panes'); });
    expect(host.querySelector('[data-test-file="drone-a"]')).not.toBeNull();
    await render(droneB, true);
    expect(host.querySelector('[data-test-file]')).toBeNull();
    expect(host.querySelector('[data-test-fork="drone-a"]')).toBeNull();
    expect(host.querySelector('[data-test-fork="drone-b"]')).not.toBe(forkA);
    expect(host.querySelector('[data-test-fork="drone-b"]')).not.toBeNull();
    expect(closedFiles).toEqual([]);
    expect(host.querySelector('[aria-label="canvas draft"]')).toBe(canvas);
    await act(async () => { presentCompanionFiles(droneB.id, [fileFor(droneB)], 'panes'); });
    expect(host.querySelector('[data-test-file="drone-b"]')).not.toBeNull();
    const closeFile = host.querySelector('[data-test-file="drone-b"]')!.closest('.dv-groupview')!.querySelector('.dv-default-tab-action') as HTMLElement;
    await act(async () => {
      closeFile.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(closedFiles).toEqual([fileFor(droneB).tabId]);
    expect(host.querySelector('[data-test-file]')).toBeNull();
    await act(async () => { presentCompanionFiles(droneB.id, [fileFor(droneB)], 'panes'); });
    ownedWindows = false;
    await render(droneA, true);
    expect(host.querySelector('[data-test-file]')).toBeNull();
    expect(host.querySelector('[data-test-fork]')).toBeNull();
    expect(closedFiles).toEqual([fileFor(droneB).tabId]);

    // Each drone's own layout is untouched by the shared one, and the other way round.
    // Mounting focuses the chat, so compare the arrangement, not the active group.
    const arrangement = () => {
      const { grid, panels } = JSON.parse(stored(SHARED_WORKSPACE_LAYOUT_STORAGE_KEY)!);
      return { grid, panels };
    };
    const shared = arrangement();
    await render(droneB, false);
    expect(tools()).toEqual([]);
    await render(droneB, false, { tab: 'editor', nonce: 2 });
    await render(droneB, true);
    expect(tools().sort()).toEqual(['drone-b:canvas', 'drone-b:terminal']);
    expect(arrangement()).toEqual(shared);
    expect(Object.keys(JSON.parse(stored(workspaceLayoutStorageKey('drone-b'))!).panels)).toContain('tool:editor');
  } finally {
    await act(async () => root.unmount());
    dom.happyDOM.cancelAsync();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
