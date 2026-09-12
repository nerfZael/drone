import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, spyOn, test } from 'bun:test';
import * as http from '../src/droneHub/http';
import { useGlobalShortcutClient } from '../src/droneHub/app/use-global-shortcut-client';
import { activeGlobalShortcutBindings } from '../src/droneHub/app/global-shortcut-state';

test('canvas focus keeps global companion recording enabled; binding capture suspends it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document,
    Element: dom.Element, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  let source!: FakeEventSource;
  class FakeEventSource extends dom.EventTarget {
    constructor(_url: string) { super(); source = this; }
    close() {}
    send(type: string, data: unknown) {
      this.dispatchEvent(new dom.MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
  Object.defineProperty(dom, 'EventSource', { configurable: true, value: FakeEventSource });
  let focused = true;
  const focusSpy = spyOn(dom.document, 'hasFocus').mockImplementation(() => focused);
  const activities: Array<{ capturing: boolean; focused: boolean }> = [];
  const binding = { key: '`', mod: false, ctrl: false, meta: false, alt: false, shift: false };
  const requestSpy = spyOn(http, 'requestJson').mockImplementation(async (url, init) => {
    if (url.endsWith('/activity')) {
      activities.push(JSON.parse(String(init?.body)));
      return { ok: true, connected: true } as any;
    }
    return { ok: true, bindings: { toggleCompanion: binding }, status: {
      running: true, error: '', warning: '', actions: { toggleCompanion: { active: true, error: '' } },
    } } as any;
  });
  const actions: string[] = [];
  function Harness() {
    useGlobalShortcutClient().current = (actionId) => { actions.push(actionId); };
    return <>
      <div tabIndex={0} data-shortcut-capture="true" data-drone-canvas-viewport="1">
        <textarea />
      </div>
      <button data-shortcut-capture="true" data-shortcut-binding-capture="true">Record binding</button>
    </>;
  }
  const element = dom.document.createElement('div');
  dom.document.body.append(element);
  const root = createRoot(element as unknown as HTMLElement);
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { source.send('connected', {}); });
    expect(activeGlobalShortcutBindings()).toEqual({ toggleCompanion: binding });
    const canvas = element.querySelector('div')!;
    const editor = element.querySelector('textarea')!;
    const capture = element.querySelector('button')!;
    for (const target of [canvas, editor]) {
      await act(async () => { target.focus(); });
      expect(activities.at(-1)?.capturing).toBe(false);
      source.send('shortcut', { actionId: 'toggleCompanion' });
    }
    expect(actions).toEqual(['toggleCompanion', 'toggleCompanion']);
    await act(async () => { capture.focus(); });
    expect(activities.at(-1)?.capturing).toBe(true);
    source.send('shortcut', { actionId: 'toggleCompanion' });
    expect(actions).toHaveLength(2);
    // A background window must still accept the global recording action.
    await act(async () => { focused = false; dom.dispatchEvent(new dom.Event('blur')); });
    source.send('shortcut', { actionId: 'toggleCompanion' });
    expect(actions).toHaveLength(3);
    await act(async () => { focused = true; canvas.focus(); });
    expect(activities.at(-1)).toMatchObject({ focused: true, capturing: false });
    source.send('shortcut', { actionId: 'toggleCompanion' });
    expect(actions).toHaveLength(4);
  } finally {
    await act(async () => { root.unmount(); });
    requestSpy.mockRestore();
    focusSpy.mockRestore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.abort();
  }
});
