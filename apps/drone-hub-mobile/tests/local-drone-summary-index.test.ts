import { describe, expect, test } from 'bun:test';

import { createLocalDroneSummaryIndex } from '../src/drones/local-drone-summary-index';

describe('phone-local drone summary index', () => {
  test('summarizes busy chats, approvals, and latest activity in chat order', () => {
    const index = createLocalDroneSummaryIndex(
      [
        { id: 'thread-a', status: 'idle', updatedAt: '2026-09-01T10:00:00.000Z' },
        { id: 'thread-b', status: 'running', updatedAt: '2026-09-03T10:00:00.000Z' },
        { id: 'thread-c', status: 'idle', updatedAt: '2026-09-02T10:00:00.000Z' },
      ],
      [{ threadId: 'thread-a' }, { threadId: 'thread-c' }, { threadId: 'thread-a' }],
    );

    expect(
      index.summarizeChats(
        { default: 'thread-a', review: 'thread-b', plan: 'thread-c' },
        'thread-c',
      ),
    ).toEqual({
      busyChats: ['review', 'plan'],
      approvalChats: ['default', 'plan'],
      approvalRequired: true,
      lastActivityAt: '2026-09-03T10:00:00.000Z',
    });
  });

  test('preserves empty and missing-thread activity semantics', () => {
    const index = createLocalDroneSummaryIndex([], []);

    expect(index.summarizeChats({}, null).lastActivityAt).toBeUndefined();
    expect(index.summarizeChats({ default: 'missing' }, null)).toEqual({
      busyChats: [],
      approvalChats: [],
      approvalRequired: false,
      lastActivityAt: '',
    });
  });
});
