import { describe, expect, test } from 'bun:test';
import {
  FleetSnapshotDeliveryCache,
  loadFleetReconcilerSnapshot,
} from '../src/hub/fleet-reconciler-model';

describe('fleet reconciler canonical model', () => {
  test('uses one canonical active model and board without a compatibility projection read', async () => {
    let canonicalReads = 0;
    let boardReads = 0;
    let compatibilityReads = 0;
    const snapshot = await loadFleetReconcilerSnapshot({
      bunRuntime: false,
      readCanonicalActiveModel: () => {
        canonicalReads += 1;
        return { drones: { alpha: { id: 'alpha' } }, pending: {} };
      },
      loadKanbanBoard: async () => {
        boardReads += 1;
        return { kanbanBoard: { taskTypes: [], lanes: [] } };
      },
      loadCompatibilityRegistry: async () => {
        compatibilityReads += 1;
        return { drones: {}, pending: {} };
      },
    });
    expect(canonicalReads).toBe(1);
    expect(boardReads).toBe(1);
    expect(compatibilityReads).toBe(0);
    expect(snapshot.drones.alpha.id).toBe('alpha');
    expect(snapshot.settings?.kanbanBoard).toEqual({ taskTypes: [], lanes: [] });
  });

  test('retains the Bun compatibility fallback as one projection read', async () => {
    let compatibilityReads = 0;
    const legacy = { drones: { bun: { id: 'bun' } }, pending: {}, settings: {} };
    const snapshot = await loadFleetReconcilerSnapshot({
      bunRuntime: true,
      readCanonicalActiveModel: () => { throw new Error('canonical read should not run'); },
      loadKanbanBoard: async () => { throw new Error('canonical board should not run'); },
      loadCompatibilityRegistry: async () => {
        compatibilityReads += 1;
        return legacy;
      },
    });
    expect(snapshot).toBe(legacy);
    expect(compatibilityReads).toBe(1);
  });

  test('only redelivers unchanged snapshots after the bounded refresh interval', () => {
    let now = 1_000;
    const cache = new FleetSnapshotDeliveryCache(30_000, () => now);
    expect(cache.needsDelivery('policy\0alpha', 'disabled')).toBe(true);
    cache.markDelivered('policy\0alpha', 'disabled');
    expect(cache.needsDelivery('policy\0alpha', 'disabled')).toBe(false);
    expect(cache.needsDelivery('policy\0alpha', 'enabled')).toBe(true);
    now += 30_000;
    expect(cache.needsDelivery('policy\0alpha', 'disabled')).toBe(true);
  });
});
