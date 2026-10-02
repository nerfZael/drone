import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { NextActionsRow } from '../src/droneHub/chat/NextActionsRow';

const anchor = { turnId: 't1', turns: [{ prompt: 'fix it', response: 'Fixed, not committed.' }] };

async function withRow(
  options: { enabled: boolean; suggest: () => Promise<Response> },
  run: (ctx: { element: HTMLElement; flush: () => Promise<void>; until: (check: () => boolean) => Promise<void>; sent: string[]; requests: Array<{ url: string; body: any }>; resolveSend: (ok: boolean) => void }) => Promise<void>,
) {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const requests: Array<{ url: string; body: any }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/settings/next-actions') {
      return Response.json({ ok: true, revision: 'r1', settings: { enabled: options.enabled, actions: ['Commit', 'Review', 'Continue'] } });
    }
    return options.suggest();
  };
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, fetch, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = dom.document.createElement('div') as unknown as HTMLElement;
  const root = createRoot(element);
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
  const until = async (check: () => boolean) => {
    for (let attempt = 0; attempt < 300 && !check(); attempt += 1) await act(flush);
    expect(check()).toBe(true);
  };
  const sent: string[] = [];
  let resolveSend: (ok: boolean) => void = () => {};
  const onSend = (prompt: string) => new Promise<boolean>((resolve) => { sent.push(prompt); resolveSend = resolve; });
  try {
    await act(async () => {
      root.render(<QueryClientProvider client={client}><NextActionsRow droneId="d1" chatName="chat-1" anchor={anchor} onSend={onSend} /></QueryClientProvider>);
      await flush();
    });
    await run({ element, flush, until, sent, requests, resolveSend: (ok) => resolveSend(ok) });
  } finally {
    await act(async () => root.unmount());
    client.clear();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
}

test('shows an indicator while loading, then sends the clicked action once', async () => {
  let respond: (response: Response) => void = () => {};
  await withRow({ enabled: true, suggest: () => new Promise((resolve) => { respond = resolve; }) }, async ({ element, flush, until, sent, requests, resolveSend }) => {
    await until(() => Boolean(element.querySelector('[data-next-actions="loading"]')));
    expect(element.textContent).toContain('Next actions');
    await until(() => requests.some((request) => request.url === '/api/next-actions/suggest'));
    expect(requests.find((request) => request.url === '/api/next-actions/suggest')?.body).toEqual({ droneId: 'd1', chatName: 'chat-1', ...anchor });
    await act(async () => { respond(Response.json({ ok: true, actions: ['Review', 'Commit'] })); await flush(); });
    await until(() => element.querySelectorAll('button').length === 2);
    const buttons = Array.from(element.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual(['Review', 'Commit']);
    await act(async () => { buttons[1]!.click(); await flush(); });
    await act(async () => { buttons[0]!.click(); await flush(); });
    expect(sent).toEqual(['Commit']);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    // A failed send makes the actions available again.
    await act(async () => { resolveSend(false); await flush(); });
    expect(buttons.every((button) => !button.disabled)).toBe(true);
  });
});

test('renders nothing when off or when nothing fits, and offers a retry on failure', async () => {
  await withRow({ enabled: false, suggest: async () => Response.json({ ok: true, actions: ['Commit'] }) }, async ({ element, until, requests }) => {
    await until(() => requests.length > 0);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(element.innerHTML).toBe('');
    expect(requests.some((request) => request.url === '/api/next-actions/suggest')).toBe(false);
  });
  await withRow({ enabled: true, suggest: async () => Response.json({ ok: true, actions: [] }) }, async ({ element, until, requests }) => {
    await until(() => requests.some((request) => request.url === '/api/next-actions/suggest'));
    await until(() => element.innerHTML === '');
  });
  await withRow({ enabled: true, suggest: async () => Response.json({ ok: false, error: 'no credentials' }, { status: 412 }) }, async ({ element, until }) => {
    await until(() => Boolean(element.querySelector('[data-next-actions="error"]')));
    expect(element.textContent).toContain('Next actions unavailable');
    expect(element.querySelector('[title]')?.getAttribute('title')).toContain('no credentials');
    expect(Array.from(element.querySelectorAll('button')).map((button) => button.textContent)).toEqual(['Retry']);
  });
});
