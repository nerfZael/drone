import {
  parseSidebarMoveCommandRequest,
  applySidebarMove,
  normalizeSidebarLayout,
  sidebarLayoutPatch,
  sidebarMoveDestination,
  type SidebarMoveCommandRequest,
  type SidebarMoveCommandResult,
} from '@drone/device-protocol';
import { localHubRequest, type LocalHubAccess } from './local-hub-request';

type SidebarCommandResult = SidebarMoveCommandResult & Record<string, unknown>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function currentExpectedVersion(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export class SidebarCommandService {
  private tail: Promise<void> = Promise.resolve();
  private readonly commands = new Map<
    string,
    { fingerprint: string; result: Promise<SidebarCommandResult> }
  >();

  constructor(private readonly access: LocalHubAccess) {}

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
        const result = await localHubRequest(this.access, '/api/drones/group-set', {
          method: 'POST',
          body: JSON.stringify({
            droneIds: [request.intent.droneId],
            group: destination.targetGroup,
          }),
        });
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
          await localHubRequest(
            this.access,
            `/api/groups/${encodeURIComponent(request.intent.sourceGroup)}/rename`,
            {
              method: 'POST',
              body: JSON.stringify({
                repoPath: request.intent.repoPath,
                newName: destination.nextGroup,
              }),
            },
          ),
        );
      }
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await localHubRequest(this.access, '/api/settings/ui-preferences');
      const currentPreferences = object(current.uiPreferences);
      const nextLayout = applySidebarMove(
        normalizeSidebarLayout(currentPreferences),
        request.intent,
      );
      try {
        const saved = await localHubRequest(this.access, '/api/settings/ui-preferences', {
          method: 'POST',
          body: JSON.stringify({
            uiPreferences: {
              ...currentPreferences,
              ...sidebarLayoutPatch(nextLayout, request.intent),
            },
            ...(currentExpectedVersion(current.version) !== undefined
              ? { expectedVersion: currentExpectedVersion(current.version) }
              : {}),
            notificationMode: 'sidebar_snapshot',
          }),
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
