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
  const render = async (drone: DroneSummary, shared: boolean, open?: { tab: RightPanelTab; nonce: number }) => act(async () => {
    root.render(<DockableDroneWorkspace key={`${shared ? 'shared' : 'drone'}:${drone.id}`} sharedLayout={shared}
      currentDrone={drone} paneHeaderMode="normal" activeToolTab={open?.tab ?? 'terminal'}
      openRequestNonce={open?.nonce ?? 0} previewTab="preview"
      renderToolPane={(tab) => <div data-test-tool={`${drone.id}:${tab}`} />}
      chatContent={<div data-test-chat={drone.id} />} mainChatName="default" />);
  });
  const tools = () => [...host.querySelectorAll('[data-test-tool]')].map((element) => element.getAttribute('data-test-tool'));
  const stored = (key: string) => localStorage.getItem(key);
  try {
    await render(droneA, true);
    expect(tools()).toEqual([]);
    await render(droneA, true, { tab: 'terminal', nonce: 1 });
    expect(tools()).toEqual(['drone-a:terminal']);

    await render(droneB, true);
    expect(tools()).toEqual(['drone-b:terminal']);
    expect(host.querySelector('[data-test-chat="drone-b"]')).not.toBeNull();
    expect(Object.keys(JSON.parse(stored(SHARED_WORKSPACE_LAYOUT_STORAGE_KEY)!).panels)).toContain('tool:terminal');
    expect(stored(workspaceLayoutStorageKey('drone-a'))).toBeNull();
    expect(stored(workspaceLayoutStorageKey('drone-b'))).toBeNull();

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
    expect(tools()).toEqual(['drone-b:terminal']);
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
