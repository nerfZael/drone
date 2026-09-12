import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { normalizePresentedChatResourceSubscriptions } from '@drone/assistant-chat';
import { CompanionSubscriptions } from '../src/droneHub/companion/CompanionSubscriptions';

test('the indicator updates from pushed subscription snapshots without fetching', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let fetches = 0;
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => { fetches++; throw new Error('Unexpected polling'); } })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  const root = createRoot(container as unknown as HTMLElement);
  const rows = normalizePresentedChatResourceSubscriptions([{ id: 'watch', provider: 'github',
    resourceType: 'pull_request', resourceId: 'acme/repo#1', events: ['pull_request.merged'], status: 'active' }]);
  try {
    for (const subscriptions of [[], rows, []]) {
      await act(async () => { root.render(<CompanionSubscriptions subscriptions={subscriptions} />); });
      expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(`Companion subscriptions: ${subscriptions.length}`);
    }
    expect(fetches).toBe(0);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
