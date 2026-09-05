import {
  normalizeMobileDroneListPayload,
  type NormalizedMobileDroneListPayload,
} from './drone-sidebar-model';

type RequestDroneList = (
  destinationId: string,
  operation: 'drones.list',
  payload: { includeCreateOptions: boolean },
  signal?: AbortSignal,
) => Promise<unknown>;

export async function loadMobileDroneList(
  request: RequestDroneList,
  targetId: string,
  quiet: boolean,
  signal?: AbortSignal,
): Promise<NormalizedMobileDroneListPayload> {
  const result = await request(
    targetId,
    'drones.list',
    {
      includeCreateOptions: !quiet,
    },
    signal,
  );
  if (
    !result ||
    typeof result !== 'object' ||
    !Array.isArray((result as { drones?: unknown }).drones)
  ) {
    throw new Error('The selected Drone Hub returned an invalid drone list');
  }
  return normalizeMobileDroneListPayload(result);
}
