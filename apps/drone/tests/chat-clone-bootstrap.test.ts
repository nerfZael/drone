import { describe, expect, test } from 'bun:test';
import { cloneChatEntryForDroneClone, maybeBootstrapPromptFromTranscript } from '../src/hub/chat-clone';

describe('chat clone transcript bootstrap', () => {
  test('returns the original prompt when the builtin session is already known', () => {
    const prompt = maybeBootstrapPromptFromTranscript({
      agentId: 'cursor',
      prompt: 'What did I ask so far?',
      chatEntry: {
        chatId: 'existing-chat-id',
        turns: [
          {
            at: '2026-03-17T10:00:00.000Z',
            prompt: 'create a hello.txt file',
            ok: true,
            output: 'Created hello.txt with hello.',
          },
        ],
      },
    });

    expect(prompt).toBe('What did I ask so far?');
  });

  test('bootstraps the first cloned prompt from copied transcript turns', () => {
    const prompt = maybeBootstrapPromptFromTranscript({
      agentId: 'cursor',
      prompt: 'What did I ask so far?',
      chatEntry: {
        turns: [
          {
            at: '2026-03-17T10:00:00.000Z',
            prompt: 'create a hello.txt file',
            ok: true,
            output: 'Created hello.txt with hello.',
          },
        ],
      },
    });

    expect(prompt).toContain('You are continuing a chat in a new session.');
    expect(prompt).toContain('create a hello.txt file');
    expect(prompt).toContain('Created hello.txt with hello.');
    expect(prompt).toContain('New user message:\nWhat did I ask so far?');
  });

  test('keeps the most recent cloned turns first when limiting transcript bootstrap size', () => {
    const prompt = maybeBootstrapPromptFromTranscript({
      agentId: 'codex',
      prompt: 'Continue',
      maxTurns: 2,
      chatEntry: {
        turns: [
          { at: '2026-03-17T10:00:00.000Z', prompt: 'oldest', ok: true, output: 'one' },
          { at: '2026-03-17T10:01:00.000Z', prompt: 'middle', ok: true, output: 'two' },
          { at: '2026-03-17T10:02:00.000Z', prompt: 'latest', ok: true, output: 'three' },
        ],
      },
    });

    expect(prompt).not.toContain('oldest');
    expect(prompt).toContain('middle');
    expect(prompt).toContain('latest');
    expect(prompt).toContain('Only the most recent 2 of 3 prior turns are included.');
  });

  test('preserves continuation ids while dropping source pending prompt state', () => {
    const cloned = cloneChatEntryForDroneClone({
      createdAt: '2026-03-17T10:00:00.000Z',
      chatId: 'cursor-chat-id',
      codexThreadId: 'codex-thread-id',
      claudeSessionId: 'claude-session-id',
      openCodeSessionId: 'opencode-session-id',
      piSessionId: '550e8400-e29b-41d4-a716-446655440000',
      blipSessionId: 'blip-session-id',
      turns: [{ at: '2026-03-17T10:00:00.000Z', prompt: 'hi', ok: true, output: 'hello' }],
      pendingPrompts: [{ id: 'queued', at: '2026-03-17T10:01:00.000Z', prompt: 'later', state: 'queued' }],
      nested: { keep: true },
    });

    expect(cloned.chatId).toBe('cursor-chat-id');
    expect(cloned.codexThreadId).toBe('codex-thread-id');
    expect(cloned.claudeSessionId).toBe('claude-session-id');
    expect(cloned.openCodeSessionId).toBe('opencode-session-id');
    expect(cloned.piSessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(cloned.blipSessionId).toBe('blip-session-id');
    expect(cloned.turns).toEqual([
      {
        at: '2026-03-17T10:00:00.000Z',
        prompt: 'hi',
        ok: true,
        output: 'hello',
        inheritedFromClone: true,
      },
    ]);
    expect(cloned.pendingPrompts).toBeUndefined();
    expect(cloned.nested).toEqual({ keep: true });
  });
});
