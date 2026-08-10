import { isWorkflowChildDroneEntry } from '../workflows/workflow-child-drone-metadata';
import { InvalidRequestError, ResourceNotFoundError } from '../domain-errors';
import { isUngroupedGroupName } from './group-name';

type GroupRecord = {
  id: string;
  repoPath: string;
  name: string;
};

export type DeleteGroupInput = {
  groupRef: string;
  repoPath: string;
  keepVolume: boolean;
  forget: boolean;
};

export type DeleteGroupResult = {
  ok: boolean;
  group: string;
  repoPath: string;
  removed: Array<{ id: string; name: string }>;
  total: number;
  deletedGroup?: boolean;
  errors?: Array<{
    id: string;
    name: string;
    error: string;
    removedRegistry: boolean;
  }>;
};

export type DeleteGroupDependencies = {
  listCanonicalGroups(): Promise<GroupRecord[]>;
  loadRegistry(): Promise<any>;
  normalizeDroneIdentity(value: unknown): string;
  deleteCanonicalGroupArtifacts(repoPath: string, group: string): Promise<unknown>;
  dequeueProvisioning(droneId: string): unknown;
  removeDroneById(input: {
    id: string;
    keepVolume: boolean;
    forget: boolean;
  }): Promise<{ removeErr?: string | null; removedRegistry: boolean }>;
  deleteCanonicalDroneLifecycleBatch(
    entries: Array<{ state: 'pending'; droneId: string }>,
    options: { ignoreMissing: boolean },
  ): Promise<unknown>;
};

export type DeleteGroupCommand = (input: DeleteGroupInput) => Promise<DeleteGroupResult>;

export function createDeleteGroupCommand(
  dependencies: DeleteGroupDependencies,
): DeleteGroupCommand {
  return async (input) => await deleteGroup(input, dependencies);
}

async function deleteGroup(
  input: DeleteGroupInput,
  dependencies: DeleteGroupDependencies,
): Promise<DeleteGroupResult> {
  const groupRef = String(input.groupRef ?? '').trim();
  if (!groupRef) throw new InvalidRequestError('invalid group name');
  const canonicalGroups = await dependencies.listCanonicalGroups();
  const requestedRepoPath = String(input.repoPath ?? '').trim();
  const referencedGroup =
    canonicalGroups.find((entry) => entry.id === groupRef) ??
    canonicalGroups.find(
      (entry) => entry.repoPath === requestedRepoPath && entry.name === groupRef,
    );
  if (!referencedGroup && !isUngroupedGroupName(groupRef)) {
    throw new ResourceNotFoundError(`unknown group: ${groupRef}`);
  }
  const group = referencedGroup?.name ?? groupRef;
  const wantsUngrouped = isUngroupedGroupName(group);
  const repoPath = referencedGroup?.repoPath ?? requestedRepoPath;
  const registry = await dependencies.loadRegistry();
  const groupExists =
    !wantsUngrouped &&
    canonicalGroups.some(
      (entry) => entry.repoPath === repoPath && isSameOrDescendantGroupPath(entry.name, group),
    );

  const realTargets = targetsFrom(registry.drones, repoPath, group, wantsUngrouped, dependencies);
  const pendingTargets = targetsFrom(
    registry.pending,
    repoPath,
    group,
    wantsUngrouped,
    dependencies,
  );
  const uniqueTargets = new Map<string, { id: string; name: string }>();
  for (const target of [...realTargets, ...pendingTargets]) {
    if (!uniqueTargets.has(target.id)) uniqueTargets.set(target.id, target);
  }
  const targets = [...uniqueTargets.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  if (targets.length === 0) {
    if (!groupExists) throw new ResourceNotFoundError(`unknown group (or empty): ${group}`);
    if (!wantsUngrouped) {
      await dependencies.deleteCanonicalGroupArtifacts(repoPath, group).catch(() => undefined);
    }
    return {
      ok: true,
      group,
      repoPath,
      removed: [],
      total: 0,
      deletedGroup: !wantsUngrouped,
    };
  }

  const removed: Array<{ id: string; name: string }> = [];
  const pendingDeleted: string[] = [];
  const errors: NonNullable<DeleteGroupResult['errors']> = [];
  for (const target of targets) {
    if (registry?.pending?.[target.id] && !registry?.drones?.[target.id]) {
      pendingDeleted.push(target.id);
      removed.push(target);
      dependencies.dequeueProvisioning(target.id);
      continue;
    }
    const result = await dependencies.removeDroneById({
      id: target.id,
      keepVolume: input.keepVolume,
      forget: input.forget,
    });
    if (result.removeErr) {
      errors.push({
        ...target,
        error: result.removeErr,
        removedRegistry: result.removedRegistry,
      });
    } else {
      removed.push(target);
    }
  }
  if (errors.length > 0) {
    return { ok: false, group, repoPath, removed, errors, total: targets.length };
  }

  try {
    await dependencies.deleteCanonicalDroneLifecycleBatch(
      pendingDeleted.map((droneId) => ({ state: 'pending', droneId })),
      { ignoreMissing: true },
    );
    if (!wantsUngrouped) {
      await dependencies.deleteCanonicalGroupArtifacts(repoPath, group);
    }
  } catch {
    // Drones are already deleted; metadata cleanup is best effort.
  }
  return {
    ok: true,
    group,
    repoPath,
    removed,
    total: targets.length,
    deletedGroup: !wantsUngrouped,
  };
}

function targetsFrom(
  entries: any,
  repoPath: string,
  group: string,
  wantsUngrouped: boolean,
  dependencies: Pick<DeleteGroupDependencies, 'normalizeDroneIdentity'>,
): Array<{ id: string; name: string }> {
  return (Object.entries(entries ?? {}) as Array<[string, any]>)
    .filter(([, drone]) => !isWorkflowChildDroneEntry(drone))
    .map(([id, drone]) => ({
      id: dependencies.normalizeDroneIdentity(id),
      name: String(drone?.name ?? '').trim(),
      group: String(drone?.group ?? '').trim(),
      repoPath: String(drone?.repoPath ?? '').trim(),
    }))
    .filter((target) => Boolean(target.id))
    .filter((target) => target.repoPath === repoPath)
    .filter((target) =>
      wantsUngrouped
        ? !target.group || isUngroupedGroupName(target.group)
        : isSameOrDescendantGroupPath(target.group, group),
    )
    .map((target) => ({ id: target.id, name: target.name || target.id }));
}

function isSameOrDescendantGroupPath(candidateRaw: unknown, groupRaw: unknown): boolean {
  const candidate = String(candidateRaw ?? '').trim();
  const group = String(groupRaw ?? '').trim();
  return Boolean(candidate && group && (candidate === group || candidate.startsWith(`${group}/`)));
}
