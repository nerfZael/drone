import { dvmLs } from '../host/dvm';
import { updateRegistry } from '../host/registry';
import { normalizeDroneRuntime } from '../host/runtime';

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

  return await updateRegistry((regAny: any) => {
    const removed: PrunedRegistryDrone[] = [];
    for (const [rawDroneId, droneEntry] of Object.entries(regAny?.drones ?? {}) as Array<[string, any]>) {
      if (!droneEntry || typeof droneEntry !== 'object') continue;

      // Future host-mode drones should not be pruned based on missing containers.
      const runtime = normalizeDroneRuntime((droneEntry as any)?.runtime);
      if (runtime === 'host') continue;

      const containerName = String(droneEntry?.containerName ?? '').trim();
      if (!containerName || existingContainers.has(containerName)) continue;

      const droneId = String(rawDroneId ?? '').trim() || containerName;
      const name = String(droneEntry?.name ?? '').trim() || droneId;
      delete regAny.drones[rawDroneId];
      removed.push({ id: droneId, name, containerName });
    }
    return removed;
  });
}
