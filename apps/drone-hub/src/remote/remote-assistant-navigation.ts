import type { DroneSummary } from '../droneHub/types';

export function canOpenRemoteAssistantDrone(
  drones: Array<Pick<DroneSummary, 'id' | 'runtime'>>,
  droneIdRaw: unknown,
): boolean {
  const droneId = String(droneIdRaw ?? '').trim();
  return Boolean(droneId && drones.some((drone) => drone.id === droneId && drone.runtime !== 'host'));
}
