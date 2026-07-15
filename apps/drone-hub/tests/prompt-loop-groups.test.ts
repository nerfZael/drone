import { describe, expect, test } from 'bun:test';
import { buildTranscriptRenderBlocks, buildTranscriptTimelineBlocks } from '../src/droneHub/app/prompt-loop-groups';
import type { PendingPrompt, TranscriptItem } from '../src/droneHub/types';

function transcriptTurn(id: string, at: string): TranscriptItem {
  return {
    id,
    turn: 1,
    at,
    promptAt: at,
    completedAt: at,
    prompt: `prompt:${id}`,
    session: 'default',
    logPath: `/tmp/${id}.log`,
    ok: true,
    output: `output:${id}`,
  };
}

function failedPendingPrompt(id: string, at: string, updatedAt: string): PendingPrompt {
  return {
    id,
    at,
    updatedAt,
    prompt: `prompt:${id}`,
    state: 'failed',
    error: 'failed',
  };
}

function activePendingPrompt(id: string, at: string, updatedAt: string): PendingPrompt {
  return {
    id,
    at,
    updatedAt,
    prompt: `prompt:${id}`,
    state: 'sent',
  };
}

function queuedPendingPrompt(id: string, at: string): PendingPrompt {
  return {
    id,
    at,
    prompt: `prompt:${id}`,
    state: 'queued',
  };
}

describe('buildTranscriptTimelineBlocks', () => {
  test('keeps failed pending prompts in chronological position based on prompt time', () => {
    const transcriptRenderBlocks = buildTranscriptRenderBlocks([
      transcriptTurn('first', '2026-03-29T10:00:00.000Z'),
      transcriptTurn('second', '2026-03-29T10:02:00.000Z'),
    ]);

    const out = buildTranscriptTimelineBlocks({
      transcriptRenderBlocks,
      pendingPlainPrompts: [
        failedPendingPrompt('failed-mid', '2026-03-29T10:01:00.000Z', '2026-03-29T10:05:00.000Z'),
      ],
    });

    expect(out.map((item) => item.kind)).toEqual(['turn', 'pending-prompt', 'turn']);
    expect(out[1]).toMatchObject({
      kind: 'pending-prompt',
      item: {
        id: 'failed-mid',
      },
    });
  });

  test('sorts active pending prompts by their active timestamp instead of original queue time', () => {
    const transcriptRenderBlocks = buildTranscriptRenderBlocks([
      transcriptTurn('completed-first', '2026-03-29T10:05:00.000Z'),
    ]);

    const out = buildTranscriptTimelineBlocks({
      transcriptRenderBlocks,
      pendingPlainPrompts: [
        activePendingPrompt('waiting-second', '2026-03-29T10:01:00.000Z', '2026-03-29T10:06:00.000Z'),
      ],
    });

    expect(out.map((item) => item.kind)).toEqual(['turn', 'pending-prompt']);
    expect(out[1]).toMatchObject({
      kind: 'pending-prompt',
      item: {
        id: 'waiting-second',
      },
    });
  });

  test('keeps queued follow-up prompts after the active waiting prompt', () => {
    const out = buildTranscriptTimelineBlocks({
      transcriptRenderBlocks: [],
      pendingPlainPrompts: [
        activePendingPrompt('waiting-now', '2026-03-29T10:00:00.000Z', '2026-03-29T10:06:00.000Z'),
        queuedPendingPrompt('queued-follow-up', '2026-03-29T10:05:00.000Z'),
      ],
    });

    expect(out.map((item) => (item.kind === 'pending-prompt' ? item.item.id : item.kind))).toEqual([
      'waiting-now',
      'queued-follow-up',
    ]);
  });

  test('keeps active prompts in submission order when the first receives a later plan update', () => {
    const out = buildTranscriptTimelineBlocks({
      transcriptRenderBlocks: [],
      pendingPlainPrompts: [
        activePendingPrompt('review-first', '2026-03-29T10:00:00.000Z', '2026-03-29T10:05:00.000Z'),
        activePendingPrompt('make-pr-second', '2026-03-29T10:01:00.000Z', '2026-03-29T10:02:00.000Z'),
      ],
    });

    expect(out.map((item) => (item.kind === 'pending-prompt' ? item.item.id : item.kind))).toEqual([
      'review-first',
      'make-pr-second',
    ]);
  });
});
