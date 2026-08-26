import { describe, expect, test } from 'bun:test';
import {
  claimDroneOperation,
  droneActionState,
  isDroneOperation,
  releaseDroneOperation,
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

  test('claims only idle drones without mutating the previous map', () => {
    const previous: DroneOperationsById = { other: 'delete' };
    const claimed = claimDroneOperation(previous, 'worker', 'reparent');

    expect(claimed).toEqual({ other: 'delete', worker: 'reparent' });
    expect(previous).toEqual({ other: 'delete' });
    expect(droneActionState(claimed!, 'worker')).toMatchObject({
      operation: 'reparent',
      busy: true,
    });
    expect(claimDroneOperation(claimed!, 'worker', 'rename')).toBeNull();
  });

  test('releases only the matching operation', () => {
    const operations: DroneOperationsById = { worker: 'reparent' };

    expect(releaseDroneOperation(operations, 'worker', 'rename')).toBe(operations);
    expect(releaseDroneOperation(operations, 'worker', 'reparent')).toEqual({});
    expect(operations).toEqual({ worker: 'reparent' });
  });
});
