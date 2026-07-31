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
  listCanonicalGroups: (repoPath?: string) => Promise<GroupRecord[]>;
  normalizeGroupName: (value: unknown) => string;
  isUngroupedGroupName: (value: string) => boolean;
  validateGroupNameOrThrow: (value: unknown, field: string) => string;
  nowIso: () => string;
  ensureCanonicalGroup: (name: string, repoPath: string, at: string) => Promise<GroupRecord>;
  renameCanonicalGroupOrchestration: (
    repoPath: string,
    oldName: string,
    newName: string,
    at: string,
  ) => Promise<any>;
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
    listCanonicalGroups,
    normalizeGroupName,
    isUngroupedGroupName,
    validateGroupNameOrThrow,
    nowIso,
    ensureCanonicalGroup,
    renameCanonicalGroupOrchestration,
    isSameOrDescendantGroupPath,
    normalizeDroneIdentity,
    deleteCanonicalGroupArtifacts,
    dequeueProvisioning,
    removeDroneById,
    deleteCanonicalDroneLifecycleBatch,
  } = deps;

  router.get('/api/groups', async ({ url, json }) => {
    const registry = await loadRegistry();
    const requestedRepoPath = url.searchParams.has('repoPath')
      ? String(url.searchParams.get('repoPath') ?? '').trim()
      : undefined;
    const canonical = await listCanonicalGroups(requestedRepoPath);
    const canonicalById = new Map(canonical.map((group) => [group.id, group]));
    const canonicalByScopeAndName = new Map(
      canonical.map((group) => [`${group.repoPath}\0${group.name}`, group]),
    );
    const counts = new Map<string, { drones: number; pending: number }>();

    const count = (entries: any, kind: 'drones' | 'pending') => {
      for (const drone of Object.values(entries ?? {}) as any[]) {
        if (isWorkflowChildDroneEntry(drone)) continue;
        const group = normalizeGroupName(drone?.group);
        if (!group || isUngroupedGroupName(group)) continue;
        const repoPath = String(drone?.repoPath ?? '').trim();
        if (requestedRepoPath !== undefined && repoPath !== requestedRepoPath) continue;
        const groupId = String(drone?.groupId ?? '').trim();
        const referenced = canonicalById.get(groupId);
        const canonicalGroup = referenced?.repoPath === repoPath
          ? referenced
          : canonicalByScopeAndName.get(`${repoPath}\0${group}`);
        if (!canonicalGroup) continue;
        const current = counts.get(canonicalGroup.id) ?? { drones: 0, pending: 0 };
        current[kind] += 1;
        counts.set(canonicalGroup.id, current);
      }
    };
    count(registry.drones, 'drones');
    count(registry.pending, 'pending');

    const groups = canonical.map((entry) => {
      const totals = counts.get(entry.id) ?? { drones: 0, pending: 0 };
      return {
        id: entry.id,
        repoPath: entry.repoPath,
        name: entry.name,
        label: entry.label ?? entry.name.slice(entry.name.lastIndexOf('/') + 1),
        parentId: entry.parentId ?? null,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
        droneCount: totals.drones,
        pendingCount: totals.pending,
        totalCount: totals.drones + totals.pending,
      };
    });
    json(200, { ok: true, groups, total: groups.length });
  });

  router.post('/api/groups', async ({ readJson, fail, json }) => {
    const body = await readJson<any>();
    const repoPath = String(body?.repoPath ?? '').trim();
    let name = '';
    try {
      name = validateGroupNameOrThrow(
        body?.name ?? body?.group ?? body?.groupName ?? '',
        'group name',
      );
    } catch (error: any) {
      return fail(400, error?.message ?? String(error));
    }
    const at = nowIso();
    if ((await listCanonicalGroups(repoPath)).some((group) => group.name === name)) {
      return fail(409, `group already exists: ${name}`);
    }
    const group = await ensureCanonicalGroup(name, repoPath, at);
    json(201, { ok: true, id: group.id, repoPath: group.repoPath, name: group.name,
      label: group.label, parentId: group.parentId, createdAt: group.createdAt });
  });

  router.post('/api/groups/:groupName/rename', async ({ params, readJson, fail, json }) => {
    const groupRef = normalizeGroupName(params.groupName);
    const body = await readJson<any>();
    const requestedRepoPath = String(body?.repoPath ?? '').trim();
    const allGroups = await listCanonicalGroups();
    const existing = allGroups.find((group) => group.id === groupRef) ??
      allGroups.find((group) => group.repoPath === requestedRepoPath && group.name === groupRef);
    if (!existing) return fail(404, `unknown group: ${groupRef}`);
    const oldName = existing?.name ?? groupRef;
    if (!oldName) return fail(400, 'invalid group name');
    if (isUngroupedGroupName(oldName)) return fail(400, 'cannot rename Ungrouped');

    let newName = '';
    try {
      newName = validateGroupNameOrThrow(body?.newName ?? body?.name ?? '', 'newName');
    } catch (error: any) {
      return fail(400, error?.message ?? String(error));
    }
    if (oldName === newName) {
      json(200, { ok: true, oldName, newName, renamed: false, reason: 'same-name' });
      return;
    }
    const result = await renameCanonicalGroupOrchestration(existing.repoPath, oldName, newName, nowIso());
    if (!result.ok) return fail(result.status ?? 500, result.error ?? 'failed to rename group');
    json(200, {
      ok: true,
      id: existing?.id ?? null,
      repoPath: existing.repoPath,
      oldName,
      newName,
      renamed: true,
      movedDrones: result.movedDrones,
      movedPending: result.movedPending,
    });
  });

  router.delete('/api/groups/:groupName', async ({ params, url, fail, json }) => {
    const groupRef = params.groupName.trim();
    const canonicalGroups = await listCanonicalGroups();
    const requestedRepoPath = String(url.searchParams.get('repoPath') ?? '').trim();
    const referencedGroup = canonicalGroups.find((entry) => entry.id === groupRef) ??
      canonicalGroups.find((entry) => entry.repoPath === requestedRepoPath && entry.name === groupRef);
    if (!referencedGroup && !isUngroupedGroupName(groupRef)) return fail(404, `unknown group: ${groupRef}`);
    const group = referencedGroup?.name ?? groupRef;
    if (!group) return fail(400, 'invalid group name');

    const keepVolume = parseBoolParam(url.searchParams.get('keepVolume'), false);
    const forget = parseBoolParam(url.searchParams.get('forget'), true);
    const wantsUngrouped = isUngroupedGroupName(group);
    const scopedRepoPath = referencedGroup?.repoPath ?? requestedRepoPath;
    const registry = await loadRegistry();
    const groupExists =
      !wantsUngrouped &&
      canonicalGroups.some((entry) => entry.repoPath === scopedRepoPath &&
        isSameOrDescendantGroupPath(entry.name, group));

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
      json(200, { ok: true, group, repoPath: scopedRepoPath,
        removed: [], total: 0, deletedGroup: !wantsUngrouped });
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
