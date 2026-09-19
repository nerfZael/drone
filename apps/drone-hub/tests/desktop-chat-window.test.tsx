import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { detachChatMenuItems } from '../src/droneHub/app/DetachedChatIndicator';
import { detachedChatKey, useDetachedChatStore } from '../src/droneHub/app/detached-chat-store';
import { useDesktopChatRequests } from '../src/droneHub/app/desktop-chat-requests';
import { DesktopChatWindow } from '../src/droneHub/app/DesktopChatWindow';
import { ASSISTANT_OPEN_DRONE_CHAT_EVENT } from '../src/droneHub/assistant/open-drone-chat-event';

function DesktopViews() {
  const windows = useDesktopChatRequests(state => state.windows);
  return <>{Object.entries(windows).map(([key, chat]) => <DesktopChatWindow key={key} chatKey={key}
    title="Test chat" request={chat.request} onClose={() => useDesktopChatRequests.getState().close(key)}>
    <textarea defaultValue="desktop draft" />
  </DesktopChatWindow>)}</>;
}

test('desktop menu opens an additional view without moving the Hub chat or navigating; reopening focuses it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const child = new Window({ url: 'about:blank' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const pins: unknown[] = [];
  let opens = 0;
  let focuses = 0;
  let navigations = 0;
  Object.assign(child, { focus: () => { focuses++; } });
  Object.assign(dom, {
    open: () => { opens++; return child; },
    droneHubDesktop: { setChatWindowAlwaysOnTop: async (...args: unknown[]) => { pins.push(args); return args[1]; } },
  });
  dom.addEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, () => { navigations++; });
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, MutationObserver: dom.MutationObserver, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.document.documentElement.dataset.theme = 'catppuccin-mocha';
  const element = dom.document.createElement('div');
  dom.document.body.appendChild(element);
  const root = createRoot(element as unknown as HTMLElement);
  const chatKey = detachedChatKey('drone', 'chat');
  const hubState = useDetachedChatStore.getState().chats;
  try {
    await act(async () => { root.render(<><textarea defaultValue="Hub draft" /><DesktopViews /></>); });
    const hubDraft = element.querySelector('textarea')!;
    const menu = detachChatMenuItems('drone', 'chat');
    expect(menu.map(item => item.id)).toEqual(['detach-chat', 'open-desktop-chat']);
    await act(async () => { menu[1].onSelect(); });
    const desktopDraft = child.document.querySelector('textarea')!;
    expect(desktopDraft).not.toBe(hubDraft);
    expect(desktopDraft.value).toBe('desktop draft');
    expect(element.querySelector('textarea')).toBe(hubDraft);
    expect(hubDraft.value).toBe('Hub draft');
    expect(useDetachedChatStore.getState().chats).toBe(hubState);
    expect(navigations).toBe(0);
    expect(child.document.documentElement.dataset.theme).toBe('catppuccin-mocha');
    await act(async () => { menu[1].onSelect(); });
    expect(opens).toBe(1);
    expect(focuses).toBe(2);
    // No header of its own: the OS title bar names and closes the window.
    expect(child.document.body.textContent).not.toContain('Test chat');
    expect(child.document.querySelectorAll('button').length).toBe(0);
    expect(child.document.querySelector('.dh-floating-chat')).not.toBeNull();
    const rightClick = async (target: { dispatchEvent(event: unknown): boolean }) => act(async () => {
      target.dispatchEvent(new child.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });
    // Right-clicking a field keeps the native menu (paste, spelling).
    await rightClick(desktopDraft);
    expect(child.document.querySelector('[role="menu"]')).toBeNull();
    await rightClick(child.document.querySelector('.dh-floating-chat')!);
    const pinItem = child.document.querySelector('[role="menuitemcheckbox"]') as unknown as HTMLButtonElement;
    expect(pinItem.textContent).toBe('Always on top');
    expect(pinItem.getAttribute('aria-checked')).toBe('false');
    expect(dom.document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => { pinItem.click(); });
    expect(pins).toEqual([[`drone-hub-chat:${chatKey}`, true]]);
    expect(child.document.querySelector('[role="menu"]')).toBeNull();
    await rightClick(child.document.querySelector('.dh-floating-chat')!);
    expect(child.document.querySelector('[role="menuitemcheckbox"]')!.getAttribute('aria-checked')).toBe('true');
    await act(async () => { child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(child.document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => { child.dispatchEvent(new child.Event('beforeunload')); });
    expect(useDesktopChatRequests.getState().windows).toEqual({});
    expect(element.querySelector('textarea')).toBe(hubDraft);
    expect(hubDraft.value).toBe('Hub draft');
    expect(useDetachedChatStore.getState().chats).toBe(hubState);
    expect(navigations).toBe(0);
  } finally {
    await act(async () => root.unmount());
    useDesktopChatRequests.setState({ windows: {} });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.abort();
    await child.happyDOM.abort();
  }
});
