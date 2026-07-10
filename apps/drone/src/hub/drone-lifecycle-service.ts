import { loadRegistry, updateRegistry } from '../host/registry';
import {
  getDroneLifecycleRepository,
  type CanonicalDroneLifecycleRecord,
  type CanonicalDroneLifecycleState,
  type DroneLifecycleRepository,
} from '../host/drone-lifecycle-repository';
import { findDroneEntryByIdentity, findDroneIdByRef } from './drone-lifecycle-registry';

export type ResolvedDrone = { id: string; drone: any };
export type ResolvedOrPendingDrone =
  | { kind: 'real'; id: string; drone: any }
  | { kind: 'pending'; id: string; pending: any };

async function canonicalRepositoryWithLegacyBackfill(): Promise<DroneLifecycleRepository | null> {
  const repository = await getDroneLifecycleRepository();
  if (!repository) return null;
  const registry = await loadRegistry();
  await repository.backfillLegacyInsertOnly(registry);
  return repository;
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

export async function upsertCanonicalDroneLifecycle(
  state: CanonicalDroneLifecycleState,
  droneId: string,
  entry: unknown,
): Promise<CanonicalDroneLifecycleRecord | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  return repository ? await repository.upsert(state, droneId, entry) : null;
}

export async function deleteCanonicalDroneLifecycle(
  droneId: string,
  state?: CanonicalDroneLifecycleState,
): Promise<CanonicalDroneLifecycleRecord | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  return repository ? await repository.delete(droneId, state) : null;
}

export async function patchCanonicalDroneLifecycle(
  state: CanonicalDroneLifecycleState,
  droneId: string,
  transform: (lifecycle: Record<string, any>) => Record<string, any>,
): Promise<CanonicalDroneLifecycleRecord | null> {
  const repository = await canonicalRepositoryWithLegacyBackfill();
  return repository ? await repository.patch(state, droneId, transform) : null;
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
    await repository.patch('real', opts.droneId, (entry) => {
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
    });
  }
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
