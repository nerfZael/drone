import type { DroneRuntime } from '../../host/runtime';
import { parseBoolParam } from '../hub-format';
import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

export function registerAgentModelCatalogRoutes(
  router: HubRouter,
  deps: {
    normalizeBuiltinAgentId: ServiceFunction;
    nativeModelCatalog: ServiceFunction;
    loadRegistry: ServiceFunction;
    droneRuntime: ServiceFunction;
    discoverModels: ServiceFunction;
  },
): void {
  router.get('/api/model-catalog', async ({ url, fail, json }) => {
    const requestedAgent = String(url.searchParams.get('agent') ?? '').trim().toLowerCase();
    const runtime: DroneRuntime =
      String(url.searchParams.get('runtime') ?? '').trim() === 'host' ? 'host' : 'container';
    const forceRefresh = parseBoolParam(url.searchParams.get('refresh'), false);
    if (requestedAgent === 'native') {
      const catalog = await deps.nativeModelCatalog();
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
