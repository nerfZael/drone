import { expect, test } from 'bun:test';
import type { BlipHistoryPage } from '@blip/protocol';
import type { AssistantSnapshot } from '../src/droneHub/assistant/assistant-types';
import { deleteNativeChatSnapshot, readNativeChatSnapshot, writeNativeChatHistory, writeNativeChatSnapshot } from '../src/droneHub/assistant/native-chat-cache';

function visit(droneId: string, count = 1) {
  const threadId = `cache-thread-${droneId}`;
  writeNativeChatSnapshot(droneId, 'default', { threads: [{ id: threadId }] } as AssistantSnapshot);
  writeNativeChatHistory({
    version: 1, threadId, sessionId: null,
    entries: Array.from({ length: count }, (_, index) => ({ id: String(index), sequence: index + 1, timestamp: '2026-09-27T00:00:00Z',
      message: { role: 'assistant', content: String(index) } })),
    page: { limit: count, beforeCursor: null, hasOlder: false },
  } as BlipHistoryPage);
}

test('native snapshots retain a bounded history tail with a cursor to the omitted messages', () => {
  visit('long-history', 350);
  const cached = readNativeChatSnapshot('long-history', 'default')!;
  expect(cached.initialHistory?.entries).toHaveLength(200);
  expect(cached.initialHistory?.page.hasOlder).toBe(true);
  expect(cached.initialHistory?.page.beforeCursor).toBe(151);
  expect(readNativeChatSnapshot('long-history', 'another-chat')).toBeNull();
  deleteNativeChatSnapshot('long-history', 'default');
  expect(readNativeChatSnapshot('long-history', 'default')).toBeNull();
});

test('native snapshots evict old visits instead of keeping every opened chat', () => {
  for (let index = 0; index < 25; index += 1) visit(`bounded-${index}`);
  expect(readNativeChatSnapshot('bounded-0', 'default')).toBeNull();
  expect(readNativeChatSnapshot('bounded-24', 'default')).not.toBeNull();
  for (let index = 0; index < 25; index += 1) deleteNativeChatSnapshot(`bounded-${index}`, 'default');
});
