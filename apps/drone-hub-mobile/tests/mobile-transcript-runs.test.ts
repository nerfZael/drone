import { describe, expect, test } from 'bun:test';
import { renderItemsFromMessages, type AssistantMessage } from '@drone/assistant-chat';
import {
  groupMobileTranscriptRuns,
  mobileRunIsThinking,
  mobileRunDetails,
  normalizeMobileAgentPlan,
  workingDurationLabel,
} from '../src/local-assistant/mobile-transcript-runs';

describe('mobile transcript runs', () => {
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
            type: 'message',
            key: 'final-answer',
            sourceMessageIndex: 4,
            message: { role: 'assistant', content: 'Finished' },
          },
        ],
      }),
    ).toBe(false);
  });
});
