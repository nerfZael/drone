import { describe, expect, test } from 'bun:test';
import {
  droneActionState,
  isDroneOperation,
  type DroneOperationKind,
  type DroneOperationsById,
} from '../src/droneHub/app/drone-operation-state';

describe('drone operation state', () => {
  test.each([
    ['delete', 'deleting'],
    ['rename', 'renaming'],
    ['set-base-image', 'settingBaseImage'],
    ['start-container', 'startingContainer'],
  ] as const)('derives the %s action state', (operation, flag) => {
    const operations: DroneOperationsById = { worker: operation };
    const state = droneActionState(operations, 'worker');

    expect(state.operation).toBe(operation);
    expect(state.busy).toBe(true);
    expect(state[flag]).toBe(true);
    expect(isDroneOperation(operations, 'worker', operation)).toBe(true);
  });

  test('keeps idle drones free of operation-specific flags', () => {
    const state = droneActionState({}, 'worker');
    const operationFlags: Array<keyof typeof state> = [
      'deleting',
      'renaming',
      'settingBaseImage',
      'startingContainer',
    ];

    expect(state.operation).toBeNull();
    expect(state.busy).toBe(false);
    expect(operationFlags.every((flag) => state[flag] === false)).toBe(true);
  });

  test('does not confuse one operation kind with another', () => {
    const operations: DroneOperationsById = { worker: 'rename' };
    const otherOperation: DroneOperationKind = 'delete';

    expect(isDroneOperation(operations, 'worker', otherOperation)).toBe(false);
  });
});
