import { loadRegistry, updateRegistry } from '../host/registry';
import {
  getDroneLifecycleRepository,
  type CanonicalDroneLifecycleRecord,
  type CanonicalDroneLifecyclePatch,
  type CanonicalDroneLifecycleDelete,
  type CanonicalDroneLifecycleState,
  type CanonicalDroneLifecycleUpsert,
  type DroneLifecycleRepository,
} from '../host/drone-lifecycle-repository';
import { findDroneEntryByIdentity, findDroneIdByRef } from './drone-lifecycle-registry';

export type ResolvedDrone = { id: string; drone: any };
export type ResolvedOrPendingDrone =
  | { kind: 'real'; id: string; drone: any }
  | { kind: 'pending'; id: string; pending: any };

async function canonicalRepositoryWithLegacyBackfill(): Promise<DroneLifecycleRepository | null> {
  const repository = await getDroneLifecycleRepository();
  if (!repository) {
    if ((globalThis as any).Bun) return null;
    throw new Error('canonical drone lifecycle repository is unavailable');
  }
  const registry = await loadRegistry();
  await repository.backfillLegacyInsertOnly(registry);
  return repository;
}

function allowUnavailableStoreFallback(): boolean {
  return Boolean((globalThis as any).Bun);
}

function requireRepository(repository: DroneLifecycleRepository | null): DroneLifecycleRepository {
  if (repository) return repository;
  if (allowUnavailableStoreFallback()) return null as unknown as DroneLifecycleRepository;
  throw new Error('canonical drone lifecycle repository is unavailable');
}

function hydrateCanonicalLifecycle(record: CanonicalDroneLifecycleRecord, registry: any): any {
  const bucket = record.state === 'real' ? registry?.drones : record.state === 'pending' ? registry?.pending : registry?.archived;
  const legacy = findDroneEntryByIdentity({ drones: bucket }, record.id)?.entry ?? bucket?.[record.id] ?? null;
  // Lifecycle columns/payload win; independently owned chat aggregates remain
  // readable from the compatibility registry until their own migration lands.
  return {
    ...(legacy && typeof legacy === 'object' ? legacy : {}),
    ...record.lifecycle,
    id: record.id,
    name: record.name,
    ...(record.containerName ? { containerName: record.containerName } : {}),
    runtime: record.runtimeKind,
    ...(record.state === 'pending' && record.phase ? { phase: record.phase } : {}),
  };
}

function lifecycleBucketName(state: CanonicalDroneLifecycleState): 'drones' | 'pending' | 'archived' {
  return state === 'real' ? 'drones' : state === 'pending' ? 'pending' : 'archived';
}

function compatibilityLifecycleRecord(
  state: CanonicalDroneLifecycleState,
  droneId: string,
  entryRaw: any,
): CanonicalDroneLifecycleRecord {
  const entry = entryRaw && typeof entryRaw === 'object' ? entryRaw : {};
  const runtimeRaw = entry.runtime;
  return {
    state,
    id: droneId,
    name: String(entry.name ?? droneId).trim() || droneId,
    containerName: String(entry.containerName ?? '').trim() || null,
    runtimeKind: String(runtimeRaw && typeof runtimeRaw === 'object' ? runtimeRaw.kind : runtimeRaw ?? 'container'),
    phase: String(entry.phase ?? entry.hub?.phase ?? '').trim() || null,
    archivedAt: state === 'archived' ? String(entry.archivedAt ?? '').trim() || null : null,
    deleteAt: state === 'archived' ? String(entry.deleteAt ?? '').trim() || null : null,
    archiveRetention: state === 'archived' ? String(entry.archiveRetention ?? '').trim() || null : null,
    archiveRuntimePolicy: state === 'archived' ? String(entry.archiveRuntimePolicy ?? '').trim() || null : null,
    lifecycle: entry,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

export async function upsertCanonicalDroneLifecycle(
  state: CanonicalDroneLifecycleState,
  droneId: string,
  entry: unknown,
): Promise<CanonicalDroneLifecycleRecord | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (!repository) {
    requireRepository(repository);
    return await updateRegistry((registry: any) => {
      const bucketName = lifecycleBucketName(state);
      for (const otherBucket of ['drones', 'pending', 'archived'] as const) {
        if (otherBucket === bucketName) continue;
        const found = findDroneEntryByIdentity({ drones: registry?.[otherBucket] }, droneId);
        if (found) delete registry[otherBucket][found.key];
      }
      registry[bucketName] = registry[bucketName] ?? {};
      registry[bucketName][droneId] = entry;
      return compatibilityLifecycleRecord(state, droneId, entry);
    });
  }
  return await repository.commitUpsert(state, droneId, entry, {
    topic: 'drone.lifecycle.changes',
    eventType: `drone.lifecycle.${state}.upserted`,
  });
}

export async function upsertCanonicalDroneLifecycleBatch(
  entries: Array<{ state: CanonicalDroneLifecycleState; droneId: string; entry: unknown }>,
): Promise<CanonicalDroneLifecycleRecord[]> {
  if (entries.length === 0) return [];
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (!repository) {
    requireRepository(repository);
    return await updateRegistry((registry: any) => entries.map(({ state, droneId, entry }) => {
      const bucketName = lifecycleBucketName(state);
      for (const otherBucket of ['drones', 'pending', 'archived'] as const) {
        if (otherBucket === bucketName) continue;
        const found = findDroneEntryByIdentity({ drones: registry?.[otherBucket] }, droneId);
        if (found) delete registry[otherBucket][found.key];
      }
      registry[bucketName] = registry[bucketName] ?? {};
      registry[bucketName][droneId] = entry;
      return compatibilityLifecycleRecord(state, droneId, entry);
    }));
  }
  const items: CanonicalDroneLifecycleUpsert[] = entries.map(({ state, droneId, entry }) => ({
    state,
    id: droneId,
    entry,
    event: {
      topic: 'drone.lifecycle.changes',
      eventType: `drone.lifecycle.${state}.upserted`,
    },
  }));
  return await repository.commitUpsertBatch(items);
}

export async function deleteCanonicalDroneLifecycle(
  droneId: string,
  state?: CanonicalDroneLifecycleState,
): Promise<CanonicalDroneLifecycleRecord | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (!repository) {
    requireRepository(repository);
    return await updateRegistry((registry: any) => {
      const states = state ? [state] : (['real', 'pending', 'archived'] as CanonicalDroneLifecycleState[]);
      for (const candidate of states) {
        const bucketName = lifecycleBucketName(candidate);
        const found = findDroneEntryByIdentity({ drones: registry?.[bucketName] }, droneId);
        if (!found) continue;
        const current = found.entry;
        delete registry[bucketName][found.key];
        return compatibilityLifecycleRecord(candidate, droneId, current);
      }
      return null;
    });
  }
  return await repository.commitDelete(droneId, state, {
    topic: 'drone.lifecycle.changes',
    eventType: 'drone.lifecycle.deleted',
  });
}

export async function deleteCanonicalDroneLifecycleBatch(
  entries: Array<{ state: CanonicalDroneLifecycleState; droneId: string }>,
  options: { ignoreMissing?: boolean } = {},
): Promise<CanonicalDroneLifecycleRecord[]> {
  if (entries.length === 0) return [];
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (!repository) {
    requireRepository(repository);
    return await updateRegistry((registry: any) => entries.map((entry) => {
      const bucketName = lifecycleBucketName(entry.state);
      const found = findDroneEntryByIdentity({ drones: registry?.[bucketName] }, entry.droneId);
      if (!found) {
        if (options.ignoreMissing) return null;
        throw new Error(`unknown ${entry.state} drone: ${entry.droneId}`);
      }
      const current = found.entry;
      delete registry[bucketName][found.key];
      return compatibilityLifecycleRecord(entry.state, entry.droneId, current);
    }).filter((record): record is CanonicalDroneLifecycleRecord => Boolean(record)));
  }
  const items: CanonicalDroneLifecycleDelete[] = entries.map((entry) => ({
    state: entry.state,
    id: entry.droneId,
    event: {
      topic: 'drone.lifecycle.changes',
      eventType: 'drone.lifecycle.deleted',
      payload: { id: entry.droneId, priorState: entry.state },
    },
  }));
  return await repository.commitDeleteBatch(items, options);
}

export async function patchCanonicalDroneLifecycle(
  state: CanonicalDroneLifecycleState,
  droneId: string,
  transform: (lifecycle: Record<string, any>) => Record<string, any>,
): Promise<CanonicalDroneLifecycleRecord | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (!repository) {
    requireRepository(repository);
    return await updateRegistry((registry: any) => {
      const bucketName = lifecycleBucketName(state);
      const found = findDroneEntryByIdentity({ drones: registry?.[bucketName] }, droneId);
      if (!found) return null;
      const next = transform({ ...found.entry });
      registry[bucketName][found.key] = next;
      return compatibilityLifecycleRecord(state, droneId, next);
    });
  }
  return await repository.commitPatch(state, droneId, transform, {
    topic: 'drone.lifecycle.changes',
    eventType: 'drone.lifecycle.patched',
  });
}

export async function patchCanonicalDroneLifecycleBatch(
  entries: Array<{
    state: CanonicalDroneLifecycleState;
    droneId: string;
    transform: (lifecycle: Record<string, any>) => Record<string, any>;
    eventType?: string;
    payload?: Record<string, unknown>;
  }>,
): Promise<CanonicalDroneLifecycleRecord[]> {
  if (entries.length === 0) return [];
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (!repository) {
    requireRepository(repository);
    return await updateRegistry((registry: any) => entries.map((entry) => {
      const bucketName = lifecycleBucketName(entry.state);
      const found = findDroneEntryByIdentity({ drones: registry?.[bucketName] }, entry.droneId);
      if (!found) throw new Error(`unknown ${entry.state} drone: ${entry.droneId}`);
      const next = entry.transform({ ...found.entry });
      registry[bucketName][found.key] = next;
      return compatibilityLifecycleRecord(entry.state, entry.droneId, next);
    }));
  }
  const items: CanonicalDroneLifecyclePatch[] = entries.map((entry) => ({
    state: entry.state,
    id: entry.droneId,
    transform: entry.transform,
    event: {
      topic: 'drone.lifecycle.changes',
      eventType: entry.eventType ?? 'drone.lifecycle.patched',
      payload: { id: entry.droneId, state: entry.state, ...(entry.payload ?? {}) },
    },
  }));
  return await repository.commitPatchBatch(items);
}

export async function getCanonicalDroneLifecycle(droneId: string): Promise<CanonicalDroneLifecycleRecord | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (!repository) {
    requireRepository(repository);
    return null;
  }
  return repository.get(droneId);
}

export async function listCanonicalDroneLifecycle(
  state: CanonicalDroneLifecycleState,
): Promise<CanonicalDroneLifecycleRecord[] | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  return repository ? repository.list(state) : null;
}

export async function resolveDroneFromRegistryRef(
  droneRef: string,
  handlers: {
    onStillStarting: () => void;
    onUnknown: () => void;
  },
): Promise<ResolvedDrone | null> {
  const regAny: any = await loadRegistry();
  const repository = await canonicalRepositoryWithLegacyBackfill();
  const canonical = repository?.resolveActiveRef(droneRef) ?? null;
  if (canonical?.state === 'pending') {
    handlers.onStillStarting();
    return null;
  }
  if (canonical?.state === 'real') {
    return { id: canonical.id, drone: hydrateCanonicalLifecycle(canonical, regAny) };
  }
  const found = findDroneIdByRef(regAny, droneRef);
  if (!found) {
    handlers.onUnknown();
    return null;
  }
  if (found.kind === 'pending' && !regAny?.drones?.[found.id]) {
    handlers.onStillStarting();
    return null;
  }
  const drone = regAny?.drones?.[found.id] ?? null;
  if (!drone) {
    handlers.onUnknown();
    return null;
  }
  return { id: found.id, drone };
}

export async function resolveDroneOrPendingForReadRef(droneRef: string): Promise<ResolvedOrPendingDrone | null> {
  const ref = String(droneRef ?? '').trim();
  if (!ref) return null;
  const regAny: any = await loadRegistry();
  const repository = await canonicalRepositoryWithLegacyBackfill();
  const canonical = repository?.resolveActiveRef(ref) ?? null;
  if (canonical?.state === 'real') return { kind: 'real', id: canonical.id, drone: hydrateCanonicalLifecycle(canonical, regAny) };
  if (canonical?.state === 'pending') return { kind: 'pending', id: canonical.id, pending: hydrateCanonicalLifecycle(canonical, regAny) };
  const found = findDroneIdByRef(regAny, ref);
  if (!found) return null;
  const real = regAny?.drones?.[found.id] ?? null;
  if (real) return { kind: 'real', id: found.id, drone: real };
  const pending = regAny?.pending?.[found.id] ?? null;
  if (pending) return { kind: 'pending', id: found.id, pending };
  return null;
}

/** Read-only resolver for latency-sensitive canonical endpoints.
 *
 * Unlike the compatibility resolver, this never loads the global registry
 * projection and never attempts a legacy backfill. Bun intentionally retains
 * the registry fallback until it has a supported SQLite adapter.
 */
export async function resolveCanonicalDroneOrPendingForReadRef(droneRef: string): Promise<ResolvedOrPendingDrone | null> {
  const ref = String(droneRef ?? '').trim();
  if (!ref) return null;
  const repository = await getDroneLifecycleRepository();
  if (!repository) {
    if ((globalThis as any).Bun) return await resolveDroneOrPendingForReadRef(ref);
    throw new Error('canonical drone lifecycle repository is unavailable');
  }
  const record = repository.resolveActiveRef(ref);
  if (!record) return null;
  const entry = {
    ...record.lifecycle,
    id: record.id,
    name: record.name,
    ...(record.containerName ? { containerName: record.containerName } : {}),
    runtime: record.runtimeKind,
    ...(record.state === 'pending' && record.phase ? { phase: record.phase } : {}),
  };
  return record.state === 'pending'
    ? { kind: 'pending', id: record.id, pending: entry }
    : { kind: 'real', id: record.id, drone: entry };
}

export async function resolveDroneNameByIdentity(droneId: string): Promise<string | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  const canonical = repository?.get(droneId) ?? null;
  if (canonical?.state === 'real') return canonical.name;
  const regAny: any = await loadRegistry();
  const found = findDroneEntryByIdentity(regAny, droneId);
  if (!found) return null;
  const entryName = String(found.entry?.name ?? '').trim();
  if (entryName) return entryName;
  const keyName = String(found.key ?? '').trim();
  return keyName || null;
}

export async function resolveDroneContainerNameByIdentity(droneId: string): Promise<string | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  const canonical = repository?.get(droneId) ?? null;
  if (canonical?.state === 'real') return canonical.containerName ?? canonical.name;
  const regAny: any = await loadRegistry();
  const found = findDroneEntryByIdentity(regAny, droneId);
  if (!found) return null;
  const cn = String((found.entry as any)?.containerName ?? (found.entry as any)?.name ?? found.key ?? '').trim();
  return cn || null;
}

export async function setDroneHubMetaByIdentity(
  opts: {
    droneId: string;
    hub: null | { phase: 'starting' | 'seeding' | 'error'; message?: string; promptId?: string };
  },
): Promise<void> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  if (repository) {
    await repository.commitPatch('real', opts.droneId, (entry) => {
      if (!opts.hub) {
        delete entry.hub;
      } else {
        entry.hub = {
          phase: opts.hub.phase,
          message: opts.hub.message,
          updatedAt: new Date().toISOString(),
          ...(opts.hub.promptId ? { promptId: opts.hub.promptId } : {}),
        };
      }
      return entry;
    }, {
      topic: 'drone.lifecycle.changes',
      eventType: 'drone.hub-metadata.changed',
    });
    return;
  }
  requireRepository(repository);
  await updateRegistry((regAny: any) => {
    const found = findDroneEntryByIdentity(regAny, opts.droneId);
    if (!found) return;
    const d: any = found.entry;
    if (!opts.hub) {
      delete d.hub;
    } else {
      d.hub = {
        phase: opts.hub.phase,
        message: opts.hub.message,
        updatedAt: new Date().toISOString(),
        ...(opts.hub.promptId ? { promptId: opts.hub.promptId } : {}),
      };
    }
    regAny.drones = regAny.drones ?? {};
    regAny.drones[found.key] = d;
  });
}
