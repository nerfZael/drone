import { dvmLs } from '../host/dvm';
import { loadRegistry } from '../host/registry';
import { normalizeDroneRuntime } from '../host/runtime';
import { listCanonicalDroneLifecycle } from './drone-lifecycle-service';
import { permanentlyDeleteCanonicalDrone } from './drone-deletion-service';

export type PrunedRegistryDrone = {
  id: string;
  name: string;
  containerName: string;
};

type PruneMissingRegistryDronesOptions = {
  listContainerNames?: () => Promise<string[]>;
};

export async function pruneMissingRegistryDrones(
  opts?: PruneMissingRegistryDronesOptions,
): Promise<PrunedRegistryDrone[]> {
  let knownContainerNames: string[] = [];
  try {
    knownContainerNames = await (opts?.listContainerNames ?? dvmLs)();
  } catch {
    // If Docker/DVM is unavailable, avoid destructive guesses.
    return [];
  }

  const existingContainers = new Set(
    knownContainerNames
      .map((name) => String(name ?? '').trim())
      .filter(Boolean),
  );

  const canonicalDrones = await listCanonicalDroneLifecycle('real');
  if (canonicalDrones) {
    const removed = canonicalDrones
      .filter((record) => record.runtimeKind !== 'host')
      .map((record) => ({
        record,
        containerName: String(record.containerName ?? '').trim(),
      }))
      .filter(({ containerName }) => containerName && !existingContainers.has(containerName))
      .map(({ record, containerName }) => ({ id: record.id, name: record.name, containerName }));

    for (const entry of removed) {
      await permanentlyDeleteCanonicalDrone({ droneId: entry.id, lifecycleState: 'real' });
    }
    return removed;
  }

  // Explicit native-binding fallback used by Bun tests only.
  const regAny: any = await loadRegistry();
  const removed: PrunedRegistryDrone[] = [];
  for (const [rawDroneId, droneEntry] of Object.entries(regAny?.drones ?? {}) as Array<[string, any]>) {
    if (!droneEntry || typeof droneEntry !== 'object') continue;

    // Future host-mode drones should not be pruned based on missing containers.
    const runtime = normalizeDroneRuntime((droneEntry as any)?.runtime);
    if (runtime === 'host') continue;

    const containerName = String(droneEntry?.containerName ?? '').trim();
    if (!containerName || existingContainers.has(containerName)) continue;

    const droneId = String((droneEntry as any)?.id ?? rawDroneId).trim() || containerName;
    const name = String(droneEntry?.name ?? '').trim() || droneId;
    await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'real' });
    removed.push({ id: droneId, name, containerName });
  }
  return removed;
}
