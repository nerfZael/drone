import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { DockableDroneWorkspace, workspaceLayoutStorageKey } from '../src/droneHub/app/DockableDroneWorkspace';
import type { RightPanelTab } from '../src/droneHub/app/app-config';
import type { DroneSummary } from '../src/droneHub/types';
import { leaveCanvasFullView, showCanvasChatPanel, toggleCanvasFullView, useCanvasFullViewStore } from '../src/droneHub/canvas/canvas-full-view';

test('the canvas fills the workspace on request and shows the opened chat in a panel; Escape closes the panel, then leaves', async () => {
  const dom = new Window({ url: 'http://localhost', width: 1200, height: 800 });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'localStorage', 'navigator', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'CustomEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: (dom as any)[key] });
  }
  originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const drone = { id: 'drone-a', name: 'A', chats: ['default'] } as DroneSummary;
  let chatMounts = 0;
  function Chat() {
    React.useEffect(() => { chatMounts++; }, []);
    return <div data-test-chat="" />;
  }
  function Tool({ tab }: { tab: RightPanelTab }) {
    return tab === 'canvas'
      ? <div data-drone-canvas-viewport=""><input aria-label="canvas field" /></div>
      : <div data-test-tool={tab} />;
  }
  const render = async (open: { tab: RightPanelTab; nonce: number }) => act(async () => {
    root.render(<DockableDroneWorkspace currentDrone={drone} paneHeaderMode="normal" activeToolTab={open.tab}
      openRequestNonce={open.nonce} previewTab="preview" onActiveToolTabChange={() => {}}
      renderToolPane={(tab) => <Tool tab={tab} />}
      chatContent={<Chat />} mainChatName="default" />);
  });
  const workspace = () => host.querySelector('.dh-dockable-workspace:not(.dh-detached-chats)')!;
  const fullView = () => workspace().getAttribute('data-canvas-full-view') === 'true';
  const panel = () => host.querySelector('[data-canvas-chat-panel]');
  const chats = () => host.querySelectorAll('[data-test-chat]').length;
  const run = (action: () => void) => act(async () => action());
  const escape = (target: EventTarget) => act(async () => {
    target.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }) as never);
  });
  try {
    await render({ tab: 'terminal', nonce: 1 });
    await render({ tab: 'canvas', nonce: 2 });
    expect(fullView()).toBe(false);
    // Outside the full view, opening a chat is the main chat's business alone.
    await run(showCanvasChatPanel);
    expect(panel()).toBeNull();

    await run(toggleCanvasFullView);
    expect(fullView()).toBe(true);
    expect(dom.document.documentElement.hasAttribute('data-canvas-full-view')).toBe(true);
    // A moment's view: the saved layout keeps the panes as they were. (Opening the canvas again saves the layout.)
    localStorage.removeItem(workspaceLayoutStorageKey(drone.id));
    await render({ tab: 'canvas', nonce: 3 });
    expect(fullView()).toBe(true);
    const saved = localStorage.getItem(workspaceLayoutStorageKey(drone.id));
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).grid.maximizedNode).toBeUndefined();

    // A card's chat opens in the panel, mounted there alone, and the panel names it.
    await run(showCanvasChatPanel);
    expect(panel()).not.toBeNull();
    expect(panel()!.querySelector('[data-test-chat]')).not.toBeNull();
    expect(chats()).toBe(1);
    expect(panel()!.textContent).toContain('default');
    // Escape in a field is the field's; elsewhere it closes the panel first, and the chat goes back to its pane.
    await escape(host.querySelector('[aria-label="canvas field"]')!);
    expect(panel()).not.toBeNull();
    await escape(dom.document.body);
    expect(panel()).toBeNull();
    expect(fullView()).toBe(true);
    expect(chats()).toBe(1);
    // The panel's close button closes it too.
    await run(showCanvasChatPanel);
    await act(async () => (panel()!.querySelector('[aria-label="Close chat"]') as HTMLButtonElement).click());
    expect(panel()).toBeNull();
    // Then Escape leaves the full view.
    await escape(dom.document.body);
    expect(fullView()).toBe(false);
    expect(useCanvasFullViewStore.getState().fullView).toBe(false);
    expect(dom.document.documentElement.hasAttribute('data-canvas-full-view')).toBe(false);

    // The double middle-click's toggle leaves it too, and takes the panel with it.
    await run(toggleCanvasFullView);
    await run(showCanvasChatPanel);
    expect(panel()).not.toBeNull();
    await run(toggleCanvasFullView);
    expect(fullView()).toBe(false);
    expect(panel()).toBeNull();
    expect(chatMounts).toBeGreaterThan(0);
  } finally {
    leaveCanvasFullView();
    await act(async () => root.unmount());
    dom.happyDOM.cancelAsync();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('the full view holds while cards open other chats and other drones', async () => {
  const dom = new Window({ url: 'http://localhost', width: 1200, height: 800 });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'localStorage', 'navigator', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'CustomEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
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
  const render = async (drone: DroneSummary, open: { tab: RightPanelTab; nonce: number }, chatName = 'default', shared = true) => act(async () => {
    root.render(<DockableDroneWorkspace key={shared ? 'shared' : drone.id} sharedLayout={shared} currentDrone={drone} paneHeaderMode="normal" activeToolTab={open.tab}
      openRequestNonce={open.nonce} previewTab="preview" onActiveToolTabChange={() => {}}
      renderToolPane={(tab) => tab === 'canvas' ? <div data-drone-canvas-viewport="" /> : <div data-test-tool={tab} />}
      chatContent={<div data-test-chat={`${drone.id}:${chatName}`} />} mainChatName={chatName} />);
  });
  const fullView = () => host.querySelector('.dh-dockable-workspace:not(.dh-detached-chats)')?.getAttribute('data-canvas-full-view') === 'true';
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  try {
    await render(droneA, { tab: 'terminal', nonce: 1 });
    await render(droneA, { tab: 'canvas', nonce: 2 });
    await act(async () => toggleCanvasFullView());
    await act(async () => showCanvasChatPanel());
    expect(fullView()).toBe(true);
    // A card of this drone: another chat becomes the main chat.
    await render(droneA, { tab: 'canvas', nonce: 2 }, 'fork');
    await settle();
    expect(fullView()).toBe(true);
    expect(host.querySelector('[data-canvas-chat-panel] [data-test-chat="drone-a:fork"]')).not.toBeNull();
    // A card of another drone, in the shared layout and in each drone's own.
    await render(droneB, { tab: 'canvas', nonce: 2 }, 'default');
    await settle();
    expect(useCanvasFullViewStore.getState()).toEqual({ fullView: true, chatPanelOpen: true });
    expect(fullView()).toBe(true);
    expect(host.querySelector('[data-canvas-chat-panel] [data-test-chat="drone-b:default"]')).not.toBeNull();
    await render(droneA, { tab: 'canvas', nonce: 2 }, 'default', false);
    await render(droneB, { tab: 'canvas', nonce: 2 }, 'fork', false);
    await settle();
    expect(useCanvasFullViewStore.getState()).toEqual({ fullView: true, chatPanelOpen: true });
    expect(host.querySelector('[data-canvas-chat-panel] [data-test-chat="drone-b:fork"]')).not.toBeNull();
  } finally {
    leaveCanvasFullView();
    await act(async () => root.unmount());
    dom.happyDOM.cancelAsync();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
