import { parseBoolParam } from '../hub-format';
import type { HubRouter } from '../hub-router';
import { isWorkflowChildDroneEntry } from '../workflows/workflow-child-drone-metadata';

type GroupRecord = {
  id: string;
  repoPath: string;
  name: string;
  label?: string | null;
  parentId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};
type GroupTarget = { id: string; name: string; group: string; repoPath: string };

export type GroupRouteDependencies = {
  loadRegistry: () => Promise<any>;
  listGroups: (repoPath?: string) => Promise<unknown>;
  listCanonicalGroups: (repoPath?: string) => Promise<GroupRecord[]>;
  isUngroupedGroupName: (value: string) => boolean;
  nowIso: () => string;
  createGroup: (input: { name: unknown; repoPath?: unknown; at?: string }) => Promise<unknown>;
  renameGroup: (input: {
    groupRef: string;
    repoPath?: string;
    newName: unknown;
    at?: string;
  }) => Promise<unknown>;
  isSameOrDescendantGroupPath: (candidate: string, group: string) => boolean;
  normalizeDroneIdentity: (value: unknown) => string;
  deleteCanonicalGroupArtifacts: (repoPath: string, group: string) => Promise<unknown>;
  dequeueProvisioning: (droneId: string) => unknown;
  removeDroneById: (input: {
    id: string;
    keepVolume: boolean;
    forget: boolean;
  }) => Promise<{ removeErr?: string | null; removedRegistry: boolean }>;
  deleteCanonicalDroneLifecycleBatch: (
    entries: Array<{ state: 'pending'; droneId: string }>,
    options: { ignoreMissing: boolean },
  ) => Promise<unknown>;
};

export function registerGroupRoutes(router: HubRouter, deps: GroupRouteDependencies): void {
  const {
    loadRegistry,
    listGroups,
    listCanonicalGroups,
    isUngroupedGroupName,
    nowIso,
    createGroup,
    renameGroup,
    isSameOrDescendantGroupPath,
    normalizeDroneIdentity,
    deleteCanonicalGroupArtifacts,
    dequeueProvisioning,
    removeDroneById,
    deleteCanonicalDroneLifecycleBatch,
  } = deps;

  router.get('/api/groups', async ({ url, json }) => {
    const requestedRepoPath = url.searchParams.has('repoPath')
      ? String(url.searchParams.get('repoPath') ?? '').trim()
      : undefined;
    json(200, await listGroups(requestedRepoPath));
  });

  router.post('/api/groups', async ({ readJson, json }) => {
    const body = await readJson<any>();
    json(
      201,
      await createGroup({
        name: body?.name ?? body?.group ?? body?.groupName ?? '',
        repoPath: body?.repoPath,
        at: nowIso(),
      }),
    );
  });

  router.post('/api/groups/:groupName/rename', async ({ params, readJson, json }) => {
    const body = await readJson<any>();
    json(
      200,
      await renameGroup({
        groupRef: params.groupName,
        repoPath: String(body?.repoPath ?? '').trim(),
        newName: body?.newName ?? body?.name ?? '',
        at: nowIso(),
      }),
    );
  });

  router.delete('/api/groups/:groupName', async ({ params, url, fail, json }) => {
    const groupRef = params.groupName.trim();
    const canonicalGroups = await listCanonicalGroups();
    const requestedRepoPath = String(url.searchParams.get('repoPath') ?? '').trim();
    const referencedGroup =
      canonicalGroups.find((entry) => entry.id === groupRef) ??
      canonicalGroups.find(
        (entry) => entry.repoPath === requestedRepoPath && entry.name === groupRef,
      );
    if (!referencedGroup && !isUngroupedGroupName(groupRef))
      return fail(404, `unknown group: ${groupRef}`);
    const group = referencedGroup?.name ?? groupRef;
    if (!group) return fail(400, 'invalid group name');

    const keepVolume = parseBoolParam(url.searchParams.get('keepVolume'), false);
    const forget = parseBoolParam(url.searchParams.get('forget'), true);
    const wantsUngrouped = isUngroupedGroupName(group);
    const scopedRepoPath = referencedGroup?.repoPath ?? requestedRepoPath;
    const registry = await loadRegistry();
    const groupExists =
      !wantsUngrouped &&
      canonicalGroups.some(
        (entry) =>
          entry.repoPath === scopedRepoPath && isSameOrDescendantGroupPath(entry.name, group),
      );

    const targetsFrom = (entries: any): GroupTarget[] =>
      (Object.entries(entries ?? {}) as Array<[string, any]>)
        .filter(([, drone]) => !isWorkflowChildDroneEntry(drone))
        .map(([id, drone]) => ({
          id: normalizeDroneIdentity(id),
          name: String(drone?.name ?? '').trim(),
          group: String(drone?.group ?? '').trim(),
          repoPath: String(drone?.repoPath ?? '').trim(),
        }))
        .filter((target) => Boolean(target.id))
        .filter((target) => target.repoPath === scopedRepoPath)
        .filter((target) =>
          wantsUngrouped
            ? !target.group || isUngroupedGroupName(target.group)
            : isSameOrDescendantGroupPath(target.group, group),
        );

    const realTargets = targetsFrom(registry.drones);
    const pendingTargets = targetsFrom(registry.pending);
    const uniqueTargets = new Map<string, { id: string; name: string }>();
    for (const target of [...realTargets, ...pendingTargets]) {
      if (!uniqueTargets.has(target.id)) {
        uniqueTargets.set(target.id, { id: target.id, name: target.name || target.id });
      }
    }
    const targets = Array.from(uniqueTargets.values()).sort((left, right) =>
      (left.name || left.id).localeCompare(right.name || right.id),
    );

    if (targets.length === 0) {
      if (!groupExists) return fail(404, `unknown group (or empty): ${group}`);
      if (!wantsUngrouped) {
        await deleteCanonicalGroupArtifacts(scopedRepoPath, group).catch(() => undefined);
      }
      json(200, {
        ok: true,
        group,
        repoPath: scopedRepoPath,
        removed: [],
        total: 0,
        deletedGroup: !wantsUngrouped,
      });
      return;
    }

    const removed: Array<{ id: string; name: string }> = [];
    const pendingDeleted: string[] = [];
    const errors: Array<{ id: string; name: string; error: string; removedRegistry: boolean }> = [];
    for (const target of targets) {
      if (registry?.pending?.[target.id] && !registry?.drones?.[target.id]) {
        pendingDeleted.push(target.id);
        removed.push(target);
        dequeueProvisioning(target.id);
        continue;
      }
      const result = await removeDroneById({ id: target.id, keepVolume, forget });
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
      json(500, { ok: false, group, removed, errors, total: targets.length });
      return;
    }

    try {
      await deleteCanonicalDroneLifecycleBatch(
        pendingDeleted.map((droneId) => ({ state: 'pending', droneId })),
        { ignoreMissing: true },
      );
      if (!wantsUngrouped) await deleteCanonicalGroupArtifacts(scopedRepoPath, group);
    } catch {
      // Drones are already deleted; metadata cleanup is best effort.
    }
    json(200, {
      ok: true,
      group,
      removed,
      total: targets.length,
      deletedGroup: !wantsUngrouped,
      repoPath: scopedRepoPath,
    });
  });
}
