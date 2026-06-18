import { describe, expect, test } from 'bun:test';
import { resolveTranscriptPromptAt } from '../src/hub/transcript-order';

describe('resolveTranscriptPromptAt', () => {
  test('prefers the original queued timestamp over the daemon job start time', () => {
    expect(
      resolveTranscriptPromptAt({
        pendingAt: '2026-03-20T10:00:00.000Z',
        jobStartedAt: '2026-03-20T10:05:00.000Z',
        finishedAt: '2026-03-20T10:06:00.000Z',
      }),
    ).toBe('2026-03-20T10:00:00.000Z');
  });

  test('falls back to the daemon start time when the pending timestamp is unavailable', () => {
    expect(
      resolveTranscriptPromptAt({
        pendingAt: '',
        jobStartedAt: '2026-03-20T10:05:00.000Z',
        finishedAt: '2026-03-20T10:06:00.000Z',
      }),
    ).toBe('2026-03-20T10:05:00.000Z');
  });

  test('falls back to the finished time when neither earlier timestamp exists', () => {
    expect(
      resolveTranscriptPromptAt({
        pendingAt: '',
        jobStartedAt: '',
        finishedAt: '2026-03-20T10:06:00.000Z',
      }),
    ).toBe('2026-03-20T10:06:00.000Z');
  });
});
