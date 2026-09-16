import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { useDesktopNotifications } from '../src/droneHub/app/use-desktop-notifications';
import { useDesktopNotificationSettings } from '../src/droneHub/app/desktop-notification-settings';
import { ASSISTANT_OPEN_DRONE_CHAT_EVENT } from '../src/droneHub/assistant/open-drone-chat-event';

function Consumer() { useDesktopNotifications(); return null; }

test('live delivery respects changes to preferences, deduplicates, navigates, and cleans up', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const listeners = new Map<string, Function>();
  const sent: any[] = [];
  let clicked: ((target: any) => void) | null = null;
  let errorListener: ((error: string) => void) | null = null;
  let closed = false;
  class Source {
    constructor(url: string) { expect(url).toBe('/api/desktop/events?notifications=1'); }
    addEventListener(name: string, listener: Function) { listeners.set(name, listener); }
    close() { closed = true; }
  }
  Object.assign(dom, { EventSource: Source, droneHubDesktop: {
    showNotification: async (payload: any) => { sent.push(payload); },
    onNotificationClick: (fn: any) => { clicked = fn; return () => { clicked = null; }; },
    onNotificationError: (fn: any) => { errorListener = fn; return () => { errorListener = null; }; },
  } });
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const previous = useDesktopNotificationSettings.getState();
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement);
  try {
    useDesktopNotificationSettings.setState({ enabled: true, finished: true });
    await act(async () => { root.render(<Consumer />); });
    const event = { id: 'one', kind: 'finished', droneId: 'drone', droneName: 'Worker', chatName: 'review' };
    const emit = (data: any) => listeners.get('desktop_notification')!({ data: JSON.stringify(data) });
    emit(event); emit(event);
    expect(sent).toHaveLength(1);
    useDesktopNotificationSettings.setState({ finished: false });
    emit({ ...event, id: 'two' });
    expect(sent).toHaveLength(1);
    let opened: any;
    dom.addEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, (e: any) => { opened = e.detail; });
    clicked!(sent[0].target);
    expect(opened).toMatchObject({ droneId: 'drone', chatName: 'review' });
    errorListener!('OS rejected notification');
    expect(useDesktopNotificationSettings.getState().error).toBe('OS rejected notification');
  } finally {
    await act(async () => { root.unmount(); });
    useDesktopNotificationSettings.setState(previous);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
  expect(closed).toBe(true);
  expect(clicked).toBeNull();
  expect(errorListener).toBeNull();
});
