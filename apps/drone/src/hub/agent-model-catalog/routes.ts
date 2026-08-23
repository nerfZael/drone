import type { DroneRuntime } from '../../host/runtime';
import { parseBoolParam } from '../hub-format';
import type { HubRouter } from '../hub-router';
import { AGENT_MODEL_CATALOG_AGENT_IDS } from './adapters';

type ServiceFunction = (...args: any[]) => any;

export function registerAgentModelCatalogRoutes(
  router: HubRouter,
  deps: {
    normalizeBuiltinAgentId: ServiceFunction;
    nativeModelCatalog: ServiceFunction;
    loadRegistry: ServiceFunction;
    droneRuntime: ServiceFunction;
    discoverModels: ServiceFunction;
    hostAgentInstalled: ServiceFunction;
  },
): void {
  router.post('/api/model-catalog/refresh', async ({ json }) => {
    const installedChecks = await Promise.all(
      AGENT_MODEL_CATALOG_AGENT_IDS.map(async (agentId) => {
        try {
          return { agentId, installed: Boolean(await deps.hostAgentInstalled(agentId)) };
        } catch {
          return { agentId, installed: false };
        }
      }),
    );
    const refreshed = await Promise.all(
      installedChecks.map(async ({ agentId, installed }) => {
        if (!installed) return { agent: agentId, installed, models: [] };
        try {
          const result = await deps.discoverModels({
            runtime: 'host',
            agentId,
            forceRefresh: true,
          });
          return {
            agent: agentId,
            installed,
            models: result.models,
            source: result.source,
            discoveredAt: result.discoveredAt,
            ...(result.stale ? { stale: true } : {}),
            ...(result.error ? { error: result.error } : {}),
          };
        } catch (error: any) {
          return {
            agent: agentId,
            installed,
            models: [],
            source: 'none',
            error: String(error?.message ?? error ?? 'Model discovery failed.'),
          };
        }
      }),
    );

    json(200, {
      ok: true,
      runtime: 'host',
      refreshedAt: new Date().toISOString(),
      catalogs: refreshed,
    });
  });

  router.get('/api/model-catalog', async ({ url, fail, json }) => {
    const requestedAgent = String(url.searchParams.get('agent') ?? '').trim().toLowerCase();
    const runtime: DroneRuntime =
      String(url.searchParams.get('runtime') ?? '').trim() === 'host' ? 'host' : 'container';
    const forceRefresh = parseBoolParam(url.searchParams.get('refresh'), false);
    if (requestedAgent === 'native') {
      const requestedProvider = String(url.searchParams.get('provider') ?? '').trim().toLowerCase();
      if (requestedProvider && !['openai', 'codex', 'gemini'].includes(requestedProvider)) {
        return fail(400, 'provider must be openai, codex, or gemini');
      }
      const catalog = await deps.nativeModelCatalog(requestedProvider || undefined);
      json(200, { ok: true, agent: 'native', runtime, ...catalog, source: 'native' });
      return;
    }

    const agentId = deps.normalizeBuiltinAgentId(requestedAgent);
    if (!agentId) return fail(400, 'A builtin agent is required.');

    const registry: any = await deps.loadRegistry();
    const candidates = Object.entries<any>(registry?.drones ?? {})
      .filter(([, drone]) => deps.droneRuntime(drone) === runtime)
      .filter(([droneId, drone]) =>
        runtime === 'host' ||
        Boolean(String(drone?.containerName ?? drone?.name ?? droneId).trim()),
      )
      .sort(([left], [right]) => left.localeCompare(right));
    const targets = candidates.length > 0 ? candidates : [['', null] as const];
    let discovered: any = null;
    for (let index = 0; index < targets.length; index += 1) {
      const [droneId, drone] = targets[index];
      discovered = await deps.discoverModels({
        containerName: String(drone?.containerName ?? drone?.name ?? droneId).trim(),
        containerPort: Number(drone?.containerPort ?? 7777),
        runtime,
        agentId,
        forceRefresh: forceRefresh || index > 0,
      });
      if (discovered.models.length > 0 && !(discovered.stale && discovered.error)) break;
    }
    json(200, {
      ok: true,
      agent: agentId,
      runtime,
      models: discovered.models,
      source: discovered.source,
      discoveredAt: discovered.discoveredAt,
      ...(discovered.stale ? { stale: true } : {}),
      ...(discovered.installationFingerprint
        ? { installationFingerprint: discovered.installationFingerprint }
        : {}),
      ...(discovered.error ? { error: discovered.error } : {}),
    });
  });
}
