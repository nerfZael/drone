import type { DroneSummary } from '../types';

export function isWorkflowChildDrone(drone: DroneSummary | null | undefined): boolean {
  return Boolean(drone?.workflowChild);
}
