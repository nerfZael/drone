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
  const request = { model: 'typesafe-ai/jev' as const, state: '{"timing":{"silenceMs":40}}', instructions: 'Wait for a second', criteria: { send: 'Act', wait: 'Wait' } };
  const requests = [{ id: 'send-1', startedAt: 1, durationMs: 20, decision: 'send' as const, delegated: true, input: { transcript: 'First words', context: '', silenceMs: 40 }, request },
    { id: 'wait-1', startedAt: 2, durationMs: 25, decision: 'wait' as const, delegated: false, input: { transcript: 'Waiting words', context: '', silenceMs: 10 }, request }];
  const originalFetch = globalThis.fetch;
  const replayBodies: any[] = [];
  globalThis.fetch = (async (url, init) => {
    expect(String(url)).toBe('/api/companion/jev/replay');
    replayBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ decision: 'wait', durationMs: 30 });
  }) as typeof fetch;
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
      {dialog.open && <CompanionTranscriptDialog requests={requests} captions={captions} onClose={dialog.close} portalContainer={portalContainer} />}
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
    await act(async () => display.document.getElementById('jev-requests-tab')!.click());
    const panel = display.document.getElementById('jev-requests-panel')!;
    expect(panel.textContent).not.toContain('Waiting words');
    const row = panel.querySelector('button')!;
    await act(async () => row.click());
    expect(panel.textContent).toContain('Original result: send');
    const instructions = panel.querySelector('[aria-label="Jev replay instructions"]') as any;
    expect(instructions.value).toBe(request.instructions);
    const replay = Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Replay without delegating')!;
    await act(async () => replay.click());
    expect(replayBodies).toEqual([request]);
    expect(panel.textContent).toContain('Replay: wait');
    expect(panel.textContent).toContain('No backend request was sent.');
    await act(async () => (display.document.querySelector('[aria-label="Close dialog"]') as any).click()); await settle();
    expect(display.document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.happyDOM.abort(); child.happyDOM.abort();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});
