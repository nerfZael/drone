import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { ChatsDockTab } from '../src/droneHub/app/ChatsDockTab';
import { normalizeChatsView, useChatsViewStore } from '../src/droneHub/app/chats-view-store';

test('unknown saved views fall back to the list', () => {
  expect(normalizeChatsView('grid')).toBe('grid');
  expect(normalizeChatsView('canvas')).toBe('list');
  expect(normalizeChatsView(undefined)).toBe('list');
});

test('the Chats tab switches between list and grid without leaving the tab', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  const root = createRoot(container as unknown as HTMLElement);
  let closed = 0;
  const api = {
    title: 'Chats',
    onDidTitleChange: () => ({ dispose: () => {} }),
    close: () => { closed += 1; },
  };
  try {
    await act(async () => { root.render(<ChatsDockTab api={api as never} containerApi={{} as never} params={{}} tabLocation="header" />); });
    const radios = () => Array.from(container.querySelectorAll('[role="radio"]'));
    expect(radios().map((radio) => radio.getAttribute('data-chats-view'))).toEqual(['list', 'grid']);
    expect(radios()[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => { (radios()[1] as unknown as HTMLButtonElement).click(); });
    expect(useChatsViewStore.getState().view).toBe('grid');
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');
    expect(radios()[0].getAttribute('aria-checked')).toBe('false');
    expect(closed).toBe(0);
    expect(container.textContent).toContain('Chats');
  } finally {
    await act(async () => root.unmount());
    useChatsViewStore.getState().setView('list');
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
