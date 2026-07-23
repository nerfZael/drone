import { describe, expect, test } from 'bun:test';

import { isWorkflowChildDrone } from '../src/droneHub/workflows/workflow-drone-visibility';

describe('workflow child drone visibility', () => {
  test('recognizes workflow-owned child drones without hiding ordinary fleet children', () => {
    expect(
      isWorkflowChildDrone({
        workflowChild: {
          ownerDroneId: 'owner',
          workflowId: 'workflow',
          runId: 'run',
          invocationId: 'invocation',
        },
      } as any),
    ).toBe(true);
    expect(isWorkflowChildDrone({ fleetParentId: 'owner' } as any)).toBe(false);
  });
});
