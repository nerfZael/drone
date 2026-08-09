import { DomainConflictError } from '../domain-errors';
import { ensureCanonicalGroup, listCanonicalGroups } from '../groups-repositories';
import { validateGroupName } from './group-name';

export type CreateGroupResult = {
  ok: true;
  id: string;
  repoPath: string;
  name: string;
  label?: string | null;
  parentId?: string | null;
  createdAt?: string | null;
};

export type CreateGroupDependencies = {
  listCanonicalGroups(repoPath?: string): Promise<Array<{ name: string }>>;
  ensureCanonicalGroup(
    name: string,
    repoPath: string,
    at: string,
  ): Promise<{
    id: string;
    repoPath: string;
    name: string;
    label?: string | null;
    parentId?: string | null;
    createdAt?: string | null;
  }>;
  nowIso(): string;
};

const defaultDependencies: CreateGroupDependencies = {
  listCanonicalGroups,
  ensureCanonicalGroup,
  nowIso: () => new Date().toISOString(),
};

export async function createGroup(
  input: { name: unknown; repoPath?: unknown; at?: string },
  dependencies: CreateGroupDependencies = defaultDependencies,
): Promise<CreateGroupResult> {
  const repoPath = String(input.repoPath ?? '').trim();
  const name = validateGroupName(input.name, 'group name');
  if ((await dependencies.listCanonicalGroups(repoPath)).some((group) => group.name === name)) {
    throw new DomainConflictError(`group already exists: ${name}`);
  }
  const group = await dependencies.ensureCanonicalGroup(
    name,
    repoPath,
    input.at ?? dependencies.nowIso(),
  );
  return {
    ok: true,
    id: group.id,
    repoPath: group.repoPath,
    name: group.name,
    label: group.label,
    parentId: group.parentId,
    createdAt: group.createdAt,
  };
}
