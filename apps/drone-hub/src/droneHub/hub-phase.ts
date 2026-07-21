import type { DroneSummary } from './types';

export type HubPhase = DroneSummary['hubPhase'];

export function isDroneProvisioningPhase(hubPhase: string | null | undefined): boolean {
  return hubPhase === 'creating' || hubPhase === 'starting' || hubPhase === 'seeding';
}

export function droneProvisioningLabel(hubPhase: HubPhase | undefined): 'Creating' | 'Starting' | 'Seeding' {
  if (hubPhase === 'creating') return 'Creating';
  if (hubPhase === 'seeding') return 'Seeding';
  return 'Starting';
}
