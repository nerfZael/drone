import { loadRegistry } from '../host/registry';
import { setDroneGroupMetadataBatch } from './drone-metadata-commands';
import { listCanonicalDroneLifecycle } from './drone-lifecycle-service';
import {
  deleteCanonicalGroupTree,
  ensureCanonicalGroup,
  listCanonicalGroups,
  renameCanonicalGroupTree,
} from './groups-repositories';

type ActiveLifecycleMembership = {
  state: 'real' | 'pending';
  droneId: string;
  group: string;
  repoPath: string;
};

export type RenameGroupOrchestrationResult =
  | { ok: true; movedDrones: number; movedPending: number }
  | { ok: false; status: 404 | 409; error: string };

function normalizeGroupName(raw: unknown): string {
  return String(raw ?? '').trim();
}

function isSameOrDescendantGroupPath(pathRaw: unknown, prefixRaw: unknown): boolean {
  const path = normalizeGroupName(pathRaw);
  const prefix = normalizeGroupName(prefixRaw);
  return Boolean(path && prefix && (path === prefix || path.startsWith(`${prefix}/`)));
}

function rewriteGroupPathPrefix(pathRaw: unknown, oldName: string, newName: string): string {
  const path = normalizeGroupName(pathRaw);
  if (path === oldName) return newName;
  return `${newName}/${path.slice(oldName.length + 1)}`;
}

async function activeLifecycleMemberships(): Promise<ActiveLifecycleMembership[]> {
  const [real, pending] = await Promise.all([
    listCanonicalDroneLifecycle('real'),
    listCanonicalDroneLifecycle('pending'),
  ]);
  if (real && pending) {
    return [
      ...real.map((record) => ({ state: 'real' as const, droneId: record.id,
        group: normalizeGroupName(record.lifecycle.group), repoPath: normalizeGroupName(record.lifecycle.repoPath) })),
      ...pending.map((record) => ({ state: 'pending' as const, droneId: record.id,
        group: normalizeGroupName(record.lifecycle.group), repoPath: normalizeGroupName(record.lifecycle.repoPath) })),
    ];
  }
  const registry: any = await loadRegistry();
  return [
    ...Object.entries(registry?.drones ?? {}).map(([key, entry]: [string, any]) => ({
      state: 'real' as const,
      droneId: String(entry?.id ?? key),
      group: normalizeGroupName(entry?.group),
      repoPath: normalizeGroupName(entry?.repoPath),
    })),
    ...Object.entries(registry?.pending ?? {}).map(([key, entry]: [string, any]) => ({
      state: 'pending' as const,
      droneId: String(entry?.id ?? key),
      group: normalizeGroupName(entry?.group),
      repoPath: normalizeGroupName(entry?.repoPath),
    })),
  ];
}

export async function renameCanonicalGroupOrchestration(
  repoPathRaw: string,
  oldNameRaw: string,
  newNameRaw: string,
  at = new Date().toISOString(),
): Promise<RenameGroupOrchestrationResult> {
  const repoPath = normalizeGroupName(repoPathRaw);
  const oldName = normalizeGroupName(oldNameRaw);
  const newName = normalizeGroupName(newNameRaw);
  const [groups, allMemberships] = await Promise.all([
    listCanonicalGroups(repoPath),
    activeLifecycleMemberships(),
  ]);
  const memberships = allMemberships.filter((membership) => membership.repoPath === repoPath);
  const groupNames = groups.map((group) => group.name);
  const usedOld = memberships.some((membership) => isSameOrDescendantGroupPath(membership.group, oldName));
  const usedNew = memberships.some((membership) => isSameOrDescendantGroupPath(membership.group, newName));
  const hasOldEntry = groupNames.some((name) => isSameOrDescendantGroupPath(name, oldName));
  if (!hasOldEntry && !usedOld) return { ok: false, status: 404, error: `unknown group: ${oldName}` };
  const collidesWithExistingGroup = groupNames.some((name) =>
    !isSameOrDescendantGroupPath(name, oldName) && isSameOrDescendantGroupPath(name, newName));
  if (collidesWithExistingGroup || usedNew) {
    return { ok: false, status: 409, error: `group already exists: ${newName}` };
  }

  if (!hasOldEntry) await ensureCanonicalGroup(oldName, repoPath, at);
  await renameCanonicalGroupTree(repoPath, oldName, newName, at);

  const updates = memberships
    .filter((membership) => isSameOrDescendantGroupPath(membership.group, oldName))
    .map((membership) => ({
      state: membership.state,
      droneId: membership.droneId,
      group: rewriteGroupPathPrefix(membership.group, oldName, newName),
      repoPath,
    }));
  await setDroneGroupMetadataBatch(updates, { ensureGroups: false });
  return {
    ok: true,
    movedDrones: updates.filter((update) => update.state === 'real').length,
    movedPending: updates.filter((update) => update.state === 'pending').length,
  };
}

export async function deleteCanonicalGroupArtifacts(
  repoPathRaw: string,
  groupNameRaw: string,
): Promise<string[]> {
  const repoPath = normalizeGroupName(repoPathRaw);
  const groupName = normalizeGroupName(groupNameRaw);
  const removedGroupNames = await deleteCanonicalGroupTree(repoPath, groupName);
  if (removedGroupNames.length === 0) return [];
  return removedGroupNames;
}
