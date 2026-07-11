import { loadRegistry } from '../host/registry';
import { setDroneGroupMetadataBatch } from './drone-metadata-commands';
import { listCanonicalDroneLifecycle } from './drone-lifecycle-service';
import {
  deleteCanonicalGroupTree,
  ensureCanonicalGroup,
  listCanonicalGroups,
  renameCanonicalGroupTree,
} from './groups-repositories';
import { transformStoredKanbanBoardSettings } from './hub-settings';
import type { TaskBoardState } from './task-board';

type ActiveLifecycleMembership = {
  state: 'real' | 'pending';
  droneId: string;
  group: string;
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

function renameGroupTaskSubtree(board: TaskBoardState, oldName: string, newName: string): TaskBoardState {
  return {
    taskTypes: board.taskTypes.slice(),
    lanes: board.lanes.map((lane) => ({
      ...lane,
      cards: lane.cards.map((card) => {
        if (card.scopeType !== 'group' || !isSameOrDescendantGroupPath(card.scopeValue, oldName)) return card;
        return { ...card, scopeValue: rewriteGroupPathPrefix(card.scopeValue, oldName, newName) };
      }),
    })),
  };
}

function removeGroupTaskSubtree(board: TaskBoardState, groupName: string): TaskBoardState {
  return {
    taskTypes: board.taskTypes.slice(),
    lanes: board.lanes.map((lane) => ({
      ...lane,
      cards: lane.cards.filter((card) =>
        card.scopeType !== 'group' || !isSameOrDescendantGroupPath(card.scopeValue, groupName)),
    })),
  };
}

async function activeLifecycleMemberships(): Promise<ActiveLifecycleMembership[]> {
  const [real, pending] = await Promise.all([
    listCanonicalDroneLifecycle('real'),
    listCanonicalDroneLifecycle('pending'),
  ]);
  if (real && pending) {
    return [
      ...real.map((record) => ({ state: 'real' as const, droneId: record.id, group: normalizeGroupName(record.lifecycle.group) })),
      ...pending.map((record) => ({ state: 'pending' as const, droneId: record.id, group: normalizeGroupName(record.lifecycle.group) })),
    ];
  }
  const registry: any = await loadRegistry();
  return [
    ...Object.entries(registry?.drones ?? {}).map(([key, entry]: [string, any]) => ({
      state: 'real' as const,
      droneId: String(entry?.id ?? key),
      group: normalizeGroupName(entry?.group),
    })),
    ...Object.entries(registry?.pending ?? {}).map(([key, entry]: [string, any]) => ({
      state: 'pending' as const,
      droneId: String(entry?.id ?? key),
      group: normalizeGroupName(entry?.group),
    })),
  ];
}

export async function renameCanonicalGroupOrchestration(
  oldNameRaw: string,
  newNameRaw: string,
  at = new Date().toISOString(),
): Promise<RenameGroupOrchestrationResult> {
  const oldName = normalizeGroupName(oldNameRaw);
  const newName = normalizeGroupName(newNameRaw);
  const [groups, memberships] = await Promise.all([listCanonicalGroups(), activeLifecycleMemberships()]);
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

  if (!hasOldEntry) await ensureCanonicalGroup(oldName, at);
  await renameCanonicalGroupTree(oldName, newName, at);

  const updates = memberships
    .filter((membership) => isSameOrDescendantGroupPath(membership.group, oldName))
    .map((membership) => ({
      state: membership.state,
      droneId: membership.droneId,
      group: rewriteGroupPathPrefix(membership.group, oldName, newName),
    }));
  await setDroneGroupMetadataBatch(updates, { ensureGroups: false });
  await transformStoredKanbanBoardSettings((board) => renameGroupTaskSubtree(board, oldName, newName));
  return {
    ok: true,
    movedDrones: updates.filter((update) => update.state === 'real').length,
    movedPending: updates.filter((update) => update.state === 'pending').length,
  };
}

export async function deleteCanonicalGroupArtifacts(groupNameRaw: string): Promise<string[]> {
  const groupName = normalizeGroupName(groupNameRaw);
  const removedGroupNames = await deleteCanonicalGroupTree(groupName);
  if (removedGroupNames.length === 0) return [];
  await transformStoredKanbanBoardSettings((board) => removeGroupTaskSubtree(board, groupName));
  return removedGroupNames;
}
