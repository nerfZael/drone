import { describe, expect, test } from 'bun:test';

import {
  assistantRequestRuns,
  directAssistantRunTiming,
  renderItemsFromMessages,
} from '../src/droneHub/assistant/assistant-message-model';

describe('native assistant run timing', () => {
  test('pairs a direct assistant reply with its user prompt', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Hello', timestamp: 1_000 },
      { role: 'assistant', content: 'Hi', timestamp: 66_000 },
    ]);

    expect(directAssistantRunTiming(items, 0)).toEqual({
      startedAt: 1_000,
      endedAt: 66_000,
    });
  });

  test('leaves tool-backed runs to the tool activity summary', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Inspect this', timestamp: 1_000 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} }],
        timestamp: 2_000,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: 'Done',
        timestamp: 3_000,
      },
      { role: 'assistant', content: 'Finished', timestamp: 4_000 },
    ]);

    expect(directAssistantRunTiming(items, 0)).toBeNull();
  });

  test('combines approval continuations into one request-level tool summary', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Implement it', timestamp: 1_000 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} }],
        timestamp: 2_000,
      },
      { role: 'toolResult', toolCallId: 'call-1', content: 'Done', timestamp: 3_000 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-2', name: 'apply_patch', arguments: {} }],
        timestamp: 100_000,
      },
      { role: 'toolResult', toolCallId: 'call-2', content: 'Done', timestamp: 101_000 },
      { role: 'assistant', content: 'Finished', timestamp: 102_000 },
      {
        id: 'completed-segment',
        role: 'runSummary',
        content: '',
        createdAt: '2026-07-28T10:01:42.000Z',
        details: {
          status: 'completed',
          durationMs: 5_000,
          fileChanges: {
            version: 2,
            capturedAt: '2026-07-28T10:01:42.000Z',
            counts: { changed: 1, additions: 4, deletions: 1 },
            workspaces: [
              {
                targetId: 'drone:d1',
                droneId: 'd1',
                label: 'Drone 1',
                counts: { changed: 1, additions: 4, deletions: 1 },
                previewEntries: [
                  { path: 'src/a.ts', status: 'modified', additions: 4, deletions: 1 },
                ],
              },
            ],
          },
        },
      },
    ]);

    const runs = assistantRequestRuns(items);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.toolItems.map((item) => item.call?.id)).toEqual(['call-1', 'call-2']);
    expect(runs[0]?.durationMs).toBe(5_000);
    expect(items[runs[0]!.fileSummaryItemIndex]).toMatchObject({
      type: 'runSummary',
      fileChanges: { counts: { changed: 1 } },
    });
  });

  test('uses durable segment duration for direct replies', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Hello', timestamp: 1_000 },
      {
        role: 'assistant',
        content: 'Hi',
        timestamp: 66_000,
        details: { runDurationMs: 2_500 },
      },
    ]);

    expect(directAssistantRunTiming(items, 0)).toEqual({
      startedAt: 1_000,
      endedAt: 66_000,
      durationMs: 2_500,
    });
  });

  test('keeps tool and file activity visible when history starts mid-request', () => {
    const items = renderItemsFromMessages([
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'apply_patch', arguments: {} }],
        timestamp: 2_000,
      },
      { role: 'toolResult', toolCallId: 'call-1', content: 'Done', timestamp: 3_000 },
      {
        role: 'runSummary',
        content: '',
        details: {
          durationMs: 1_500,
          fileChanges: {
            version: 2,
            capturedAt: '2026-07-28T10:00:03.000Z',
            counts: { changed: 1, additions: 1, deletions: 0 },
            workspaces: [
              {
                targetId: 'drone:d1',
                droneId: 'd1',
                label: 'Drone 1',
                counts: { changed: 1, additions: 1, deletions: 0 },
                previewEntries: [{ path: 'src/a.ts', status: 'added', additions: 1, deletions: 0 }],
              },
            ],
          },
        },
      },
    ]);

    expect(assistantRequestRuns(items)).toMatchObject([
      {
        userItemIndex: -1,
        firstToolItemIndex: 0,
        fileSummaryItemIndex: 1,
        durationMs: 1_500,
      },
    ]);
  });
});
