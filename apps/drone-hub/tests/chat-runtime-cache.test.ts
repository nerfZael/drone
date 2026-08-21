import { afterEach, describe, expect, test } from 'bun:test';

import {
  CHAT_RUNTIME_CACHE_TTL_MS,
  chatRuntimeCacheKey,
  chatRuntimeCacheTesting,
  deleteChatRuntimeCache,
  readFreshChatRuntimeCache,
  renameChatRuntimeCache,
  writeChatRuntimeCache,
} from '../src/droneHub/app/chat-runtime-cache';

function chatInfo(chat: string, agent: any) {
  return {
    name: 'drone-one',
    chat,
    chatId: `id-${chat}`,
    subscriptions: [],
    agent,
    agentLocked: false,
    model: null,
    reasoning: null,
    agentPermissionMode: 'execute',
    approvalPolicy: 'ask',
    dockerSnapshotAfterAgentMessageEnabled: false,
    sessionName: `session-${chat}`,
    createdAt: '2026-08-21T00:00:00.000Z',
  } as any;
}

afterEach(() => chatRuntimeCacheTesting.reset());

describe('chat runtime cache', () => {
  test.each([
    ['builtin', { kind: 'builtin', id: 'codex' }],
    ['native', { kind: 'native' }],
    ['custom', { kind: 'custom', id: 'shell', label: 'Shell', command: 'shell' }],
  ])('retains %s surface metadata with its transcript', (_label, agent) => {
    const key = chatRuntimeCacheKey('drone-1', 'review');
    writeChatRuntimeCache(
      key,
      {
        chatInfo: chatInfo('review', agent),
        transcripts: [{ id: 'turn-1', prompt: 'Review this.' } as any],
      },
      1_000,
    );

    expect(readFreshChatRuntimeCache(key, 1_001)).toMatchObject({
      chatInfo: { chat: 'review', agent },
      transcripts: [{ id: 'turn-1' }],
    });
  });

  test('never returns one chat snapshot for another chat identity', () => {
    const firstKey = chatRuntimeCacheKey('drone-1', 'first');
    const secondKey = chatRuntimeCacheKey('drone-1', 'second');
    writeChatRuntimeCache(firstKey, {
      chatInfo: chatInfo('first', { kind: 'builtin', id: 'codex' }),
      transcripts: [{ id: 'first-turn' } as any],
    });

    expect(readFreshChatRuntimeCache(secondKey)).toBeNull();
    deleteChatRuntimeCache(firstKey);
    expect(readFreshChatRuntimeCache(firstKey)).toBeNull();
  });

  test('moves the complete snapshot when a chat is renamed', () => {
    const oldKey = chatRuntimeCacheKey('drone-1', 'old-name');
    const newKey = chatRuntimeCacheKey('drone-1', 'new-name');
    writeChatRuntimeCache(oldKey, {
      chatInfo: chatInfo('old-name', { kind: 'native' }),
      pending: [{ id: 'pending-1' } as any],
      transcripts: [{ id: 'turn-1' } as any],
    });

    renameChatRuntimeCache('drone-1', 'old-name', 'new-name');

    expect(readFreshChatRuntimeCache(oldKey)).toBeNull();
    expect(readFreshChatRuntimeCache(newKey)).toMatchObject({
      chatInfo: { chat: 'new-name', agent: { kind: 'native' } },
      pending: [{ id: 'pending-1' }],
      transcripts: [{ id: 'turn-1' }],
    });
  });

  test('expires config and content together after the revisit window', () => {
    const key = chatRuntimeCacheKey('drone-1', 'default');
    writeChatRuntimeCache(
      key,
      {
        chatInfo: chatInfo('default', { kind: 'builtin', id: 'blip' }),
        transcripts: [],
      },
      10,
    );

    expect(readFreshChatRuntimeCache(key, 10 + CHAT_RUNTIME_CACHE_TTL_MS)).toBeNull();
  });
});
