import { describe, expect, test } from 'bun:test';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';
import {
  buildRemoteChatTimeline,
  normalizeRemotePendingPrompts,
} from '../src/remote/remote-chat-timeline';

function transcript(
  seed: Partial<TranscriptItem> & Pick<TranscriptItem, 'id' | 'at'>,
): TranscriptItem {
  return {
    id: seed.id,
    turn: seed.turn ?? 1,
    at: seed.at,
    promptAt: seed.promptAt,
    prompt: seed.prompt ?? String(seed.id),
    session: seed.session ?? 'session',
    logPath: seed.logPath ?? '',
    ok: seed.ok ?? true,
    output: seed.output ?? 'done',
  };
}

function pending(seed: Partial<PendingPrompt> & Pick<PendingPrompt, 'id' | 'at'>): PendingPrompt {
  return {
    id: seed.id,
    at: seed.at,
    prompt: seed.prompt ?? String(seed.id),
    state: seed.state ?? 'sending',
    updatedAt: seed.updatedAt,
    error: seed.error,
  };
}

describe('Remote Hub chat timeline', () => {
  test('places failed prompts at their submission time instead of after all transcripts', () => {
    const timeline = buildRemoteChatTimeline(
      [
        transcript({ id: 'first', at: '2026-07-10T10:00:00.000Z' }),
        transcript({ id: 'third', at: '2026-07-10T12:00:00.000Z' }),
      ],
      [pending({ id: 'failed', at: '2026-07-10T11:00:00.000Z', state: 'failed' })],
    );

    expect(timeline.map((entry) => entry.item.id)).toEqual(['first', 'failed', 'third']);
  });

  test('deduplicates repeated pending IDs and keeps the newest state', () => {
    const normalized = normalizeRemotePendingPrompts([
      pending({
        id: 'same-prompt',
        at: '2026-07-10T10:00:00.000Z',
        updatedAt: '2026-07-10T10:00:01.000Z',
        state: 'sending',
      }),
      pending({
        id: 'same-prompt',
        at: '2026-07-10T10:00:00.000Z',
        updatedAt: '2026-07-10T10:00:02.000Z',
        state: 'failed',
      }),
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.state).toBe('failed');
  });

  test('removes pending entries that already have transcript turns', () => {
    expect(
      normalizeRemotePendingPrompts(
        [pending({ id: 'completed', at: '2026-07-10T10:00:00.000Z', state: 'sent' })],
        [transcript({ id: 'completed', at: '2026-07-10T10:00:00.000Z' })],
      ),
    ).toEqual([]);
  });

  test('keeps intentionally repeated prompts when they have different IDs', () => {
    const normalized = normalizeRemotePendingPrompts([
      pending({ id: 'attempt-a', at: '2026-07-10T10:00:00.000Z', prompt: 'retry this' }),
      pending({ id: 'attempt-b', at: '2026-07-10T10:00:01.000Z', prompt: 'retry this' }),
    ]);

    expect(normalized.map((item) => item.id)).toEqual(['attempt-a', 'attempt-b']);
  });
});
