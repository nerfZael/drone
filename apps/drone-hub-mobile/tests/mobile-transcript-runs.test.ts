import { describe, expect, test } from 'bun:test';
import { renderItemsFromMessages, type AssistantMessage } from '@drone/assistant-chat';
import {
  groupMobileTranscriptRuns,
  limitMobileRunToolItems,
  mobileRunIsThinking,
  mobileRunDetails,
  normalizeMobileAgentPlan,
  partitionMobileRunItems,
  sortMobileTranscriptTimeline,
  workingDurationLabel,
} from '../src/local-assistant/mobile-transcript-runs';

describe('mobile transcript runs', () => {
  test('keeps only the five latest tool calls in an automatic live expansion', () => {
    const items = [
      {
        type: 'message' as const,
        key: 'progress',
        sourceMessageIndex: 0,
        message: { role: 'assistant' as const, content: 'Progress' },
      },
      {
        type: 'toolGroup' as const,
        key: 'reads',
        items: Array.from({ length: 4 }, (_, index) => ({
          type: 'tool' as const,
          key: `read-${index + 1}`,
          call: { id: `read-${index + 1}`, name: 'read_file', args: {} },
        })),
      },
      ...Array.from({ length: 3 }, (_, index) => ({
        type: 'tool' as const,
        key: `write-${index + 1}`,
        call: { id: `write-${index + 1}`, name: 'write_file', args: {} },
      })),
    ];

    const visible = limitMobileRunToolItems(items);
    expect(visible[0]).toMatchObject({ type: 'message', key: 'progress' });
    expect(
      visible
        .flatMap((item) => (item.type === 'toolGroup' ? item.items : [item]))
        .map((item) => item.key),
    ).toEqual(['progress', 'read-3', 'read-4', 'write-1', 'write-2', 'write-3']);
  });

  test('groups a user turn with its tool calls and completed response', () => {
    const messages: AssistantMessage[] = [
      { role: 'user', content: 'Inspect it', createdAt: '2026-07-20T10:00:00.000Z' },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'README.md' } },
        ],
        createdAt: '2026-07-20T10:00:01.000Z',
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read_file',
        content: 'contents',
        createdAt: '2026-07-20T10:00:02.000Z',
      },
      { role: 'assistant', content: 'Done', createdAt: '2026-07-20T10:00:04.000Z' },
    ];

    const groups = groupMobileTranscriptRuns(renderItemsFromMessages(messages));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      type: 'run',
      toolCallCount: 1,
      startedAt: '2026-07-20T10:00:00.000Z',
      completedAt: '2026-07-20T10:00:04.000Z',
      active: false,
    });
  });

  test('uses durable active time across approval continuations', () => {
    const groups = groupMobileTranscriptRuns(
      renderItemsFromMessages([
        { role: 'user', content: 'Implement it', timestamp: 1_000 },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} }],
          timestamp: 2_000,
          details: { runDurationMs: 1_200 },
        },
        { role: 'toolResult', toolCallId: 'call-1', content: 'Done', timestamp: 3_000 },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-2', name: 'apply_patch', arguments: {} }],
          timestamp: 100_000,
        },
        { role: 'toolResult', toolCallId: 'call-2', content: 'Done', timestamp: 101_000 },
        {
          role: 'assistant',
          content: 'Finished',
          timestamp: 102_000,
          details: { runDurationMs: 2_000 },
        },
      ]),
    );

    expect(groups).toMatchObject([
      {
        type: 'run',
        toolCallCount: 2,
        durationMs: 2_000,
        startedAt: 1_000,
        completedAt: 102_000,
      },
    ]);
  });

  test('keeps the final answer outside collapsed completed activity', () => {
    const items = renderItemsFromMessages([
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Inspecting the repository.' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'command_execution',
            arguments: { command: 'git status' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: 'clean',
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Everything is clean.' }],
      },
    ]);

    const partition = partitionMobileRunItems({ active: false, items });
    expect(partition.activityItems.map((item) => item.type)).toEqual(['message', 'tool']);
    expect(partition.trailingItems).toHaveLength(1);
    expect(partition.trailingItems[0]).toMatchObject({
      type: 'message',
      message: { role: 'assistant' },
    });
  });

  test('keeps context compaction visible outside collapsed run activity', () => {
    const [run] = groupMobileTranscriptRuns(
      renderItemsFromMessages([
        { role: 'user', content: 'Keep going', timestamp: 1_000 },
        {
          id: 'compaction-1',
          role: 'compaction',
          timestamp: 2_000,
          details: {
            summaryId: 'summary-1',
            trigger: 'auto',
            tokensBefore: 90_000,
            tokensAfter: 24_000,
          },
        },
        { role: 'assistant', content: 'Done', timestamp: 3_000 },
      ]),
    );

    expect(run).toMatchObject({ type: 'run', completedAt: 3_000 });
    if (run?.type !== 'run') throw new Error('Expected a transcript run');
    const partition = partitionMobileRunItems(run);
    expect(partition.activityItems).toEqual([]);
    expect(partition.trailingItems.map((item) => item.type)).toEqual(['compaction', 'message']);
  });

  test('keeps the latest run active unless a separate pending prompt owns the working row', () => {
    const items = renderItemsFromMessages([
      { role: 'user', content: 'Keep going', timestamp: 1_000 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} }],
        timestamp: 2_000,
      },
    ]);
    expect(groupMobileTranscriptRuns(items, { running: true })[0]).toMatchObject({
      type: 'run',
      active: true,
      completedAt: undefined,
    });
    expect(
      groupMobileTranscriptRuns(items, { running: true, hasSeparateActivePrompt: true })[0],
    ).toMatchObject({ type: 'run', active: false });
  });

  test('uses the latest update_plan tool call as the visible plan', () => {
    const groups = groupMobileTranscriptRuns(
      renderItemsFromMessages([
        { role: 'user', content: 'Ship it', timestamp: 1_000 },
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'plan-1',
              name: 'update_plan',
              arguments: {
                plan: [
                  { step: 'Inspect files', status: 'completed' },
                  { step: 'Make the change', status: 'in_progress' },
                ],
              },
            },
          ],
          timestamp: 2_000,
        },
      ]),
      { running: true },
    );
    expect(groups[0]).toMatchObject({
      type: 'run',
      plan: {
        items: [
          { text: 'Inspect files', status: 'completed' },
          { text: 'Make the change', status: 'in_progress' },
        ],
      },
    });
  });

  test('accepts external-agent plan metadata and matches desktop duration formatting', () => {
    const plan = normalizeMobileAgentPlan({
      items: [{ id: 'one', text: 'Review output', status: 'completed' }],
      source: 'codex',
    });
    const groups = groupMobileTranscriptRuns(
      renderItemsFromMessages([
        { role: 'user', content: 'Review it', timestamp: 1_000 },
        {
          role: 'assistant',
          content: 'Reviewed',
          timestamp: 63_000,
          details: mobileRunDetails({ plan }),
        },
      ]),
    );
    expect(groups[0]).toMatchObject({ type: 'run', plan });
    expect(workingDurationLabel(3_661_000)).toBe('1h 1m 1s');
  });

  test('shows thinking only after active tools have genuinely settled', () => {
    const completedTool = {
      type: 'tool' as const,
      key: 'completed-tool',
      call: { id: 'completed-call', name: 'read_file', args: {} },
      result: { role: 'toolResult' as const, toolCallId: 'completed-call', content: 'Done' },
    };
    const pendingTool = {
      type: 'tool' as const,
      key: 'pending-tool',
      call: { id: 'pending-call', name: 'read_file', args: {} },
    };
    const transferringTool = {
      type: 'tool' as const,
      key: 'transferring-tool',
      call: { id: 'transfer-call', name: 'transfer_files', args: {} },
      result: {
        role: 'toolResult' as const,
        toolCallId: 'transfer-call',
        content: 'Transferring',
        details: { type: 'workspace_transfer', phase: 'transferring' },
      },
    };

    expect(mobileRunIsThinking({ active: true, items: [completedTool] })).toBe(true);
    expect(mobileRunIsThinking({ active: true, items: [pendingTool] })).toBe(false);
    expect(mobileRunIsThinking({ active: true, items: [transferringTool] })).toBe(false);
    expect(
      mobileRunIsThinking({
        active: true,
        items: [{ type: 'toolGroup', key: 'transfers', items: [transferringTool] }],
      }),
    ).toBe(false);
    expect(mobileRunIsThinking({ active: false, items: [completedTool] })).toBe(false);
    expect(
      mobileRunIsThinking({
        active: true,
        items: [
          completedTool,
          {
            type: 'runSummary',
            key: 'changed-files',
            fileChanges: {
              version: 2,
              capturedAt: '2026-07-24T00:00:02.000Z',
              counts: { changed: 1, additions: 1, deletions: 0 },
              workspaces: [],
            },
          },
        ],
      }),
    ).toBe(true);
    expect(
      mobileRunIsThinking({
        active: true,
        items: [
          completedTool,
          {
            type: 'message',
            key: 'final-answer',
            sourceMessageIndex: 4,
            message: { role: 'assistant', content: 'Finished' },
          },
        ],
      }),
    ).toBe(false);
  });

  test('places a historical stopped run at its original transcript time', () => {
    const timeline = sortMobileTranscriptTimeline([
      { label: 'newer run', atMs: Date.parse('2026-07-20T10:02:00.000Z'), order: 1 },
      { label: 'stopped run', atMs: Date.parse('2026-07-20T10:01:00.000Z'), order: 2 },
      { label: 'older run', atMs: Date.parse('2026-07-20T10:00:00.000Z'), order: 0 },
    ]);

    expect(timeline.map((entry) => entry.label)).toEqual(['older run', 'stopped run', 'newer run']);
  });
});
