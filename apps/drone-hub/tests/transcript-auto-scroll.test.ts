import { describe, expect, test } from 'bun:test';
import { computeTranscriptAutoScrollDecision } from '../src/droneHub/app/lifecycle-effect-helpers';

describe('transcript auto-scroll decision', () => {
  test('resets tracking on context switch without scrolling', () => {
    const out = computeTranscriptAutoScrollDecision({
      chatUiMode: 'transcript',
      selectedDrone: 'drone-b',
      selectedChat: 'default',
      previousContextKey: 'drone-a\u0000default',
      previousTrackedLength: 3,
      transcripts: [],
      pendingCount: 0,
    });

    expect(out.nextContextKey).toBe('drone-b\u0000default');
    expect(out.nextTrackedLength).toBe(-1);
    expect(out.shouldScroll).toBe(false);
  });

  test('does not sample stale pending rows while transcripts are still loading', () => {
    const out = computeTranscriptAutoScrollDecision({
      chatUiMode: 'transcript',
      selectedDrone: 'drone-a',
      selectedChat: 'default',
      previousContextKey: 'drone-a\u0000default',
      previousTrackedLength: -1,
      transcripts: null,
      pendingCount: 2,
    });

    expect(out.nextTrackedLength).toBe(-1);
    expect(out.shouldScroll).toBe(false);
  });

  test('scrolls when loaded transcript data changes item count', () => {
    const out = computeTranscriptAutoScrollDecision({
      chatUiMode: 'transcript',
      selectedDrone: 'drone-a',
      selectedChat: 'default',
      previousContextKey: 'drone-a\u0000default',
      previousTrackedLength: -1,
      transcripts: [],
      pendingCount: 2,
    });

    expect(out.nextTrackedLength).toBe(2);
    expect(out.shouldScroll).toBe(true);
  });

  test('does not scroll when count is unchanged', () => {
    const out = computeTranscriptAutoScrollDecision({
      chatUiMode: 'transcript',
      selectedDrone: 'drone-a',
      selectedChat: 'default',
      previousContextKey: 'drone-a\u0000default',
      previousTrackedLength: 3,
      transcripts: [{}, {}] as any,
      pendingCount: 1,
    });

    expect(out.nextTrackedLength).toBe(3);
    expect(out.shouldScroll).toBe(false);
  });
});
