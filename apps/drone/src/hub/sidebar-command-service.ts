import {
  parseSidebarMoveCommandRequest,
  type SidebarMoveCanonicalGroup,
  type SidebarMoveCommandRequest,
  type SidebarMoveCommandResult,
  type SidebarMoveCommandStage,
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
    groupRef: string;
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
    renameGroup: async ({ repoPath, groupRef, newName }) =>
      await application.groups.rename({ groupRef, repoPath, newName }),
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
    let membershipStage: SidebarMoveCommandStage = { status: 'not-required' };
    let canonicalGroup: SidebarMoveCanonicalGroup | null = null;
    if (request.intent.kind === 'move-into-folder') {
      const destination = sidebarMoveDestination(request.intent);
      if (!destination) {
        throw Object.assign(new Error('cannot move a group into itself or its subtree'), {
          code: 'INVALID_REQUEST',
        });
      }
      try {
        if (request.intent.itemKind === 'drone') {
          const movingDroneIds = sidebarMoveDroneIds(request.intent);
          if (request.intent.targetParentDroneId !== undefined) {
            for (const droneId of movingDroneIds) {
              await this.operations.setDroneParent(droneId, request.intent.targetParentDroneId);
            }
          }
          const result = await this.operations.setDroneGroup(
            movingDroneIds,
            destination.targetGroup,
          );
          const rejected = Array.isArray(result.rejected) ? result.rejected : [];
          if (rejected.length) {
            const rejectedMessage = String(
              object(rejected[0]).error ?? 'drone could not be moved',
            );
            throw Object.assign(new Error(rejectedMessage), {
              code: /invalid drone id/i.test(rejectedMessage)
                ? 'INVALID_REQUEST'
                : 'OPERATION_FAILED',
            });
          }
          membershipResult = object(result);
        } else {
          membershipResult = object(
            await this.operations.renameGroup({
              repoPath: request.intent.repoPath,
              groupRef: request.intent.sourceGroupId ?? request.intent.sourceGroup,
              newName: destination.nextGroup!,
            }),
          );
          canonicalGroup = canonicalGroupFromRename(
            membershipResult,
            request.intent.sourceGroupId,
            request.intent.repoPath,
            destination.nextGroup!,
          );
        }
        membershipStage = { status: 'applied' };
      } catch (error) {
        if ((error as { code?: unknown })?.code === 'INVALID_REQUEST') throw error;
        const message = errorMessage(error);
        return {
          ...membershipResult,
          ok: false,
          mutationId: request.mutationId,
          code: 'MEMBERSHIP_UPDATE_FAILED',
          error: message,
          stages: {
            membership: { status: 'failed', error: message },
            layout: { status: 'not-attempted' },
          },
          canonical: { group: canonicalGroup, sidebar: null },
        };
      }
    }

    let latestSidebar: SidebarSettingsSnapshot | null = null;
    let lastLayoutError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const current = await this.operations.readUiPreferences();
        latestSidebar = current;
        const currentPreferences = object(current.uiPreferences);
        const nextLayout = applySidebarMove(
          normalizeSidebarLayout(currentPreferences),
          request.intent,
        );
        const saved = await this.operations.writeUiPreferences({
          uiPreferences: {
            ...currentPreferences,
            ...sidebarLayoutPatch(nextLayout, request.intent),
          },
          expectedVersion: currentExpectedVersion(current.version),
        });
        const uiPreferences = {
          ...object(saved.uiPreferences),
          ...normalizeSidebarLayout(saved.uiPreferences),
        };
        const version = currentExpectedVersion(saved.version) ?? null;
        return {
          ...membershipResult,
          ...saved,
          ok: true,
          mutationId: request.mutationId,
          version,
          uiPreferences,
          stages: {
            membership: membershipStage,
            layout: { status: 'applied' },
          },
          canonical: {
            group: canonicalGroup,
            sidebar: { version, uiPreferences },
          },
        };
      } catch (error: any) {
        lastLayoutError = error;
        const conflict = error?.code === 'HUB_409' || error?.statusCode === 409;
        if (!conflict || attempt === 3) break;
      }
    }
    const message = errorMessage(lastLayoutError ?? new Error('Failed to apply sidebar move'));
    return {
      ...membershipResult,
      ok: false,
      mutationId: request.mutationId,
      code: 'LAYOUT_UPDATE_FAILED',
      error: message,
      stages: {
        membership: membershipStage,
        layout: { status: 'failed', error: message },
      },
      canonical: {
        group: canonicalGroup,
        sidebar: latestSidebar
          ? {
              version: currentExpectedVersion(latestSidebar.version) ?? null,
              uiPreferences: {
                ...object(latestSidebar.uiPreferences),
                ...normalizeSidebarLayout(latestSidebar.uiPreferences),
              },
            }
          : null,
      },
    };
  }
}

function canonicalGroupFromRename(
  result: Record<string, unknown>,
  sourceGroupId: string | null | undefined,
  repoPathRaw: string,
  nextNameRaw: string,
): SidebarMoveCanonicalGroup | null {
  const id = String(result.id ?? sourceGroupId ?? '').trim();
  const repoPath = String(result.repoPath ?? repoPathRaw ?? '').trim();
  const name = String(result.newName ?? nextNameRaw ?? '').trim();
  return id && name ? { id, repoPath, name } : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = String(error ?? '').trim();
  return message || 'Sidebar move failed';
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
