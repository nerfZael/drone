import type { CompanionWorkspaceService } from './companion-workspaces';
import type { HubRouter } from '../hub-router';
import { companionSettingsResponse, writeCompanionSettings } from './companion-config';
import type { CompanionTelemetryService } from './companion-telemetry';
import { COMPANION_INSTRUCTIONS_MAX_CHARS } from '@drone/assistant-chat';
import { readCompanionInstructions, writeCompanionInstructions } from './companion-instructions';

export function registerCompanionRoutes(
  router: HubRouter,
  telemetry?: CompanionTelemetryService,
  workspaces?: CompanionWorkspaceService,
): void {
  router.get('/api/companion/instructions', async ({ json }) => {
    json(200, { ok: true, instructions: await readCompanionInstructions(), maxChars: COMPANION_INSTRUCTIONS_MAX_CHARS });
  });
  router.put('/api/companion/instructions', async ({ readJson, json, fail }) => {
    try {
      const body = await readJson<{ content: unknown; revision: unknown }>();
      const instructions = await writeCompanionInstructions(body?.content, body?.revision);
      json(200, { ok: true, instructions, maxChars: COMPANION_INSTRUCTIONS_MAX_CHARS });
    } catch (error) {
      fail((error as { code?: string })?.code === 'STALE_INSTRUCTIONS' ? 409 : 400,
        error instanceof Error ? error.message : String(error));
    }
  });
  if (workspaces) {
    router.get('/api/companion/workspaces', async ({ url, json, fail }) => {
      try { json(200, await workspaces.catalog(url.searchParams.get('deviceId') || undefined)); }
      catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
    });
    router.post('/api/companion/workspaces', async ({ readJson, json, fail }) => {
      try {
        const body = await readJson<{ access: unknown; revision: string }>();
        json(200, await workspaces.save(body.access, body.revision));
      } catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
    });
  }
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
