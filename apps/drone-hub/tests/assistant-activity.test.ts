import { describe, expect, test } from 'bun:test';
import { summarizeAssistantActivity } from '../src/droneHub/assistant/assistant-activity';

describe('assistant activity summary', () => {
  test('counts active normal and voice threads without rendering zero buckets', () => {
    expect(
      summarizeAssistantActivity({
        threads: [
          { id: 'normal-running', status: 'running' },
          { id: 'voice-waiting', status: 'waiting_for_chats_idle', voiceEnabled: true },
          { id: 'normal-idle', status: 'idle' },
          { id: 'voice-error', status: 'error', voiceEnabled: true },
        ],
      }),
    ).toEqual({ normal: 1, voice: 1, total: 2 });
  });

  test('deduplicates running models, thread state, and active chat idle subscriptions', () => {
    expect(
      summarizeAssistantActivity({
        threads: [
          { id: 'normal-active', status: 'running' },
          { id: 'voice-subscribed', status: 'idle', voiceEnabled: true },
          { id: 'normal-fired', status: 'idle' },
        ],
        runningModels: {
          'normal-active': { model: 'codex' },
          'missing-thread': { model: 'codex' },
        },
        chatIdleSubscriptions: [
          { threadId: 'voice-subscribed', status: 'active' },
          { threadId: 'normal-fired', status: 'fired' },
          { threadId: 'normal-active', status: 'active' },
        ],
      }),
    ).toEqual({ normal: 2, voice: 1, total: 3 });
  });

  test('returns empty counts when nothing is active', () => {
    expect(
      summarizeAssistantActivity({
        threads: [
          { id: 'normal-idle', status: 'idle' },
          { id: 'voice-idle', status: 'idle', voiceEnabled: true },
        ],
        chatIdleSubscriptions: [{ threadId: 'voice-idle', status: 'expired' }],
      }),
    ).toEqual({ normal: 0, voice: 0, total: 0 });
  });
});
