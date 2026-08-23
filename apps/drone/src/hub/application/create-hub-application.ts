import { createGroup } from './create-group';
import { renameGroup } from './rename-group';
import { setDroneGroup } from './set-drone-group';
import { setDroneParent } from './set-drone-parent';
import { HubApplicationEvents } from './hub-application-events';
import { listGroups } from './list-groups';
import { listRepositories } from './list-repositories';
import { resolveDeleteActionSettingsResponse } from '../hub-settings';
import { UiPreferencesService } from './ui-preferences';
import type { HubServices } from './hub-services';
import type { RenameDroneCommand } from '../drone-rename-command';
import {
  createDeleteGroupCommand,
  type DeleteGroupDependencies,
} from './delete-group';
import {
  createFleetActorService,
  type FleetActorDependencies,
} from './fleet-actors';

export type HubApplication = ReturnType<typeof createHubApplication>;

export function createHubApplication(input: {
  renameDrone: RenameDroneCommand;
  deleteGroupDependencies: DeleteGroupDependencies;
  fleetActorDependencies?: Partial<FleetActorDependencies>;
  events?: HubApplicationEvents;
}) {
  const events = input.events ?? new HubApplicationEvents();
  const uiPreferences = new UiPreferencesService(events);
  const deleteGroup = createDeleteGroupCommand(input.deleteGroupDependencies);
  const services: HubServices = {
    repositories: {
      list: listRepositories,
    },
    groups: {
      list: listGroups,
      create: createGroup,
      delete: deleteGroup,
      deleteDrones: async (deleteInput) =>
        await deleteGroup({
          ...deleteInput,
          preserveGroup: true,
        }),
      rename: renameGroup,
      setDroneGroup,
    },
    fleet: {
      setDroneParent,
      ...createFleetActorService(input.fleetActorDependencies),
    },
    drones: {
      rename: input.renameDrone,
    },
    settings: {
      uiPreferences,
      readDeleteAction: resolveDeleteActionSettingsResponse,
    },
  };
  return {
    events,
    ...services,
  };
}
