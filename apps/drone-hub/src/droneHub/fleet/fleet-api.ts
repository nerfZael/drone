import { requestJson } from '../http';

export type FleetActorPayload = {
  ok: true;
  actor: { id: string; name: string };
  relationships: {
    children: Array<{ id: string; name: string; kind: 'real' | 'pending'; phase?: string | null }>;
    assigned: Array<{ id: string; name: string; kind: 'real' | 'pending' }>;
  };
  availableTargets: Array<{ id: string; name: string; assigned: boolean; child: boolean }>;
};

function normalizeAssignableTargetIds(ownerDroneId: string, targetDroneIdsRaw: string[]): string[] {
  return Array.from(
    new Set(
      targetDroneIdsRaw
        .map((item) => String(item ?? '').trim())
        .filter((item) => item && item !== ownerDroneId),
    ),
  );
}

export async function fetchFleetActor(droneIdRaw: string): Promise<FleetActorPayload> {
  const droneId = String(droneIdRaw ?? '').trim();
  return requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(droneId)}`);
}

export async function assignFleetTargets(
  ownerDroneIdRaw: string,
  targetDroneIdsRaw: string[],
): Promise<FleetActorPayload | null> {
  const ownerDroneId = String(ownerDroneIdRaw ?? '').trim();
  if (!ownerDroneId) return null;
  const targetDroneIds = normalizeAssignableTargetIds(ownerDroneId, targetDroneIdsRaw);
  if (targetDroneIds.length === 0) return null;
  let latest: FleetActorPayload | null = null;
  for (const targetId of targetDroneIds) {
    latest = await requestJson<FleetActorPayload>(`/api/fleet/actors/${encodeURIComponent(ownerDroneId)}/assigned`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: targetId }),
    });
  }
  return latest;
}
