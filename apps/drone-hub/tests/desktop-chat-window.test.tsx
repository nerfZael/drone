import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { detachChatMenuItems } from '../src/droneHub/app/DetachedChatIndicator';
import { detachedChatKey, useDetachedChatStore } from '../src/droneHub/app/detached-chat-store';
import { useDesktopChatRequests } from '../src/droneHub/app/desktop-chat-requests';
import { DesktopChatWindow } from '../src/droneHub/app/DesktopChatWindow';
import { ASSISTANT_OPEN_DRONE_CHAT_EVENT } from '../src/droneHub/assistant/open-drone-chat-event';
import { ChatContextActionsContext, type ChatContextTarget } from '../src/droneHub/app/ChatContextActions';
import { OPEN_SIDE_CHAT_EVENT } from '../src/droneHub/app/side-chat-events';
import { useDroneHubUiStore } from '../src/droneHub/app/use-drone-hub-ui-store';

function DesktopViews() {
  const windows = useDesktopChatRequests(state => state.windows);
  return <>{Object.entries(windows).map(([key, chat]) => <DesktopChatWindow key={key} chatKey={key} chatTarget={chat}
    title="Test chat" request={chat.request} onClose={() => useDesktopChatRequests.getState().close(key)}>
    <textarea defaultValue="desktop draft" />
  </DesktopChatWindow>)}</>;
}

test('desktop menu opens an additional view without moving the Hub chat or navigating; reopening focuses it', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const child = new Window({ url: 'about:blank' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const pins: unknown[] = [];
  const created: ChatContextTarget[] = [];
  const cloned: ChatContextTarget[] = [];
  const forks: unknown[] = [];
  dom.addEventListener(OPEN_SIDE_CHAT_EVENT, (event) => {
    event.preventDefault();
    forks.push((event as unknown as CustomEvent).detail);
  });
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
  const originalBindings = useDroneHubUiStore.getState().shortcutBindings;
  useDroneHubUiStore.setState({ shortcutBindings: { ...originalBindings,
    cloneDroneChat: { key: 'k', mod: true, ctrl: false, meta: false, alt: false, shift: true },
  } });
  try {
    await act(async () => { root.render(<ChatContextActionsContext.Provider value={{
      createChat: (target) => { created.push(target); },
      cloneChat: (target) => { cloned.push(target); },
    }}><textarea defaultValue="Hub draft" /><DesktopViews /></ChatContextActionsContext.Provider>); });
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
    // Desktop shortcuts use their own document and the same explicit target
    // as the menu, even when keyboard focus is on the window body.
    await act(async () => { child.document.body.dispatchEvent(new child.KeyboardEvent('keydown', {
      key: 'K', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    })); });
    expect(cloned).toEqual([expect.objectContaining({ droneId: 'drone', chatName: 'chat' })]);
    cloned.length = 0;
    await act(async () => { desktopDraft.dispatchEvent(new child.KeyboardEvent('keydown', {
      key: 'K', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    })); });
    expect(cloned).toHaveLength(0);
    const desktopHost = child.document.querySelector('[data-desktop-chat-focused]')!;
    await act(async () => { child.dispatchEvent(new child.Event('blur')); });
    expect(desktopHost.getAttribute('data-desktop-chat-focused')).toBe('false');
    desktopDraft.value = 'preserved desktop draft';
    await act(async () => { child.dispatchEvent(new child.Event('focus')); });
    expect(desktopHost.getAttribute('data-desktop-chat-focused')).toBe('true');
    expect(child.document.querySelector('textarea')).toBe(desktopDraft);
    expect(desktopDraft.value).toBe('preserved desktop draft');
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
    const findAction = (label: string) => [...child.document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.startsWith(label))!;
    expect(findAction('Fork into side chat').disabled).toBe(true);
    expect(findAction('Clone chat').textContent).toContain('Ctrl/Cmd+Shift+K');
    await act(async () => { findAction('Clone chat').click(); });
    expect(cloned).toEqual([expect.objectContaining({ droneId: 'drone', chatName: 'chat' })]);
    expect(child.document.querySelector('[role="menu"]')).toBeNull();
    await rightClick(child.document.querySelector('.dh-floating-chat')!);
    await act(async () => { findAction('New chat').click(); });
    expect(created).toEqual([expect.objectContaining({ droneId: 'drone', chatName: 'chat' })]);
    const checkpoint = child.document.createElement('div');
    checkpoint.dataset.sideChatCheckpointId = 'desktop-answer';
    child.document.querySelector('.dh-floating-chat')!.appendChild(checkpoint);
    await rightClick(checkpoint);
    expect(findAction('Fork into side chat').disabled).toBe(false);
    await act(async () => { findAction('Fork into side chat').click(); });
    expect(forks).toEqual([{ droneId: 'drone', target: { sourceChatName: 'chat', checkpointId: 'desktop-answer' } }]);
    checkpoint.remove();
    await rightClick(child.document.querySelector('.dh-floating-chat')!);
    await act(async () => { (child.document.querySelector('[role="menuitemcheckbox"]') as unknown as HTMLButtonElement).click(); });
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
    useDroneHubUiStore.setState({ shortcutBindings: originalBindings });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.abort();
    await child.happyDOM.abort();
  }
});
