import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chatIdFor, chatIdentityTesting, chatPathRef, continuesChat, currentChatName, forgetNewChatId, newChatId, publishChatIds, renameChatId, takeSeenChatRenames } from '../src/droneHub/app/chat-identity';
import { droneChatEventMatches } from '../src/droneHub/app/chat-api';
import { chatSelectionKey } from '../src/droneHub/app/chat-selection-model';

const stored = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  });
});
afterEach(() => {
  chatIdentityTesting.reset();
  stored.clear();
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('chats are keyed by their ID once a summary reports it, and by name until then', () => {
  const byName = chatSelectionKey('drone', 'Plan');
  publishChatIds([{ id: 'drone', chatIds: { Plan: 'chat-1' } }]);
  const byId = chatSelectionKey('drone', 'Plan');

  expect(byName).toBe('drone\u0000Plan');
  expect(byId).not.toBe(byName);
  expect(chatSelectionKey('drone', 'Other')).toBe('drone\u0000Other');
  // The ID arriving does not make a view think it shows another chat.
  expect(continuesChat(byName, byId)).toBe(true);
  expect(continuesChat(chatSelectionKey('drone', 'Other'), byId)).toBe(false);
});

test('a renamed chat keeps its key under the new name before the summary shows it', () => {
  publishChatIds([{ id: 'drone', chatIds: { Plan: 'chat-1', Notes: 'chat-2' } }]);
  const before = chatSelectionKey('drone', 'Plan');

  renameChatId('drone', 'Plan', 'Roadmap');

  expect(chatSelectionKey('drone', 'Roadmap')).toBe(before);
  expect(continuesChat(before, chatSelectionKey('drone', 'Roadmap'))).toBe(true);
  expect(continuesChat(before, chatSelectionKey('drone', 'Notes'))).toBe(false);

  // Once the summary lists the ID under its new name, it alone decides.
  publishChatIds([{ id: 'drone', chatIds: { Roadmap: 'chat-1', Notes: 'chat-2' } }]);
  publishChatIds([{ id: 'drone', chatIds: { Renamed: 'chat-1', Notes: 'chat-2' } }]);
  expect(chatIdFor('drone', 'Roadmap')).toBeNull();
  expect(chatIdFor('drone', 'Renamed')).toBe('chat-1');
});

test('renames made anywhere are seen in the summaries, and an old name leads to the renamed chat', () => {
  publishChatIds([{ id: 'drone', chatIds: { Plan: 'chat-1', Notes: 'chat-2' } }]);
  expect(takeSeenChatRenames()).toEqual([]);

  // Renamed on another device: the next summary shows the ID under a new name.
  publishChatIds([{ id: 'drone', chatIds: { Roadmap: 'chat-1', Notes: 'chat-2' } }]);
  publishChatIds([{ id: 'drone', chatIds: { 'Roadmap v2': 'chat-1', Notes: 'chat-2' } }]);

  expect(takeSeenChatRenames()).toEqual([
    [{ droneId: 'drone', oldName: 'Plan', newName: 'Roadmap' }],
    [{ droneId: 'drone', oldName: 'Roadmap', newName: 'Roadmap v2' }],
  ]);
  expect(takeSeenChatRenames()).toEqual([]);
  expect(currentChatName('drone', 'Plan')).toBe('Roadmap v2');
  expect(currentChatName('drone', 'Notes')).toBe('Notes');

  // A new chat that takes an old name is that chat, not the renamed one.
  publishChatIds([{ id: 'drone', chatIds: { 'Roadmap v2': 'chat-1', Notes: 'chat-2', Plan: 'chat-3' } }]);
  expect(currentChatName('drone', 'Plan')).toBe('Plan');
});

test('requests name a chat by its ID once known, and events match it by ID across a rename', () => {
  expect(chatPathRef('drone', 'Plan A')).toBe('Plan%20A');
  publishChatIds([{ id: 'drone', chatIds: { 'Plan A': 'chat-1', Notes: 'chat-2' } }]);
  expect(chatPathRef('drone', 'Plan A')).toBe('chat-1');

  // The event still names the chat by its old name; the view already holds the new one.
  renameChatId('drone', 'Plan A', 'Roadmap');
  const event = { chats: [{ droneId: 'drone', chatName: 'Plan A', chatId: 'chat-1' }] };
  expect(droneChatEventMatches(event, 'drone', 'Roadmap')).toBe(true);
  expect(droneChatEventMatches(event, 'drone', 'Notes')).toBe(false);
  // Events from hubs that send no ID match by name.
  expect(droneChatEventMatches({ chats: [{ droneId: 'drone', chatName: 'Notes' }] }, 'drone', 'Notes')).toBe(true);
});

test('a chat this client creates is known by its chosen ID from the start', () => {
  // A deleted chat's ID may still be listed under the name; a new chat never takes it.
  publishChatIds([{ id: 'drone', chatIds: { 'Untitled 1': 'deleted-chat' } }]);
  const chatId = newChatId('drone', 'Untitled 1');
  expect(chatId).not.toBe('deleted-chat');
  expect(chatIdFor('drone', 'Untitled 1')).toBe(chatId);
  // A retried create reuses it until the summary lists the chat.
  expect(newChatId('drone', 'Untitled 1')).toBe(chatId);
  publishChatIds([{ id: 'drone', chatIds: { 'Untitled 1': chatId } }]);
  expect(chatIdFor('drone', 'Untitled 1')).toBe(chatId);
  expect(newChatId('drone', 'Untitled 1')).not.toBe(chatId);

  const failed = newChatId('drone', 'Untitled 2');
  forgetNewChatId('drone', 'Untitled 2', failed);
  expect(chatIdFor('drone', 'Untitled 2')).toBeNull();
});

test('a rename made here is not followed a second time when the summary shows it', () => {
  publishChatIds([{ id: 'drone', chatIds: { Plan: 'chat-1' } }]);
  renameChatId('drone', 'Plan', 'Roadmap');
  publishChatIds([{ id: 'drone', chatIds: { Roadmap: 'chat-1' } }]);
  expect(takeSeenChatRenames()).toEqual([]);
});

test('a rename made while the app was closed is seen in the first summary', () => {
  publishChatIds([{ id: 'drone', chatIds: { Plan: 'chat-1', Notes: 'chat-2' } }]);
  // Next launch: nothing in memory, only what was stored.
  chatIdentityTesting.reset();
  publishChatIds([{ id: 'drone', chatIds: { Notes: 'chat-1', Plan: 'chat-2' } }]);
  expect(takeSeenChatRenames()).toEqual([[
    { droneId: 'drone', oldName: 'Plan', newName: 'Notes' },
    { droneId: 'drone', oldName: 'Notes', newName: 'Plan' },
  ]]);
});
