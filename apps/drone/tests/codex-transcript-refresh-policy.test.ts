import { describe, expect, test } from 'bun:test';

import { codexTranscriptRefreshDue } from '../src/codex-transcript-refresh-policy';

describe('Codex transcript refresh policy', () => {
  test('bounds ordinary streaming reparses', () => {
    expect(
      codexTranscriptRefreshDue({
        events: [{ type: 'delta' }],
        lastRefreshAtMs: undefined,
        nowMs: 1_000,
      }),
    ).toBe(true);
    expect(
      codexTranscriptRefreshDue({
        events: [{ type: 'delta' }],
        lastRefreshAtMs: 1_000,
        nowMs: 1_499,
      }),
    ).toBe(false);
    expect(
      codexTranscriptRefreshDue({
        events: [{ type: 'delta' }],
        lastRefreshAtMs: 1_000,
        nowMs: 1_500,
      }),
    ).toBe(true);
  });

  test('always refreshes terminal and error events', () => {
    expect(
      codexTranscriptRefreshDue({
        events: [{ type: 'turn.completed' }],
        lastRefreshAtMs: 1_000,
        nowMs: 1_001,
      }),
    ).toBe(true);
    expect(
      codexTranscriptRefreshDue({
        events: [{ type: 'error' }],
        lastRefreshAtMs: 1_000,
        nowMs: 1_001,
      }),
    ).toBe(true);
  });
});
