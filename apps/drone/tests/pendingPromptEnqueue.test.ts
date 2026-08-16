import { describe, expect, test } from 'bun:test';
import {
  looksLikeTransientPromptEnqueueError,
  shouldRetryFailedPendingPrompt,
  stalePendingPromptState,
} from '../src/hub/pendingPromptEnqueue';

describe('shouldRetryFailedPendingPrompt', () => {
  test('does not retry terminal auth failures', () => {
    expect(
      shouldRetryFailedPendingPrompt({
        error:
          'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.',
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

  test('retries recent provisional missing-exit failures for late reconciliation', () => {
    const nowMs = Date.parse('2026-07-19T16:00:00.000Z');
    for (const error of [
      'prompt wrapper ended without writing an exit code; the tmux session may have been killed',
      'Codex turn started but exited before producing a response.',
    ]) {
      expect(
        shouldRetryFailedPendingPrompt({
          error,
          updatedAt: '2026-07-19T15:55:00.000Z',
          nowMs,
        }),
      ).toBe(true);
    }
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
    expect(
      looksLikeTransientPromptEnqueueError(
        'prompt enqueue failed for drone/default (timed out after 180s)',
      ),
    ).toBe(true);
    expect(
      looksLikeTransientPromptEnqueueError(
        'request timeout after 5000ms: POST /v1/prompts/enqueue',
      ),
    ).toBe(true);
    expect(looksLikeTransientPromptEnqueueError('drone daemon not ready after 20000ms')).toBe(true);
    expect(looksLikeTransientPromptEnqueueError('fetch failed: ECONNREFUSED 127.0.0.1')).toBe(true);
    expect(
      looksLikeTransientPromptEnqueueError('timed out acquiring registry lock (10000ms)'),
    ).toBe(true);
  });

  test('does not retry terminal auth failures', () => {
    expect(looksLikeTransientPromptEnqueueError('unauthorized')).toBe(false);
    expect(
      looksLikeTransientPromptEnqueueError(
        'authentication failed; please log out and sign in again',
      ),
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
