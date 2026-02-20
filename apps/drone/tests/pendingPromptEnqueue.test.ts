import { describe, expect, test } from 'bun:test';
import { shouldDeferQueuedTranscriptPrompt, stalePendingPromptState } from '../src/hub/pendingPromptEnqueue';

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

describe('stalePendingPromptState', () => {
  test('marks sending stale after enqueue timeout floor', () => {
    const nowMs = Date.now();
    const enqueueTimeoutMs = 180_000;
    const staleAt = new Date(nowMs - enqueueTimeoutMs - 5_000).toISOString();
    expect(
      stalePendingPromptState({
        state: 'sending',
        updatedAt: staleAt,
        enqueueTimeoutMs,
        nowMs,
      }),
    ).toBe('sending');
  });

  test('uses longer timeout before marking sent stale', () => {
    const nowMs = Date.now();
    const enqueueTimeoutMs = 180_000;
    const freshEnough = new Date(nowMs - 5 * 60_000).toISOString();
    const stale = new Date(nowMs - 11 * 60_000).toISOString();
    expect(
      stalePendingPromptState({
        state: 'sent',
        updatedAt: freshEnough,
        enqueueTimeoutMs,
        nowMs,
      }),
    ).toBeNull();
    expect(
      stalePendingPromptState({
        state: 'sent',
        updatedAt: stale,
        enqueueTimeoutMs,
        nowMs,
      }),
    ).toBe('sent');
  });

  test('returns null for invalid timestamp or non-active states', () => {
    expect(
      stalePendingPromptState({
        state: 'failed',
        updatedAt: '2020-01-01T00:00:00.000Z',
        enqueueTimeoutMs: 180_000,
        nowMs: Date.now(),
      }),
    ).toBeNull();
    expect(
      stalePendingPromptState({
        state: 'sending',
        updatedAt: 'not-a-date',
        enqueueTimeoutMs: 180_000,
        nowMs: Date.now(),
      }),
    ).toBeNull();
  });
});
