import { afterEach, expect, test } from 'bun:test';
import { chatIdFor, chatIdentityTesting, continuesChat, publishChatIds, renameChatId } from '../src/droneHub/app/chat-identity';
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
