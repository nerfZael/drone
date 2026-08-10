import {
  parseSidebarMoveCommandRequest,
  type SidebarMoveCommandRequest,
  type SidebarMoveCommandResult,
} from '@drone/device-protocol';
import {
  applySidebarMove,
  normalizeSidebarLayout,
  sidebarLayoutPatch,
  sidebarMoveDroneIds,
  sidebarMoveDestination,
} from '@drone/hub-model';
import type { HubServices } from './application/hub-services';

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

export function createSidebarCommandService(application: HubServices): SidebarCommandService {
  return new SidebarCommandService({
    setDroneParent: async (droneId, parentId) =>
      await application.fleet.setDroneParent({ droneRef: droneId, parentRef: parentId }),
    setDroneGroup: async (droneIds, group) =>
      await application.groups.setDroneGroup({ droneIds, group }),
    renameGroup: async ({ repoPath, oldName, newName }) =>
      await application.groups.rename({ groupRef: oldName, repoPath, newName }),
    readUiPreferences: async () => await application.settings.uiPreferences.read(),
    writeUiPreferences: async ({ uiPreferences, expectedVersion }) =>
      await application.settings.uiPreferences.update({
        uiPreferences,
        expectedVersion,
        notificationMode: 'sidebar-snapshot',
      }),
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
        const conflict = error?.code === 'HUB_409' || error?.statusCode === 409;
        if (!conflict || attempt === 3) throw error;
      }
    }
    throw new Error('Failed to apply sidebar move');
  }
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
