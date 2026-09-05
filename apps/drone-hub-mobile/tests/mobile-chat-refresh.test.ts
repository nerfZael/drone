import { describe, expect, test } from 'bun:test';

import {
  loadMobileChatWithListRecovery,
  mobileChatRefreshPlan,
} from '../src/drones/mobile-chat-refresh';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('mobile chat refresh', () => {
  test('a slow chat list does not keep an already-read conversation loading', async () => {
    const list = deferred<string[]>();
    let finished = false;
    const loading = loadMobileChatWithListRecovery({
      initialChat: 'default',
      knownChats: ['default'],
      listChats: () => list.promise,
      readChat: async () => {},
      isCurrent: () => true,
      applyListedSelection: () => {},
    }).then(() => {
      finished = true;
    });
    await loading;
    expect(finished).toBe(true);
    list.resolve(['default']);
  });

  test('a failed chat list does not replace successfully loaded history with an error', async () => {
    await expect(
      loadMobileChatWithListRecovery({
        initialChat: 'default',
        knownChats: ['default'],
        listChats: async () => {
          throw new Error('metadata unavailable');
        },
        readChat: async () => {},
        isCurrent: () => true,
        applyListedSelection: () => {},
      }),
    ).resolves.toBeUndefined();
  });

  test('a late list response cannot navigate away from a newer selection', async () => {
    const list = deferred<string[]>();
    let current = true;
    const selections: string[] = [];
    await loadMobileChatWithListRecovery({
      initialChat: 'default',
      knownChats: ['default'],
      listChats: () => list.promise,
      readChat: async () => {},
      isCurrent: () => current,
      applyListedSelection: (_, chat) => selections.push(chat),
    });
    current = false;
    list.resolve(['other']);
    await Promise.resolve();
    expect(selections).toEqual([]);
  });

  test('starts the known chat read before the chat list resolves', async () => {
    const list = deferred<string[]>();
    const calls: string[] = [];
    const loading = loadMobileChatWithListRecovery({
      initialChat: 'default',
      knownChats: ['default'],
      listChats: () => list.promise,
      readChat: async (chatName) => {
        calls.push(`read:${chatName}`);
      },
      isCurrent: () => true,
      applyListedSelection: (_chats, chatName) => calls.push(`select:${chatName}`),
    });

    expect(calls).toEqual(['read:default']);
    list.resolve(['default']);
    await loading;
    expect(calls).toEqual(['read:default', 'select:default']);
  });

  test('recovers from a stale summary with the listed fallback chat', async () => {
    const calls: string[] = [];
    await loadMobileChatWithListRecovery({
      initialChat: 'deleted',
      knownChats: ['deleted'],
      requestedChat: 'deleted',
      listChats: async () => ['default'],
      readChat: async (chatName) => {
        calls.push(chatName);
        if (chatName === 'deleted') throw new Error('unknown chat');
      },
      isCurrent: () => true,
      applyListedSelection: () => undefined,
    });
    expect(calls).toEqual(['deleted', 'default']);
  });

  test('keeps tool progress chat-local and refreshes sidebar state only when needed', () => {
    const active = {
      eventDroneId: 'drone-1',
      eventChatName: 'default',
      activeDroneId: 'drone-1',
      activeChatName: 'default',
    };
    expect(mobileChatRefreshPlan({ ...active, reason: 'runtime_tool_call_progress' })).toEqual({
      refreshChat: true,
      refreshDrones: false,
    });
    expect(mobileChatRefreshPlan({ ...active, reason: 'runtime_finished' })).toEqual({
      refreshChat: true,
      refreshDrones: true,
    });
    expect(
      mobileChatRefreshPlan({
        ...active,
        reason: 'canonical_history_changed',
        eventChatName: 'other',
      }),
    ).toEqual({ refreshChat: false, refreshDrones: true });
  });
});
