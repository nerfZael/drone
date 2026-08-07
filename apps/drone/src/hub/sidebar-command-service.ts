import {
  parseSidebarMoveCommandRequest,
  type SidebarMoveCommandRequest,
  type SidebarMoveCommandResult,
} from '@drone/device-protocol';
import {
  applySidebarMove,
  isUngroupedGroupName,
  normalizeSidebarLayout,
  sidebarLayoutPatch,
  sidebarMoveDroneIds,
  sidebarMoveDestination,
} from '@drone/hub-model';
import { loadRegistry } from '../host/registry';
import { fleetDescendantIdsForActor } from './fleet-helpers';
import { renameCanonicalGroupOrchestration } from './group-orchestration';
import { listCanonicalGroups } from './groups-repositories';
import {
  UiPreferencesSettingsConflictError,
  UiPreferencesSettingsValidationError,
  resolveUiPreferencesSettingsResponse,
  upsertStoredUiPreferencesSettings,
} from './hub-settings';
import {
  findDroneIdByRef,
  normalizeDroneIdentity,
  resolveStableDroneOrPendingIdFromRef,
} from './drone-lifecycle-registry';
import { resolveDroneOrPendingForReadRef } from './drone-lifecycle-service';
import { setDroneGroupMetadata, updateDroneFleetMetadata } from './drone-metadata-commands';

type SidebarCommandResult = SidebarMoveCommandResult & Record<string, unknown>;
type SidebarSettingsSnapshot = {
  uiPreferences: Record<string, unknown>;
  version: number | null;
} & Record<string, unknown>;

export type SidebarCommandOperations = {
  setDroneParent(droneId: string, parentId: string | null): Promise<Record<string, unknown>>;
  setDroneGroup(droneIds: string[], group: string | null): Promise<Record<string, unknown>>;
  renameGroup(input: {
    repoPath: string;
    oldName: string;
    newName: string;
  }): Promise<Record<string, unknown>>;
  readUiPreferences(): Promise<SidebarSettingsSnapshot>;
  writeUiPreferences(input: {
    uiPreferences: Record<string, unknown>;
    expectedVersion: number | null | undefined;
  }): Promise<SidebarSettingsSnapshot>;
};

export function createSidebarCommandService(options: {
  notifyUiPreferencesChanged(): void | Promise<void>;
}): SidebarCommandService {
  return new SidebarCommandService({
    setDroneParent,
    setDroneGroup,
    renameGroup,
    readUiPreferences: async () => await resolveUiPreferencesSettingsResponse(),
    writeUiPreferences: async ({ uiPreferences, expectedVersion }) => {
      try {
        await upsertStoredUiPreferencesSettings(uiPreferences, expectedVersion);
      } catch (error) {
        if (error instanceof UiPreferencesSettingsConflictError) {
          throw commandError(error.message, 409);
        }
        if (error instanceof UiPreferencesSettingsValidationError) {
          throw commandError(error.message, 400);
        }
        throw error;
      }
      await options.notifyUiPreferencesChanged();
      return await resolveUiPreferencesSettingsResponse();
    },
  });
}

export class SidebarCommandService {
  private tail: Promise<void> = Promise.resolve();
  private readonly commands = new Map<
    string,
    { fingerprint: string; result: Promise<SidebarCommandResult> }
  >();

  constructor(private readonly operations: SidebarCommandOperations) {}

  move(value: unknown): Promise<SidebarCommandResult> {
    const request = parseSidebarMoveCommandRequest(value);
    const fingerprint = JSON.stringify(request);
    const existing = this.commands.get(request.mutationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw Object.assign(new Error('mutationId was already used for another sidebar move'), {
          code: 'INVALID_REQUEST',
        });
      }
      return existing.result;
    }
    const result = this.tail.then(() => this.executeMove(request));
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.commands.set(request.mutationId, { fingerprint, result });
    if (this.commands.size > 200) this.commands.delete(this.commands.keys().next().value!);
    return result;
  }

  private async executeMove(request: SidebarMoveCommandRequest): Promise<SidebarCommandResult> {
    let membershipResult: Record<string, unknown> = {};
    if (request.intent.kind === 'move-into-folder') {
      const destination = sidebarMoveDestination(request.intent);
      if (!destination) {
        throw Object.assign(new Error('cannot move a group into itself or its subtree'), {
          code: 'INVALID_REQUEST',
        });
      }
      if (request.intent.itemKind === 'drone') {
        const movingDroneIds = sidebarMoveDroneIds(request.intent);
        if (request.intent.targetParentDroneId !== undefined) {
          for (const droneId of movingDroneIds) {
            await this.operations.setDroneParent(droneId, request.intent.targetParentDroneId);
          }
        }
        const result = await this.operations.setDroneGroup(movingDroneIds, destination.targetGroup);
        const rejected = Array.isArray(result.rejected) ? result.rejected : [];
        if (rejected.length) {
          throw Object.assign(
            new Error(String(object(rejected[0]).error ?? 'drone could not be moved')),
            { code: 'OPERATION_FAILED' },
          );
        }
        membershipResult = object(result);
      } else {
        membershipResult = object(
          await this.operations.renameGroup({
            repoPath: request.intent.repoPath,
            oldName: request.intent.sourceGroup,
            newName: destination.nextGroup!,
          }),
        );
      }
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.operations.readUiPreferences();
      const currentPreferences = object(current.uiPreferences);
      const nextLayout = applySidebarMove(
        normalizeSidebarLayout(currentPreferences),
        request.intent,
      );
      try {
        const saved = await this.operations.writeUiPreferences({
          uiPreferences: {
            ...currentPreferences,
            ...sidebarLayoutPatch(nextLayout, request.intent),
          },
          expectedVersion: currentExpectedVersion(current.version),
        });
        return {
          ...membershipResult,
          ...saved,
          ok: true,
          mutationId: request.mutationId,
          version: currentExpectedVersion(saved.version) ?? null,
          uiPreferences: {
            ...object(saved.uiPreferences),
            ...normalizeSidebarLayout(saved.uiPreferences),
          },
        };
      } catch (error: any) {
        if (error?.code !== 'HUB_409' || attempt === 3) throw error;
      }
    }
    throw new Error('Failed to apply sidebar move');
  }
}

async function setDroneParent(
  droneId: string,
  parentId: string | null,
): Promise<Record<string, unknown>> {
  const resolved = await resolveDroneOrPendingForReadRef(droneId);
  if (!resolved) throw commandError(`unknown drone: ${droneId}`, 404);
  if (resolved.kind !== 'real') {
    throw commandError(`drone "${droneId}" is still starting`, 409);
  }

  const registry = await loadRegistry();
  let nextParentId: string | null = null;
  if (parentId) {
    if (!findDroneIdByRef(registry, parentId)) {
      throw commandError(`unknown drone: ${parentId}`, 404);
    }
    nextParentId = resolveStableDroneOrPendingIdFromRef(registry, parentId);
    if (!nextParentId) throw commandError(`unknown drone: ${parentId}`, 404);
    if (nextParentId === resolved.id) {
      throw commandError('cannot make a drone its own parent', 400);
    }
    if (fleetDescendantIdsForActor(registry, resolved.id).includes(nextParentId)) {
      throw commandError('cannot reparent a drone beneath one of its descendants', 400);
    }
  }

  await updateDroneFleetMetadata({
    droneId: resolved.id,
    transform: (fleet) => ({ ...fleet, createdBy: nextParentId }),
  });
  return { ok: true, id: resolved.id, parentId: nextParentId };
}

async function setDroneGroup(
  droneIdsRaw: string[],
  groupRaw: string | null,
): Promise<Record<string, unknown>> {
  const droneIds = uniqueStrings(droneIdsRaw.map(normalizeDroneIdentity));
  if (droneIds.length === 0) throw commandError('missing droneIds', 400);
  const normalizedGroup = String(groupRaw ?? '').trim();
  const group =
    !normalizedGroup || isUngroupedGroupName(normalizedGroup)
      ? null
      : validateGroupName(normalizedGroup);
  const moved: Array<Record<string, unknown>> = [];
  const rejected: Array<{ id: string; error: string }> = [];

  for (const droneId of droneIds) {
    try {
      const resolved = await resolveDroneOrPendingForReadRef(droneId);
      if (!resolved) throw new Error(`unknown drone: ${droneId}`);
      const source = resolved.kind === 'real' ? resolved.drone : resolved.pending;
      const repoPath = String(source?.repoPath ?? '').trim();
      const previousRaw = String(source?.group ?? '').trim();
      const previousGroup = !previousRaw || isUngroupedGroupName(previousRaw) ? null : previousRaw;
      if (previousGroup === group) continue;
      const record = await setDroneGroupMetadata({
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

async function renameGroup(input: {
  repoPath: string;
  oldName: string;
  newName: string;
}): Promise<Record<string, unknown>> {
  const groups = await listCanonicalGroups();
  const existing = groups.find(
    (group) => group.repoPath === input.repoPath && group.name === input.oldName,
  );
  if (!existing) throw commandError(`unknown group: ${input.oldName}`, 404);
  if (isUngroupedGroupName(existing.name)) {
    throw commandError('cannot rename Ungrouped', 400);
  }
  const newName = validateGroupName(input.newName);
  if (existing.name === newName) {
    return {
      ok: true,
      oldName: existing.name,
      newName,
      renamed: false,
      reason: 'same-name',
    };
  }
  const result = await renameCanonicalGroupOrchestration(existing.repoPath, existing.name, newName);
  if (!result.ok) throw commandError(result.error, result.status);
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

function commandError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status, code: `HUB_${status}` });
}

function validateGroupName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!name) throw commandError('invalid group (must be non-empty)', 400);
  if (name.length > 64) throw commandError('invalid group (max 64 chars)', 400);
  if (isUngroupedGroupName(name)) {
    throw commandError('invalid group ("Ungrouped" is reserved)', 400);
  }
  return name;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function currentExpectedVersion(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
