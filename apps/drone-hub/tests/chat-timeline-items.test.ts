import { describe, expect, test } from 'bun:test';
import { buildChatTimelineItems } from '../src/droneHub/app/chat-timeline-items';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';

function turn(turnNumber: number, at: string): TranscriptItem {
  return {
    turn: turnNumber,
    at,
    prompt: `turn ${turnNumber}`,
    session: 'chat-default',
    logPath: '/tmp/chat.log',
    ok: true,
    output: 'done',
  };
}

function pending(id: string, at: string, state: PendingPrompt['state'], updatedAt?: string): PendingPrompt {
  return { id, at, prompt: id, state, ...(updatedAt ? { updatedAt } : {}) };
}

describe('chat timeline items', () => {
  test('merges ordinary pending prompts with completed turns chronologically', () => {
    const items = buildChatTimelineItems(
      [turn(1, '2026-01-01T10:00:00.000Z'), turn(2, '2026-01-01T10:02:00.000Z')],
      [pending('between', '2026-01-01T10:01:00.000Z', 'failed')],
    );

    expect(items.map((item) => item.kind === 'turn' ? `turn:${item.item.turn}` : `pending:${item.item.id}`)).toEqual([
      'turn:1',
      'pending:between',
      'turn:2',
    ]);
  });

  test('keeps a prompt being delivered ahead of locally queued prompts', () => {
    const items = buildChatTimelineItems([], [
      pending('queued', '2026-01-01T10:00:00.000Z', 'queued'),
      pending('active', '2026-01-01T10:01:00.000Z', 'sending', '2026-01-01T10:02:00.000Z'),
    ]);

    expect(items.map((item) => item.item.id)).toEqual(['active', 'queued']);
  });

  test('orders active prompts by submission time rather than status update time', () => {
    const items = buildChatTimelineItems([], [
      pending('first', '2026-01-01T10:00:00.000Z', 'sent', '2026-01-01T10:03:00.000Z'),
      pending('second', '2026-01-01T10:01:00.000Z', 'sending', '2026-01-01T10:02:00.000Z'),
    ]);

    expect(items.map((item) => item.item.id)).toEqual(['first', 'second']);
  });

  test('preserves input order when timestamps match', () => {
    const at = '2026-01-01T10:00:00.000Z';
    const items = buildChatTimelineItems([turn(1, at), turn(2, at)], [pending('same-time', at, 'failed')]);

    expect(items.map((item) => item.kind === 'turn' ? `turn:${item.item.turn}` : `pending:${item.item.id}`)).toEqual([
      'turn:1',
      'turn:2',
      'pending:same-time',
    ]);
  });
});
