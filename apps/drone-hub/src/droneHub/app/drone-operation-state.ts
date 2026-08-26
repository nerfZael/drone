export type DroneOperationKind =
  | 'delete'
  | 'rename'
  | 'set-base-image'
  | 'start-container';

export type DroneOperationsById = Record<string, DroneOperationKind | undefined>;

export type DroneActionState = {
  operation: DroneOperationKind | null;
  busy: boolean;
  deleting: boolean;
  renaming: boolean;
  settingBaseImage: boolean;
  startingContainer: boolean;
};

export function droneActionState(
  operationsById: DroneOperationsById,
  droneId: string,
): DroneActionState {
  const operation = operationsById[droneId] ?? null;
  return {
    operation,
    busy: operation !== null,
    deleting: operation === 'delete',
    renaming: operation === 'rename',
    settingBaseImage: operation === 'set-base-image',
    startingContainer: operation === 'start-container',
  };
}

export function isDroneOperation(
  operationsById: DroneOperationsById,
  droneId: string,
  operation: DroneOperationKind,
): boolean {
  return operationsById[droneId] === operation;
}
