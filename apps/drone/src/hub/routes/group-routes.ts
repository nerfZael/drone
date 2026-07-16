import { parseBoolParam } from '../hub-format';
import type { HubRouter } from '../hub-router';

type GroupRecord = { name: string; createdAt?: string | null; updatedAt?: string | null };
type GroupTarget = { id: string; name: string; group: string; repoPath: string };

export type GroupRouteDependencies = {
  loadRegistry: () => Promise<any>;
  listCanonicalGroups: () => Promise<GroupRecord[]>;
  listAllKnownGroups: (registry: any) => string[];
  normalizeGroupName: (value: unknown) => string;
  isUngroupedGroupName: (value: string) => boolean;
  validateGroupNameOrThrow: (value: unknown, field: string) => string;
  nowIso: () => string;
  ensureCanonicalGroup: (name: string, at: string) => Promise<unknown>;
  renameCanonicalGroupOrchestration: (oldName: string, newName: string, at: string) => Promise<any>;
  isSameOrDescendantGroupPath: (candidate: string, group: string) => boolean;
  normalizeDroneIdentity: (value: unknown) => string;
  deleteCanonicalGroupArtifacts: (group: string) => Promise<unknown>;
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
    listAllKnownGroups,
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

  router.get('/api/groups', async ({ json }) => {
    const registry = await loadRegistry();
    const canonical = await listCanonicalGroups();
    const names = Array.from(
      new Set([
        ...canonical.map((group) => group.name),
        ...listAllKnownGroups({ ...registry, groups: {} }),
      ]),
    ).sort((left, right) => left.localeCompare(right));
    const canonicalByName = new Map(canonical.map((group) => [group.name, group]));
    const counts = new Map<string, { drones: number; pending: number }>();

    const count = (entries: any, kind: 'drones' | 'pending') => {
      for (const drone of Object.values(entries ?? {}) as any[]) {
        const group = normalizeGroupName(drone?.group);
        if (!group || isUngroupedGroupName(group)) continue;
        const current = counts.get(group) ?? { drones: 0, pending: 0 };
        current[kind] += 1;
        counts.set(group, current);
      }
    };
    count(registry.drones, 'drones');
    count(registry.pending, 'pending');

    const groups = names.map((name) => {
      const entry = canonicalByName.get(name);
      const totals = counts.get(name) ?? { drones: 0, pending: 0 };
      return {
        name,
        createdAt: typeof entry?.createdAt === 'string' ? entry.createdAt : null,
        updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : null,
        droneCount: totals.drones,
        pendingCount: totals.pending,
        totalCount: totals.drones + totals.pending,
      };
    });
    json(200, { ok: true, groups, total: groups.length });
  });

  router.post('/api/groups', async ({ readJson, fail, json }) => {
    const body = await readJson<any>();
    let name = '';
    try {
      name = validateGroupNameOrThrow(
        body?.name ?? body?.group ?? body?.groupName ?? body?.groupId ?? '',
        'group name',
      );
    } catch (error: any) {
      return fail(400, error?.message ?? String(error));
    }
    const at = nowIso();
    if ((await listCanonicalGroups()).some((group) => group.name === name)) {
      return fail(409, `group already exists: ${name}`);
    }
    await ensureCanonicalGroup(name, at);
    json(201, { ok: true, name, createdAt: at });
  });

  router.post('/api/groups/:groupName/rename', async ({ params, readJson, fail, json }) => {
    const oldName = normalizeGroupName(params.groupName);
    if (!oldName) return fail(400, 'invalid group name');
    if (isUngroupedGroupName(oldName)) return fail(400, 'cannot rename Ungrouped');

    const body = await readJson<any>();
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
    const result = await renameCanonicalGroupOrchestration(oldName, newName, nowIso());
    if (!result.ok) return fail(result.status ?? 500, result.error ?? 'failed to rename group');
    json(200, {
      ok: true,
      oldName,
      newName,
      renamed: true,
      movedDrones: result.movedDrones,
      movedPending: result.movedPending,
    });
  });

  router.delete('/api/groups/:groupName', async ({ params, url, fail, json }) => {
    const group = params.groupName.trim();
    if (!group) return fail(400, 'invalid group name');

    const keepVolume = parseBoolParam(url.searchParams.get('keepVolume'), false);
    const forget = parseBoolParam(url.searchParams.get('forget'), true);
    const wantsUngrouped = isUngroupedGroupName(group);
    const scopedRepoPath = String(url.searchParams.get('repoPath') ?? '').trim();
    const registry = await loadRegistry();
    const groupExists =
      !wantsUngrouped &&
      (await listCanonicalGroups()).some((entry) => isSameOrDescendantGroupPath(entry.name, group));

    const targetsFrom = (entries: any): GroupTarget[] =>
      (Object.entries(entries ?? {}) as Array<[string, any]>)
        .map(([id, drone]) => ({
          id: normalizeDroneIdentity(id),
          name: String(drone?.name ?? '').trim(),
          group: String(drone?.group ?? '').trim(),
          repoPath: String(drone?.repoPath ?? '').trim(),
        }))
        .filter((target) => Boolean(target.id))
        .filter((target) => !scopedRepoPath || target.repoPath === scopedRepoPath)
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
      if (scopedRepoPath || !groupExists) return fail(404, `unknown group (or empty): ${group}`);
      await deleteCanonicalGroupArtifacts(group).catch(() => undefined);
      json(200, { ok: true, group, removed: [], total: 0, deletedGroup: true });
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
      if (!scopedRepoPath && !wantsUngrouped) await deleteCanonicalGroupArtifacts(group);
    } catch {
      // Drones are already deleted; metadata cleanup is best effort.
    }
    json(200, {
      ok: true,
      group,
      removed,
      total: targets.length,
      deletedGroup: !scopedRepoPath && !wantsUngrouped,
      ...(scopedRepoPath ? { repoPath: scopedRepoPath } : {}),
    });
  });
}
