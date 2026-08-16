import type { HubRouter } from '../hub-router';
import { companionSettingsResponse, writeCompanionSettings } from './companion-config';
import type { CompanionTelemetryService } from './companion-telemetry';

export function registerCompanionRoutes(
  router: HubRouter,
  telemetry?: CompanionTelemetryService,
): void {
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

  router.get('/api/companion/telemetry', async ({ url, fail, json }) => {
    if (!telemetry) {
      fail(503, 'Companion telemetry is unavailable.');
      return;
    }
    const availableTelemetry = telemetry;
    const requestedLimit = Number(url.searchParams.get('limit') ?? 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(2_000, Math.floor(requestedLimit)))
      : 200;
    json(200, { ok: true, ...availableTelemetry.report(limit) });
  });
}
