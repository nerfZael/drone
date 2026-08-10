import path from 'node:path';

import type { HubRouter } from '../hub-router';
import type { HubServices } from '../application/hub-services';

type ServiceFunction = (...args: any[]) => any;

export interface RepositoryRouteDependencies {
  loadRegistry: ServiceFunction;
  repositories: HubServices['repositories'];
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
    loadRegistry,
    repositories,
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

  router.get('/api/repos', async ({ json }) => {
    json(200, await repositories.list());
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
