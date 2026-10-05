import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { ChatAsksBadge } from '../src/droneHub/chat/ChatAsksControl';
import { askStatusLabel, groupAsksByRun, useChatAsks, type ChatAsk } from '../src/droneHub/chat/chat-asks';

const ask = (patch: Partial<ChatAsk>): ChatAsk => ({
  id: 'a1', kind: 'request', text: 'make it collapse', messageIds: ['m1'], runId: 'r1', at: '2026-10-05T10:00:00.000Z',
  status: 'open', inProgress: false, ...patch,
});

function Harness() {
  const state = useChatAsks({ droneId: 'd1', chatName: 'chat-1' });
  return <ChatAsksBadge state={state} />;
}

async function withBadge(view: Record<string, unknown>, run: (ctx: { element: HTMLElement; until: (check: () => boolean) => Promise<void>; requests: Array<{ url: string; body: any }>; click: (text: string) => Promise<void> }) => Promise<void>) {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const requests: Array<{ url: string; body: any }> = [];
  let current = { ok: true, enabled: true, tracking: true, processing: false, error: null, cost: { cost: 0.0042, calls: 7, unpriced: 0 }, ...view } as any;
  const fetch = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, body });
    if (url === '/api/settings/chat-asks') return Response.json({ ok: true, settings: { enabled: true } });
    if (url === '/api/chat-asks/status') {
      current = { ...current, asks: current.asks.map((item: ChatAsk) => item.id === body.askId ? { ...item, status: body.status, manual: true } : item) };
    }
    return Response.json(current);
  };
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, CSS: { escape: (value: string) => value }, fetch, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = dom.document.createElement('div') as unknown as HTMLElement;
  dom.document.body.appendChild(element as any);
  const root = createRoot(element);
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
  const until = async (check: () => boolean) => {
    for (let attempt = 0; attempt < 300 && !check(); attempt += 1) await act(flush);
    expect(check()).toBe(true);
  };
  const click = async (text: string) => {
    const button = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim().startsWith(text));
    expect(button).toBeTruthy();
    await act(async () => { button!.click(); await flush(); });
  };
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); await flush(); });
    await run({ element, until, requests, click });
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

test('the badge counts open asks and the list shows them in the user\'s words, by kind, with cost', async () => {
  await withBadge({
    asks: [
      ask({ id: 'a1', text: 'make it collapse', status: 'done', note: 'Collapses under 768px.' }),
      ask({ id: 'a2', kind: 'question', text: 'why is the build slow?', inProgress: true }),
      ask({ id: 'a3', kind: 'rule', text: 'always run the type checker' }),
      ask({ id: 'a4', text: 'keep the icons', status: 'not_done', runId: 'r2', at: '2026-10-05T10:05:00.000Z' }),
    ],
  }, async ({ element, until, requests, click }) => {
    await until(() => element.textContent?.includes('Asks') ?? false);
    expect(element.textContent).toContain('2 open');
    await click('Asks');
    const panel = element.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain('“make it collapse”');
    expect(panel.textContent).toContain('Done');
    expect(panel.textContent).toContain('Collapses under 768px.');
    expect(panel.textContent).toContain('In progress');
    expect(panel.textContent).toContain('Active');
    expect(panel.textContent).toContain('Not done');
    expect(panel.textContent).toContain('<$0.01');
    expect(panel.querySelectorAll('section')).toHaveLength(2);
    await click('Questions');
    expect(element.querySelector('[role="dialog"]')!.textContent).toContain('why is the build slow?');
    expect(element.querySelector('[role="dialog"]')!.textContent).not.toContain('make it collapse');
    await click('All');
    await click('Mark done');
    expect(requests.find((request) => request.url === '/api/chat-asks/status')?.body).toEqual({ droneId: 'd1', chatName: 'chat-1', askId: 'a2', status: 'done' });
    await until(() => element.querySelector('[role="dialog"]')!.textContent!.includes('·you'));
  });
});

test('an untracked chat with no asks shows nothing; a chat that stopped tracking offers to track again', async () => {
  await withBadge({ tracking: false, asks: [] }, async ({ element, requests, until }) => {
    await until(() => requests.some((request) => request.url.startsWith('/api/chat-asks?')));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(element.innerHTML).toBe('');
  });
  await withBadge({ tracking: false, asks: [ask({})] }, async ({ element, until, requests, click }) => {
    await until(() => element.textContent?.includes('off') ?? false);
    await click('Asks');
    await click('Track again');
    expect(requests.find((request) => request.url === '/api/chat-asks/tracking')?.body).toEqual({ droneId: 'd1', chatName: 'chat-1', enabled: true });
  });
});

test('status labels read naturally per kind, and asks group by run in order', () => {
  expect(askStatusLabel({ kind: 'question', status: 'done', inProgress: false })).toBe('Answered');
  expect(askStatusLabel({ kind: 'request', status: 'partial', inProgress: false })).toBe('Partly done');
  expect(askStatusLabel({ kind: 'rule', status: 'open', inProgress: true })).toBe('Active');
  expect(askStatusLabel({ kind: 'request', status: 'open', inProgress: true })).toBe('In progress');
  const groups = groupAsksByRun([
    ask({ id: 'b', runId: 'r2', at: '2026-10-05T11:00:00.000Z' }),
    ask({ id: 'a', runId: 'r1' }),
    ask({ id: 'c', runId: 'r2', at: '2026-10-05T11:00:01.000Z' }),
  ]);
  expect(groups.map((group) => [group.runId, group.asks.map((item) => item.id)])).toEqual([['r1', ['a']], ['r2', ['b', 'c']]]);
});
