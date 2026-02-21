import type { DroneSummary } from '../types';

export type GroupMultiChatColumnRuntimeState = {
  waitingForAgent: boolean;
  waitingSinceMs: number | null;
  lastResponseAtMs: number | null;
};

type SortGroupMultiChatDronesArgs = {
  drones: DroneSummary[];
  runtimeByDroneId: Record<string, GroupMultiChatColumnRuntimeState | undefined>;
  statusSortEnabled: boolean;
};

function normalizeMs(value: unknown): number | null {
  const raw = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(raw) ? raw : null;
}

function compareNullableAsc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a - b;
}

export function parseIsoDateMs(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortGroupMultiChatDrones({
  drones,
  runtimeByDroneId,
  statusSortEnabled,
}: SortGroupMultiChatDronesArgs): DroneSummary[] {
  if (!statusSortEnabled || drones.length < 2) return drones;

  const baseOrder = new Map<string, number>();
  for (let i = 0; i < drones.length; i += 1) {
    baseOrder.set(drones[i].id, i);
  }

  return [...drones].sort((a, b) => {
    const aRuntime = runtimeByDroneId[a.id];
    const bRuntime = runtimeByDroneId[b.id];

    const aWaiting = Boolean(aRuntime?.waitingForAgent);
    const bWaiting = Boolean(bRuntime?.waitingForAgent);
    if (aWaiting !== bWaiting) return aWaiting ? 1 : -1;

    if (aWaiting && bWaiting) {
      const byWaitingSince = compareNullableAsc(
        normalizeMs(aRuntime?.waitingSinceMs),
        normalizeMs(bRuntime?.waitingSinceMs),
      );
      if (byWaitingSince !== 0) return byWaitingSince;
    } else {
      const byLastResponse = compareNullableAsc(
        normalizeMs(aRuntime?.lastResponseAtMs),
        normalizeMs(bRuntime?.lastResponseAtMs),
      );
      if (byLastResponse !== 0) return byLastResponse;
    }

    return (baseOrder.get(a.id) ?? 0) - (baseOrder.get(b.id) ?? 0);
  });
}
