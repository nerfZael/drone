import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { AiGatewayKeySettings } from '../src/droneHub/app/AiGatewayKeySettings';

test('saves and clears the Hub key without retaining the submitted secret in the form', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const requests: Array<{ url: string; method: string; body: any }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ ok: true, hasKey: method === 'POST', source: method === 'POST' ? 'settings' : null, keyHint: null, updatedAt: null });
  };
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, CustomEvent: dom.CustomEvent, fetch, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const element = dom.document.createElement('div');
  const root = createRoot(element as unknown as HTMLElement);
  const flush = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><AiGatewayKeySettings /></QueryClientProvider>); await flush(); });
    const input = element.querySelector('input')!;
    // React's input event handler accepts pasted credentials.
    const propsKey = Object.keys(input).find(key => key.startsWith('__reactProps'))!;
    await act(async () => { (input as any)[propsKey].onChange({ target: { value: 'test-ai-gateway-secret' } }); });
    await act(async () => { Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Save')!.click(); await flush(); });
    expect(requests).toContainEqual({ url: '/api/settings/ai-gateway', method: 'POST', body: { apiKey: 'test-ai-gateway-secret' } });
    expect(input.value).toBe('');
    expect(element.textContent).toContain('Saved AI Gateway API key.');
    await act(async () => { Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Clear')!.click(); await flush(); });
    expect(requests.some(request => request.url === '/api/settings/ai-gateway' && request.method === 'DELETE')).toBe(true);
    expect(element.textContent).toContain('Cleared stored AI Gateway API key.');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
