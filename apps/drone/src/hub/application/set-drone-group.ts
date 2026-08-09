import { InvalidRequestError, ResourceNotFoundError } from '../domain-errors';
import { normalizeDroneIdentity } from '../drone-lifecycle-registry';
import { resolveDroneOrPendingForReadRef } from '../drone-lifecycle-service';
import { setDroneGroupMetadata } from '../drone-metadata-commands';
import { resolveCanonicalGroupReference } from '../groups-repositories';
import { isUngroupedGroupName, validateGroupName } from './group-name';

export type SetDroneGroupResult = {
  ok: true;
  group: string | null;
  moved: Array<{
    id: string;
    name: string;
    previousGroup: string | null;
    group: string | null;
    groupId: string | null;
    repoPath: string;
  }>;
  rejected: Array<{ id: string; error: string }>;
  total: number;
};

export type SetDroneGroupDependencies = {
  normalizeDroneIdentity(value: unknown): string;
  resolveCanonicalGroupReference(ref: string): Promise<{ name: string; repoPath: string } | null>;
  resolveDrone(
    ref: string,
  ): Promise<
    { kind: 'real'; id: string; drone: any } | { kind: 'pending'; id: string; pending: any } | null
  >;
  setDroneGroupMetadata(input: {
    droneId: string;
    state: 'real' | 'pending';
    group: string | null;
    repoPath: string;
  }): Promise<{ name: string; lifecycle: Record<string, any> }>;
};

const defaultDependencies: SetDroneGroupDependencies = {
  normalizeDroneIdentity,
  resolveCanonicalGroupReference,
  resolveDrone: resolveDroneOrPendingForReadRef,
  setDroneGroupMetadata,
};

export async function setDroneGroup(
  input: { droneIds: unknown[]; group?: unknown; groupId?: unknown },
  dependencies: SetDroneGroupDependencies = defaultDependencies,
): Promise<SetDroneGroupResult> {
  if (!Array.isArray(input.droneIds) || input.droneIds.length === 0) {
    throw new InvalidRequestError('missing droneIds (expected non-empty array)');
  }
  const droneIds: string[] = [];
  const seen = new Set<string>();
  for (const rawId of input.droneIds) {
    const droneId = dependencies.normalizeDroneIdentity(String(rawId ?? '').trim());
    if (!droneId) throw new InvalidRequestError('invalid drone id (empty)');
    if (seen.has(droneId)) continue;
    seen.add(droneId);
    droneIds.push(droneId);
  }

  const groupRaw = input.groupId ?? input.group;
  if (!(groupRaw == null || typeof groupRaw === 'string')) {
    throw new InvalidRequestError('invalid group (expected string or null)');
  }
  const groupValue = String(groupRaw ?? '').trim();
  const hasGroupId = typeof input.groupId === 'string' && input.groupId.trim().length > 0;
  const referencedGroup = hasGroupId
    ? await dependencies.resolveCanonicalGroupReference(groupValue)
    : null;
  if (hasGroupId && !referencedGroup) {
    throw new ResourceNotFoundError(`unknown group: ${groupValue}`);
  }
  const resolvedGroup = referencedGroup?.name ?? groupValue;
  const group =
    !resolvedGroup || isUngroupedGroupName(resolvedGroup) ? null : validateGroupName(resolvedGroup);
  const moved: SetDroneGroupResult['moved'] = [];
  const rejected: SetDroneGroupResult['rejected'] = [];

  for (const droneId of droneIds) {
    try {
      const resolved = await dependencies.resolveDrone(droneId);
      if (!resolved) throw new Error(`unknown drone: ${droneId}`);
      const source = resolved.kind === 'real' ? resolved.drone : resolved.pending;
      const repoPath = String(source?.repoPath ?? '').trim();
      if (referencedGroup && referencedGroup.repoPath !== repoPath) {
        throw new Error('group belongs to a different repository');
      }
      const previousRaw = String(source?.group ?? '').trim();
      const previousGroup = !previousRaw || isUngroupedGroupName(previousRaw) ? null : previousRaw;
      if (previousGroup === group) continue;
      const record = await dependencies.setDroneGroupMetadata({
        droneId,
        state: resolved.kind,
        group,
        repoPath,
      });
      moved.push({
        id: droneId,
        name: record.name,
        previousGroup,
        group,
        groupId: String(record.lifecycle.groupId ?? '').trim() || null,
        repoPath,
      });
    } catch (error: any) {
      rejected.push({ id: droneId, error: String(error?.message ?? error) });
    }
  }
  return { ok: true, group, moved, rejected, total: droneIds.length };
}
