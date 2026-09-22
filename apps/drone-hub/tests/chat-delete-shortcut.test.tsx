import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useChatDeleteShortcut } from '../src/droneHub/app/use-chat-delete-shortcut';

test('Delete targets the interacting chat, protects editors, and suppresses duplicate/sidebar deletion', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document,
    Element: dom.Element, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const calls: string[] = [];
  let finish: (() => void) | undefined;
  let sidebarDeletes = 0;
  const sidebarHandler = () => { sidebarDeletes++; };
  dom.window.addEventListener('keydown', sidebarHandler);
  function Harness() {
    useChatDeleteShortcut((droneId, chatName) => {
      calls.push(`${droneId}/${chatName}`);
      return new Promise((resolve) => { finish = () => resolve({ ok: false, error: '' }); });
    });
    return <>
      <div data-main-workspace-chat="true" data-chat-drone-id="a" data-chat-name="main">
        <p id="transcript">Main chat</p><textarea id="composer" />
        <div contentEditable suppressContentEditableWarning><span id="editable">Draft text</span></div>
      </div>
      <button id="row" data-chat-drone-id="a" data-chat-name="nested">Nested chat row</button>
      <section data-chat-drone-id="b" data-chat-name="grid"><p id="grid">Another drone’s chat</p></section>
      <div data-app-shortcuts-disabled="true"><button id="boundary" data-chat-drone-id="a" data-chat-name="blocked">Boundary</button></div>
      <button id="other">Other panel</button>
    </>;
  }
  const press = (id: string | null, init = {}) => {
    const event = new dom.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true, ...init });
    (id ? dom.document.getElementById(id)! : dom.document.body).dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => root.render(<Harness />));
    expect(press('row').defaultPrevented).toBe(true);
    expect(calls).toEqual(['a/nested']);
    expect(sidebarDeletes).toBe(0);
    press('row');
    expect(calls.length).toBe(1);
    await act(async () => finish?.());

    press('composer');
    press('editable');
    press('boundary');
    press('transcript', { ctrlKey: true });
    press('transcript', { repeat: true });
    press('transcript', { isComposing: true });
    expect(calls.length).toBe(1);

    const dialog = dom.document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dom.document.body.append(dialog);
    press('transcript');
    expect(calls.length).toBe(1);
    dialog.remove();

    press('transcript');
    expect(calls.at(-1)).toBe('a/main');
    await act(async () => finish?.());
    dom.document.getElementById('grid')!.dispatchEvent(new dom.PointerEvent('pointerdown', { bubbles: true }));
    press(null);
    expect(calls.at(-1)).toBe('b/grid');
    await act(async () => finish?.());
    dom.document.getElementById('other')!.dispatchEvent(new dom.PointerEvent('pointerdown', { bubbles: true }));
    press(null);
    expect(calls.length).toBe(3);
  } finally {
    await act(async () => root.unmount());
    dom.window.removeEventListener('keydown', sidebarHandler);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
