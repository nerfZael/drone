import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useCompanionLive } from '../src/droneHub/companion/use-companion-live';

test('the Live toggle loads persisted state, rolls back failed saves, and survives remounting', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const original = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  let saved = false;
  let prompt = 'Speak calmly.';
  let mode = 'live';
  let interval = 250;
  let jevPrompt = 'Send clear requests.';
  let failSave = false;
  let failLoad = false;
  const writes: unknown[] = [];
  set('window', dom);
  set('document', dom.document);
  set('IS_REACT_ACT_ENVIRONMENT', true);
  set('fetch', async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/settings/companion/live-voice');
    expect(new Headers(init?.headers).get('x-drone-client-request-id')).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    if (init?.method === 'PUT') {
      if (failSave) return new Response('', { status: 500 });
      const body = JSON.parse(String(init.body));
      writes.push(body);
      if (typeof body.enabled === 'boolean') saved = body.enabled;
      if (typeof body.systemPrompt === 'string') prompt = body.systemPrompt;
      if (typeof body.mode === 'string') mode = body.mode;
      if (typeof body.jevDecisionIntervalMs === 'number') interval = body.jevDecisionIntervalMs;
      if (typeof body.jevSystemPrompt === 'string') jevPrompt = body.jevSystemPrompt;
    }
    if (failLoad && init?.method !== 'PUT') return new Response('', { status: 503 });
    return Response.json({ ok: true, enabled: saved, mode, jevDecisionIntervalMs: interval, jevSystemPrompt: jevPrompt, defaultJevSystemPrompt: 'Send clear requests.', systemPrompt: prompt, defaultSystemPrompt: 'Speak calmly.', maxSystemPromptChars: 8000 });
  });
  const element = dom.document.createElement('div');
  dom.document.body.append(element);
  let root = createRoot(element as unknown as HTMLElement);
  let live!: ReturnType<typeof useCompanionLive>;
  function Harness() { live = useCompanionLive(); return <span>{String(live.enabled)}</span>; }
  try {
    await act(async () => { root.render(<Harness />); });
    expect(live.loading).toBe(false);
    expect(live.enabled).toBe(false);
    await act(async () => { await live.toggleEnabled(); });
    expect(live.enabled).toBe(true);
    expect(writes).toEqual([{ enabled: true }]);
    await act(async () => { expect(await live.saveSystemPrompt('Speak brightly.')).toBe(true); });
    expect(live.systemPrompt).toBe('Speak brightly.');
    expect(writes.at(-1)).toEqual({ systemPrompt: 'Speak brightly.' });
    failSave = true;
    await act(async () => { await live.toggleEnabled(); });
    expect(live.enabled).toBe(true);
    expect(live.settingsError).toContain('save');
    await act(async () => { root.unmount(); });
    root = createRoot(element as unknown as HTMLElement);
    await act(async () => { root.render(<Harness />); });
    expect(live.enabled).toBe(true);
    expect(live.status).toBe('idle'); // Remembering the setting never opens the microphone.
    failSave = false;
    await act(async () => { await live.toggleEnabled(); });
    expect(live.enabled).toBe(false);
    expect(saved).toBe(false);
    await act(async () => { root.unmount(); });
    failLoad = true;
    root = createRoot(element as unknown as HTMLElement);
    await act(async () => { root.render(<Harness />); });
    expect(live.resolved).toBe(false);
    expect(live.settingsError).toContain('load');
    failLoad = false;
    await act(async () => { await live.load(); });
    expect(live.resolved).toBe(true);
    expect(live.settingsError).toBe('');
    await act(async () => { await live.saveVoiceMode('jev'); });
    expect(live.mode).toBe('jev');
    await act(async () => { expect(await live.saveJevDecisionInterval(500)).toBe(true); });
    expect(live.jevDecisionIntervalMs).toBe(500);
    expect(writes.at(-1)).toEqual({ jevDecisionIntervalMs: 500 });
    expect(live.enabled).toBe(true);
    expect(live.status).toBe('idle');
    await act(async () => { await live.saveJevSystemPrompt('Delegate only when I ask directly.'); });
    expect(live.jevSystemPrompt).toBe('Delegate only when I ask directly.');
    expect(live.systemPrompt).toBe('Speak brightly.');
    await act(async () => { await live.saveVoiceMode('normal'); });
    expect(live.enabled).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
