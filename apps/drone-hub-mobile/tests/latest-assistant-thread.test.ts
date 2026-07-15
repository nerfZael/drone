import { describe, expect, test } from 'bun:test';
import {
  assistantThreadsNewestFirst,
  latestAssistantThread,
} from '../src/local-assistant/latest-assistant-thread';

describe('mobile assistant latest thread', () => {
  test('selects by created time rather than activity or storage order', () => {
    const threads = [
      {
        id: 'older',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:00.000Z',
      },
      {
        id: 'latest',
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:00:00.000Z',
      },
      {
        id: 'middle',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    ];
    expect(latestAssistantThread(threads)?.id).toBe('latest');
    expect(assistantThreadsNewestFirst(threads).map((thread) => thread.id)).toEqual([
      'latest',
      'middle',
      'older',
    ]);
    expect(threads[0]?.id).toBe('older');
  });
});
