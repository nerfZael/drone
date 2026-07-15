import { describe, expect, test } from 'bun:test';
import { assistantThreadsByCreatedAtNewestFirst } from '../src/droneHub/assistant/assistant-thread-order';

describe('assistant thread order', () => {
  test('keeps newly created threads above older recently active threads', () => {
    const threads = [
      {
        id: 'old-active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
      {
        id: 'new',
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        id: 'middle',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    ];

    expect(assistantThreadsByCreatedAtNewestFirst(threads).map((thread) => thread.id)).toEqual([
      'new',
      'middle',
      'old-active',
    ]);
    expect(threads[0]?.id).toBe('old-active');
  });
});
