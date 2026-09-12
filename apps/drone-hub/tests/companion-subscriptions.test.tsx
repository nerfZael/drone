import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useCompanionSubscriptions } from '../src/droneHub/companion/CompanionSubscriptions';

test('loads only the current session subscriptions, refreshes on open, and clears on close', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const urls: string[] = [];
  let fail = false;
  let rows = [{ id: 'watch', provider: 'github', resourceType: 'pull_request', resourceId: 'acme/repo#1', events: ['pull_request.merged'], status: 'active' }];
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string) => {
      urls.push(url);
      if (fail) throw new Error('Offline');
      return new Response(JSON.stringify({ subscriptions: rows }), { headers: { 'content-type': 'application/json' } });
    } })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement);
  let state!: ReturnType<typeof useCompanionSubscriptions>;
  function Harness({ id, open = false }: { id: string | null; open?: boolean }) {
    state = useCompanionSubscriptions(id, open); return null;
  }
  try {
    await act(async () => { root.render(<Harness id="session-a" />); });
    expect(urls.at(-1)).toContain('subscriberChatId=companion%3Asession-a');
    expect(state.subscriptions).toHaveLength(1);
    rows = [];
    await act(async () => { root.render(<Harness id="session-a" open />); });
    expect(state.subscriptions).toHaveLength(0);
    fail = true;
    await act(async () => { root.render(<Harness id="session-b" open />); });
    expect(urls.at(-1)).toContain('companion%3Asession-b');
    expect(state.error).toContain('Offline');
    expect(state.subscriptions).toHaveLength(0);
    fail = false;
    await act(async () => { state.reload(); });
    expect(state.error).toBe('');
    await act(async () => { root.render(<Harness id={null} />); });
    expect(state.subscriptions).toHaveLength(0);
    expect(state.loading).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
