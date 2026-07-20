import { getDroneLifecycleRepository, type CanonicalDroneLifecycleRecord, type CanonicalDroneLifecycleState } from '../host/drone-lifecycle-repository';
import { loadRegistry, updateRegistry } from '../host/registry';
import { findDroneEntryByIdentity, normalizeDroneIdentity } from './drone-lifecycle-registry';
import { ensureCanonicalGroup } from './groups-repositories';
import { patchCanonicalDroneLifecycleBatch } from './drone-lifecycle-service';

export type DroneMetadataCommandDependencies = {
  project?: (record: CanonicalDroneLifecycleRecord) => Promise<void>;
};

async function repositoryWithBackfill() {
  const repository = await getDroneLifecycleRepository();
  if (!repository) {
    if ((globalThis as any).Bun) return null;
    throw new Error('canonical drone lifecycle repository is unavailable');
  }
  await repository.backfillLegacyInsertOnly(await loadRegistry());
  return repository;
}

export async function commitDroneMetadataPatch(opts: {
  droneId: string;
  state?: CanonicalDroneLifecycleState;
  eventType: string;
  transform: (lifecycle: Record<string, any>) => Record<string, any>;
  payload?: Record<string, unknown>;
  dependencies?: DroneMetadataCommandDependencies;
}): Promise<CanonicalDroneLifecycleRecord> {
  const repository = await repositoryWithBackfill();
  if (!repository) {
    const state = opts.state ?? 'real';
    return await updateRegistry((registry: any) => {
      const bucketName = state === 'real' ? 'drones' : state === 'pending' ? 'pending' : 'archived';
      const bucket = registry?.[bucketName];
      const found = findDroneEntryByIdentity({ drones: bucket }, opts.droneId);
      if (!found) throw new Error(`unknown drone: ${opts.droneId}`);
      const current = found.entry;
      const chats = current.chats;
      const archivedChats = current.archivedChats;
      const next = opts.transform({ ...current });
      if (chats !== undefined) next.chats = chats;
      if (archivedChats !== undefined) next.archivedChats = archivedChats;
      registry[bucketName][found.key] = next;
      const runtimeRaw = next.runtime;
      const stableId = normalizeDroneIdentity(next.id) || normalizeDroneIdentity(opts.droneId);
      return {
        state,
        id: stableId,
        name: String(next.name ?? stableId),
        containerName: String(next.containerName ?? '').trim() || null,
        runtimeKind: String(runtimeRaw && typeof runtimeRaw === 'object' ? runtimeRaw.kind : runtimeRaw ?? 'container'),
        phase: String(next.phase ?? '').trim() || null,
        archivedAt: state === 'archived' ? String(next.archivedAt ?? '').trim() || null : null,
        deleteAt: state === 'archived' ? String(next.deleteAt ?? '').trim() || null : null,
        archiveRetention: state === 'archived' ? String(next.archiveRetention ?? '').trim() || null : null,
        archiveRuntimePolicy: state === 'archived' ? String(next.archiveRuntimePolicy ?? '').trim() || null : null,
        lifecycle: next,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
    });
  }
  const current = repository.get(opts.droneId);
  if (!current) throw new Error(`unknown drone: ${opts.droneId}`);
  const state = opts.state ?? current.state;
  if (current.state !== state) throw new Error(`drone ${opts.droneId} is ${current.state}, not ${state}`);
  const record = await repository.commitPatch(state, opts.droneId, opts.transform, {
    topic: 'drone.lifecycle.changes',
    eventType: opts.eventType,
    payload: { id: opts.droneId, state, ...(opts.payload ?? {}) },
  });
  if (!record) throw new Error(`unknown drone: ${opts.droneId}`);
  if (opts.dependencies?.project) {
    try {
      await opts.dependencies.project(record);
    } catch {
      // Compatibility projection cannot invalidate a committed canonical command.
    }
  }
  return record;
}

export async function setDroneEnvironmentMetadata(opts: {
  droneId: string;
  state?: 'real' | 'pending';
  environment: { vars: Record<string, string>; useRepoVars: boolean; disabledRepoKeys: string[]; updatedAt: string };
  dependencies?: DroneMetadataCommandDependencies;
}): Promise<CanonicalDroneLifecycleRecord> {
  return await commitDroneMetadataPatch({
    ...opts,
    eventType: 'drone.environment.changed',
    payload: { fields: ['environment'] },
    transform: (lifecycle) => ({ ...lifecycle, environment: opts.environment }),
  });
}

export async function updateDroneFleetMetadata(opts: {
  droneId: string;
  transform: (fleet: Record<string, any>) => Record<string, any>;
  dependencies?: DroneMetadataCommandDependencies;
}): Promise<CanonicalDroneLifecycleRecord> {
  return await commitDroneMetadataPatch({
    droneId: opts.droneId,
    state: 'real',
    eventType: 'drone.fleet.changed',
    payload: { fields: ['fleet'] },
    dependencies: opts.dependencies,
    transform: (lifecycle) => ({ ...lifecycle, fleet: opts.transform(lifecycle.fleet && typeof lifecycle.fleet === 'object' ? { ...lifecycle.fleet } : {}) }),
  });
}

export async function renameDroneDisplayName(opts: {
  droneId: string;
  state?: 'real' | 'pending';
  name: string;
  dependencies?: DroneMetadataCommandDependencies;
}): Promise<CanonicalDroneLifecycleRecord> {
  const record = await commitDroneMetadataPatch({
    droneId: opts.droneId,
    state: opts.state,
    eventType: 'drone.display-name.changed',
    payload: { name: opts.name },
    dependencies: opts.dependencies,
    transform: (lifecycle) => ({ ...lifecycle, name: opts.name }),
  });
  if ((globalThis as any).Bun) {
    await updateRegistry((registry: any) => {
      for (const bucketName of ['drones', 'pending', 'archived']) {
        const found = findDroneEntryByIdentity({ drones: registry?.[bucketName] }, opts.droneId);
        if (found) found.entry.name = opts.name;
      }
    });
  }
  return record;
}

export async function setDroneGroupMetadata(opts: {
  droneId: string;
  state?: 'real' | 'pending';
  group: string | null;
  dependencies?: DroneMetadataCommandDependencies;
}): Promise<CanonicalDroneLifecycleRecord> {
  if (opts.group) await ensureCanonicalGroup(opts.group);
  return await commitDroneMetadataPatch({
    droneId: opts.droneId,
    state: opts.state,
    eventType: opts.group ? 'drone.group.set' : 'drone.group.cleared',
    payload: { group: opts.group },
    dependencies: opts.dependencies,
    transform: (lifecycle) => {
      const next = { ...lifecycle };
      if (opts.group) next.group = opts.group;
      else delete next.group;
      return next;
    },
  });
}

export async function setDroneGroupMetadataBatch(
  updates: Array<{ droneId: string; state: 'real' | 'pending'; group: string | null }>,
  options: { ensureGroups?: boolean } = {},
): Promise<CanonicalDroneLifecycleRecord[]> {
  if (options.ensureGroups !== false) {
    for (const group of new Set(updates.map((update) => update.group).filter((group): group is string => Boolean(group)))) {
      await ensureCanonicalGroup(group);
    }
  }
  return await patchCanonicalDroneLifecycleBatch(updates.map((update) => ({
    state: update.state,
    droneId: update.droneId,
    eventType: update.group ? 'drone.group.set' : 'drone.group.cleared',
    payload: { group: update.group },
    transform: (lifecycle) => {
      const next = { ...lifecycle };
      if (update.group) next.group = update.group;
      else delete next.group;
      return next;
    },
  })));
}
