import { describe, expect, test } from 'bun:test';

import {
  agentRunActivityHasResponse,
  normalizeAgentRunActivity,
  settleAgentRunActivity,
} from '../src/agent-run-activity';

describe('agent run activity', () => {
  test('normalizes supported built-in agent activity', () => {
    expect(
      normalizeAgentRunActivity({
        version: 1,
        source: 'codex',
        updatedAt: '2026-07-24T10:00:00.000Z',
        messages: [{ role: 'assistant', content: 'Done.' }],
      }),
    ).toEqual({
      version: 1,
      source: 'codex',
      updatedAt: '2026-07-24T10:00:00.000Z',
      messages: [{ role: 'assistant', content: 'Done.' }],
    });
  });

  test('settles tool calls that ended without a result', () => {
    const activity = settleAgentRunActivity({
      version: 1,
      source: 'claude',
      updatedAt: '2026-07-24T10:00:00.000Z',
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'read_file',
              arguments: { path: 'README.md' },
            },
          ],
        },
      ],
    });

    expect(activity?.messages.at(-1)).toMatchObject({
      role: 'toolResult',
      toolCallId: 'tool-1',
      isError: true,
      errorMessage: 'Tool completion was not reported.',
    });
  });

  test('does not add a duplicate result for completed tool calls', () => {
    const activity = settleAgentRunActivity({
      version: 1,
      source: 'opencode',
      updatedAt: '2026-07-24T10:00:00.000Z',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: {} }],
        },
        {
          role: 'toolResult',
          toolCallId: 'tool-1',
          content: 'ok',
        },
      ],
    });

    expect(activity?.messages).toHaveLength(2);
  });

  test('distinguishes final responses from reasoning and tool-only activity', () => {
    expect(
      agentRunActivityHasResponse({
        version: 1,
        source: 'codex',
        updatedAt: '2026-07-24T10:00:00.000Z',
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Inspecting.' }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      agentRunActivityHasResponse({
        version: 1,
        source: 'codex',
        updatedAt: '2026-07-24T10:00:00.000Z',
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Finished.' }],
          },
        ],
      }),
    ).toBe(true);
  });
});
