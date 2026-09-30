import { expect, test } from 'bun:test';
import { preferredChatName } from '../src/hub/preferred-chat';
import { chatReadSnapshotFromRegistry } from '../src/hub/chat-read/helpers/chat-read-model';

test('omitted targets prefer default, then a deterministic surviving chat', () => {
  expect(preferredChatName(['review', 'default'])).toBe('default');
  expect(preferredChatName(['review', 'planning'])).toBe('planning');
  expect(preferredChatName([])).toBe('default');
  expect(preferredChatName(['review'], 'default')).toBe('default');
});

test('history and status follow the surviving chat without reviving default seed history', () => {
  const registry = { drones: { d: { chats: { review: { id: 'review-id', turns: [] } }, seed: { prompt: 'original seed' } } } };
  const read = chatReadSnapshotFromRegistry(registry, { droneId: 'd' });
  expect(read.chat).toBe('review');
  expect(read.chatId).toBe('review-id');
  expect(read.pending).toEqual([]);
  expect(() => chatReadSnapshotFromRegistry(registry, { droneId: 'd', chatName: 'default' })).toThrow('unknown chat');
  expect(() => chatReadSnapshotFromRegistry(registry, { droneId: 'd', chatName: 'missing' })).toThrow('unknown chat');
});
