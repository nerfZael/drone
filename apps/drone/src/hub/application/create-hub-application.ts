import { createGroup } from './create-group';
import { renameGroup } from './rename-group';
import { setDroneGroup } from './set-drone-group';
import { setDroneParent } from './set-drone-parent';
import { HubApplicationEvents } from './hub-application-events';
import { listGroups } from './list-groups';
import { listRepositories } from './list-repositories';
import { resolveDeleteActionSettingsResponse } from '../hub-settings';
import { UiPreferencesService } from './ui-preferences';

export type HubApplication = ReturnType<typeof createHubApplication>;

export function createHubApplication(events = new HubApplicationEvents()) {
  const uiPreferences = new UiPreferencesService(events);
  return {
    events,
    uiPreferences,
    listGroups,
    listRepositories,
    readDeleteActionSettings: resolveDeleteActionSettingsResponse,
    createGroup,
    setDroneParent,
    setDroneGroup,
    renameGroup,
  };
}
