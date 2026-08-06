import { describe, expect, test } from 'bun:test';

import { mergeNativeBusyChatNames } from '../src/hub/native-drone-summary';

describe('native drone busy summaries', () => {
  test('includes running native chats without dropping other busy chats', async () => {
    const checkedThreadIds: string[] = [];
    const result = await mergeNativeBusyChatNames({
      busyChatNames: ['builtin'],
      chatNames: ['native-idle', 'builtin', 'native-running'],
      droneEntry: {
        chats: {
          'native-idle': { id: 'thread-idle', agent: { kind: 'native' } },
          builtin: { id: 'thread-builtin', agent: { kind: 'builtin' } },
          'native-running': { id: 'thread-running', agent: { kind: 'native' } },
        },
      },
      isNativeChat: (chatEntry) => chatEntry?.agent?.kind === 'native',
      isThreadBusy: async (threadId) => {
        checkedThreadIds.push(threadId);
        return threadId === 'thread-running';
      },
    });

    expect(result).toEqual(['builtin', 'native-running']);
    expect(checkedThreadIds).toEqual(['thread-idle', 'thread-running']);
  });

  test('ignores native chats without a stable thread id', async () => {
    let checks = 0;
    const result = await mergeNativeBusyChatNames({
      busyChatNames: [],
      chatNames: ['default'],
      droneEntry: { chats: { default: { agent: { kind: 'native' } } } },
      isNativeChat: (chatEntry) => chatEntry?.agent?.kind === 'native',
      isThreadBusy: async () => {
        checks += 1;
        return true;
      },
    });

    expect(result).toEqual([]);
    expect(checks).toBe(0);
  });
});
