import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { DroneChatsDock } from '../src/droneHub/app/DroneChatsDock';
import { allDroneChatNames, latestChatPreview } from '../src/droneHub/app/drone-chats-model';
import type { DroneSummary } from '../src/droneHub/types';
import { useDroneHubRuntimeStore } from '../src/droneHub/app/use-drone-hub-runtime-store';
import { createCanvasChatNodeId } from '../src/droneHub/app/app-config';

const drone = { id: 'drone-1', chats: ['default', 'nested-chat'], workflowChats: ['workflow'],
  sideChats: [{ name: 'side' }], statusOk: true, busyChats: ['default'],
  approvalChats: ['nested-chat'], unreadChats: ['workflow'], draftChats: { side: true } } as DroneSummary;

test('the inventory includes grouped, workflow, and optimistic side chats without duplicates', () => {
  expect(allDroneChatNames(drone, ['side', 'new-side'])).toEqual(['default', 'nested-chat', 'workflow', 'side', 'new-side']);
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
    await act(async () => { root.render(<DroneChatsDock drone={drone} selectedChat="default" options={{
      sideChatNames: [], onSelectChat: (name) => { selected = name; },
      renderChat: (name) => <textarea aria-label={`Message ${name}`} />,
    }} />); });
    expect(container.textContent).toContain('Latest request');
    expect(container.textContent).toContain('You');
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
    await act(async () => { buttons().find((button) => button.textContent === 'Grid')!.click(); });
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
    useDroneHubRuntimeStore.getState().setLocalBusyChatCountByNodeId(previousBusy);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
