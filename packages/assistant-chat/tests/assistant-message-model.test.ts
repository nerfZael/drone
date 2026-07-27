import { describe, expect, test } from 'bun:test';
import { renderItemsFromMessages, toolActivityIsSettled } from '../src';

describe('assistant message model', () => {
  test('pairs tool calls with their results on every platform', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Read the file' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect it.' },
          { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'read_file',
        content: 'hello',
      },
      { role: 'assistant', content: 'The file says hello.' },
    ]);

    expect(items.map((item) => item.type)).toEqual(['message', 'message', 'tool', 'message']);
    expect(items[2]).toMatchObject({
      type: 'tool',
      call: { id: 'call_1', name: 'read_file' },
      result: { toolCallId: 'call_1' },
    });
  });

  test('groups consecutive repeated tool calls into one activity item', () => {
    const items = renderItemsFromMessages([
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: 'a' } },
          { type: 'toolCall', id: 'call_2', name: 'read_file', arguments: { path: 'b' } },
          { type: 'toolCall', id: 'call_3', name: 'read_file', arguments: { path: 'c' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call_1', toolName: 'read_file', content: 'a' },
      { role: 'toolResult', toolCallId: 'call_2', toolName: 'read_file', content: 'b' },
      { role: 'toolResult', toolCallId: 'call_3', toolName: 'read_file', content: 'c' },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'toolGroup', items: [{}, {}, {}] });
  });

  test('keeps reasoning-only model turns inside one tool run', () => {
    const items = renderItemsFromMessages([
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_1', name: 'list_files', arguments: { path: '.' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call_1', toolName: 'list_files', content: 'first' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should inspect the other folders.' },
          { type: 'toolCall', id: 'call_2', name: 'list_files', arguments: { path: 'a' } },
          { type: 'toolCall', id: 'call_3', name: 'list_files', arguments: { path: 'b' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'call_2', toolName: 'list_files', content: 'second' },
      { role: 'toolResult', toolCallId: 'call_3', toolName: 'list_files', content: 'third' },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'toolGroup', items: [{}, {}, {}] });
  });

  test('keeps every model/tool iteration for one prompt contiguous', () => {
    const toolTurn = (prefix: string, name: string, count: number) => ({
      role: 'assistant' as const,
      content: [
        { type: 'thinking' as const, thinking: `Planning ${prefix}` },
        ...Array.from({ length: count }, (_, index) => ({
          type: 'toolCall' as const,
          id: `${prefix}_${index}`,
          name,
          arguments: {},
        })),
      ],
    });
    const messages = [
      { role: 'user' as const, content: 'Read 10 files' },
      toolTurn('list-a', 'list_files', 3),
      toolTurn('list-b', 'list_files', 7),
      toolTurn('read', 'read_file', 10),
      { role: 'assistant' as const, content: 'Read 10 files.' },
    ];
    const items = renderItemsFromMessages(messages);
    const runItems = items.slice(1, -1);
    const callCount = runItems.reduce(
      (total, item) =>
        total + (item.type === 'toolGroup' ? item.items.length : item.type === 'tool' ? 1 : 0),
      0,
    );

    expect(items.map((item) => item.type)).toEqual([
      'message',
      'toolGroup',
      'toolGroup',
      'message',
    ]);
    expect(callCount).toBe(20);
  });

  test('distinguishes progress snapshots from settled tool results', () => {
    const tool = (details?: unknown, isError = false) => ({
      type: 'tool' as const,
      key: 'transfer',
      call: { id: 'transfer', name: 'transfer_files', args: {} },
      result: {
        role: 'toolResult' as const,
        toolCallId: 'transfer',
        content: '',
        details,
        isError,
      },
    });

    expect(toolActivityIsSettled({ ...tool(), result: undefined })).toBe(false);
    expect(toolActivityIsSettled(tool())).toBe(true);
    expect(
      toolActivityIsSettled(tool({ type: 'workspace_transfer', phase: 'transferring' })),
    ).toBe(false);
    expect(
      toolActivityIsSettled(tool({ type: 'workspace_transfer', phase: 'completed' })),
    ).toBe(true);
    expect(
      toolActivityIsSettled(tool({ type: 'workspace_transfer', phase: 'failed' }, true)),
    ).toBe(true);
  });

  test('renders persisted run file changes as a dedicated summary item', () => {
    const items = renderItemsFromMessages([
      { role: 'assistant', content: 'Done.' },
      {
        id: 'summary-1',
        role: 'runSummary',
        content: '',
        details: {
          fileChanges: {
            version: 2,
            capturedAt: '2026-07-21T00:00:00.000Z',
            counts: { changed: 1, additions: 2, deletions: 0 },
            workspaces: [
              {
                targetId: 'drone:d1',
                droneId: 'd1',
                label: 'Drone 1',
                counts: { changed: 1, additions: 2, deletions: 0 },
                previewEntries: [
                  { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 0 },
                ],
              },
            ],
          },
        },
      },
    ]);

    expect(items.map((item) => item.type)).toEqual(['message', 'runSummary']);
    expect(items[1]).toMatchObject({
      type: 'runSummary',
      key: 'run-summary:summary-1',
      fileChanges: { counts: { changed: 1, additions: 2, deletions: 0 } },
    });
  });

  test('renders a persisted compaction as a dedicated transcript item', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Continue the work' },
      {
        id: 'compact-1',
        role: 'compaction',
        content: '',
        timestamp: '2026-07-27T10:00:00.000Z',
        details: {
          summaryId: 'compact-1',
          trigger: 'auto',
          tokensBefore: 90_000,
          tokensAfter: 24_000,
          fallbackUsed: true,
          fallbackReason: 'Provider summary timed out',
        },
      },
      { role: 'assistant', content: 'Done.' },
    ]);

    expect(items.map((item) => item.type)).toEqual(['message', 'compaction', 'message']);
    expect(items[1]).toMatchObject({
      type: 'compaction',
      key: 'compaction:compact-1',
      details: {
        trigger: 'auto',
        tokensBefore: 90_000,
        tokensAfter: 24_000,
        fallbackUsed: true,
      },
      timestamp: '2026-07-27T10:00:00.000Z',
    });
  });

  test('rejects malformed compaction metadata instead of coercing it', () => {
    const items = renderItemsFromMessages([
      {
        role: 'compaction',
        content: '',
        details: {
          summaryId: 'compact-1',
          trigger: 'sometimes',
          tokensBefore: '90000',
          tokensAfter: 24_000,
        },
      },
    ]);

    expect(items).toEqual([]);
  });
});
