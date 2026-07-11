import { loadRegistry } from '../host/registry';
import { readCanonicalDroneLifecycleModel } from './canonical-drone-read-model';
import { resolveKanbanBoardSettingsResponse } from './hub-settings';

export type FleetReconcilerSnapshot = {
  drones: Record<string, any>;
  pending: Record<string, any>;
  settings?: { kanbanBoard?: any };
};

type SnapshotDependencies = {
  readCanonicalLifecycleModel: () => FleetReconcilerSnapshot | null;
  loadCompatibilityRegistry: () => Promise<any>;
  loadKanbanBoard: () => Promise<{ kanbanBoard: any }>;
  bunRuntime: boolean;
};

async function loadCanonicalKanbanBoard(): Promise<{ kanbanBoard: any }> {
  return await resolveKanbanBoardSettingsResponse();
}

export async function loadFleetReconcilerSnapshot(
  overrides: Partial<SnapshotDependencies> = {},
): Promise<FleetReconcilerSnapshot> {
  const dependencies: SnapshotDependencies = {
    readCanonicalLifecycleModel: readCanonicalDroneLifecycleModel,
    loadCompatibilityRegistry: loadRegistry,
    loadKanbanBoard: loadCanonicalKanbanBoard,
    bunRuntime: Boolean((globalThis as any).Bun),
    ...overrides,
  };
  if (dependencies.bunRuntime) return await dependencies.loadCompatibilityRegistry();
  const active = dependencies.readCanonicalLifecycleModel();
  if (!active) return await dependencies.loadCompatibilityRegistry();
  const board = await dependencies.loadKanbanBoard();
  return {
    ...active,
    settings: { kanbanBoard: board.kanbanBoard },
  };
}

export class FleetSnapshotDeliveryCache {
  private readonly delivered = new Map<string, { fingerprint: string; atMs: number }>();

  constructor(
    private readonly refreshAfterMs = 30_000,
    private readonly now = () => Date.now(),
  ) {}

  needsDelivery(key: string, fingerprint: string): boolean {
    const previous = this.delivered.get(key);
    return !previous || previous.fingerprint !== fingerprint || this.now() - previous.atMs >= this.refreshAfterMs;
  }

  markDelivered(key: string, fingerprint: string): void {
    this.delivered.set(key, { fingerprint, atMs: this.now() });
  }

  prune(validActorIds: Set<string>): void {
    for (const key of this.delivered.keys()) {
      const actorId = key.slice(key.indexOf('\0') + 1);
      if (!validActorIds.has(actorId)) this.delivered.delete(key);
    }
  }

  clear(): void {
    this.delivered.clear();
  }
}
