import { describe, expect, test } from 'bun:test';

import {
  buildWorkflowNodeExecutionMap,
  workflowCallsForAgent,
  workflowFitViewport,
  workflowRunAgentGroups,
} from '../src/droneHub/workflows/WorkflowDefinitionView';
import { buildWorkflowGraphLayout } from '../src/droneHub/workflows/workflow-graph-layout';
import type {
  DroneWorkflow,
  WorkflowInvocation,
} from '../src/droneHub/workflows/workflow-types';

const workflow: DroneWorkflow = {
  id: 'research-brief',
  droneId: 'owner',
  name: 'Research brief',
  description: 'Plan, research, and edit a brief.',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  definition: {
    version: 1,
    agents: {
      analyst: {
        runner: {
          kind: 'drone-chat',
          agent: { kind: 'builtin', id: 'blip' },
        },
        permissions: ['read'],
        instructions: 'Analyze the assigned question.',
      },
    },
    phases: [
      {
        id: 'plan',
        label: 'Plan questions',
        run: {
          id: 'plan_questions',
          type: 'call',
          agent: 'analyst',
          prompt: 'Create a question list.',
        },
      },
      {
        id: 'analyze',
        label: 'Analyze questions',
        run: {
          id: 'analysis_loop',
          type: 'forEach',
          itemsFrom: 'plan_questions.output',
          maxItems: 8,
          parallelism: 3,
          body: {
            id: 'analyze_task',
            type: 'call',
            agent: 'analyst',
            prompt: 'Answer one question.',
          },
        },
      },
      {
        id: 'edit',
        label: 'Edit brief',
        run: {
          id: 'write_brief',
          type: 'call',
          agent: 'analyst',
          prompt: 'Synthesize the final brief.',
        },
      },
    ],
  },
};

function invocation(
  ordinal: number,
  phaseId: string,
  nodeId: string,
  status: WorkflowInvocation['status'],
): WorkflowInvocation {
  return {
    id: `invocation-${ordinal}`,
    ordinal,
    runtimePath: `${phaseId}/${nodeId}/${ordinal}`,
    phaseId,
    nodeId,
    agentSnapshot: {
      runner: {
        kind: 'drone-chat',
        agent: { kind: 'builtin', id: 'blip' },
      },
      permissions: ['read'],
    },
    executionDroneId: 'owner',
    childDroneId: null,
    chatId: `chat-${ordinal}`,
    lastChatName: `Question ${ordinal}`,
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: status === 'running' ? null : '2026-01-01T00:00:10.000Z',
    textResult: null,
    structuredResult: null,
    error: null,
  };
}

describe('workflow graph', () => {
  test('keeps phases in execution order from left to right', () => {
    const layout = buildWorkflowGraphLayout(workflow);

    expect(layout.phaseRegions.map((region) => region.y)).toEqual([24, 24, 24]);
    expect(layout.phaseRegions[0]!.x).toBeLessThan(layout.phaseRegions[1]!.x);
    expect(layout.phaseRegions[1]!.x).toBeLessThan(layout.phaseRegions[2]!.x);
    expect(layout.edges.filter((edge) => edge.variant === 'phase')).toHaveLength(2);
    expect(layout.nodes.some((node) => node.type === 'phase')).toBe(false);
    expect(layout.nodes).toHaveLength(4);
  });

  test('aggregates repeated call executions into their iterator', () => {
    const layout = buildWorkflowGraphLayout(workflow);
    const execution = buildWorkflowNodeExecutionMap(layout, [
      invocation(1, 'analyze', 'analyze_task', 'completed'),
      invocation(2, 'analyze', 'analyze_task', 'running'),
      invocation(3, 'analyze', 'analyze_task', 'queued'),
    ]);
    const loop = layout.nodes.find((node) => node.sourceId === 'analysis_loop')!;
    const call = layout.nodes.find((node) => node.sourceId === 'analyze_task')!;

    expect(execution.get(loop.key)).toMatchObject({ status: 'running' });
    expect(execution.get(call.key)).toMatchObject({ status: 'running' });
    expect(execution.get(loop.key)?.invocations).toHaveLength(3);
  });

  test('links agent definitions to every call that uses them', () => {
    const layout = buildWorkflowGraphLayout(workflow);

    expect(workflowCallsForAgent(layout, 'analyst').map((node) => node.sourceId)).toEqual([
      'plan_questions',
      'analyze_task',
      'write_brief',
    ]);
    expect(workflowCallsForAgent(layout, 'missing')).toEqual([]);
  });

  test('groups run conversations under their configured workflow agent', () => {
    const layout = buildWorkflowGraphLayout(workflow);
    const invocations = [
      invocation(1, 'plan', 'plan_questions', 'completed'),
      invocation(2, 'analyze', 'analyze_task', 'completed'),
      invocation(3, 'analyze', 'analyze_task', 'running'),
    ];
    const groups = workflowRunAgentGroups(workflow, layout, invocations);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.agentId).toBe('analyst');
    expect(groups[0]?.calls.map((call) => call.sourceId)).toEqual([
      'plan_questions',
      'analyze_task',
      'write_brief',
    ]);
    expect(groups[0]?.invocations.map((item) => item.id)).toEqual([
      'invocation-1',
      'invocation-2',
      'invocation-3',
    ]);
  });

  test('anchors a fitted workflow near the top of a tall canvas', () => {
    const viewport = workflowFitViewport({
      viewportWidth: 1200,
      viewportHeight: 900,
      graphWidth: 1100,
      graphHeight: 440,
    });

    expect(viewport.panY).toBe(28);
    expect(viewport.panX).toBeGreaterThanOrEqual(28);
  });
});
