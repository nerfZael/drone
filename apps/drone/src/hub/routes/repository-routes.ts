import path from 'node:path';

import { parseBoolParam } from '../hub-format';
import type { HubRouter } from '../hub-router';
import type { DroneRuntime } from '../../host/runtime';

type ServiceFunction = (...args: any[]) => any;

interface ModelDiscoveryCacheEntry {
  atMs: number;
  models: unknown[];
}

export interface RepositoryRouteDependencies {
  normalizeBuiltinAgentId: ServiceFunction;
  modelCatalogCacheKey: ServiceFunction;
  latestChatModelDiscoveryByAgent: Map<string, ModelDiscoveryCacheEntry>;
  loadRegistry: ServiceFunction;
  droneRuntime: ServiceFunction;
  discoverAndRememberModelsForBuiltinAgent: ServiceFunction;
  listCanonicalRepositories: ServiceFunction;
  gitListRemoteBranches: ServiceFunction;
  removeCanonicalRepository: ServiceFunction;
  withCanonicalRepositories: ServiceFunction;
  repoEnvironmentPayload: ServiceFunction;
  normalizeEnvVarMap: ServiceFunction;
  nowIso: () => string;
  upsertCanonicalNonRepoEnvironmentConfig: ServiceFunction;
  updateCanonicalRepositoryEnvironment: ServiceFunction;
  repoAgentsPayload: ServiceFunction;
  normalizeRepoAgentsMode: ServiceFunction;
  normalizeAgentsMarkdown: ServiceFunction;
  updateCanonicalRepositoryAgents: ServiceFunction;
}

export function registerRepositoryRoutes(
  router: HubRouter,
  deps: RepositoryRouteDependencies,
): void {
  const {
    normalizeBuiltinAgentId,
    modelCatalogCacheKey,
    latestChatModelDiscoveryByAgent,
    loadRegistry,
    droneRuntime,
    discoverAndRememberModelsForBuiltinAgent,
    listCanonicalRepositories,
    gitListRemoteBranches,
    removeCanonicalRepository,
    withCanonicalRepositories,
    repoEnvironmentPayload,
    normalizeEnvVarMap,
    nowIso,
    upsertCanonicalNonRepoEnvironmentConfig,
    updateCanonicalRepositoryEnvironment,
    repoAgentsPayload,
    normalizeRepoAgentsMode,
    normalizeAgentsMarkdown,
    updateCanonicalRepositoryAgents,
  } = deps;

  router.get('/api/model-catalog', async ({ url, fail, json }) => {
    const agentId = normalizeBuiltinAgentId(url.searchParams.get('agent'));
    const runtime: DroneRuntime =
      String(url.searchParams.get('runtime') ?? '').trim() === 'host' ? 'host' : 'container';
    const forceRefresh = parseBoolParam(url.searchParams.get('refresh'), false);
    if (!agentId) return fail(400, 'A builtin agent is required.');

    const cacheKey = modelCatalogCacheKey(runtime, agentId);
    const cached = latestChatModelDiscoveryByAgent.get(cacheKey);
    if (!forceRefresh && cached) {
      json(200, {
        ok: true,
        agent: agentId,
        runtime,
        models: cached.models,
        source: 'cache',
        discoveredAt: new Date(cached.atMs).toISOString(),
      });
      return;
    }

    const registry: any = await loadRegistry();
    const candidate = Object.entries<any>(registry?.drones ?? {}).find(
      ([, drone]) => droneRuntime(drone) === runtime,
    );
    if (!candidate) {
      json(200, {
        ok: true,
        agent: agentId,
        runtime,
        models: cached?.models ?? [],
        source: cached ? 'cache' : 'none',
        discoveredAt: cached ? new Date(cached.atMs).toISOString() : null,
        error: `No ${runtime} drone is available for model discovery.`,
      });
      return;
    }

    const [droneId, drone] = candidate;
    const discovered = await discoverAndRememberModelsForBuiltinAgent({
      containerName: String(drone?.containerName ?? drone?.name ?? droneId).trim() || droneId,
      containerPort: Number(drone?.containerPort ?? 7777),
      runtime,
      droneName: droneId,
      chatName: '__model_catalog__',
      agentId,
      forceRefresh,
    });
    json(200, {
      ok: true,
      agent: agentId,
      runtime,
      models: discovered.models,
      source: discovered.source,
      discoveredAt: discovered.discoveredAt,
      ...(discovered.error ? { error: discovered.error } : {}),
    });
  });

  router.get('/api/repos', async ({ json }) => {
    const repos = (await listCanonicalRepositories()).map((repo: any) => ({
      path: repo.path,
      addedAt: repo.addedAt ?? null,
      remoteUrl: repo.remoteUrl ?? null,
      github: repo.github ?? null,
    }));
    json(200, { ok: true, repos, count: repos.length });
  });

  router.get('/api/repos/branches', async ({ url, fail, json }) => {
    const repoPath = String(url.searchParams.get('repoPath') ?? '').trim();
    if (!repoPath) return fail(400, 'missing repoPath');
    if (!path.isAbsolute(repoPath)) {
      return fail(400, 'invalid repoPath (expected absolute path)');
    }
    try {
      const listed = await gitListRemoteBranches(repoPath);
      json(200, {
        ok: true,
        repoRoot: listed.repoRoot,
        hostBranch: listed.hostBranch,
        remoteBranches: listed.remoteBranches.map((entry: any) => ({
          name: entry.ref,
          remote: entry.remote,
          branch: entry.branch,
          headSha: entry.oid,
        })),
      });
    } catch (error: any) {
      const message = error?.message ?? String(error);
      json(/git repository|git root|missing repo path/i.test(message) ? 409 : 500, {
        ok: false,
        error: message,
      });
    }
  });

  router.delete('/api/repos', async ({ url, fail, json }) => {
    const target = String(url.searchParams.get('path') ?? '').trim();
    if (!target) return fail(400, 'missing path');
    if (!path.isAbsolute(target)) return fail(400, 'invalid path (expected absolute path)');
    json(200, { ok: true, removed: await removeCanonicalRepository(target), path: target });
  });

  router.get('/api/repo-env', async ({ url, json }) => {
    const repoPath = url.searchParams.has('repoPath')
      ? String(url.searchParams.get('repoPath') ?? '')
      : '';
    const registry = repoPath ? await withCanonicalRepositories() : await loadRegistry();
    json(200, await repoEnvironmentPayload(registry, repoPath));
  });

  router.post('/api/repo-env', async ({ readJson, fail, json }) => {
    const body = await readJson<any>();
    const repoPath = typeof body?.repoPath === 'string' ? body.repoPath.trim() : '';
    if (repoPath && !path.isAbsolute(repoPath)) {
      return fail(400, 'invalid repoPath (expected absolute path or empty string)');
    }
    const vars = normalizeEnvVarMap(body?.vars);
    const autoApplyToNewContainerDrones = body?.autoApplyToNewContainerDrones === true;
    const updatedAt = nowIso();
    if (repoPath) {
      await updateCanonicalRepositoryEnvironment(
        repoPath,
        { vars, autoApplyToNewContainerDrones, updatedAt },
        updatedAt,
      );
    } else {
      await upsertCanonicalNonRepoEnvironmentConfig({ vars, autoApplyToNewContainerDrones });
    }
    const registry = repoPath ? await withCanonicalRepositories() : await loadRegistry();
    json(200, await repoEnvironmentPayload(registry, repoPath));
  });

  router.get('/api/repo-agents', async ({ url, fail, json }) => {
    const repoPath = String(url.searchParams.get('repoPath') ?? '').trim();
    if (!repoPath) return fail(400, 'missing repoPath');
    if (!path.isAbsolute(repoPath)) {
      return fail(400, 'invalid repoPath (expected absolute path)');
    }
    json(200, repoAgentsPayload(await withCanonicalRepositories(), repoPath));
  });

  router.post('/api/repo-agents', async ({ readJson, fail, json }) => {
    const body = await readJson<any>();
    const repoPath = typeof body?.repoPath === 'string' ? body.repoPath.trim() : '';
    if (!repoPath) return fail(400, 'missing repoPath');
    if (!path.isAbsolute(repoPath)) {
      return fail(400, 'invalid repoPath (expected absolute path)');
    }
    const updatedAt = nowIso();
    await updateCanonicalRepositoryAgents(
      repoPath,
      {
        mode: normalizeRepoAgentsMode(body?.mode),
        content: normalizeAgentsMarkdown(body?.content),
        updatedAt,
      },
      updatedAt,
    );
    json(200, repoAgentsPayload(await withCanonicalRepositories(), repoPath));
  });
}
