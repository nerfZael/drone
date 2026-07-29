import crypto from 'node:crypto';

import type { HubRouter } from '../hub-router';
import {
  UiPreferencesSettingsConflictError,
  UiPreferencesSettingsValidationError,
  type LlmProviderId,
  type StoredApiKeyProviderId,
} from '../hub-settings';
import type { ParsedSyncSetMutationInput } from '../sync-sets';

type ServiceFunction = (...args: any[]) => any;

interface SyncSetRouteService {
  storedSyncSets: ServiceFunction;
  buildViewsFromRegistry: ServiceFunction;
  createSyncSet: ServiceFunction;
  updateSyncSet: ServiceFunction;
  deleteSyncSet: ServiceFunction;
  applySyncSetToAllExistingTargets: ServiceFunction;
}

export interface SettingsRouteDependencies {
  resolveGroqApiKeySettings: ServiceFunction;
  resolveExaApiKeySettings: ServiceFunction;
  resolveEffectiveProviderApiKeySettings: ServiceFunction;
  logProviderApiKeyResolution: ServiceFunction;
  providerKeySettingsResponse: ServiceFunction;
  normalizeApiKey: ServiceFunction;
  upsertStoredProviderApiKey: ServiceFunction;
  clearStoredProviderApiKey: ServiceFunction;
  startCodexLogin: ServiceFunction;
  codexLoginStatus: ServiceFunction;
  cancelCodexLogin: ServiceFunction;
  resolveLlmSettingsResponse: ServiceFunction;
  parseLlmProvider: ServiceFunction;
  upsertStoredLlmProvider: ServiceFunction;
  resolveGithubSettingsResponse: ServiceFunction;
  resolveDeleteActionSettingsResponse: ServiceFunction;
  readManagedHubStateAtRootOrFallback: ServiceFunction;
  parseDroneDeleteMode: ServiceFunction;
  parseArchiveRetentionId: ServiceFunction;
  parseArchiveRuntimePolicy: ServiceFunction;
  upsertStoredDeleteActionSettings: ServiceFunction;
  resolveFilesystemSettingsResponse: ServiceFunction;
  parseFilesystemUploadMaxBytes: ServiceFunction;
  upsertStoredFilesystemSettings: ServiceFunction;
  FILESYSTEM_UPLOAD_MAX_BYTES_MIN: number;
  FILESYSTEM_UPLOAD_MAX_BYTES_MAX: number;
  resolveRegistryBackupStatusResponse: ServiceFunction;
  upsertStoredRegistryBackupSettings: ServiceFunction;
  createRegistryBackup: ServiceFunction;
  defaultAgentsPayload: ServiceFunction;
  normalizeAgentsMarkdown: ServiceFunction;
  upsertCanonicalDefaultAgentsConfig: ServiceFunction;
  resolveCanonicalAgentsLibraryFile: ServiceFunction;
  createCanonicalAgentsLibraryFile: ServiceFunction;
  updateCanonicalAgentsLibraryFile: ServiceFunction;
  deleteCanonicalAgentsLibraryFile: ServiceFunction;
  loadRegistry: ServiceFunction;
  syncSetService: SyncSetRouteService;
  parseSyncSetMutationInput: ServiceFunction;
  buildStoredSyncSet: ServiceFunction;
  ensureSyncSetSourceIsReadable: ServiceFunction;
  ensureHubManagedSyncSetSourceDir: ServiceFunction;
  removeHubManagedSyncSetSourceDir: ServiceFunction;
  nowIso: () => string;
  listProfilesState: ServiceFunction;
  createManagedProfile: ServiceFunction;
  useManagedProfile: ServiceFunction;
  renameManagedProfile: ServiceFunction;
  deleteManagedProfile: ServiceFunction;
  profileSettingsErrorStatus: (error: unknown) => number;
  apiToken: string;
  droneRootPath: (...parts: string[]) => string;
  resolveUiPreferencesSettingsResponse: ServiceFunction;
  upsertStoredUiPreferencesSettings: ServiceFunction;
  updatePinnedDronePreference: ServiceFunction;
  notifyPinnedDronesChanged: ServiceFunction;
  clampIntParam: (value: string | null, fallback: number, min: number, max: number) => number;
  readHubLogTail: ServiceFunction;
  HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES: number;
  HUB_SETTINGS_LOG_MAX_BYTES: number;
  HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES: number;
  HUB_SETTINGS_LOG_MAX_TAIL_LINES: number;
}

export function registerSettingsRoutes(
  apiRouter: HubRouter,
  deps: SettingsRouteDependencies,
): void {
  const {
    resolveGroqApiKeySettings,
    resolveExaApiKeySettings,
    resolveEffectiveProviderApiKeySettings,
    logProviderApiKeyResolution,
    providerKeySettingsResponse,
    normalizeApiKey,
    upsertStoredProviderApiKey,
    clearStoredProviderApiKey,
    startCodexLogin,
    codexLoginStatus,
    cancelCodexLogin,
    resolveLlmSettingsResponse,
    parseLlmProvider,
    upsertStoredLlmProvider,
    resolveGithubSettingsResponse,
    resolveDeleteActionSettingsResponse,
    readManagedHubStateAtRootOrFallback,
    parseDroneDeleteMode,
    parseArchiveRetentionId,
    parseArchiveRuntimePolicy,
    upsertStoredDeleteActionSettings,
    resolveFilesystemSettingsResponse,
    parseFilesystemUploadMaxBytes,
    upsertStoredFilesystemSettings,
    FILESYSTEM_UPLOAD_MAX_BYTES_MIN,
    FILESYSTEM_UPLOAD_MAX_BYTES_MAX,
    resolveRegistryBackupStatusResponse,
    upsertStoredRegistryBackupSettings,
    createRegistryBackup,
    defaultAgentsPayload,
    normalizeAgentsMarkdown,
    upsertCanonicalDefaultAgentsConfig,
    resolveCanonicalAgentsLibraryFile,
    createCanonicalAgentsLibraryFile,
    updateCanonicalAgentsLibraryFile,
    deleteCanonicalAgentsLibraryFile,
    loadRegistry,
    syncSetService,
    parseSyncSetMutationInput,
    buildStoredSyncSet,
    ensureSyncSetSourceIsReadable,
    ensureHubManagedSyncSetSourceDir,
    removeHubManagedSyncSetSourceDir,
    nowIso,
    listProfilesState,
    createManagedProfile,
    useManagedProfile,
    renameManagedProfile,
    deleteManagedProfile,
    profileSettingsErrorStatus,
    apiToken,
    droneRootPath,
    resolveUiPreferencesSettingsResponse,
    upsertStoredUiPreferencesSettings,
    updatePinnedDronePreference,
    notifyPinnedDronesChanged,
    clampIntParam,
    readHubLogTail,
    HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES,
    HUB_SETTINGS_LOG_MAX_BYTES,
    HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES,
    HUB_SETTINGS_LOG_MAX_TAIL_LINES,
  } = deps;
  type ProviderSettingsRouteId = StoredApiKeyProviderId | 'codex';
  const resolveProviderSettings = async (provider: ProviderSettingsRouteId) =>
    provider === 'groq'
      ? await resolveGroqApiKeySettings()
      : provider === 'exa'
        ? await resolveExaApiKeySettings()
        : await resolveEffectiveProviderApiKeySettings(provider as LlmProviderId);

  const providerSettingsRoutes: Array<{
    path: string;
    provider: ProviderSettingsRouteId;
  }> = [
    { path: '/api/settings/openai', provider: 'openai' },
    { path: '/api/settings/gemini', provider: 'gemini' },
    { path: '/api/settings/codex', provider: 'codex' },
    { path: '/api/settings/groq', provider: 'groq' },
    { path: '/api/settings/exa', provider: 'exa' },
  ];
  for (const { path: providerPath, provider } of providerSettingsRoutes) {
    apiRouter.get(providerPath, async ({ url, method, json: respond }) => {
      const resolved = await resolveProviderSettings(provider);
      if (!resolved.apiKey && provider !== 'groq' && provider !== 'exa') {
        await logProviderApiKeyResolution(
          'warn',
          'settings provider lookup resolved without API key',
          provider as LlmProviderId,
          { pathname: providerPath, method },
        );
      }
      respond(200, {
        ok: true,
        ...providerKeySettingsResponse(resolved, {
          includeApiKey: provider !== 'codex' && url.searchParams.get('reveal') === '1',
        }),
      });
    });

    apiRouter.post(providerPath, async ({ readJson, fail, json: respond }) => {
      if (provider === 'codex') {
        return fail(
          400,
          'Codex uses subscription authentication. Connect from Drone Hub, run `codex login` on the Hub host, or use `codex login --device-auth` for a remote or headless Hub.',
        );
      }
      const body = await readJson<any>();
      const apiKey = normalizeApiKey(body?.apiKey);
      if (!apiKey) fail(400, 'API key is required.');
      await upsertStoredProviderApiKey(provider, apiKey);
      respond(200, {
        ok: true,
        ...providerKeySettingsResponse(await resolveProviderSettings(provider)),
      });
    });

    apiRouter.delete(providerPath, async ({ fail, json: respond }) => {
      if (provider === 'codex') {
        return fail(
          400,
          'Codex uses the shared local login. Run `codex logout` on the Hub host to remove it.',
        );
      }
      await clearStoredProviderApiKey(provider);
      respond(200, {
        ok: true,
        ...providerKeySettingsResponse(await resolveProviderSettings(provider)),
      });
    });
  }

  apiRouter.get('/api/settings/codex/connect', async ({ json: respond }) => {
    respond(200, codexLoginStatus());
  });

  apiRouter.post('/api/settings/codex/connect', async ({ json: respond }) => {
    try {
      respond(200, await startCodexLogin());
    } catch (error: any) {
      respond(400, {
        ok: false,
        error: error?.message ?? String(error),
        login: codexLoginStatus(),
      });
    }
  });

  apiRouter.delete('/api/settings/codex/connect', async ({ json: respond }) => {
    respond(200, cancelCodexLogin());
  });

  apiRouter.get('/api/settings/llm', async ({ method, json: respond }) => {
    const data = await resolveLlmSettingsResponse();
    const selectedProvider = data.provider.selected;
    const selectedProviderSettings =
      selectedProvider === 'openai'
        ? data.openai
        : selectedProvider === 'gemini'
          ? data.gemini
          : data.codex;
    if (!selectedProviderSettings.hasKey) {
      await logProviderApiKeyResolution(
        'warn',
        'settings llm lookup resolved without selected provider key',
        selectedProvider,
        {
          pathname: '/api/settings/llm',
          method,
          providerSource: data.provider.source,
        },
      );
    }
    respond(200, data);
  });

  apiRouter.post('/api/settings/llm', async ({ readJson, fail, json: respond }) => {
    const body = await readJson<any>();
    const provider = parseLlmProvider(body?.provider);
    if (!provider) return fail(400, 'provider must be openai, gemini, or codex');
    await upsertStoredLlmProvider(provider);
    respond(200, await resolveLlmSettingsResponse());
  });

  apiRouter.get('/api/settings/github', async ({ json: respond }) => {
    respond(200, await resolveGithubSettingsResponse());
  });

  apiRouter.get('/api/settings/delete-action', async ({ json: respond }) => {
    respond(200, await resolveDeleteActionSettingsResponse());
  });

  apiRouter.post('/api/settings/delete-action', async ({ readJson, fail, json: respond }) => {
    const body = await readJson<any>();
    const mode = parseDroneDeleteMode(body?.mode);
    const archiveRetention = parseArchiveRetentionId(body?.archiveRetention);
    const archiveRuntimePolicy = parseArchiveRuntimePolicy(body?.archiveRuntimePolicy);
    if (!mode) return fail(400, 'mode must be permanent or archive');
    if (body?.archiveRetention != null && !archiveRetention) {
      return fail(400, 'archiveRetention must be one of: 1h, 8h, 1d, 1w');
    }
    if (body?.archiveRuntimePolicy != null && !archiveRuntimePolicy) {
      return fail(400, 'archiveRuntimePolicy must be one of: keep-running, stop');
    }
    await upsertStoredDeleteActionSettings({
      mode,
      archiveRetention: archiveRetention ?? undefined,
      archiveRuntimePolicy: archiveRuntimePolicy ?? undefined,
    });
    respond(200, await resolveDeleteActionSettingsResponse());
  });

  apiRouter.get('/api/settings/filesystem', async ({ json: respond }) => {
    respond(200, await resolveFilesystemSettingsResponse());
  });

  apiRouter.post('/api/settings/filesystem', async ({ readJson, fail, json: respond }) => {
    const body = await readJson<any>();
    const uploadMaxBytes = parseFilesystemUploadMaxBytes(body?.uploadMaxBytes);
    if (!uploadMaxBytes) {
      return fail(
        400,
        `uploadMaxBytes must be an integer between ${FILESYSTEM_UPLOAD_MAX_BYTES_MIN} and ${FILESYSTEM_UPLOAD_MAX_BYTES_MAX}`,
      );
    }
    await upsertStoredFilesystemSettings({ uploadMaxBytes });
    respond(200, await resolveFilesystemSettingsResponse());
  });

  apiRouter.get('/api/settings/backups', async ({ json: respond }) => {
    respond(200, await resolveRegistryBackupStatusResponse());
  });

  apiRouter.post('/api/settings/backups', async ({ readJson, fail, json: respond }) => {
    const body = await readJson<any>();
    try {
      await upsertStoredRegistryBackupSettings({
        enabled: body?.enabled,
        hourlyEnabled: body?.hourlyEnabled,
        dailyEnabled: body?.dailyEnabled,
        hourlyRetentionHours: body?.hourlyRetentionHours,
        dailyRetentionDays: body?.dailyRetentionDays,
      });
    } catch (error: any) {
      return fail(400, error?.message ?? String(error));
    }
    respond(200, await resolveRegistryBackupStatusResponse());
  });

  apiRouter.post('/api/settings/backups/run', async ({ json: respond }) => {
    try {
      const createdBackup = await createRegistryBackup('manual', { force: true });
      respond(200, { ...(await resolveRegistryBackupStatusResponse()), createdBackup });
    } catch (error: any) {
      respond(500, { ok: false, error: error?.message ?? String(error) });
    }
  });

  apiRouter.get('/api/settings/agents', async ({ json: respond }) => {
    respond(200, await defaultAgentsPayload(await loadRegistry()));
  });

  apiRouter.post('/api/settings/agents', async ({ readJson, json: respond }) => {
    const body = await readJson<any>();
    await upsertCanonicalDefaultAgentsConfig(normalizeAgentsMarkdown(body?.content));
    respond(200, await defaultAgentsPayload(await loadRegistry()));
  });

  apiRouter.get('/api/settings/agents/files/:fileId', async ({ params, fail, json: respond }) => {
    const file = await resolveCanonicalAgentsLibraryFile(params.fileId);
    if (!file) return fail(404, `unknown AGENTS.md file: ${params.fileId}`);
    respond(200, { ok: true, file });
  });

  apiRouter.post('/api/settings/agents/files', async ({ readJson, fail, json: respond }) => {
    const body = await readJson<any>();
    try {
      const file = await createCanonicalAgentsLibraryFile(body);
      respond(201, { ...(await defaultAgentsPayload(await loadRegistry())), file });
    } catch (error: any) {
      fail(400, error?.message ?? String(error));
    }
  });

  apiRouter.put(
    '/api/settings/agents/files/:fileId',
    async ({ params, readJson, fail, json: respond }) => {
      const body = await readJson<any>();
      try {
        const file = await updateCanonicalAgentsLibraryFile(params.fileId, body);
        if (!file) return fail(404, `unknown AGENTS.md file: ${params.fileId}`);
        respond(200, { ...(await defaultAgentsPayload(await loadRegistry())), file });
      } catch (error: any) {
        fail(400, error?.message ?? String(error));
      }
    },
  );

  apiRouter.delete(
    '/api/settings/agents/files/:fileId',
    async ({ params, fail, json: respond }) => {
      if (!(await deleteCanonicalAgentsLibraryFile(params.fileId))) {
        return fail(404, `unknown AGENTS.md file: ${params.fileId}`);
      }
      respond(200, await defaultAgentsPayload(await loadRegistry()));
    },
  );

  const syncSetsResponse = async () => {
    const registry: any = await loadRegistry();
    const storedSyncSets = await syncSetService.storedSyncSets(registry);
    return {
      ok: true,
      syncSets: await syncSetService.buildViewsFromRegistry(registry),
      updatedAt: storedSyncSets.reduce(
        (latest: string | null, item: any) =>
          !latest || item.updatedAt > latest ? item.updatedAt : latest,
        null as string | null,
      ),
    };
  };

  apiRouter.get('/api/settings/sync-sets', async ({ json: respond }) => {
    respond(200, await syncSetsResponse());
  });

  apiRouter.post('/api/settings/sync-sets', async ({ readJson, fail, json: respond }) => {
    const body = await readJson<any>();
    let input: ParsedSyncSetMutationInput;
    try {
      input = parseSyncSetMutationInput(body);
      await ensureSyncSetSourceIsReadable(input);
    } catch (error: any) {
      return fail(400, error?.message ?? String(error));
    }
    const createdAt = nowIso();
    const syncSetId = `sync-${crypto.randomBytes(8).toString('hex')}`;
    const createdManagedSourceDir = input.sourceType === 'hub-managed';
    if (createdManagedSourceDir) await ensureHubManagedSyncSetSourceDir(syncSetId);
    try {
      await syncSetService.createSyncSet(
        buildStoredSyncSet({
          id: syncSetId,
          label: input.label,
          sourceType: input.sourceType,
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
          applyToHost: input.applyToHost,
          createdAt,
          updatedAt: createdAt,
        }),
      );
    } catch (error) {
      if (createdManagedSourceDir) await removeHubManagedSyncSetSourceDir(syncSetId);
      throw error;
    }
    respond(201, await syncSetsResponse());
  });

  apiRouter.post('/api/settings/sync-sets/:syncSetId/apply', async ({ params, json: respond }) => {
    try {
      const result = await syncSetService.applySyncSetToAllExistingTargets(params.syncSetId);
      respond(200, {
        ok: true,
        syncSet: result.syncSetView,
        appliedDrones: result.appliedDrones,
        totalDrones: result.totalDrones,
        appliedHost: result.appliedHost,
        failures: result.failures,
        versionId: result.snapshot.versionId,
        sourcePath: result.snapshot.sourcePath,
        fileCount: result.snapshot.fileCount,
        totalBytes: result.snapshot.totalBytes,
      });
    } catch (error: any) {
      const message = error?.message ?? String(error);
      respond(/^unknown sync set: /.test(String(message)) ? 404 : 400, {
        ok: false,
        error: message,
      });
    }
  });

  apiRouter.patch(
    '/api/settings/sync-sets/:syncSetId',
    async ({ params, readJson, fail, json: respond }) => {
      const body = await readJson<any>();
      let input: ParsedSyncSetMutationInput;
      try {
        input = parseSyncSetMutationInput(body);
        await ensureSyncSetSourceIsReadable(input);
      } catch (error: any) {
        return fail(400, error?.message ?? String(error));
      }
      const registry: any = await loadRegistry();
      const storedSyncSets = await syncSetService.storedSyncSets(registry);
      const existing = storedSyncSets.find((item: any) => item.id === params.syncSetId);
      if (!existing) return fail(404, `unknown sync set: ${params.syncSetId}`);
      if (input.sourceType === 'hub-managed') {
        await ensureHubManagedSyncSetSourceDir(params.syncSetId);
      }
      const materialChanged =
        existing.sourceType !== input.sourceType ||
        (existing.sourcePath ?? null) !== (input.sourcePath ?? null) ||
        existing.targetPath !== input.targetPath ||
        existing.applyToHost !== input.applyToHost;
      await syncSetService.updateSyncSet(
        buildStoredSyncSet({
          id: existing.id,
          label: input.label,
          sourceType: input.sourceType,
          sourcePath: input.sourcePath,
          targetPath: input.targetPath,
          applyToHost: input.applyToHost,
          createdAt: existing.createdAt,
          updatedAt: nowIso(),
          existing: materialChanged
            ? {
                ...existing,
                lastAppliedVersionId: null,
                lastAppliedAt: null,
                targetStatus: {},
              }
            : existing,
        }),
      );
      respond(200, await syncSetsResponse());
    },
  );

  apiRouter.delete(
    '/api/settings/sync-sets/:syncSetId',
    async ({ params, fail, json: respond }) => {
      if (!(await syncSetService.deleteSyncSet(params.syncSetId))) {
        return fail(404, `unknown sync set: ${params.syncSetId}`);
      }
      await removeHubManagedSyncSetSourceDir(params.syncSetId);
      respond(200, await syncSetsResponse());
    },
  );

  apiRouter.get('/api/settings/profiles', async ({ json: respond }) => {
    respond(200, { ok: true, ...(await listProfilesState()) });
  });

  apiRouter.post('/api/settings/profiles', async ({ readJson, json: respond }) => {
    const body = await readJson<any>();
    try {
      const created = await createManagedProfile(body?.name, {
        use: false,
        stopCurrentHub: false,
      });
      respond(201, {
        ok: true,
        ...(await listProfilesState()),
        createdProfile: created.created,
      });
    } catch (error: any) {
      respond(profileSettingsErrorStatus(error), {
        ok: false,
        error: error?.message ?? String(error),
      });
    }
  });

  apiRouter.post('/api/settings/profiles/activate', async ({ req, readJson, json: respond }) => {
    const body = await readJson<any>();
    const previousRootDir = droneRootPath();
    try {
      const currentHubState = await readManagedHubStateAtRootOrFallback(previousRootDir, req);
      const activated = await useManagedProfile(body?.name, {
        stopCurrentHub: false,
        syncRunningHubState: { state: currentHubState, apiToken, previousRootDir },
      });
      respond(200, {
        ok: true,
        ...(await listProfilesState()),
        activeProfile: activated.activeProfile,
        activatedProfile: activated.activeProfile,
        reloadRequired: true,
      });
    } catch (error: any) {
      respond(profileSettingsErrorStatus(error), {
        ok: false,
        error: error?.message ?? String(error),
      });
    }
  });

  apiRouter.post('/api/settings/profiles/rename', async ({ req, readJson, json: respond }) => {
    const body = await readJson<any>();
    const previousRootDir = droneRootPath();
    try {
      const currentHubState = await readManagedHubStateAtRootOrFallback(previousRootDir, req);
      const renamed = await renameManagedProfile(body?.name, body?.nextName, {
        syncRunningHubState: { state: currentHubState, apiToken, previousRootDir },
      });
      respond(200, {
        ok: true,
        ...(await listProfilesState()),
        renamedFrom: renamed.renamedFrom,
        renamedTo: renamed.renamedTo,
        reloadRequired:
          renamed.activeProfile === renamed.renamedTo && renamed.renamedFrom !== renamed.renamedTo,
      });
    } catch (error: any) {
      respond(profileSettingsErrorStatus(error), {
        ok: false,
        error: error?.message ?? String(error),
      });
    }
  });

  apiRouter.delete('/api/settings/profiles/:profileName', async ({ params, json: respond }) => {
    try {
      const deleted = await deleteManagedProfile(params.profileName);
      respond(200, {
        ok: true,
        ...(await listProfilesState()),
        deletedProfile: deleted.deleted,
        removedContainers: deleted.removedContainers,
        removedHostRoots: deleted.removedHostRoots,
      });
    } catch (error: any) {
      respond(profileSettingsErrorStatus(error), {
        ok: false,
        error: error?.message ?? String(error),
      });
    }
  });

  apiRouter.get('/api/settings/ui-preferences', async ({ json: respond }) => {
    respond(200, await resolveUiPreferencesSettingsResponse());
  });

  apiRouter.post('/api/settings/ui-preferences', async ({ readJson, json: respond }) => {
    const body = await readJson<any>();
    try {
      await upsertStoredUiPreferencesSettings(body?.uiPreferences, body?.expectedVersion);
    } catch (error: any) {
      if (error instanceof UiPreferencesSettingsConflictError) {
        respond(409, {
          ok: false,
          error: error.message,
          uiPreferences: error.uiPreferences,
          updatedAt: error.updatedAt,
          version: error.version,
        });
        return;
      }
      if (error instanceof UiPreferencesSettingsValidationError) {
        respond(400, { ok: false, error: error.message });
        return;
      }
      throw error;
    }
    respond(200, await resolveUiPreferencesSettingsResponse());
  });

  apiRouter.post('/api/settings/ui-preferences/pinned-drones', async ({ readJson, json: respond }) => {
    const body = await readJson<any>();
    try {
      const saved = await updatePinnedDronePreference(
        Array.isArray(body?.droneIds) ? body.droneIds : body?.droneId,
        body?.pinned === true,
      );
      await notifyPinnedDronesChanged();
      respond(200, { ok: true, ...saved });
    } catch (error: any) {
      if (error instanceof UiPreferencesSettingsValidationError) {
        respond(400, { ok: false, error: error.message });
        return;
      }
      throw error;
    }
  });

  apiRouter.get('/api/settings/hub/logs', async ({ url, json: respond }) => {
    const maxBytes = clampIntParam(
      url.searchParams.get('maxBytes'),
      HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES,
      1,
      HUB_SETTINGS_LOG_MAX_BYTES,
    );
    const tailLines = clampIntParam(
      url.searchParams.get('tail'),
      HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES,
      1,
      HUB_SETTINGS_LOG_MAX_TAIL_LINES,
    );
    try {
      respond(200, {
        ok: true,
        ...(await readHubLogTail({ maxBytes, tailLines })),
        maxBytes,
        tailLines,
      });
    } catch (error: any) {
      respond(500, { ok: false, error: error?.message ?? String(error) });
    }
  });
}
