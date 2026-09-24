import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';

test.each([false, true])('menu handoff keeps transcript open (floating=%s)', async floating => {
  const dom = new Window({ url: 'http://localhost' });
  const child = new Window({ url: 'http://localhost' });
  const display = floating ? child : dom;
  const portalContainer = display.document.body as unknown as HTMLElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'HTMLInputElement', 'MutationObserver', 'ResizeObserver', 'CustomEvent', 'Event', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? dom : (dom as any)[name];
    Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(dom) : value });
  }
  originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const { Popover } = await import('radix-ui');
  const { CompanionTranscriptDialog, useCompanionTranscriptDialog } = await import('../src/droneHub/companion/CompanionTranscriptDialog');
  const { useCrossWindowFocus } = await import('../src/ui/use-cross-window-focus');
  const container = display.document.createElement('div'); display.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  let restores = 0;
  function Harness({ captions }: { captions: string }) {
    const [menuOpen, setMenuOpen] = React.useState(false);
    const dialog = useCompanionTranscriptDialog();
    const focus = useCrossWindowFocus(portalContainer);
    return <>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger id="options">Options</Popover.Trigger>
        <Popover.Portal container={portalContainer}><Popover.Content onOpenAutoFocus={focus.onOpenAutoFocus} onCloseAutoFocus={event => {
          if (!dialog.onMenuCloseAutoFocus(event)) { restores++; focus.onCloseAutoFocus(event); }
        }}>
          <button id="transcript" onClick={() => { dialog.requestOpen(); setMenuOpen(false); }}>Voice transcript</button>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      {dialog.open && <CompanionTranscriptDialog captions={captions} onClose={dialog.close} portalContainer={portalContainer} />}
    </>;
  }
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
  try {
    await act(async () => root.render(<Harness captions="First words" />));
    await act(async () => display.document.getElementById('options')!.click()); await settle();
    await act(async () => display.document.getElementById('transcript')!.click()); await settle();
    expect(restores).toBe(0);
    expect(display.document.querySelector('[role="dialog"]')?.textContent).toContain('First words');
    await act(async () => root.render(<Harness captions="First words, still updating" />)); await settle();
    expect(display.document.querySelector('[role="dialog"]')?.textContent).toContain('still updating');
    await act(async () => (display.document.querySelector('[aria-label="Close dialog"]') as any).click()); await settle();
    expect(display.document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    dom.happyDOM.abort(); child.happyDOM.abort();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});
