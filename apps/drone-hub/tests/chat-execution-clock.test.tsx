import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { QueuedElapsedStatus, WorkingElapsedStatus } from '../src/droneHub/chat/WorkingElapsedStatus';
import { EarlierRequestWorkingNotice } from '../src/droneHub/chat/ChatExecutionNotice';

test('queue time survives remounts, runtime starts at execution, and the notice finds the active request', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const realNow = Date.now;
  let now = Date.parse('2026-09-25T00:02:00Z');
  Date.now = () => now;
  let tick = () => {};
  dom.setInterval = ((callback: () => void) => { tick = callback; return 1; }) as any;
  dom.clearInterval = (() => {}) as any;
  const host = dom.document.createElement('div');
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(async () => root.render(<QueuedElapsedStatus submittedAt="2026-09-25T00:00:00Z" />));
    expect(host.textContent).toBe('Queued for 2m 0s');
    now += 5000;
    await act(async () => tick());
    expect(host.textContent).toBe('Queued for 2m 5s');
    await act(async () => root.render(<QueuedElapsedStatus key="remounted" submittedAt="2026-09-25T00:00:00Z" />));
    expect(host.textContent).toBe('Queued for 2m 5s');
    await act(async () => root.render(<WorkingElapsedStatus startedAt={now} preRunDurationMs={125000} />));
    now += 2000;
    await act(async () => tick());
    expect(host.textContent).toContain('Working for 2s');
    expect(host.textContent).toContain('Queued 2m 5s');

    await act(async () => root.render(<div data-chat-transcript-surface="true">
      <div data-pending-prompt-id="active" />
      <EarlierRequestWorkingNotice id="active" prompt="Investigate FPS" />
    </div>));
    let scrolled = false;
    const target = host.querySelector('[data-pending-prompt-id]')!;
    target.scrollIntoView = () => { scrolled = true; };
    await act(async () => host.querySelector('button')!.click());
    expect(scrolled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    Date.now = realNow;
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
