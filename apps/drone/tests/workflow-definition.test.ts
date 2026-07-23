import { describe, expect, test } from 'bun:test';

import {
  mapWorkflowPermissionsToBlip,
  workflowPermissionIssue,
} from '../src/hub/workflows/workflow-permissions';
import {
  isWorkflowChildDroneEntry,
  workflowChildDroneMetadata,
} from '../src/hub/workflows/workflow-child-drone-metadata';
import {
  parseWorkflowDefinition,
  readWorkflowJsonPointer,
  validateWorkflowJsonSchema,
} from '../src/hub/workflows/workflow-validator';

function definition() {
  return {
    version: 1 as const,
    agents: {
      reviewer: {
        runner: {
          kind: 'drone-chat' as const,
          agent: { kind: 'builtin' as const, id: 'blip' as const },
        },
        permissions: ['workspace:read' as const],
        instructions: 'Review the selected code.',
      },
    },
    phases: [
      {
        id: 'review',
        run: {
          id: 'inspect',
          type: 'call' as const,
          agent: 'reviewer',
          prompt: 'Inspect the implementation.',
          outputSchema: {
            type: 'object' as const,
            properties: { approved: { type: 'boolean' as const } },
            required: ['approved'],
            additionalProperties: false as const,
          },
        },
      },
    ],
    outputFrom: 'review.inspect',
  };
}

describe('workflow definitions', () => {
  test('accepts the strict version-one definition without adding count limits', () => {
    const input: any = definition();
    input.phases[0].run.contextFrom = [
      { source: 'input', path: '/target', as: 'selected_target', optional: true },
    ];
    const parsed = parseWorkflowDefinition(input);
    expect(parsed.limits).toBeUndefined();
    expect(parsed.agents.reviewer.permissions).toEqual(['workspace:read']);
    expect((parsed.phases[0].run as any).contextFrom[0].as).toBe('selected_target');
  });

  test('rejects unknown result references and duplicate node ids', () => {
    const input: any = definition();
    input.phases[0].run = {
      id: 'group',
      type: 'sequence',
      children: [
        { id: 'same', type: 'call', agent: 'reviewer', prompt: 'One' },
        {
          id: 'same',
          type: 'call',
          agent: 'reviewer',
          prompt: 'Two',
          contextFrom: [{ source: 'result', result: 'review.missing' }],
        },
      ],
    };
    expect(() => parseWorkflowDefinition(input)).toThrow('duplicate node id');
  });

  test('rejects results that are not available in execution order', () => {
    const forward: any = definition();
    forward.phases[0].run = {
      id: 'steps',
      type: 'sequence',
      children: [
        {
          id: 'first',
          type: 'call',
          agent: 'reviewer',
          prompt: 'First',
          contextFrom: [{ source: 'result', result: 'review.second' }],
        },
        { id: 'second', type: 'call', agent: 'reviewer', prompt: 'Second' },
      ],
    };
    forward.outputFrom = 'review.steps';
    expect(() => parseWorkflowDefinition(forward)).toThrow(
      'workflow result is not available at this point: review.second',
    );

    const parallelSibling: any = definition();
    parallelSibling.phases[0].run = {
      id: 'branches',
      type: 'parallel',
      children: [
        { id: 'left', type: 'call', agent: 'reviewer', prompt: 'Left' },
        {
          id: 'right',
          type: 'call',
          agent: 'reviewer',
          prompt: 'Right',
          contextFrom: [{ source: 'result', result: 'review.left' }],
        },
      ],
    };
    parallelSibling.outputFrom = 'review.branches';
    expect(() => parseWorkflowDefinition(parallelSibling)).toThrow(
      'workflow result is not available at this point: review.left',
    );
  });

  test('allows optional conditional and prior-repeat-iteration results', () => {
    const input: any = definition();
    input.phases[0].run = {
      id: 'steps',
      type: 'sequence',
      children: [
        {
          id: 'choice',
          type: 'if',
          condition: { op: 'truthy', value: { source: 'input', path: '/enabled' } },
          then: { id: 'conditional', type: 'call', agent: 'reviewer', prompt: 'Conditional' },
        },
        {
          id: 'after',
          type: 'call',
          agent: 'reviewer',
          prompt: 'After',
          contextFrom: [
            {
              source: 'result',
              result: 'review.conditional',
              optional: true,
            },
          ],
        },
        {
          id: 'loop',
          type: 'repeat',
          maxIterations: 2,
          until: { op: 'truthy', value: { source: 'result', result: 'review.later' } },
          body: {
            id: 'loop_steps',
            type: 'sequence',
            children: [
              {
                id: 'earlier',
                type: 'call',
                agent: 'reviewer',
                prompt: 'Earlier',
                contextFrom: [
                  {
                    source: 'result',
                    result: 'review.later',
                    optional: true,
                  },
                ],
              },
              { id: 'later', type: 'call', agent: 'reviewer', prompt: 'Later' },
            ],
          },
        },
      ],
    };
    input.outputFrom = 'review.steps';

    expect(parseWorkflowDefinition(input).outputFrom).toBe('review.steps');
  });

  test('maps permissions to the frozen Blip profiles', () => {
    expect(mapWorkflowPermissionsToBlip(['workspace:read'])).toEqual({
      permissionMode: 'read-only',
      toolProfile: 'read-only',
    });
    expect(mapWorkflowPermissionsToBlip(['workspace:read', 'workspace:write'])).toEqual({
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    });
    expect(workflowPermissionIssue(['workspace:read', 'process:execute'])).toContain(
      'requires workspace:write',
    );
  });

  test('supports Codex and child-drone runners without weakening permissions', () => {
    const codex: any = definition();
    codex.agents.reviewer = {
      runner: {
        kind: 'drone',
        agent: { kind: 'builtin', id: 'codex' },
      },
      permissions: ['workspace:read', 'workspace:write', 'process:execute'],
      instructions: 'Implement the requested change.',
    };
    expect(parseWorkflowDefinition(codex).agents.reviewer.runner).toEqual({
      kind: 'drone',
      agent: { kind: 'builtin', id: 'codex' },
    });

    codex.agents.reviewer.permissions = ['workspace:read', 'workspace:write'];
    expect(() => parseWorkflowDefinition(codex)).toThrow(
      'Codex workflow agents require process:execute',
    );
  });

  test('reads JSON pointers and validates closed object output', () => {
    expect(readWorkflowJsonPointer({ nested: ['value'] }, '/nested/0')).toEqual({
      found: true,
      value: 'value',
    });
    expect(
      validateWorkflowJsonSchema(
        {
          type: 'object',
          properties: { approved: { type: 'boolean' } },
          required: ['approved'],
          additionalProperties: false,
        },
        { approved: true, extra: 'nope' },
      ),
    ).toEqual(['$.extra is not allowed']);
  });

  test('recognizes only complete workflow child-drone metadata', () => {
    const workflowChild = {
      ownerDroneId: 'owner',
      workflowId: 'workflow',
      runId: 'run',
      invocationId: 'invocation',
    };
    expect(isWorkflowChildDroneEntry({ workflowChild })).toBe(true);
    expect(workflowChildDroneMetadata({ workflowChild })).toEqual(workflowChild);
    expect(isWorkflowChildDroneEntry({ workflowChild: { ownerDroneId: 'owner' } })).toBe(false);
  });
});
