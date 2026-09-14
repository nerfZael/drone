import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { MarkdownOutlinePreview } from '../src/droneHub/files/MarkdownOutlinePreview';

test('preview search opens from the keyboard, reveals collapsed results, wraps and closes', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.HTMLElement.prototype.scrollIntoView = () => {};
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const key = async (element: any, name: string, modifiers = {}) => {
    await act(async () => {
      element.dispatchEvent(new dom.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...modifiers }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  };
  try {
    await act(async () => {
      root.render(<MarkdownOutlinePreview text={'# First\n\nNeedle one\n\n# Second\n\nNeedle two'} expansionCommand={{ action: 'collapse', sequence: 1 }} />);
    });
    expect(host.textContent).not.toContain('Needle one');
    await key(host.firstElementChild, 'f', { ctrlKey: true });
    const input = host.querySelector('input')!;
    expect(dom.document.activeElement).toBe(input);
    await act(async () => { Simulate.change(input as unknown as HTMLInputElement, { target: { value: 'NEEDLE' } } as any); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(host.textContent).toContain('1 of 2 matching lines');
    expect(host.textContent).toContain('Needle one');
    await key(input, 'Enter');
    expect(host.textContent).toContain('2 of 2 matching lines');
    expect(host.textContent).toContain('Needle two');
    await key(input, 'Enter');
    expect(host.textContent).toContain('1 of 2 matching lines');
    await key(input, 'Enter', { shiftKey: true });
    expect(host.textContent).toContain('2 of 2 matching lines');
    await act(async () => { Simulate.change(input as unknown as HTMLInputElement, { target: { value: 'absent' } } as any); });
    expect(host.textContent).toContain('No results');
    expect(host.querySelector('button[aria-label="Next match"]')?.hasAttribute('disabled')).toBe(true);
    await key(input, 'Escape');
    expect(host.querySelector('input')).toBeNull();
    expect(dom.document.activeElement).toBe(host.firstElementChild);
    await key(host.firstElementChild, 'f', { metaKey: true });
    expect(host.querySelector('input')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
