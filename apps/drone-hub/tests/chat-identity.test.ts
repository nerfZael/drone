import { afterEach, expect, test } from 'bun:test';
import { chatIdFor, chatIdentityTesting, chatPathRef, continuesChat, currentChatName, publishChatIds, renameChatId, takeSeenChatRenames } from '../src/droneHub/app/chat-identity';
import { droneChatEventMatches } from '../src/droneHub/app/chat-api';
import { chatSelectionKey } from '../src/droneHub/app/chat-selection-model';

afterEach(() => chatIdentityTesting.reset());

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
    { droneId: 'drone', oldName: 'Plan', newName: 'Roadmap' },
    { droneId: 'drone', oldName: 'Roadmap', newName: 'Roadmap v2' },
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
