import { ActiveComposerProvider, useActiveComposer } from '../src/droneHub/chat/ActiveComposerContext';
import { Simulate } from 'react-dom/test-utils';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { DroneChatsDock } from '../src/droneHub/app/DroneChatsDock';
import { allDroneChatNames, latestChatPreview } from '../src/droneHub/app/drone-chats-model';
import type { DroneSummary } from '../src/droneHub/types';
import { useDroneHubRuntimeStore } from '../src/droneHub/app/use-drone-hub-runtime-store';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';
import { useChatsViewStore } from '../src/droneHub/app/chats-view-store';
import { useChatClipboardStore } from '../src/droneHub/app/chat-clipboard-store';

const drone = { id: 'drone-1', chats: ['default', 'nested-chat'], workflowChats: ['workflow'],
  sideChats: [{ name: 'side' }], statusOk: true, busyChats: ['default'],
  approvalChats: ['nested-chat'], unreadChats: ['workflow'], draftChats: { side: true } } as DroneSummary;

test('the inventory includes grouped, workflow, and optimistic side chats without duplicates', () => {
  expect(allDroneChatNames(drone, ['side', 'new-side'])).toEqual(['default', 'nested-chat', 'workflow', 'side', 'new-side']);
});

test('the Chats window lists chats oldest first, with chats of unknown age last', () => {
  const dated = { ...drone, chatCreatedAt: {
    workflow: '2026-09-01T09:00:00Z', 'nested-chat': '2026-09-01T11:00:00Z', default: '2026-09-01T10:00:00Z',
  } } as DroneSummary;
  expect(allDroneChatNames(dated, ['new-side'])).toEqual(['workflow', 'default', 'nested-chat', 'side', 'new-side']);
});

test('preview chooses the latest speaker, including a pending user message', () => {
  const messages = [{ role: 'assistant' as const, text: 'Done.\nAll tests passed.', at: '2026-09-22T10:00:00Z' }];
  expect(latestChatPreview({ messages, pending: [] })?.text).toBe('Done. All tests passed.');
  expect(latestChatPreview({ messages, pending: [
    { prompt: 'One more thing', at: '2026-09-22T10:01:00Z', state: 'queued' },
  ] })?.role).toBe('user');
  expect(latestChatPreview({ messages, pending: [
    { prompt: 'Old prompt', at: '2026-09-22T09:00:00Z', state: 'sent' },
  ] })?.role).toBe('assistant');
  expect(latestChatPreview({ messages: [], pending: [] })).toBeNull();
});

test('list selection opens the named chat and grid mounts independent interactive chats', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ messages: [{ role: 'user', text: 'Latest request', at: '2026-09-22T10:00:00Z' }], pending: [] }), { headers: { 'content-type': 'application/json' } }),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  const root = createRoot(container as unknown as HTMLElement);
  const previousBusy = useDroneHubRuntimeStore.getState().localBusyChatCountByNodeId;
  let selected = '';
  try {
    const options = {
      sideChatNames: [], onSelectChat: (name: string) => { selected = name; },
      renderChat: (name: string) => <textarea aria-label={`Message ${name}`} />,
    };
    await act(async () => { root.render(<DroneChatsDock drone={drone} selectedChat="default" options={options} />); });
    expect(container.textContent).toContain('Latest request');
    // The speaker shows as a tint, not a label, so the preview keeps its width.
    expect(container.textContent).not.toContain('You');
    const preview = container.querySelector('[data-preview-role="user"]')!;
    expect(preview.className).toContain('text-[var(--user-muted)]');
    expect(preview.closest('[title]')!.getAttribute('title')).toBe('You: Latest request');
    // Rows speak for themselves: no column headings and no in-body view toggle.
    expect(container.textContent).not.toContain('Latest message');
    expect(container.querySelector('[aria-label="Chat view"]')).toBeNull();
    const selectedRow = container.querySelector('[data-chat-name="default"][aria-current="true"]')!;
    expect(selectedRow.className).toContain('bg-[var(--selected)]');
    expect(container.querySelector('[data-chat-name="side"]')!.getAttribute('aria-current')).toBeNull();
    expect(container.querySelector('[aria-label="Working"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Approval required"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Unread"]')).not.toBeNull();
    expect(container.textContent).toContain('Draft');
    await act(async () => { useDroneHubRuntimeStore.getState().setLocalBusyChatCountByNodeId({
      ...previousBusy, [createCanvasChatNodeId(drone.id, 'side')]: 1,
    }); });
    expect(container.querySelectorAll('[aria-label="Working"]').length).toBe(2);
    const buttons = () => Array.from(container.querySelectorAll('button'));
    await act(async () => { buttons().find((button) => button.textContent?.includes('nested-chat'))!.click(); });
    expect(selected).toBe('nested-chat');
    await act(async () => { useChatsViewStore.getState().setView('grid'); });
    expect(container.querySelectorAll('textarea').length).toBe(4);
    const grid = container.querySelector('[aria-label="Chat grid"]')!;
    expect(grid.getAttribute('style')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(grid.getAttribute('style')).toContain('grid-template-rows: repeat(2, minmax(0, 1fr))');
    expect(grid.className).toContain('overflow-hidden');
    expect(container.querySelectorAll('[aria-label="Working"]').length).toBe(2);
    const nested = container.querySelector('textarea[aria-label="Message nested-chat"]')!;
    (nested as unknown as HTMLTextAreaElement).value = 'Independent draft';
    expect((container.querySelector('textarea[aria-label="Message default"]') as unknown as HTMLTextAreaElement).value).toBe('');
    await act(async () => { buttons().find((button) => button.title === 'Open side as main chat')!.click(); });
    expect(selected).toBe('side');
  } finally {
    await act(async () => root.unmount());
    useChatsViewStore.getState().setView('list');
    useDroneHubRuntimeStore.getState().setLocalBusyChatCountByNodeId(previousBusy);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});

test('chat rows toggle and range-select, and right-click deletes exactly the targeted selection', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ messages: [], pending: [] })),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const opened: string[] = [];
  const deleted: string[][] = [];
  const options = { sideChatNames: [], onSelectChat: (name: string) => opened.push(name), renderChat: () => null };
  const row = (name: string) => container.querySelector(`button[data-chat-name="${name}"]`)!;
  const selected = () => Array.from(container.querySelectorAll('button[aria-pressed="true"]')).map((el) => el.getAttribute('data-chat-name'));
  const click = async (name: string, modifiers = {}) => {
    await act(async () => { row(name).dispatchEvent(new dom.MouseEvent('click', { bubbles: true, ...modifiers })); });
  };
  const context = async (name: string) => {
    await act(async () => { row(name).dispatchEvent(new dom.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
  };
  try {
    await act(async () => root.render(<DroneChatsDock drone={drone} selectedChat="default" options={options}
      onDeleteChats={async (targets) => { deleted.push(targets.map((target) => target.chatName)); return targets.map((target) => ({ ...target, ok: true })); }} />));
    await click('workflow', { ctrlKey: true });
    expect(selected()).toEqual(['default', 'workflow']);
    await click('workflow', { metaKey: true });
    expect(selected()).toEqual(['default']);
    await click('nested-chat');
    await click('side', { shiftKey: true });
    expect(selected()).toEqual(['nested-chat', 'workflow', 'side']);
    expect(opened).toEqual(['nested-chat']);
    // Delete takes the whole selection in one request, not just the focused row.
    const deleteKey = new dom.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    await act(async () => { row('side').dispatchEvent(deleteKey); });
    expect(deleteKey.defaultPrevented).toBe(true);
    expect(deleted.shift()).toEqual(['nested-chat', 'workflow', 'side']);
    await click('nested-chat');
    await click('side', { shiftKey: true });
    await context('workflow');
    expect(selected()).toEqual(['nested-chat', 'workflow', 'side']);
    const menuItem = (label: string) => Array.from(dom.document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes(label))!;
    let item = menuItem('Delete');
    expect(item.textContent).toContain('Delete 3 chats');
    await act(async () => { (item as unknown as HTMLButtonElement).click(); });
    expect(deleted).toEqual([['nested-chat', 'workflow', 'side']]);
    await click('workflow', { ctrlKey: true });
    await context('default');
    expect(selected()).toEqual(['default']);
    item = menuItem('Delete');
    expect(item.textContent).toContain('Delete chat');
    await act(async () => { (item as unknown as HTMLButtonElement).click(); });
    expect(deleted[1]).toEqual(['default']);
    await act(async () => useChatsViewStore.getState().setView('grid'));
    const header = (name: string) => container.querySelector(`section[data-chat-name="${name}"] > button`)!;
    await act(async () => { header('nested-chat').dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { header('side').dispatchEvent(new dom.MouseEvent('click', { bubbles: true, shiftKey: true })); });
    expect(container.querySelectorAll('button[aria-pressed="true"]').length).toBe(3);
  } finally {
    await act(async () => root.unmount());
    useChatsViewStore.getState().setView('list');
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});

test('Chats window copies and pastes chats from the menu and with Ctrl+C / Ctrl+V', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ messages: [], pending: [] })),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const clones: string[] = [];
  const options = { sideChatNames: [], onSelectChat() {}, renderChat: () => null };
  const row = (name: string) => container.querySelector(`button[data-chat-name="${name}"]`)!;
  const menuItem = (label: string) => Array.from(dom.document.querySelectorAll('[role="menuitem"]'))
    .find((el) => el.textContent?.includes(label)) as unknown as HTMLButtonElement;
  const context = async (name: string) => {
    await act(async () => { row(name).dispatchEvent(new dom.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
  };
  const press = async (name: string, key: string) => {
    await act(async () => { row(name).dispatchEvent(new dom.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })); });
  };
  useChatClipboardStore.getState().copy({ chats: [] });
  try {
    await act(async () => root.render(<DroneChatsDock drone={drone} selectedChat="default" options={options}
      onCloneChat={async (droneId, chatName) => { clones.push(`${droneId}/${chatName}`); return { ok: true, chatName: `${chatName} - Copy` }; }} />));
    await context('default');
    expect(menuItem('Paste').disabled).toBe(true);
    await act(async () => menuItem('Copy chat').click());
    await context('workflow');
    expect(menuItem('Paste').disabled).toBe(false);
    await act(async () => menuItem('Paste').click());
    expect(clones).toEqual(['drone-1/default']);

    // Ctrl+C copies the whole selection; Ctrl+V clones every copied chat.
    await act(async () => { row('workflow').dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { row('nested-chat').dispatchEvent(new dom.MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    await press('nested-chat', 'c');
    expect(useChatClipboardStore.getState().chats.map((chat) => chat.chatName)).toEqual(['workflow', 'nested-chat']);
    await press('nested-chat', 'v');
    expect(clones.slice(1).sort()).toEqual(['drone-1/nested-chat', 'drone-1/workflow']);

    // Another drone's copy is invisible here; the original drone can still paste it.
    await act(async () => useChatClipboardStore.getState().copy({ chats: [{ droneId: 'drone-2', chatName: 'elsewhere' }] }));
    await context('default');
    expect(menuItem('Paste').disabled).toBe(true);
    await press('default', 'v');
    expect(clones).toHaveLength(3);
    await act(async () => root.render(<DroneChatsDock drone={{ ...drone, id: 'drone-2', chats: ['elsewhere'] } as DroneSummary}
      selectedChat="elsewhere" options={options}
      onCloneChat={async (droneId, chatName) => { clones.push(`${droneId}/${chatName}`); return { ok: true, chatName: `${chatName} - Copy` }; }} />));
    await press('elsewhere', 'v');
    expect(clones.at(-1)).toBe('drone-2/elsewhere');
  } finally {
    await act(async () => root.unmount());
    useChatClipboardStore.getState().copy({ chats: [] });
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});

test('Chats window broadcasts to selected rows with attachments and shortcuts without changing configuration by default', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const sends: Array<{ targets: unknown; payload: any; context: any; overrides: unknown }> = [];
  let wrongMainSends = 0;
  let fail = false;
  let recordings = 0;
  class Recorder extends dom.EventTarget {
    static isTypeSupported() { return true; }
    state = 'inactive';
    mimeType = 'audio/webm';
    start() { this.state = 'recording'; recordings += 1; }
    stop() {
      this.state = 'inactive';
      const event = new dom.Event('dataavailable');
      Object.assign(event, { data: new Blob(['voice']) });
      this.dispatchEvent(event);
      this.dispatchEvent(new dom.Event('stop'));
    }
  }
  Object.defineProperty(dom, 'MediaRecorder', { configurable: true, value: Recorder });
  Object.defineProperty(dom.HTMLElement.prototype, 'offsetParent', { configurable: true, get() {
    return this.closest('[hidden]') ? null : dom.document.body;
  } });
  for (const [name, value] of Object.entries({ window: dom, document: dom.document, Node: dom.Node,
    Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Event: dom.Event, CustomEvent: dom.CustomEvent, FileReader: dom.FileReader, File: dom.File, MediaRecorder: Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    requestAnimationFrame: (run: FrameRequestCallback) => setTimeout(() => run(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/transcriptions') ? { ok: true, text: 'Voice broadcast' }
        : url.includes('/model-catalog') ? { ok: true, models: [{ id: 'chosen-model', label: 'Chosen model' }] }
        : { ok: true, name: 'Drone', chat: decodeURIComponent(url.match(/\/chats\/([^/]+)/)?.[1] ?? 'default'),
          agent: { kind: 'builtin', id: 'codex' }, model: 'existing-model', messages: [], pending: [] }),
        { headers: { 'content-type': 'application/json' } });
    },
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  function OtherChat() {
    const active = useActiveComposer();
    React.useEffect(() => active.registerComposer({ id: 'main', isEligible: () => true, appendTranscript() {},
      sendMessage: () => { wrongMainSends += 1; return true; } }), [active.registerComposer]);
    return null;
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const row = (name: string) => container.querySelector(`button[data-chat-name="${name}"]`)!;
  const input = () => container.querySelector('[data-selected-chats-composer] textarea')!;
  const settle = () => new Promise(resolve => setTimeout(resolve, 15));
  const press = async (target: Element, key: string) => {
    await act(async () => { Simulate.keyDown(target, { key, nativeEvent: new dom.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }) } as never); await settle(); });
    await act(async () => { await settle(); });
  };
  const type = async (value: string) => { await act(async () => Simulate.change(input() as unknown as Element, { target: { value } } as never)); };
  try {
    await act(async () => root.render(<ActiveComposerProvider><OtherChat /><DroneChatsDock drone={drone} selectedChat="default"
      options={{ sideChatNames: [], onSelectChat() {}, renderChat: name => <textarea aria-label={`Individual ${name}`} /> }}
      onSendToChats={async (targets, payload, context, overrides) => {
        sends.push({ targets, payload, context, overrides });
        return { ok: !fail, error: fail ? 'Send failed' : undefined };
      }} /></ActiveComposerProvider>));
    await act(async () => { row('nested-chat').dispatchEvent(new dom.MouseEvent('click', { bubbles: true, ctrlKey: true })); await settle(); });
    expect(container.textContent).toContain('To default, nested-chat');
    // Like the agent chat, the model controls sit in the toolbar of the expanded composer.
    expect(container.textContent).not.toContain('Model: Unchanged');
    await type('Hello both');
    expect(container.textContent).toContain('Model: Unchanged');
    const modelButton = container.querySelector('[data-chat-composer-model-picker] > button')!;
    await press(modelButton as unknown as Element, 'Enter');
    expect(dom.document.activeElement).not.toBe(input());
    await press(modelButton as unknown as Element, 'Tab');
    expect(sends).toHaveLength(0);
    await press(row('nested-chat') as unknown as Element, 's');
    expect(sends[0]).toMatchObject({ targets: [{ droneId: drone.id, chatName: 'default' }, { droneId: drone.id, chatName: 'nested-chat' }],
      payload: { prompt: 'Hello both', attachments: [] }, context: { deliveryMode: 'queue' }, overrides: {} });
    expect(wrongMainSends).toBe(0);
    const file = container.querySelector('input[type="file"]')!;
    Object.defineProperty(file, 'files', { configurable: true, value: [new dom.File(['notes'], 'notes.txt', { type: 'text/plain' })] });
    await act(async () => Simulate.change(file as unknown as Element));
    await act(async () => { row('workflow').dispatchEvent(new dom.MouseEvent('click', { bubbles: true, shiftKey: true })); });
    await press(row('workflow') as unknown as Element, 'Tab');
    expect(sends[1]).toMatchObject({ targets: [{ droneId: drone.id, chatName: 'nested-chat' }, { droneId: drone.id, chatName: 'workflow' }],
      payload: { attachments: [{ name: 'notes.txt', dataBase64: 'bm90ZXM=' }] }, context: { deliveryMode: 'asap' }, overrides: {} });
    fail = true;
    await type('Retain draft');
    await press(input() as unknown as Element, 'Enter');
    expect((input() as unknown as HTMLTextAreaElement).value).toBe('Retain draft');
    fail = false;
    await type('');
    await press(row('workflow') as unknown as Element, 'q');
    expect(recordings).toBe(1);
    await press(row('workflow') as unknown as Element, 's');
    expect(sends.at(-1)).toMatchObject({ payload: { prompt: 'Voice broadcast' }, overrides: {} });
    await act(async () => Simulate.change(container.querySelector('select[aria-label="Reasoning override for selected chats"]') as unknown as Element, { target: { value: 'high' } } as never));
    await type('Explicit reasoning');
    await press(input() as unknown as Element, 'Enter');
    expect(sends.at(-1)?.overrides).toEqual({ reasoning: 'high' });
    expect((container.querySelector('select') as unknown as HTMLSelectElement).value).toBe('__unchanged__');
    await act(async () => useChatsViewStore.getState().setView('grid'));
    await type('Grid broadcast');
    await press(input() as unknown as Element, 'Tab');
    expect(sends.at(-1)).toMatchObject({ payload: { prompt: 'Grid broadcast' }, context: { deliveryMode: 'asap' }, overrides: {} });
    const previousSends = sends.length;
    await press(container.querySelector('textarea[aria-label="Individual default"]') as unknown as Element, 's');
    expect(sends).toHaveLength(previousSends);
    expect(wrongMainSends).toBe(0);
  } finally {
    await act(async () => root.unmount());
    useChatsViewStore.getState().setView('list');
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    await dom.happyDOM.close();
  }
});

test('dragging Chats rows onto the composer references them in the next message', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ messages: [], pending: [] })),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const sends: Array<{ targets: unknown; prompt: string }> = [];
  const row = (name: string) => container.querySelector(`button[data-chat-name="${name}"]`)! as unknown as Element;
  const composer = () => container.querySelector('[data-selected-chats-composer]')! as unknown as Element;
  try {
    await act(async () => root.render(<ActiveComposerProvider><DroneChatsDock drone={drone} selectedChat="default"
      options={{ sideChatNames: [], onSelectChat() {}, renderChat: () => null }}
      onSendToChats={async (targets, payload) => { sends.push({ targets, prompt: payload.prompt }); return { ok: true }; }} /></ActiveComposerProvider>));
    // Select two rows, then drag one of them: the drag carries both.
    await act(async () => { Simulate.click(row('workflow')); });
    await act(async () => { Simulate.click(row('side'), { ctrlKey: true }); });
    const data = new Map<string, string>();
    await act(async () => Simulate.dragStart(row('side'), { dataTransfer: { setData: (type: string, value: string) => data.set(type, value) } } as never));
    const transfer = { types: [...data.keys()], getData: (type: string) => data.get(type) ?? '', files: [] };
    await act(async () => Simulate.dragOver(composer(), { dataTransfer: transfer } as never));
    await act(async () => Simulate.drop(composer(), { dataTransfer: transfer } as never));
    expect(composer().querySelectorAll('[data-reference-tile="chat"]').length).toBe(2);
    const input = container.querySelector('[data-selected-chats-composer] textarea')!;
    await act(async () => Simulate.change(input as unknown as Element, { target: { value: 'Summarize these' } } as never));
    await act(async () => { Simulate.keyDown(input as unknown as Element, { key: 'Enter', nativeEvent: new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) } as never); });
    expect(sends.at(-1)?.prompt).toBe(['Summarize these', '', 'Referenced drones and chats:',
      '- Chat "workflow" in drone "drone-1" (drone id: drone-1)',
      '- Chat "side" in drone "drone-1" (drone id: drone-1)'].join('\n'));
    expect(composer().querySelectorAll('[data-reference-tile]').length).toBe(0);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});

test('pasted text becomes a text attachment that can be inserted below the typed text', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ messages: [], pending: [] })),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const input = () => container.querySelector('[data-selected-chats-composer] textarea')! as unknown as HTMLTextAreaElement;
  const paste = async (text: string) => {
    let prevented = false;
    const clipboardData = { files: [], items: [], types: ['text/plain'], getData: (type: string) => type === 'text/plain' ? text : '' };
    await act(async () => Simulate.paste(input() as unknown as Element, { clipboardData, preventDefault: () => { prevented = true; } } as never));
    return prevented;
  };
  try {
    await act(async () => root.render(<ActiveComposerProvider><DroneChatsDock drone={drone} selectedChat="default"
      options={{ sideChatNames: [], onSelectChat() {}, renderChat: () => null }}
      onSendToChats={async () => ({ ok: true })} /></ActiveComposerProvider>));
    await act(async () => Simulate.change(input() as unknown as Element, { target: { value: 'Look at this:' } } as never));
    expect(await paste('stack trace line 1\nline 2')).toBe(true);
    expect(container.querySelector('[aria-label="Attachments"]')?.textContent).toContain('stack trace line 1');
    expect(input().value).toBe('Look at this:');
    const insert = container.querySelector('button[aria-label^="Insert pasted-text"]')!;
    await act(async () => (insert as unknown as HTMLButtonElement).click());
    expect(input().value).toBe('Look at this:\nstack trace line 1\nline 2');
    expect(container.querySelector('[aria-label="Attachments"]')).toBeNull();
    // Ctrl+Shift+V keeps the browser's own paste into the text.
    await act(async () => Simulate.keyDown(input() as unknown as Element, { key: 'V', ctrlKey: true, shiftKey: true }));
    expect(await paste('inline')).toBe(false);
    expect(container.querySelector('[aria-label="Attachments"]')).toBeNull();
    // Blank clipboard text is left to the browser.
    expect(await paste('   ')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
