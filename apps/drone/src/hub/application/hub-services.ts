import type { createGroup } from './create-group';
import type { listGroups } from './list-groups';
import type { listRepositories } from './list-repositories';
import type { renameGroup } from './rename-group';
import type { setDroneGroup } from './set-drone-group';
import type { setDroneParent } from './set-drone-parent';
import type { UiPreferencesService } from './ui-preferences';
import type { RenameDroneCommand } from '../drone-rename-command';
import type { resolveDeleteActionSettingsResponse } from '../hub-settings';
import type { DeleteGroupCommand } from './delete-group';
import type { FleetActorService } from './fleet-actors';

export type HubServices = {
  repositories: {
    list: typeof listRepositories;
  };
  groups: {
    list: typeof listGroups;
    create: typeof createGroup;
    delete: DeleteGroupCommand;
    deleteDrones: DeleteGroupCommand;
    rename: typeof renameGroup;
    setDroneGroup: typeof setDroneGroup;
  };
  fleet: {
    setDroneParent: typeof setDroneParent;
  } & FleetActorService;
  drones: {
    rename: RenameDroneCommand;
  };
  settings: {
    readDeleteAction: typeof resolveDeleteActionSettingsResponse;
    uiPreferences: Pick<UiPreferencesService, 'read' | 'update'>;
  };
};

export type HubServiceRequest = <T>(
  pathname: string,
  init?: RequestInit,
  timeoutMs?: number,
) => Promise<T>;

export function createHttpHubServices(request: HubServiceRequest): HubServices {
  return {
    repositories: {
      list: async () => await request('/api/repos', { method: 'GET' }),
    },
    groups: {
      list: async (repoPath) =>
        await request(
          `/api/groups${repoPath === undefined ? '' : `?${new URLSearchParams({ repoPath }).toString()}`}`,
          { method: 'GET' },
        ),
      create: async (input) =>
        await request('/api/groups', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      delete: async (input) =>
        await request(
          `/api/groups/${encodeURIComponent(input.groupRef)}?${new URLSearchParams({
            repoPath: input.repoPath,
            keepVolume: String(input.keepVolume),
            forget: String(input.forget),
          }).toString()}`,
          { method: 'DELETE' },
        ),
      deleteDrones: async (input) =>
        await request(
          `/api/groups/${encodeURIComponent(input.groupRef)}/drones?${new URLSearchParams({
            repoPath: input.repoPath,
            keepVolume: String(input.keepVolume),
            forget: String(input.forget),
          }).toString()}`,
          { method: 'DELETE' },
        ),
      rename: async (input) =>
        await request(`/api/groups/${encodeURIComponent(input.groupRef)}/rename`, {
          method: 'POST',
          body: JSON.stringify({
            repoPath: input.repoPath,
            newName: input.newName,
            at: input.at,
          }),
        }),
      setDroneGroup: async (input) =>
        await request('/api/drones/group-set', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
    },
    fleet: {
      setDroneParent: async (input) =>
        await request(`/api/fleet/actors/${encodeURIComponent(input.droneRef)}/parent`, {
          method: 'POST',
          body: JSON.stringify({ parent: input.parentRef }),
        }),
      get: async (droneRef) =>
        await request(`/api/fleet/actors/${encodeURIComponent(droneRef)}`, { method: 'GET' }),
      assign: async (input) =>
        await request(`/api/fleet/actors/${encodeURIComponent(input.droneRef)}/assigned`, {
          method: 'POST',
          body: JSON.stringify({ target: input.targetRef }),
        }),
      unassign: async (input) =>
        await request(
          `/api/fleet/actors/${encodeURIComponent(input.droneRef)}/assigned/${encodeURIComponent(input.targetRef)}`,
          { method: 'DELETE' },
        ),
    },
    drones: {
      rename: async (input) =>
        await request(`/api/drones/${encodeURIComponent(input.droneRef)}/rename`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
    },
    settings: {
      readDeleteAction: async () => await request('/api/settings/delete-action', { method: 'GET' }),
      uiPreferences: {
        read: async () => await request('/api/settings/ui-preferences', { method: 'GET' }),
        update: async (input) =>
          await request('/api/settings/ui-preferences', {
            method: 'POST',
            body: JSON.stringify({
              ...input,
              ...(input.notificationMode === 'sidebar-snapshot'
                ? { notificationMode: 'sidebar_snapshot' }
                : {}),
            }),
          }),
      },
    },
  };
}
