import { describe, expect, test } from 'bun:test';

import { resolveChatCloneSources, resolveChatCreatedAt, summarizeDroneActivity } from '../src/hub/drone-summary-helpers';

describe('drone summary helpers', () => {
  test('reports each chat\'s creation time, skipping missing or invalid ones', () => {
    expect(resolveChatCreatedAt({
      default: { createdAt: '2026-09-01T10:00:00.000Z' },
      legacy: {},
      broken: { createdAt: 'not a date' },
    })).toEqual({ default: '2026-09-01T10:00:00.000Z' });
    expect(resolveChatCreatedAt(null)).toEqual({});
  });

  test('resolves clone sources by chat ID so renames keep the link and deleted sources drop out', () => {
    expect(
      resolveChatCloneSources({
        'renamed-source': { id: 'source-id' },
        clone: { id: 'clone-id', cloneOrigin: { sourceChatName: 'old-name', sourceChatId: 'source-id' } },
        'clone-of-clone': { id: 'c2', cloneOrigin: { sourceChatName: 'clone', sourceChatId: 'clone-id' } },
        'kept-side-chat': { id: 'k1', sideChatOrigin: { sourceChatName: 'clone', checkpointId: 'answer-1' } },
        orphan: { id: 'o1', cloneOrigin: { sourceChatName: 'deleted', sourceChatId: 'gone' } },
      }),
    ).toEqual({
      clone: 'renamed-source',
      'clone-of-clone': 'clone',
      'kept-side-chat': 'clone',
    });
  });

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

  test('does not let hidden workflow chats change ordinary drone activity', () => {
    expect(
      summarizeDroneActivity({
        createdAt: '2026-07-01T08:00:00.000Z',
        chats: {
          default: {
            turns: [{ at: '2026-07-02T08:00:00.000Z' }],
          },
          worker: {
            visibility: 'workflow',
            turns: [{ at: '2026-07-20T08:00:00.000Z' }],
          },
        },
      }),
    ).toEqual({
      lastActivityAt: '2026-07-02T08:00:00.000Z',
      lastMessageAt: '2026-07-02T08:00:00.000Z',
      lastActivityChat: 'default',
    });
  });
});
