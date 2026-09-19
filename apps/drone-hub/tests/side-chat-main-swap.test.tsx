import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { DockableDroneWorkspace } from '../src/droneHub/app/DockableDroneWorkspace';
import { saveSideChatWorkspaceState } from '../src/droneHub/app/side-chat-workspace-state';
import type { DroneSummary } from '../src/droneHub/types';

test('promoting A, then B, then restoring main keeps each fork in its original window', async () => {
  const dom = new Window({ url: 'http://localhost', width: 1200, height: 800 });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'localStorage', 'navigator', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: (dom as any)[key] });
  }
  originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
  dom.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('dh-dockable-workspace')) return new dom.DOMRect(0, 0, 1200, 800);
    return originalRect.call(this);
  };
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const sideChats = ['fork-A', 'fork-B'].map(name => ({ name, sourceChatName: 'default', agent: { kind: 'native' } }));
  const drone = { id: 'swap-test', name: 'Swap test', chats: ['default'], sideChats } as DroneSummary;
  let restored = 0;
  const render = async (main: string) => act(async () => {
    root.render(<DockableDroneWorkspace currentDrone={drone} paneHeaderMode="normal" activeToolTab="files"
      openRequestNonce={0} previewTab="preview" renderToolPane={() => null}
      chatContent={<div data-test-main={main}>{main}</div>} mainChatName={main}
      sideChats={drone.sideChats} displacedMainChatName={main === 'default' ? undefined : 'default'}
      onRestoreMainChat={() => { restored++; }}
      renderDisplacedMainChat={name => <div data-test-chat={name}>{name}</div>}
      renderSideChat={chat => <div data-test-chat={chat.name}>{chat.name}</div>} />);
  });
  const frame = (name: string) => host.querySelector(`[data-test-chat="${name}"]`)?.closest('.dv-resize-container');
  try {
    saveSideChatWorkspaceState(drone.id, { floatingBounds: {
      'fork-A': { x: 10, y: 20, width: 350, height: 300 },
      'fork-B': { x: 400, y: 30, width: 350, height: 300 },
    } });
    await render('default');
    const a = frame('fork-A');
    const b = frame('fork-B');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    const geometry = (element: typeof a) => {
      const style = (element as unknown as HTMLElement).style;
      return [style.left, style.top, style.width, style.height];
    };
    const initialA = geometry(a);
    const initialB = geometry(b);
    await render('fork-A');
    expect(frame('default')).toBe(a);
    expect(frame('fork-B')).toBe(b);
    expect(frame('fork-A')).toBeUndefined();
    expect(geometry(a)).toEqual(initialA);
    expect(geometry(b)).toEqual(initialB);
    expect(a!.querySelector('[data-chat-name="default"]')).not.toBeNull();
    expect(a!.querySelector('[aria-label="Delete forked chat"]')).toBeNull();
    await render('fork-B');
    expect(frame('fork-A')).toBe(a);
    expect(frame('default')).toBe(b);
    expect(frame('fork-B')).toBeUndefined();
    expect(geometry(a)).toEqual(initialA);
    expect(geometry(b)).toEqual(initialB);
    await act(async () => { (b!.querySelector('[aria-label="Restore as main chat"]') as unknown as HTMLButtonElement).click(); });
    expect(restored).toBe(1);
    await render('default');
    expect(frame('fork-A')).toBe(a);
    expect(frame('fork-B')).toBe(b);
    expect(frame('default')).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    dom.happyDOM.cancelAsync();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
