import { describe, expect, test } from 'bun:test';

import {
  groupChatScrollTopAfterPrepend,
  groupChatTailHasOlder,
} from '../src/droneHub/app/group-chat-history';

describe('group chat history', () => {
  test('uses transcript totals to decide whether the initial tail has older messages', () => {
    expect(groupChatTailHasOlder(125, 50, 50)).toBe(true);
    expect(groupChatTailHasOlder(50, 50, 50)).toBe(false);
    expect(groupChatTailHasOlder(null, 50, 50)).toBe(true);
    expect(groupChatTailHasOlder(null, 49, 50)).toBe(false);
  });

  test('preserves the visible position when older content is prepended', () => {
    expect(
      groupChatScrollTopAfterPrepend({ scrollHeight: 1_000, scrollTop: 30 }, 1_700),
    ).toBe(730);
  });
});
