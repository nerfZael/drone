import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { CompanionSettingsTab } from '../src/droneHub/companion/CompanionSettingsTab';
import { useCompanionSettings, type CompanionSettingsResponse } from '../src/droneHub/companion/use-companion-settings';

test('follow-up delivery uses the normal Save flow, preserves failed edits, and reloads the saved choice', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  let response: CompanionSettingsResponse = {
    ok: true,
    settings: { schemaVersion: 9, promptDeliveryMode: 'asap', provider: 'codex', model: 'chosen',
      thinkingLevel: 'medium', systemPrompt: 'Test', enabledTools: [] },
    defaultSystemPrompt: 'Test', maxSystemPromptChars: 1000, tools: [],
    models: [{ provider: 'codex', id: 'chosen', name: 'Chosen', thinkingLevel: 'medium' }],
    credentials: { codex: true, openai: false, gemini: false, openrouter: false },
  };
  let failSave = false;
  let writes = 0;
  const request = async <T,>(_url: string, init?: RequestInit): Promise<T> => {
    if (init?.method === 'PUT') {
      if (failSave) throw new Error('Could not save settings');
      writes++;
      response = { ...response, settings: JSON.parse(String(init.body)) };
    }
    return structuredClone(response) as T;
  };
  const element = dom.document.createElement('div');
  dom.document.body.append(element);
  let root = createRoot(element as unknown as HTMLElement);
  let settings!: ReturnType<typeof useCompanionSettings>;
  function Harness() { settings = useCompanionSettings(request); return <CompanionSettingsTab settings={settings} />; }
  const choices = () => element.querySelectorAll('[aria-label="Companion follow-up delivery"] button');
  try {
    await act(async () => { root.render(<Harness />); });
    expect(choices()[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => { (choices()[1] as any).click(); });
    expect(settings.dirty).toBe(true);
    expect(writes).toBe(0);
    failSave = true;
    await act(async () => { await settings.save(); });
    expect(settings.error).toContain('Could not save');
    expect(settings.draft?.promptDeliveryMode).toBe('queue');
    expect(response.settings.promptDeliveryMode).toBe('asap');
    failSave = false;
    await act(async () => { await settings.save(); });
    expect(response.settings).toMatchObject({ promptDeliveryMode: 'queue', provider: 'codex', model: 'chosen' });
    await act(async () => { root.unmount(); });
    root = createRoot(element as unknown as HTMLElement);
    await act(async () => { root.render(<Harness />); });
    expect(choices()[1].getAttribute('aria-checked')).toBe('true');
    expect(element.textContent).toContain('current run keeps its setting');
  } finally {
    await act(async () => { root.unmount(); });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
