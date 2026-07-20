import { describe, expect, test } from 'bun:test';

import { summarizeDroneActivity } from '../src/hub/drone-summary-helpers';

describe('drone summary helpers', () => {
  test('includes canonical native-chat messages in drone activity', () => {
    expect(
      summarizeDroneActivity(
        {
          createdAt: '2026-07-01T08:00:00.000Z',
          chats: {
            default: { id: 'native-thread', turns: [], pendingPrompts: [] },
          },
        },
        new Map([['native-thread', '2026-07-20T12:34:56.000Z']]),
      ),
    ).toEqual({
      lastActivityAt: '2026-07-20T12:34:56.000Z',
      lastMessageAt: '2026-07-20T12:34:56.000Z',
      lastActivityChat: 'default',
    });
  });
});
