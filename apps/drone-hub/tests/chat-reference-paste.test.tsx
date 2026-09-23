import { Simulate } from 'react-dom/test-utils';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { afterEach, expect, test } from 'bun:test';
import { ActiveComposerProvider } from '../src/droneHub/chat/ActiveComposerContext';
import { ChatSurface, ChatSurfaceComposer, adaptExternalAgentChatSurface } from '../src/droneHub/chat';
import { DroneChatsDock } from '../src/droneHub/app/DroneChatsDock';
import { pastedChatReferences, useChatClipboardStore } from '../src/droneHub/app/chat-clipboard-store';
import type { DroneSummary } from '../src/droneHub/types';

const COPIED_TEXT = [
  'Referenced drones and chats:',
  '- Drone "Beta" (drone id: beta)',
  '- Chat "plan" in drone "Alpha" (drone id: alpha)',
].join('\n');

function copyPlanAndBeta() {
  useChatClipboardStore.getState().copy({
    chats: [{ droneId: 'alpha', chatName: 'plan' }],
    drones: [{ droneId: 'beta', nodeId: 'drone:beta' }],
    droneNames: { alpha: 'Alpha', beta: 'Beta' },
  });
}

const clipboard = (text: string) => ({ files: [], items: [], types: ['text/plain'], getData: (type: string) => type === 'text/plain' ? text : '' });

afterEach(() => useChatClipboardStore.getState().copy({ chats: [] }));

test('a copy puts its references on the system clipboard, and only that exact text pastes as references', () => {
  const written: string[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true,
    value: { clipboard: { writeText: async (text: string) => { written.push(text); } } } });
  try {
    copyPlanAndBeta();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
  expect(written).toEqual([COPIED_TEXT]);
  expect(pastedChatReferences(clipboard(`${COPIED_TEXT}\n`))?.references).toEqual([
    { kind: 'drone', droneId: 'beta' },
    { kind: 'chat', droneId: 'alpha', chatName: 'plan' },
  ]);
  // Something copied elsewhere since then pastes as itself.
  expect(pastedChatReferences(clipboard('some other text'))).toBeNull();
  useChatClipboardStore.getState().copy({ chats: [] });
  expect(pastedChatReferences(clipboard(COPIED_TEXT))).toBeNull();
});

async function withDom(run: (dom: Window, container: HTMLElement, root: ReturnType<typeof createRoot>) => Promise<void>) {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ messages: [], pending: [] })),
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div') as unknown as HTMLElement;
  dom.document.body.append(container as never);
  const root = createRoot(container);
  try {
    await run(dom, container, root);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
}

const paste = async (target: Element, text: string) => {
  let prevented = false;
  await act(async () => Simulate.paste(target, { clipboardData: clipboard(text), preventDefault: () => { prevented = true; } } as never));
  return prevented;
};

const pressEnter = async (dom: Window, input: Element) => {
  await act(async () => { Simulate.keyDown(input, { key: 'Enter', nativeEvent: new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }) } as never); });
};

test('copied chats paste into the Chats window composer as reference tiles', async () => {
  const drone = { id: 'drone-1', chats: ['default'], statusOk: true } as DroneSummary;
  await withDom(async (dom, container, root) => {
    const sends: string[] = [];
    await act(async () => root.render(<ActiveComposerProvider><DroneChatsDock drone={drone} selectedChat="default"
      options={{ sideChatNames: [], onSelectChat() {}, renderChat: () => null }}
      onSendToChats={async (_targets, payload) => { sends.push(payload.prompt); return { ok: true }; }} /></ActiveComposerProvider>));
    const input = container.querySelector('[data-selected-chats-composer] textarea')! as unknown as Element;
    copyPlanAndBeta();
    expect(await paste(input, COPIED_TEXT)).toBe(true);
    expect(Array.from(container.querySelectorAll('[data-reference-tile]')).map((tile) => tile.getAttribute('data-reference-tile')))
      .toEqual(['drone', 'chat']);
    // Not also added as a pasted-text attachment.
    expect(container.querySelector('[aria-label="Attachments"]')?.textContent ?? '').not.toContain('Referenced drones');
    await act(async () => Simulate.change(input, { target: { value: 'Compare' } } as never));
    await pressEnter(dom, input);
    expect(sends).toEqual([`Compare\n\n${COPIED_TEXT}`]);
  });
});

test('copied chats paste into an agent chat composer and go out with the next message', async () => {
  await withDom(async (dom, container, root) => {
    const sends: string[] = [];
    function Composer({ resetKey }: { resetKey: string }) {
      const [draft, setDraft] = React.useState('');
      return (
        <ChatSurface adapter={adaptExternalAgentChatSurface()}>
          <ChatSurfaceComposer resetKey={resetKey} droneName="Agent" promptError={null} waiting={false}
            draftValue={draft} onDraftValueChange={setDraft}
            onSend={async (payload) => { sends.push(payload.prompt); return true; }} />
        </ChatSurface>
      );
    }
    await act(async () => root.render(<ActiveComposerProvider><Composer resetKey="chat-a" /></ActiveComposerProvider>));
    const input = () => container.querySelector('textarea')! as unknown as Element;
    const tiles = () => container.querySelectorAll('[data-reference-tile]').length;
    copyPlanAndBeta();
    expect(await paste(input(), COPIED_TEXT)).toBe(true);
    expect(tiles()).toBe(2);
    await act(async () => Simulate.change(input(), { target: { value: 'What changed?' } } as never));
    await pressEnter(dom, input());
    expect(sends).toEqual([`What changed?\n\n${COPIED_TEXT}`]);
    expect(tiles()).toBe(0);
    // Other clipboard text is not taken as references; it stays a pasted-text attachment.
    await paste(input(), 'plain words');
    expect(tiles()).toBe(0);
    expect(container.querySelector('[aria-label="Attachments"]')?.textContent).toContain('plain words');
    // References belong to the chat they were pasted into.
    await paste(input(), COPIED_TEXT);
    expect(tiles()).toBe(2);
    await act(async () => root.render(<ActiveComposerProvider><Composer resetKey="chat-b" /></ActiveComposerProvider>));
    expect(tiles()).toBe(0);
  });
});
