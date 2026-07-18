import { describe, expect, test } from 'bun:test';
import { resolveReadStateChatEntry } from '../src/hub/routes/chat-management-routes';

describe('chat management route helpers', () => {
  test('uses the canonical chat store when the lifecycle projection has no chats', () => {
    const canonicalChat = { id: 'chat-id', agent: { kind: 'builtin', id: 'codex' } };

    expect(
      resolveReadStateChatEntry({
        droneId: 'drone-id',
        chatName: 'default',
        droneEntry: { id: 'drone-id' },
        readChatFromStore: () => ({ available: true, chat: canonicalChat }),
      }),
    ).toEqual({ chatEntry: canonicalChat, fromStore: true });
  });

  test('falls back to the compatibility projection when the chat store is unavailable', () => {
    const projectedChat = { id: 'legacy-chat-id' };

    expect(
      resolveReadStateChatEntry({
        droneId: 'drone-id',
        chatName: 'default',
        droneEntry: { chats: { default: projectedChat } },
        readChatFromStore: () => ({ available: false, chat: null }),
      }),
    ).toEqual({ chatEntry: projectedChat, fromStore: false });
  });
});
