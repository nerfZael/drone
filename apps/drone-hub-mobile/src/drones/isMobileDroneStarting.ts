import type { MobileDroneSummary } from './drone-sidebar-model';

export function isMobileDroneStarting(drone: Pick<MobileDroneSummary, 'phase'>): boolean {
  return MOBILE_DRONE_STARTING_PHASES.has(drone.phase.trim().toLowerCase());
}

const MOBILE_DRONE_STARTING_PHASES = new Set(['starting', 'creating', 'seeding']);
