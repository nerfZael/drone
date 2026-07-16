import { describe, expect, test } from 'bun:test';
import { summarizeAssistantActivity } from '../src/droneHub/assistant/assistant-activity';

describe('assistant activity summary', () => {
  test('counts active threads', () => {
    expect(
      summarizeAssistantActivity({
        threads: [
          { id: 'running', status: 'running' },
          { id: 'waiting', status: 'waiting_for_chats_idle' },
          { id: 'idle', status: 'idle' },
          { id: 'error', status: 'error' },
        ],
      }),
    ).toEqual({ total: 2 });
  });

  test('deduplicates running models, thread state, and active chat idle subscriptions', () => {
    expect(
      summarizeAssistantActivity({
        threads: [
          { id: 'active', status: 'running' },
          { id: 'subscribed', status: 'idle' },
          { id: 'fired', status: 'idle' },
        ],
        runningModels: {
          active: { model: 'codex' },
          'missing-thread': { model: 'codex' },
        },
        chatIdleSubscriptions: [
          { threadId: 'subscribed', status: 'active' },
          { threadId: 'fired', status: 'fired' },
          { threadId: 'active', status: 'active' },
        ],
      }),
    ).toEqual({ total: 3 });
  });

  test('returns empty counts when nothing is active', () => {
    expect(
      summarizeAssistantActivity({
        threads: [
          { id: 'idle', status: 'idle' },
        ],
        chatIdleSubscriptions: [{ threadId: 'idle', status: 'expired' }],
      }),
    ).toEqual({ total: 0 });
  });
});
