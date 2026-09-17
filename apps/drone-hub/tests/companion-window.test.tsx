import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';
import { useCompanionWindowHost, useCompanionWindow } from '../src/droneHub/companion/companion-window';

test('moving Companion retains component state and DOM, follows theme, hides when idle, and docks on native close', async () => {
  const source = new Window({ url: 'http://localhost:5173' });
  const child = new Window({ url: 'about:blank' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: source, document: source.document, HTMLElement: source.HTMLElement, MutationObserver: source.MutationObserver, ResizeObserver: source.ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const controls: string[] = [];
  let onClose: (() => void) | undefined;
  Object.assign(source, {
    droneHubDesktop: { companionWindow: {
      control: (action: string) => controls.push(action),
      onClose: (callback: () => void) => { onClose = callback; return () => { onClose = undefined; }; },
    } },
    open: () => child,
  });
  source.document.head.innerHTML = '<style>:root { --fg: red }</style><style data-drone-hub-desktop-title-bar>body{margin-top:29px}</style>';
  source.document.documentElement.dataset.theme = 'dark';
  const container = source.document.createElement('div');
  source.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  let mounts = 0;
  function Editor() {
    const floating = useCompanionWindow();
    const [count, setCount] = React.useState(0);
    React.useEffect(() => { mounts++; return () => { mounts--; }; }, []);
    return <><button id="toggle" onClick={floating.toggle}>{String(floating.detached)}</button>
      <button id="count" onClick={() => setCount(c => c + 1)}>{count}</button>
      <textarea defaultValue="unsaved draft" /><div role="alert">{floating.error}</div></>;
  }
  function Host({ visible = true }: { visible?: boolean }) {
    const host = useCompanionWindowHost(visible);
    return host.render(<Editor />);
  }
  const click = async (doc: typeof source.document, id: string) => {
    await act(async () => doc.getElementById(id)!.click());
  };
  try {
    await act(async () => root.render(<Host />));
    const editor = source.document.querySelector('textarea')!;
    editor.value = 'keep my draft';
    editor.setSelectionRange(3, 7);
    await click(source.document, 'count');
    await click(source.document, 'toggle');
    expect(mounts).toBe(1);
    expect(child.document.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('keep my draft');
    expect(editor.selectionStart).toBe(3);
    expect(child.document.getElementById('count')!.textContent).toBe('1');
    expect(child.document.getElementById('toggle')!.textContent).toBe('true');
    expect(source.document.querySelector('textarea')).toBeNull();
    expect(child.document.querySelector('base')!.href).toBe(source.document.baseURI);
    expect(child.document.querySelector('[data-drone-hub-desktop-title-bar]')).toBeNull();
    expect(controls).toContain('show');
    await act(async () => {
      source.document.documentElement.dataset.theme = 'light';
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(child.document.documentElement.dataset.theme).toBe('light');
    await click(child.document, 'count');
    expect(child.document.getElementById('count')!.textContent).toBe('2');
    await act(async () => root.render(<Host visible={false} />));
    expect(controls.at(-1)).toBe('hide');
    await act(async () => root.render(<Host />));
    expect(controls).toContain('show');
    await act(async () => onClose!());
    expect(source.document.querySelector('textarea')).toBe(editor);
    expect(source.document.getElementById('count')!.textContent).toBe('2');
    expect(source.document.getElementById('toggle')!.textContent).toBe('false');
    expect(controls.at(-1)).toBe('attach');
    expect(mounts).toBe(1);
    Object.assign(source, { open: () => null });
    await click(source.document, 'toggle');
    expect(source.document.querySelector('[role="alert"]')!.textContent).toContain('Could not detach Companion');
    expect(source.document.querySelector('textarea')).toBe(editor);
  } finally {
    await act(async () => root.unmount());
    expect(mounts).toBe(0);
    expect(onClose).toBeUndefined();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await source.happyDOM.close();
    await child.happyDOM.close();
  }
});
