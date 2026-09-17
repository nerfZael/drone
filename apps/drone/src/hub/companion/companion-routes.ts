import { readCompanionAttachments } from './companion-attachments';
import { evaluateCompanionSpeechDetailed, parseJevInput, parseJevReplay, replayJevEvaluation } from './companion-jev';
import type { CompanionRuntime } from './companion-runtime';
import { readCompanionAutoApproveSettings, writeCompanionAutoApproveSettings } from './companion-auto-approve-settings';
import { measureHubRequestPhase } from '../hub-performance-diagnostics';
import { executeCompanionOrganization } from './executeCompanionOrganization';
import type { HubServices } from '../application/hub-services';
import type { SidebarCommandService } from '../sidebar-command-service';
import type { CompanionWorkspaceService } from './companion-workspaces';
import type { HubRouter } from '../hub-router';
import { companionSettingsResponse, writeCompanionSettings } from './companion-config';
import type { CompanionTelemetryService } from './companion-telemetry';
import { COMPANION_INSTRUCTIONS_MAX_CHARS } from '@drone/assistant-chat';
import { readCompanionInstructions, writeCompanionInstructions } from './companion-instructions';
import { companionLiveSettingsResponse, readCompanionLiveSettings, writeCompanionLiveSettings } from './companion-live-settings';

export function registerCompanionRoutes(
  router: HubRouter,
  telemetry?: CompanionTelemetryService,
  workspaces?: CompanionWorkspaceService,
  organization?: { services: HubServices; sidebar: SidebarCommandService },
  runtime?: CompanionRuntime,
): void {
  router.post('/api/companion/attachments/read', async ({ readJson, json, fail }) => {
    try {
      const body = await readJson();
      json(200, { ok: true, attachments: await readCompanionAttachments(body.paths) });
    } catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
  });
  router.post('/api/companion/jev/evaluate', async ({ readJson, json, fail }) => {
    let input: ReturnType<typeof parseJevInput>;
    try { input = parseJevInput(await readJson()); }
    catch { return fail(400, 'Invalid Jev transcript or context.'); }
    try { json(200, { ok: true, ...await evaluateCompanionSpeechDetailed(input) }); }
    catch (error) { fail(503, error instanceof Error ? error.message : 'Jev evaluation failed.'); }
  });
  router.post('/api/companion/jev/replay', async ({ readJson, json, fail }) => {
    let request: ReturnType<typeof parseJevReplay>;
    try { request = parseJevReplay(await readJson()); }
    catch { return fail(400, 'Invalid Jev replay state, instructions, or criteria.'); }
    try { json(200, { ok: true, ...await replayJevEvaluation(request) }); }
    catch (error) { fail(503, error instanceof Error ? error.message : 'Jev replay failed.'); }
  });
  router.get('/api/settings/companion/live-voice', async ({ req, json }) => {
    const settings = await measureHubRequestPhase(req, 'companion_settings_read', () => readCompanionLiveSettings());
    json(200, { ok: true, ...companionLiveSettingsResponse(settings) });
  });
  router.put('/api/settings/companion/live-voice', async ({ req, readJson, json, fail }) => {
    try {
      const body = await measureHubRequestPhase(req, 'companion_request_body', () => readJson());
      const settings = await measureHubRequestPhase(req, 'companion_settings_write', () => writeCompanionLiveSettings(body));
      json(200, { ok: true, ...companionLiveSettingsResponse(settings) });
    }
    catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
  });
  router.get('/api/settings/companion/auto-approve', async ({ req, json }) => {
    json(200, { ok: true, ...await measureHubRequestPhase(req, 'companion_settings_read', () => readCompanionAutoApproveSettings()) });
  });
  router.put('/api/settings/companion/auto-approve', async ({ req, readJson, json, fail }) => {
    try {
      const body = await measureHubRequestPhase(req, 'companion_request_body', () => readJson());
      json(200, { ok: true, ...await measureHubRequestPhase(req, 'companion_settings_write', () => writeCompanionAutoApproveSettings(body)) });
    }
    catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
  });
  if (organization) {
    router.post('/api/companion/organization', async ({ readJson, json, fail }) => {
      try { json(200, await executeCompanionOrganization(await readJson<unknown>(), organization)); }
      catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
    });
  }
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
    router.get('/api/companion/workspaces/current', async ({ req, url, json, fail }) => {
      try { json(200, await workspaces.current(url.searchParams.get('droneId') || '', (phase, run) => measureHubRequestPhase(req, phase, run))); }
      catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
    });
    router.post('/api/companion/editor-file', async ({ req, readJson, json, fail }) => {
      try {
        const body = await measureHubRequestPhase(req, 'companion_request_body', () => readJson());
        json(200, await workspaces.editorFile(body, (phase, run) => measureHubRequestPhase(req, phase, run)));
      }
      catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
    });
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
      const value = await readJson<unknown>();
      if (runtime) await runtime.updateSettings(value);
      else await writeCompanionSettings(value);
      json(200, await companionSettingsResponse());
    } catch (error) {
      fail(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/api/companion/telemetry/live', async ({ url, fail, json }) => {
    if (!telemetry) { fail(503, 'Companion telemetry is unavailable.'); return; }
    json(200, { ok: true, ...telemetry.live.report(telemetry.list(2_000), url.searchParams.get('sessionId') || undefined) });
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
