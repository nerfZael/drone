export type SidebarDroneMutationQueue = {
  enqueue<T>(droneIds: readonly string[], task: () => Promise<T>): Promise<T>;
};

function normalizeDroneIds(droneIds: readonly string[]): string[] {
  return Array.from(
    new Set(droneIds.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)),
  );
}

export function createSidebarDroneMutationQueue(): SidebarDroneMutationQueue {
  const tailByDroneId = new Map<string, Promise<void>>();

  return {
    enqueue<T>(droneIdsRaw: readonly string[], task: () => Promise<T>): Promise<T> {
      const droneIds = normalizeDroneIds(droneIdsRaw);
      const priorTails = droneIds
        .map((droneId) => tailByDroneId.get(droneId))
        .filter((tail): tail is Promise<void> => Boolean(tail));
      const result = Promise.all(priorTails).then(task);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );

      for (const droneId of droneIds) tailByDroneId.set(droneId, tail);
      void tail.then(() => {
        for (const droneId of droneIds) {
          if (tailByDroneId.get(droneId) === tail) tailByDroneId.delete(droneId);
        }
      });
      return result;
    },
  };
}
