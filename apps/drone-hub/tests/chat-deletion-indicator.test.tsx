import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import {
  DELETED_CHAT_HIDE_MAX_MS,
  beginChatDeletion,
  markChatsDeleted,
  pruneDeletedChats,
  pruneDeletedChatsOfDrone,
  unmarkChatsDeleted,
  useChatDeletionStore,
} from '../src/droneHub/app/chat-deletion-store';
import type { DroneSummary } from '../src/droneHub/types';
import { ChatDeletingOverlay } from '../src/droneHub/app/ChatDeletingOverlay';

test('a chat counts as being deleted until every deletion of it has ended', () => {
  const plan = { droneId: 'alpha', chatName: 'plan' };
  const endFirst = beginChatDeletion([plan]);
  const endSecond = beginChatDeletion([plan]);
  endFirst(plan);
  endFirst(plan); // ending twice does not end the other deletion
  expect(Object.keys(useChatDeletionStore.getState().deletingByNodeId)).toHaveLength(1);
  endSecond(plan);
  expect(useChatDeletionStore.getState().deletingByNodeId).toEqual({});
});

test('the open chat is covered by a spinner while it is being deleted', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.document.createElement('div');
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => root.render(<ChatDeletingOverlay droneId="alpha" chatName="plan" />));
    expect(container.querySelector('[data-chat-deleting-overlay]')).toBeNull();
    let end: ReturnType<typeof beginChatDeletion> = () => {};
    await act(async () => { end = beginChatDeletion([{ droneId: 'alpha', chatName: 'plan' }]); });
    const overlay = container.querySelector('[data-chat-deleting-overlay]');
    expect(overlay?.getAttribute('role')).toBe('status');
    expect(overlay?.textContent).toContain('Deleting “plan”');
    // Another chat of the same drone is not covered.
    await act(async () => root.render(<ChatDeletingOverlay droneId="alpha" chatName="default" />));
    expect(container.querySelector('[data-chat-deleting-overlay]')).toBeNull();
    await act(async () => root.render(<ChatDeletingOverlay droneId="alpha" chatName="plan" />));
    await act(async () => end({ droneId: 'alpha', chatName: 'plan' }));
    expect(container.querySelector('[data-chat-deleting-overlay]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await dom.happyDOM.close();
  }
});

test('a deleted chat stays hidden until the summaries stop listing it', () => {
  const deletedIds = () => Object.keys(useChatDeletionStore.getState().deletedAtByNodeId).length;
  const alpha = (chats: string[]) => ({ id: 'alpha', chats } as DroneSummary);
  const beta = (chats: string[]) => ({ id: 'beta', chats } as DroneSummary);
  markChatsDeleted([{ droneId: 'alpha', chatName: 'plan' }, { droneId: 'beta', chatName: 'x' }], 1_000);
  // Still listed: kept.
  pruneDeletedChats([alpha(['default', 'plan']), beta(['x'])], 2_000);
  expect(deletedIds()).toBe(2);
  // One drone's summary drops its chat: only that entry goes.
  pruneDeletedChatsOfDrone(alpha(['default']), 2_000);
  expect(deletedIds()).toBe(1);
  // A summary that never catches up does not hide the chat forever.
  pruneDeletedChats([beta(['x'])], 1_000 + DELETED_CHAT_HIDE_MAX_MS);
  expect(deletedIds()).toBe(0);
  // A deletion that failed shows the chat again.
  markChatsDeleted([{ droneId: 'alpha', chatName: 'plan' }]);
  unmarkChatsDeleted([{ droneId: 'alpha', chatName: 'plan' }]);
  expect(deletedIds()).toBe(0);
});
