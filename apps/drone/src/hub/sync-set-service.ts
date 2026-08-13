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
  syncSetTargetOverlapsRepository,
  syncSetTargetStatusKeyForHost,
  writeStoredSyncSets,
  type StoredSyncSet,
  type SyncSetSourceSnapshot,
} from './sync-sets';
import {
  getFleetWorkflowStore,
  type FleetWorkflowStore,
  type WorkflowSyncSetTargetStatus,
} from '../host/fleet-workflow-store';
import { getHubDatabase } from '../host/hub-database';
import { loadRegistryRawSnapshot } from '../host/registry';

const workflowBackfilled = new WeakSet<FleetWorkflowStore>();

type SyncSetTargetOutcome = {
  syncSetId: string;
  targetId: string;
  targetKind: 'drone' | 'host';
  state: 'synced' | 'error';
  appliedVersionId?: string | null;
  appliedAt?: string | null;
  error?: string | null;
};

type SyncSetApplyPhases = {
  snapshot: number;
  droneLockWait: number;
  prepareTarget: number;
  copyTarget: number;
  persistOutcome: number;
};

type ApplySyncSetResult =
  | { ok: true; phases: Omit<SyncSetApplyPhases, 'snapshot'> }
  | { ok: false; error: string; phases: Omit<SyncSetApplyPhases, 'snapshot'> };

export type ApplyAllSyncSetsToDroneResult = {
  repositoryFilesMayHaveChanged: boolean;
};

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
  logInfo?: (message: string, meta: Record<string, unknown>) => void;
};

function roundedMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyTargetPhases(): Omit<SyncSetApplyPhases, 'snapshot'> {
  return { droneLockWait: 0, prepareTarget: 0, copyTarget: 0, persistOutcome: 0 };
}

async function measurePhase<T>(
  phases: Record<string, number>,
  phase: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    phases[phase] = (phases[phase] ?? 0) + performance.now() - startedAt;
  }
}

function buildSyncSetDroneNameMap(
  regAny: any,
  normalizeDroneIdentity: CreateSyncSetServiceDeps['normalizeDroneIdentity'],
): Record<string, string> {
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
    try {
      return await getFleetWorkflowStore();
    } catch (error) {
      if ((globalThis as any).Bun && getHubDatabase() === null) return null;
      throw error;
    }
  }

  async function ensureWorkflowBackfill(store: FleetWorkflowStore): Promise<void> {
    if (workflowBackfilled.has(store)) return;
    await store.backfillSyncSets(readStoredSyncSets(await loadRegistryRawSnapshot()));
    workflowBackfilled.add(store);
  }

  async function storedSyncSets(regAny?: any): Promise<StoredSyncSet[]> {
    const store = await workflowStore();
    if (!store) return readStoredSyncSets(regAny ?? (await deps.loadRegistry()));
    await ensureWorkflowBackfill(store);
    return store.listSyncSets<StoredSyncSet>();
  }

  async function storedSyncSetDefinitions(regAny?: any): Promise<StoredSyncSet[]> {
    const store = await workflowStore();
    if (!store) return readStoredSyncSets(regAny ?? (await deps.loadRegistry()));
    await ensureWorkflowBackfill(store);
    return store.listSyncSetDefinitions<StoredSyncSet>();
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
      const targetId = String(opts.targetId ?? '').trim();
      await store.updateSyncSetTarget<StoredSyncSet>(
        opts.syncSetId,
        targetId,
        (existing, previousTarget) => {
          const targetStatus: WorkflowSyncSetTargetStatus = {
            targetKind: opts.targetKind,
            state: opts.state,
            appliedVersionId:
              opts.state === 'synced'
                ? (opts.appliedVersionId ?? null)
                : (previousTarget?.appliedVersionId ?? null),
            appliedAt:
              opts.state === 'synced'
                ? (opts.appliedAt ?? null)
                : (previousTarget?.appliedAt ?? null),
            error: opts.state === 'error' ? String(opts.error ?? '').trim() || 'sync failed' : null,
          };
          const next =
            opts.state === 'synced'
              ? {
                  ...existing,
                  lastAppliedVersionId: opts.appliedVersionId ?? null,
                  lastAppliedAt: opts.appliedAt ?? null,
                  updatedAt: deps.nowIso(),
                }
              : { ...existing, updatedAt: deps.nowIso() };
          return { syncSet: next, targetStatus };
        },
      );
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
            ? (opts.appliedVersionId ?? null)
            : (previousTarget?.appliedVersionId ?? null),
        appliedAt:
          opts.state === 'synced' ? (opts.appliedAt ?? null) : (previousTarget?.appliedAt ?? null),
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
    const phases = emptyTargetPhases();
    const droneId = deps.normalizeDroneIdentity(opts.droneId);
    if (!droneId || !opts.droneEntry)
      return { ok: false, error: 'missing drone target', phases };
    const appliedAt = deps.nowIso();
    const persistOutcome = async (outcome: SyncSetTargetOutcome) =>
      await measurePhase(phases, 'persistOutcome', async () => await recordTargetOutcome(outcome));
    try {
      if (deps.droneRuntime(opts.droneEntry) === 'host') {
        await measurePhase(phases, 'copyTarget', async () =>
          await mirrorLocalSourceToHostTarget({
            sourcePath: opts.snapshot.sourcePath,
            sourceKind: opts.snapshot.sourceKind,
            targetPath: opts.syncSet.targetPath,
          }),
        );
      } else {
        const requestedDroneName =
          String((opts.droneEntry as any)?.name ?? droneId).trim() || droneId;
        const lockStartedAt = performance.now();
        let lockEntered = false;
        try {
          await deps.withLockedDroneContainer(
            { requestedDroneName, droneEntry: opts.droneEntry },
            async ({ containerName }) => {
              lockEntered = true;
              phases.droneLockWait += performance.now() - lockStartedAt;
              await mirrorLocalSourceToContainerTarget({
                containerName,
                sourcePath: opts.snapshot.sourcePath,
                sourceKind: opts.snapshot.sourceKind,
                targetPath: opts.syncSet.targetPath,
                onTiming: (phase, durationMs) => {
                  phases[phase] += durationMs;
                },
              });
            },
          );
        } finally {
          if (!lockEntered) phases.droneLockWait += performance.now() - lockStartedAt;
        }
      }
    } catch (e: any) {
      const error = String(e?.message ?? e ?? 'sync failed').trim();
      await persistOutcome({
        syncSetId: opts.syncSet.id,
        targetId: droneId,
        targetKind: 'drone',
        state: 'error',
        error,
      });
      return { ok: false, error, phases };
    }
    await persistOutcome({
      syncSetId: opts.syncSet.id,
      targetId: droneId,
      targetKind: 'drone',
      state: 'synced',
      appliedVersionId: opts.snapshot.versionId,
      appliedAt,
    });
    return { ok: true, phases };
  }

  async function applyToHostTarget(opts: {
    syncSet: StoredSyncSet;
    snapshot: SyncSetSourceSnapshot;
  }): Promise<ApplySyncSetResult> {
    const phases = emptyTargetPhases();
    const appliedAt = deps.nowIso();
    const persistOutcome = async (outcome: SyncSetTargetOutcome) =>
      await measurePhase(phases, 'persistOutcome', async () => await recordTargetOutcome(outcome));
    try {
      await measurePhase(phases, 'copyTarget', async () =>
        await mirrorLocalSourceToHostTarget({
          sourcePath: opts.snapshot.sourcePath,
          sourceKind: opts.snapshot.sourceKind,
          targetPath: opts.syncSet.targetPath,
        }),
      );
    } catch (e: any) {
      const error = String(e?.message ?? e ?? 'sync failed').trim();
      await persistOutcome({
        syncSetId: opts.syncSet.id,
        targetId: syncSetTargetStatusKeyForHost(),
        targetKind: 'host',
        state: 'error',
        error,
      });
      return { ok: false, error, phases };
    }
    await persistOutcome({
      syncSetId: opts.syncSet.id,
      targetId: syncSetTargetStatusKeyForHost(),
      targetKind: 'host',
      state: 'synced',
      appliedVersionId: opts.snapshot.versionId,
      appliedAt,
    });
    return { ok: true, phases };
  }

  return {
    buildViewsFromRegistry,
    storedSyncSets,
    async syncSetsOverlapRepository(repositoryPathRaw: unknown): Promise<boolean> {
      const repositoryPath = String(repositoryPathRaw ?? '').trim();
      if (!repositoryPath) return false;
      const syncSets = await storedSyncSetDefinitions();
      return syncSets.some((syncSet) =>
        syncSetTargetOverlapsRepository(syncSet.targetPath, repositoryPath),
      );
    },
    async createSyncSet(syncSet: StoredSyncSet) {
      const store = await workflowStore();
      if (store) {
        await ensureWorkflowBackfill(store);
        return await store.putSyncSet(syncSet);
      }
      await deps.updateRegistry((regAny: any) => {
        const rows = readStoredSyncSets(regAny);
        rows.push(syncSet);
        writeStoredSyncSets(regAny, rows, syncSet.updatedAt);
      });
      return syncSet;
    },
    async updateSyncSet(syncSet: StoredSyncSet) {
      const store = await workflowStore();
      if (store) {
        await ensureWorkflowBackfill(store);
        return await store.putSyncSet(syncSet);
      }
      await deps.updateRegistry((regAny: any) => {
        const rows = readStoredSyncSets(regAny);
        const i = findStoredSyncSetIndex(rows, syncSet.id);
        if (i < 0) throw new Error(`unknown sync set: ${syncSet.id}`);
        rows[i] = syncSet;
        writeStoredSyncSets(regAny, rows, syncSet.updatedAt);
      });
      return syncSet;
    },
    async deleteSyncSet(id: string) {
      const store = await workflowStore();
      if (store) {
        await ensureWorkflowBackfill(store);
        return await store.deleteSyncSet(id);
      }
      let removed = false;
      await deps.updateRegistry((regAny: any) => {
        const rows = readStoredSyncSets(regAny);
        const i = findStoredSyncSetIndex(rows, id);
        if (i >= 0) {
          rows.splice(i, 1);
          removed = true;
          writeStoredSyncSets(regAny, rows, deps.nowIso());
        }
      });
      return removed;
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

    async applyAllSyncSetsToDrone(opts: {
      droneId: string;
      droneEntry: any;
      repositoryPath?: string;
    }): Promise<ApplyAllSyncSetsToDroneResult> {
      const droneId = deps.normalizeDroneIdentity(opts.droneId);
      if (!droneId || !opts.droneEntry) return { repositoryFilesMayHaveChanged: false };
      const startedAt = performance.now();
      const phases: SyncSetApplyPhases = {
        snapshot: 0,
        ...emptyTargetPhases(),
      };
      const loadStartedAt = performance.now();
      let syncSets: StoredSyncSet[];
      try {
        syncSets = await storedSyncSetDefinitions();
      } catch (error) {
        const loadSyncSetsMs = performance.now() - loadStartedAt;
        deps.logInfo?.('shared path sync timing', {
          at: deps.nowIso(),
          droneId,
          outcome: 'failed',
          durationMs: roundedMs(performance.now() - startedAt),
          syncSetCount: 0,
          phases: { loadSyncSets: roundedMs(loadSyncSetsMs) },
          error: String((error as any)?.message ?? error),
        });
        throw error;
      }
      const loadSyncSetsMs = performance.now() - loadStartedAt;
      const repositoryPath = String(
        opts.repositoryPath ?? opts.droneEntry?.repo?.dest ?? '',
      ).trim();
      let repositoryFilesMayHaveChanged = false;
      const syncSetTimings: Array<{
        syncSetId: string;
        sourceBytes: number | null;
        outcome: 'completed' | 'failed';
        durationMs: number;
      }> = [];
      for (const syncSet of syncSets) {
        const syncSetStartedAt = performance.now();
        let sourceBytes: number | null = null;
        let outcome: 'completed' | 'failed' = 'failed';
        if (repositoryPath && syncSetTargetOverlapsRepository(syncSet.targetPath, repositoryPath)) {
          // Treat even a failed application as potentially mutating: file copies
          // can fail after partially updating their target.
          repositoryFilesMayHaveChanged = true;
        }
        try {
          let snapshot: SyncSetSourceSnapshot;
          try {
            snapshot = await measurePhase(
              phases,
              'snapshot',
              async () => await computeSyncSetSourceSnapshot(syncSet),
            );
            sourceBytes = snapshot.totalBytes;
          } catch (e: any) {
            const error = String(e?.message ?? e ?? 'sync failed').trim();
            await measurePhase(phases, 'persistOutcome', async () =>
              await recordTargetOutcome({
                syncSetId: syncSet.id,
                targetId: droneId,
                targetKind: 'drone',
                state: 'error',
                error,
              }),
            );
            deps.logWarn('sync set snapshot failed during provisioning', {
              syncSetId: syncSet.id,
              droneId,
              error,
            });
            continue;
          }
          const result = await applyToDroneTarget({
            syncSet,
            snapshot,
            droneId,
            droneEntry: opts.droneEntry,
          });
          phases.droneLockWait += result.phases.droneLockWait;
          phases.prepareTarget += result.phases.prepareTarget;
          phases.copyTarget += result.phases.copyTarget;
          phases.persistOutcome += result.phases.persistOutcome;
          outcome = result.ok ? 'completed' : 'failed';
          if (!result.ok) {
            deps.logWarn('sync set apply failed during provisioning', {
              syncSetId: syncSet.id,
              droneId,
              error: result.error,
            });
          }
        } catch (e: any) {
          const error = String(e?.message ?? e ?? 'sync failed').trim();
          deps.logWarn('sync set apply failed during provisioning', {
            syncSetId: syncSet.id,
            droneId,
            error,
          });
        } finally {
          syncSetTimings.push({
            syncSetId: syncSet.id,
            sourceBytes,
            outcome,
            durationMs: roundedMs(performance.now() - syncSetStartedAt),
          });
        }
      }
      deps.logInfo?.('shared path sync timing', {
        at: deps.nowIso(),
        droneId,
        outcome: syncSetTimings.every((timing) => timing.outcome === 'completed')
          ? 'completed'
          : 'partial',
        durationMs: roundedMs(performance.now() - startedAt),
        syncSetCount: syncSets.length,
        phases: {
          loadSyncSets: roundedMs(loadSyncSetsMs),
          snapshot: roundedMs(phases.snapshot),
          droneLockWait: roundedMs(phases.droneLockWait),
          prepareTarget: roundedMs(phases.prepareTarget),
          copyTarget: roundedMs(phases.copyTarget),
          persistOutcome: roundedMs(phases.persistOutcome),
        },
        syncSets: syncSetTimings,
      });
      return { repositoryFilesMayHaveChanged };
    },
  };
}
