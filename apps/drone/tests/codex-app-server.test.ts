import { describe, expect, test } from 'bun:test';

import {
  normalizeCodexAppServerItem,
  translateCodexAppServerNotification,
} from '../src/codex-app-server';

describe('Codex App Server event compatibility', () => {
  test('translates App Server items into the durable Codex transcript stream', () => {
    expect(
      translateCodexAppServerNotification({
        method: 'item/completed',
        params: {
          item: {
            id: 'command-1',
            type: 'commandExecution',
            command: 'npm test',
            aggregatedOutput: 'all green',
            exitCode: 0,
            status: 'completed',
          },
        },
      }),
    ).toEqual([
      {
        type: 'item.completed',
        item: expect.objectContaining({
          id: 'command-1',
          type: 'command_execution',
          aggregated_output: 'all green',
          exit_code: 0,
        }),
      },
    ]);
  });

  test('keeps separate streamed agent-message identities', () => {
    expect(
      translateCodexAppServerNotification({
        method: 'item/agentMessage/delta',
        params: { itemId: 'agent-message-2', delta: 'Final answer' },
      }),
    ).toEqual([
      {
        type: 'response.output_text.delta',
        item_id: 'agent-message-2',
        delta: 'Final answer',
      },
    ]);
  });

  test('preserves proposed plans and authoritative plan updates', () => {
    expect(
      normalizeCodexAppServerItem({ id: 'plan-message', type: 'plan', text: 'Proposed plan' }),
    ).toMatchObject({ id: 'plan-message', type: 'agent_message', text: 'Proposed plan' });
    expect(
      translateCodexAppServerNotification({
        method: 'turn/plan/updated',
        params: {
          turnId: 'turn-1',
          explanation: 'Updated after inspection',
          plan: [
            { step: 'Inspect', status: 'completed' },
            { step: 'Fix', status: 'inProgress' },
          ],
        },
      }),
    ).toEqual([
      {
        type: 'item.updated',
        item: {
          id: 'turn-plan-turn-1',
          type: 'todo_list',
          explanation: 'Updated after inspection',
          items: [
            { step: 'Inspect', status: 'completed' },
            { step: 'Fix', status: 'inProgress' },
          ],
        },
      },
    ]);
  });

  test('normalizes reasoning arrays and terminal failures', () => {
    expect(
      normalizeCodexAppServerItem({
        id: 'reasoning-1',
        type: 'reasoning',
        summary: ['First', 'Second'],
      }),
    ).toMatchObject({ summary: 'First\nSecond' });
    expect(
      translateCodexAppServerNotification({
        method: 'turn/completed',
        params: {
          turn: { id: 'turn-1', status: 'failed', error: { message: 'provider failed' } },
        },
      }),
    ).toEqual([{ type: 'error', message: 'provider failed' }]);
  });
});
