import { describe, expect, test } from 'bun:test';
import {
  cloneTranscriptTurnsForChatFork,
  completePendingChatFork,
  createChatForkOrigin,
  pendingChatForkSourceSessionId,
} from '../src/hub/chat-fork';

describe('chat forks', () => {
  test('records native external-agent fork origins without reusing the source session', () => {
    const origin = createChatForkOrigin({ claudeSessionId: 'claude-source' }, 'default', 'claude');
    expect(origin).toEqual({
      version: 1,
      agentId: 'claude',
      sourceChatName: 'default',
      sourceSessionId: 'claude-source',
      state: 'pending',
    });
    expect(pendingChatForkSourceSessionId({ chatForkOrigin: origin }, 'claude')).toBe(
      'claude-source',
    );
    expect(pendingChatForkSourceSessionId({ chatForkOrigin: origin }, 'pi')).toBe('');
  });

  test('uses transcript fallback for Cursor without storing fork metadata', () => {
    const origin = createChatForkOrigin({ chatId: 'cursor-source' }, 'review', 'cursor');
    expect(origin).toBeNull();
    expect(pendingChatForkSourceSessionId({}, 'cursor')).toBe('');
    expect(completePendingChatFork({}, 'cursor')).toBe(false);
  });

  test('copies transcript turns independently and marks inherited history', () => {
    const source = [{
      id: 'turn-1',
      prompt: 'one',
      output: 'two',
      details: { ok: true },
      agentMessageAutoContinue: { state: 'queued' },
      agentSuggestion: { state: 'ready' },
      automation: { kind: 'legacy' },
    }];
    const cloned = cloneTranscriptTurnsForChatFork(source);
    expect(cloned).toEqual([{
      id: 'turn-1',
      prompt: 'one',
      output: 'two',
      details: { ok: true },
      inheritedFromClone: true,
    }]);
    cloned[0].details.ok = false;
    expect(source[0].details.ok).toBe(true);
  });
});
