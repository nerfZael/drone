import { describe, expect, test } from 'bun:test';
import {
  hasActivePriorPendingPrompt,
  looksLikeTransientPromptEnqueueError,
  shouldDeferQueuedTranscriptPrompt,
  shouldRetryFailedPendingPrompt,
  stalePendingPromptState,
} from '../src/hub/pendingPromptEnqueue';

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

  test('defers codex/opencode/pi/blip when session unknown and a prior prompt is enqueued', () => {
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
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'pi',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'p1', state: 'sent' }],
      }),
    ).toBe(true);
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'blip',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'p1', state: 'sent' }],
      }),
    ).toBe(true);
  });

  test('does not defer codex/opencode/pi when session is known', () => {
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'codex',
        sessionKnown: true,
        priorPendingPrompts: [{ id: 'p1', state: 'sent' }],
      }),
    ).toBe(false);
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'pi',
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
    expect(
      shouldDeferQueuedTranscriptPrompt({
        agentId: 'pi',
        sessionKnown: false,
        priorPendingPrompts: [{ id: 'p1', state: 'queued' }],
      }),
    ).toBe(false);
  });
});

describe('hasActivePriorPendingPrompt', () => {
  test('returns true for queued/sending/sent rows that are not done', () => {
    expect(
      hasActivePriorPendingPrompt({
        priorPendingPrompts: [
          { id: 'q', state: 'queued' },
          { id: 's', state: 'sending' },
          { id: 't', state: 'sent' },
        ],
      }),
    ).toBe(true);
  });

  test('ignores failed rows and transcript-completed rows', () => {
    expect(
      hasActivePriorPendingPrompt({
        priorPendingPrompts: [{ id: 'f', state: 'failed' }],
      }),
    ).toBe(false);
    expect(
      hasActivePriorPendingPrompt({
        priorPendingPrompts: [{ id: 'done', state: 'sent' }],
        transcriptDoneIds: new Set(['done']),
      }),
    ).toBe(false);
  });
});

describe('shouldRetryFailedPendingPrompt', () => {
  test('does not retry terminal auth failures', () => {
    expect(
      shouldRetryFailedPendingPrompt({
        error: 'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.',
        updatedAt: '2026-06-13T23:41:42.221Z',
        nowMs: Date.parse('2026-06-13T23:42:00.000Z'),
      }),
    ).toBe(false);
  });

  test('retries recent transcript parse failures', () => {
    expect(
      shouldRetryFailedPendingPrompt({
        error: 'codex finished but no message was parsed',
        updatedAt: '2026-06-13T23:40:00.000Z',
        nowMs: Date.parse('2026-06-13T23:45:00.000Z'),
      }),
    ).toBe(true);
  });

  test('stops retrying old transcript parse failures', () => {
    expect(
      shouldRetryFailedPendingPrompt({
        error: 'codex finished but no message was parsed',
        updatedAt: '2026-06-13T23:20:00.000Z',
        nowMs: Date.parse('2026-06-13T23:45:00.000Z'),
      }),
    ).toBe(false);
  });
});

describe('looksLikeTransientPromptEnqueueError', () => {
  test('matches daemon and timeout delivery interruptions', () => {
    expect(looksLikeTransientPromptEnqueueError('prompt enqueue failed for drone/default (timed out after 180s)')).toBe(true);
    expect(looksLikeTransientPromptEnqueueError('request timeout after 5000ms: POST /v1/prompts/enqueue')).toBe(true);
    expect(looksLikeTransientPromptEnqueueError('drone daemon not ready after 20000ms')).toBe(true);
    expect(looksLikeTransientPromptEnqueueError('fetch failed: ECONNREFUSED 127.0.0.1')).toBe(true);
    expect(looksLikeTransientPromptEnqueueError('timed out acquiring registry lock (10000ms)')).toBe(true);
  });

  test('does not retry terminal auth failures', () => {
    expect(looksLikeTransientPromptEnqueueError('unauthorized')).toBe(false);
    expect(looksLikeTransientPromptEnqueueError('authentication failed; please log out and sign in again')).toBe(false);
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
