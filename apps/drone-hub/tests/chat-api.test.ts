import { describe, expect, test } from 'bun:test';
import { sameTranscriptItem } from '../src/droneHub/app/chat-api';
import type { TranscriptItem } from '../src/droneHub/types';

function transcriptItem(overrides: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    turn: 1,
    at: '2026-06-16T18:34:44.000Z',
    id: 'turn-1',
    prompt: 'run task',
    session: 'default',
    logPath: '',
    ok: true,
    output: 'done',
    ...overrides,
  };
}

describe('chat api transcript equality', () => {
  test('detects docker snapshot status changes', () => {
    const creating = transcriptItem({
      dockerSnapshot: {
        id: 'snapshot-1',
        status: 'creating',
        createdAt: '2026-06-16T18:34:44.000Z',
      },
    });
    const ready = transcriptItem({
      dockerSnapshot: {
        id: 'snapshot-1',
        status: 'ready',
        createdAt: '2026-06-16T18:34:44.000Z',
        readyAt: '2026-06-16T18:34:53.000Z',
        sizeBytes: 7392574357,
      },
    });

    expect(sameTranscriptItem(creating, ready)).toBe(false);
  });
});
