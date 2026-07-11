import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentPlanList } from '../src/droneHub/chat/AgentPlanList';

describe('AgentPlanList', () => {
  test('shows progress and strikes completed work', () => {
    const html = renderToStaticMarkup(
      <AgentPlanList
        running
        plan={{
          source: 'claude',
          updatedAt: '2026-07-11T12:00:00.000Z',
          items: [
            { text: 'Inspect the parser', status: 'completed' },
            { text: 'Update the UI', status: 'in_progress' },
            { text: 'Run tests', status: 'pending' },
          ],
        }}
      />,
    );

    expect(html).toContain('Claude plan');
    expect(html).toContain('1/3');
    expect(html).toContain('Inspect the parser');
    expect(html).toContain('line-through');
    expect(html).toContain('Update the UI');
    expect(html).toContain('animate-spin');
  });

  test('renders nothing without a published plan', () => {
    expect(renderToStaticMarkup(<AgentPlanList />)).toBe('');
  });

  test('limits long plans and does not animate completed transcript plans', () => {
    const html = renderToStaticMarkup(
      <AgentPlanList
        plan={{
          source: 'cursor',
          updatedAt: '2026-07-11T12:00:00.000Z',
          items: Array.from({ length: 10 }, (_, index) => ({
            text: `Step ${index + 1}`,
            status: index === 0 ? 'in_progress' as const : 'pending' as const,
          })),
        }}
      />,
    );

    expect(html).toContain('Show 2 more');
    expect(html).toContain('Step 8');
    expect(html).not.toContain('Step 9');
    expect(html).not.toContain('animate-spin');
    expect(html).toContain('In progress:');
  });
});
