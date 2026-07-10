import {
  buildSyncSetView,
  computeSyncSetSourceSnapshot,
  findStoredSyncSetIndex,
  mirrorLocalSourceToContainerTarget,
  mirrorLocalSourceToHostTarget,
  readStoredSyncSets,
  setStoredSyncSetTargetStatus,
  syncSetAppliesToHost,
  syncSetSourceExists,
  syncSetTargetStatusKeyForHost,
  writeStoredSyncSets,
  type StoredSyncSet,
  type SyncSetSourceSnapshot,
} from './sync-sets';
import { getFleetWorkflowStore, type FleetWorkflowStore } from '../host/fleet-workflow-store';

type SyncSetTargetOutcome = {
  syncSetId: string;
  targetId: string;
  targetKind: 'drone' | 'host';
  state: 'synced' | 'error';
  appliedVersionId?: string | null;
  appliedAt?: string | null;
  error?: string | null;
};

type ApplySyncSetResult = { ok: true } | { ok: false; error: string };

type CreateSyncSetServiceDeps = {
  loadRegistry: () => Promise<any>;
  updateRegistry: (mutator: (regAny: any) => void | Promise<void>) => Promise<void>;
  normalizeDroneIdentity: (droneIdRaw: unknown) => string;
  droneRuntime: (droneEntry: any) => 'host' | 'container';
  withLockedDroneContainer: <T>(
    opts: { requestedDroneName: string; droneEntry: any },
    fn: (ctx: { containerName: string }) => Promise<T>,
  ) => Promise<T>;
  nowIso: () => string;
  logWarn: (message: string, meta: Record<string, unknown>) => void;
};

function buildSyncSetDroneNameMap(regAny: any, normalizeDroneIdentity: CreateSyncSetServiceDeps['normalizeDroneIdentity']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(regAny?.drones ?? {})) {
    const droneId = normalizeDroneIdentity((entry as any)?.id) || String(key);
    if (!droneId) continue;
    out[droneId] = String((entry as any)?.name ?? droneId).trim() || droneId;
  }
  for (const [key, entry] of Object.entries(regAny?.pending ?? {})) {
    const droneId = normalizeDroneIdentity((entry as any)?.id) || String(key);
    if (!droneId) continue;
    out[droneId] = String((entry as any)?.name ?? droneId).trim() || droneId;
  }
  return out;
}

export function createSyncSetService(deps: CreateSyncSetServiceDeps) {
  async function workflowStore(): Promise<FleetWorkflowStore | null> {
    try { return await getFleetWorkflowStore(); } catch (error) { if ((globalThis as any).Bun) return null; throw error; }
  }

  async function storedSyncSets(regAny?: any): Promise<StoredSyncSet[]> {
    const registry = regAny ?? (await deps.loadRegistry());
    const legacy = readStoredSyncSets(registry);
    const store = await workflowStore();
    if (!store) return legacy;
    await store.backfillSyncSets(legacy);
    return store.listSyncSets<StoredSyncSet>();
  }

  async function buildViewsFromRegistry(regAny: any) {
    const syncSets = await storedSyncSets(regAny);
    const droneNameById = buildSyncSetDroneNameMap(regAny, deps.normalizeDroneIdentity);
    return await Promise.all(
      syncSets.map(async (syncSet) =>
        buildSyncSetView(syncSet, {
          droneNameById,
          includeHostTargetName: 'Host',
          sourceExists: await syncSetSourceExists(syncSet),
        }),
      ),
    );
  }

  async function recordTargetOutcome(opts: SyncSetTargetOutcome) {
    const store = await workflowStore();
    if (store) {
      await store.updateSyncSet<StoredSyncSet>(opts.syncSetId, (existing) => {
        const previousTarget = existing.targetStatus[String(opts.targetId ?? '').trim()] ?? null;
        let next = setStoredSyncSetTargetStatus(existing, opts.targetId, {
          targetKind: opts.targetKind, state: opts.state,
          appliedVersionId: opts.state === 'synced' ? opts.appliedVersionId ?? null : previousTarget?.appliedVersionId ?? null,
          appliedAt: opts.state === 'synced' ? opts.appliedAt ?? null : previousTarget?.appliedAt ?? null,
          error: opts.state === 'error' ? String(opts.error ?? '').trim() || 'sync failed' : null,
        });
        if (opts.state === 'synced') next = { ...next, lastAppliedVersionId: opts.appliedVersionId ?? null, lastAppliedAt: opts.appliedAt ?? null };
        return { ...next, updatedAt: deps.nowIso() };
      });
      return;
    }
    await deps.updateRegistry((regAny: any) => {
      const syncSets = readStoredSyncSets(regAny);
      const index = findStoredSyncSetIndex(syncSets, opts.syncSetId);
      if (index < 0) return;
      const existing = syncSets[index]!;
      const previousTarget = existing.targetStatus[String(opts.targetId ?? '').trim()] ?? null;
      let next = setStoredSyncSetTargetStatus(existing, opts.targetId, {
        targetKind: opts.targetKind,
        state: opts.state,
        appliedVersionId:
          opts.state === 'synced'
            ? opts.appliedVersionId ?? null
            : previousTarget?.appliedVersionId ?? null,
        appliedAt:
          opts.state === 'synced'
            ? opts.appliedAt ?? null
            : previousTarget?.appliedAt ?? null,
        error: opts.state === 'error' ? String(opts.error ?? '').trim() || 'sync failed' : null,
      });
      if (opts.state === 'synced') {
        next = {
          ...next,
          lastAppliedVersionId: opts.appliedVersionId ?? null,
          lastAppliedAt: opts.appliedAt ?? null,
        };
      }
      syncSets[index] = next;
      writeStoredSyncSets(regAny, syncSets, deps.nowIso());
    });
  }

  async function applyToDroneTarget(opts: {
    syncSet: StoredSyncSet;
    snapshot: SyncSetSourceSnapshot;
    droneId: string;
    droneEntry: any;
  }): Promise<ApplySyncSetResult> {
    const droneId = deps.normalizeDroneIdentity(opts.droneId);
    if (!droneId || !opts.droneEntry) return { ok: false, error: 'missing drone target' };
    const appliedAt = deps.nowIso();
    try {
      if (deps.droneRuntime(opts.droneEntry) === 'host') {
        await mirrorLocalSourceToHostTarget({
          sourcePath: opts.snapshot.sourcePath,
          sourceKind: opts.snapshot.sourceKind,
          targetPath: opts.syncSet.targetPath,
        });
      } else {
        const requestedDroneName = String((opts.droneEntry as any)?.name ?? droneId).trim() || droneId;
        await deps.withLockedDroneContainer({ requestedDroneName, droneEntry: opts.droneEntry }, async ({ containerName }) => {
          await mirrorLocalSourceToContainerTarget({
            containerName,
            sourcePath: opts.snapshot.sourcePath,
            sourceKind: opts.snapshot.sourceKind,
            targetPath: opts.syncSet.targetPath,
          });
        });
      }
      await recordTargetOutcome({
        syncSetId: opts.syncSet.id,
        targetId: droneId,
        targetKind: 'drone',
        state: 'synced',
        appliedVersionId: opts.snapshot.versionId,
        appliedAt,
      });
      return { ok: true };
    } catch (e: any) {
      const error = String(e?.message ?? e ?? 'sync failed').trim();
      await recordTargetOutcome({
        syncSetId: opts.syncSet.id,
        targetId: droneId,
        targetKind: 'drone',
        state: 'error',
        error,
      });
      return { ok: false, error };
    }
  }

  async function applyToHostTarget(opts: {
    syncSet: StoredSyncSet;
    snapshot: SyncSetSourceSnapshot;
  }): Promise<ApplySyncSetResult> {
    const appliedAt = deps.nowIso();
    try {
      await mirrorLocalSourceToHostTarget({
        sourcePath: opts.snapshot.sourcePath,
        sourceKind: opts.snapshot.sourceKind,
        targetPath: opts.syncSet.targetPath,
      });
      await recordTargetOutcome({
        syncSetId: opts.syncSet.id,
        targetId: syncSetTargetStatusKeyForHost(),
        targetKind: 'host',
        state: 'synced',
        appliedVersionId: opts.snapshot.versionId,
        appliedAt,
      });
      return { ok: true };
    } catch (e: any) {
      const error = String(e?.message ?? e ?? 'sync failed').trim();
      await recordTargetOutcome({
        syncSetId: opts.syncSet.id,
        targetId: syncSetTargetStatusKeyForHost(),
        targetKind: 'host',
        state: 'error',
        error,
      });
      return { ok: false, error };
    }
  }

  return {
    buildViewsFromRegistry,
    storedSyncSets,
    async createSyncSet(syncSet: StoredSyncSet) {
      const store = await workflowStore();
      if (store) { await store.backfillSyncSets(readStoredSyncSets(await deps.loadRegistry())); return await store.putSyncSet(syncSet); }
      await deps.updateRegistry((regAny:any)=>{const rows=readStoredSyncSets(regAny);rows.push(syncSet);writeStoredSyncSets(regAny,rows,syncSet.updatedAt);});
      return syncSet;
    },
    async updateSyncSet(syncSet: StoredSyncSet) {
      const store = await workflowStore();
      if (store) { await store.backfillSyncSets(readStoredSyncSets(await deps.loadRegistry())); return await store.putSyncSet(syncSet); }
      await deps.updateRegistry((regAny:any)=>{const rows=readStoredSyncSets(regAny);const i=findStoredSyncSetIndex(rows,syncSet.id);if(i<0)throw new Error(`unknown sync set: ${syncSet.id}`);rows[i]=syncSet;writeStoredSyncSets(regAny,rows,syncSet.updatedAt);}); return syncSet;
    },
    async deleteSyncSet(id:string) {
      const store=await workflowStore();if(store){await store.backfillSyncSets(readStoredSyncSets(await deps.loadRegistry()));return await store.deleteSyncSet(id);}
      let removed=false;await deps.updateRegistry((regAny:any)=>{const rows=readStoredSyncSets(regAny);const i=findStoredSyncSetIndex(rows,id);if(i>=0){rows.splice(i,1);removed=true;writeStoredSyncSets(regAny,rows,deps.nowIso());}});return removed;
    },

    async applySyncSetToAllExistingTargets(syncSetIdRaw: unknown) {
      const syncSetId = String(syncSetIdRaw ?? '').trim();
      if (!syncSetId) throw new Error('missing sync set id');
      const regAny: any = await deps.loadRegistry();
      const syncSets = await storedSyncSets(regAny);
      const syncSet = syncSets.find((entry) => entry.id === syncSetId) ?? null;
      if (!syncSet) throw new Error(`unknown sync set: ${syncSetId}`);
      const snapshot = await computeSyncSetSourceSnapshot(syncSet);
      const drones = Object.entries(regAny?.drones ?? {})
        .map(([key, entry]) => ({
          id: deps.normalizeDroneIdentity((entry as any)?.id) || String(key),
          entry,
        }))
        .filter((row) => row.id);
      const failures: Array<{ targetId: string; targetName: string; error: string }> = [];
      let appliedDrones = 0;
      let appliedHost = false;

      for (const drone of drones) {
        const result = await applyToDroneTarget({
          syncSet,
          snapshot,
          droneId: drone.id,
          droneEntry: drone.entry,
        });
        if (result.ok) {
          appliedDrones += 1;
        } else {
          failures.push({
            targetId: drone.id,
            targetName: String((drone.entry as any)?.name ?? drone.id).trim() || drone.id,
            error: result.error,
          });
        }
      }

      if (syncSetAppliesToHost(syncSet)) {
        const hostResult = await applyToHostTarget({ syncSet, snapshot });
        if (hostResult.ok) {
          appliedHost = true;
        } else {
          failures.push({
            targetId: syncSetTargetStatusKeyForHost(),
            targetName: 'Host',
            error: hostResult.error,
          });
        }
      }

      const refreshedRegAny: any = await deps.loadRegistry();
      const refreshedViews = await buildViewsFromRegistry(refreshedRegAny);
      const syncSetView = refreshedViews.find((entry) => entry.id === syncSetId) ?? null;
      return {
        syncSet,
        syncSetView,
        snapshot,
        appliedDrones,
        appliedHost,
        failures,
        totalDrones: drones.length,
      };
    },

    async applyAllSyncSetsToDrone(opts: { droneId: string; droneEntry: any }) {
      const droneId = deps.normalizeDroneIdentity(opts.droneId);
      if (!droneId || !opts.droneEntry) return;
      const regAny: any = await deps.loadRegistry();
      const syncSets = await storedSyncSets(regAny);
      for (const syncSet of syncSets) {
        try {
          const snapshot = await computeSyncSetSourceSnapshot(syncSet);
          const result = await applyToDroneTarget({
            syncSet,
            snapshot,
            droneId,
            droneEntry: opts.droneEntry,
          });
          if (!result.ok) {
            deps.logWarn('sync set apply failed during provisioning', {
              syncSetId: syncSet.id,
              droneId,
              error: result.error,
            });
          }
        } catch (e: any) {
          const error = String(e?.message ?? e ?? 'sync failed').trim();
          await recordTargetOutcome({
            syncSetId: syncSet.id,
            targetId: droneId,
            targetKind: 'drone',
            state: 'error',
            error,
          });
          deps.logWarn('sync set snapshot failed during provisioning', {
            syncSetId: syncSet.id,
            droneId,
            error,
          });
        }
      }
    },
  };
}
