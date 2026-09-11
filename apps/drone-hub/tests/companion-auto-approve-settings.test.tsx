import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useCompanionAutoApprove } from '../src/droneHub/companion/use-companion-auto-approve';

test('the auto-approve toggle loads persisted state, rolls back failed saves, and survives remounting', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const original = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  let saved = false;
  let failSave = false;
  let failLoad = false;
  const writes: unknown[] = [];
  set('window', dom);
  set('document', dom.document);
  set('IS_REACT_ACT_ENVIRONMENT', true);
  set('fetch', async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/settings/companion/auto-approve');
    if (init?.method === 'PUT') {
      if (failSave) return new Response('', { status: 500 });
      const body = JSON.parse(String(init.body));
      writes.push(body);
      saved = body.enabled;
    }
    if (failLoad && init?.method !== 'PUT') return new Response('', { status: 503 });
    return Response.json({ ok: true, enabled: saved });
  });
  const element = dom.document.createElement('div');
  dom.document.body.append(element);
  let root = createRoot(element as unknown as HTMLElement);
  let live!: ReturnType<typeof useCompanionAutoApprove>;
  function Harness() { live = useCompanionAutoApprove(); return <span>{String(live.enabled)}</span>; }
  try {
    await act(async () => { root.render(<Harness />); });
    expect(live.loading).toBe(false);
    expect(live.enabled).toBe(false);
    await act(async () => { await live.toggle(); });
    expect(live.enabled).toBe(true);
    expect(writes).toEqual([{ enabled: true }]);
    failSave = true;
    await act(async () => { await live.toggle(); });
    expect(live.enabled).toBe(true);
    expect(live.error).toContain('save');
    await act(async () => { root.unmount(); });
    root = createRoot(element as unknown as HTMLElement);
    await act(async () => { root.render(<Harness />); });
    expect(live.enabled).toBe(true);
    failSave = false;
    await act(async () => { await live.toggle(); });
    expect(live.enabled).toBe(false);
    expect(saved).toBe(false);
    await act(async () => { root.unmount(); });
    failLoad = true;
    root = createRoot(element as unknown as HTMLElement);
    await act(async () => { root.render(<Harness />); });
    expect(live.error).toContain('load');
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
