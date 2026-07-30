import { describe, expect, test } from 'bun:test';
import { normalizeAgentPlan, sameAgentPlan } from '../src';

describe('agent plan model', () => {
  test('normalizes provider payload aliases and statuses', () => {
    expect(
      normalizeAgentPlan(
        {
          todos: [
            'Inspect the repository',
            { content: 'Run tests', todo_id: 'test', status: 'done' },
            { title: 'Open the pull request', todoId: 'pr', status: 'running' },
            { task: 'Retired step', status: 'skipped' },
            { text: 'Explicit completion wins', status: 'pending', completed: true },
          ],
        },
        'claude',
        '2026-07-29T12:00:00.000Z',
      ),
    ).toEqual({
      source: 'claude',
      updatedAt: '2026-07-29T12:00:00.000Z',
      items: [
        { text: 'Inspect the repository', status: 'pending' },
        { id: 'test', text: 'Run tests', status: 'completed' },
        { id: 'pr', text: 'Open the pull request', status: 'in_progress' },
        { text: 'Retired step', status: 'cancelled' },
        { text: 'Explicit completion wins', status: 'completed' },
      ],
    });
  });

  test('supports update_plan aliases and preserves the Hub bounds', () => {
    const plan = normalizeAgentPlan({
      source: 'CODEX',
      updatedAt: '2026-07-29T12:00:00.000Z',
      plan: Array.from({ length: 55 }, (_, index) => ({
        step: `${index}:${'x'.repeat(1_100)}`,
        status: index === 0 ? 'in-progress' : 'unknown',
      })),
    });

    expect(plan?.source).toBe('codex');
    expect(plan?.updatedAt).toBe('2026-07-29T12:00:00.000Z');
    expect(plan?.items).toHaveLength(50);
    expect(plan?.items[0]?.status).toBe('in_progress');
    expect(plan?.items[0]?.text).toHaveLength(1_000);
    expect(plan?.items[49]?.status).toBe('pending');
  });

  test('compares semantic content without treating capture time as a plan change', () => {
    const left = {
      source: 'codex',
      updatedAt: '2026-07-29T12:00:00.000Z',
      items: [{ text: 'Run tests', status: 'pending' }],
    };
    const right = { ...left, updatedAt: '2026-07-29T12:00:01.000Z' };

    expect(sameAgentPlan(left, right)).toBe(true);
    expect(
      sameAgentPlan(left, {
        ...right,
        items: [{ text: 'Run tests', status: 'completed' }],
      }),
    ).toBe(false);
    expect(sameAgentPlan(left, { ...right, source: 'claude' })).toBe(false);
  });
});
