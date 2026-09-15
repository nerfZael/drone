import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';
import { CompanionScreen } from '../../../packages/assistant-chat/src/CompanionScreen';
import { CompanionScreenPanel } from '../src/droneHub/companion/CompanionScreenPanel';

test('desktop measures hidden Markdown, publishes accepted content, and dismisses it', async () => {
  const window = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, ResizeObserver: window.ResizeObserver, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  Object.defineProperty(window.document, 'fonts', { value: { ready: Promise.resolve() } });
  const container = window.document.createElement('div'); window.document.body.append(container);
  container.getBoundingClientRect = () => ({ top: 500, right: 600, width: 400 } as DOMRect);
  let renderedHeight = 44;
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return 374; } });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return renderedHeight; } });
  const root = createRoot(container as unknown as HTMLElement);
  const screen = new CompanionScreen();
  try {
    await act(async () => root.render(<CompanionScreenPanel screen={screen} />));
    expect(screen.constraints()).toMatchObject({ width: 374, height: 420 });
    let result: unknown;
    await act(async () => { result = screen.execute({ markdown: '## Status\n\n**Ready**' }); });
    expect(await result).toMatchObject({ displayed: true, measured: { height: 44 } });
    expect(window.document.querySelector('section strong')?.textContent).toBe('Ready');
    renderedHeight = 421;
    await act(async () => { result = screen.execute({ markdown: 'Too long' }); });
    expect(await result).toMatchObject({ error: 'CONTENT_DOES_NOT_FIT' });
    expect(window.document.querySelector('section strong')?.textContent).toBe('Ready');
    await act(async () => (window.document.querySelector('button') as unknown as HTMLButtonElement).click());
    expect(window.document.querySelector('section')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    await window.happyDOM.close();
  }
  expect(screen.constraints().width).toBe(0);
});
