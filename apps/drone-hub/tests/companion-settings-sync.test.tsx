import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useCompanionSettings, type CompanionSettingsResponse } from '../src/droneHub/companion/use-companion-settings';

test('mounted settings consumers sync saves in both directions and preserve unrelated draft edits', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  let response: CompanionSettingsResponse = {
    ok: true,
    settings: { schemaVersion: 9, promptDeliveryMode: 'asap', provider: 'codex', model: 'first',
      thinkingLevel: 'medium', systemPrompt: 'Original', enabledTools: [] },
    defaultSystemPrompt: 'Original', maxSystemPromptChars: 1000, tools: [], models: [],
    credentials: { codex: true, openai: true, gemini: false, openrouter: false },
  };
  let failSave = false;
  let pendingRead: ((value: CompanionSettingsResponse) => void) | undefined;
  let delayRead = false;
  const request = async <T,>(_url: string, init?: RequestInit): Promise<T> => {
    if (init?.method === 'PUT') {
      if (failSave) throw new Error('Save failed');
      response = { ...response, settings: JSON.parse(String(init.body)) };
    } else if (delayRead) {
      return await new Promise<CompanionSettingsResponse>((resolve) => { pendingRead = resolve; }) as T;
    }
    return structuredClone(response) as T;
  };
  const element = dom.document.createElement('div');
  const root = createRoot(element as unknown as HTMLElement);
  const consumers: Array<ReturnType<typeof useCompanionSettings>> = [];
  function Consumer({ index }: { index: number }) { consumers[index] = useCompanionSettings(request); return null; }
  try {
    await act(async () => { root.render(<><Consumer index={0} /><Consumer index={1} /></>); });
    await act(async () => { consumers[0].setDraft((draft) => ({ ...draft!, model: 'second' })); });
    await act(async () => { await consumers[0].save(); });
    expect(consumers[1].data?.settings.model).toBe('second');
    expect(consumers[1].draft?.model).toBe('second');
    expect(consumers[1].dirty).toBe(false);

    await act(async () => { consumers[0].setDraft((draft) => ({ ...draft!, systemPrompt: 'Unsaved prompt' })); });
    // The composer saves directly, then publishes the server response through acceptSaved.
    response = { ...response, settings: { ...response.settings, provider: 'openai', model: 'third', thinkingLevel: 'high' } };
    await act(async () => { consumers[1].acceptSaved(response); });
    expect(consumers[0].draft).toMatchObject({ provider: 'openai', model: 'third', thinkingLevel: 'high', systemPrompt: 'Unsaved prompt' });
    expect(consumers[0].dirty).toBe(true);
    await act(async () => { await consumers[0].save(); });
    expect(consumers[1].draft?.systemPrompt).toBe('Unsaved prompt');
    expect(response.settings.model).toBe('third');

    await act(async () => { consumers[0].setDraft((draft) => ({ ...draft!, model: 'failed' })); });
    failSave = true;
    await act(async () => { expect(await consumers[0].save()).toBe(false); });
    expect(consumers[1].data?.settings.model).toBe('third');
    expect(consumers[0].draft?.model).toBe('failed');

    const stale = structuredClone(response);
    delayRead = true;
    let loading!: Promise<void>;
    await act(async () => { loading = consumers[1].load(); });
    response = { ...response, settings: { ...response.settings, model: 'latest' } };
    await act(async () => { consumers[0].acceptSaved(response); });
    await act(async () => { pendingRead!(stale); await loading; });
    expect(consumers[1].data?.settings.model).toBe('latest');
    expect(consumers[1].loading).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
