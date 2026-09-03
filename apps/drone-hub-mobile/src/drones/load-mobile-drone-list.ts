import {
  normalizeMobileDroneListPayload,
  type NormalizedMobileDroneListPayload,
} from './drone-sidebar-model';

type RequestDroneList = (
  destinationId: string,
  operation: 'drones.list',
  payload: { includeCreateOptions: boolean },
) => Promise<unknown>;

export async function loadMobileDroneList(
  request: RequestDroneList,
  targetId: string,
  quiet: boolean,
): Promise<NormalizedMobileDroneListPayload> {
  const result = await request(targetId, 'drones.list', {
    includeCreateOptions: !quiet,
  });
  if (
    !result ||
    typeof result !== 'object' ||
    !Array.isArray((result as { drones?: unknown }).drones)
  ) {
    throw new Error('The selected Drone Hub returned an invalid drone list');
  }
  return normalizeMobileDroneListPayload(result);
}
