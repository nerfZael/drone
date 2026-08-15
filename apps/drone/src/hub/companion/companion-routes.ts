import type { HubRouter } from '../hub-router';
import { companionSettingsResponse, writeCompanionSettings } from './companion-config';

export function registerCompanionRoutes(router: HubRouter): void {
  router.get('/api/settings/companion', async ({ json }) => {
    json(200, await companionSettingsResponse());
  });

  router.put('/api/settings/companion', async ({ readJson, fail, json }) => {
    try {
      await writeCompanionSettings(await readJson<unknown>());
      json(200, await companionSettingsResponse());
    } catch (error) {
      fail(400, error instanceof Error ? error.message : String(error));
    }
  });
}
