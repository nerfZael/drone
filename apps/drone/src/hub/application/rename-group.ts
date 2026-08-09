import { DomainConflictError, InvalidRequestError, ResourceNotFoundError } from '../domain-errors';
import { renameCanonicalGroupOrchestration } from '../group-orchestration';
import { listCanonicalGroups } from '../groups-repositories';
import { isUngroupedGroupName, validateGroupName } from './group-name';

export type RenameGroupResult = {
  ok: true;
  id?: string;
  repoPath?: string;
  oldName: string;
  newName: string;
  renamed: boolean;
  reason?: 'same-name';
  movedDrones?: number;
  movedPending?: number;
};

export type RenameGroupDependencies = {
  listCanonicalGroups(): Promise<Array<{ id: string; repoPath: string; name: string }>>;
  renameCanonicalGroupOrchestration(
    repoPath: string,
    oldName: string,
    newName: string,
    at?: string,
  ): Promise<
    | { ok: true; movedDrones: number; movedPending: number }
    | { ok: false; status: 404 | 409; error: string }
  >;
};

const defaultDependencies: RenameGroupDependencies = {
  listCanonicalGroups,
  renameCanonicalGroupOrchestration,
};

export async function renameGroup(
  input: { groupRef: string; repoPath?: string; newName: unknown; at?: string },
  dependencies: RenameGroupDependencies = defaultDependencies,
): Promise<RenameGroupResult> {
  const groupRef = String(input.groupRef ?? '').trim();
  if (!groupRef) throw new InvalidRequestError('invalid group name');
  const repoPath = String(input.repoPath ?? '').trim();
  const groups = await dependencies.listCanonicalGroups();
  const existing =
    groups.find((group) => group.id === groupRef) ??
    groups.find((group) => group.repoPath === repoPath && group.name === groupRef);
  if (!existing) throw new ResourceNotFoundError(`unknown group: ${groupRef}`);
  if (isUngroupedGroupName(existing.name)) {
    throw new InvalidRequestError('cannot rename Ungrouped');
  }
  const newName = validateGroupName(input.newName, 'newName');
  if (existing.name === newName) {
    return {
      ok: true,
      oldName: existing.name,
      newName,
      renamed: false,
      reason: 'same-name',
    };
  }

  const result = await dependencies.renameCanonicalGroupOrchestration(
    existing.repoPath,
    existing.name,
    newName,
    input.at,
  );
  if (!result.ok) {
    if (result.status === 404) throw new ResourceNotFoundError(result.error);
    throw new DomainConflictError(result.error);
  }
  return {
    ok: true,
    id: existing.id,
    repoPath: existing.repoPath,
    oldName: existing.name,
    newName,
    renamed: true,
    movedDrones: result.movedDrones,
    movedPending: result.movedPending,
  };
}
