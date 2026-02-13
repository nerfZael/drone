import { describe, expect, test } from 'bun:test';
import { shouldDeferQueuedTranscriptPrompt } from '../src/hub/pendingPromptEnqueue';

describe('shouldDeferQueuedTranscriptPrompt', () => {
  test('does not defer for cursor/claude', () => {
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'cursor',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'a', state: 'sent' }],
      }),
    ).toBe(false);
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'claude',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'a', state: 'sent' }],
      }),
    ).toBe(false);
  });

  test('defers codex/opencode when session unknown and a prior prompt is enqueued', () => {
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'codex',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'p1', state: 'sent' }],
      }),
    ).toBe(true);
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'opencode',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'p1', state: 'sending' }],
      }),
    ).toBe(true);
  });

  test('does not defer codex/opencode when session is known', () => {
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'codex',
        sessionKnown: true,
        priorPendingPrompts: [{ id: 'p1', state: 'sent' }],
      }),
    ).toBe(false);
  });

  test('does not defer when prior prompts are failed, done, or only queued', () => {
    const done = new Set(['p1']);
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'codex',
        sessionKnown: false,
        transcriptDoneIds: done,
        priorPendingPrompts: [{ id: 'p1', state: 'sent' }],
      }),
    ).toBe(false);
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'codex',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'p1', state: 'failed' }],
      }),
    ).toBe(false);
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'opencode',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'p1', state: 'queued' }],
      }),
    ).toBe(false);
  });
});

