import { parseBoolParam } from '../hub-format';
import type { HubRouter } from '../hub-router';
import type { HubServices } from '../application/hub-services';

export type GroupRouteDependencies = {
  groups: HubServices['groups'];
  nowIso: () => string;
};

export function registerGroupRoutes(router: HubRouter, deps: GroupRouteDependencies): void {
  const {
    groups,
    nowIso,
  } = deps;

  router.get('/api/groups', async ({ url, json }) => {
    const requestedRepoPath = url.searchParams.has('repoPath')
      ? String(url.searchParams.get('repoPath') ?? '').trim()
      : undefined;
    json(200, await groups.list(requestedRepoPath));
  });

  router.post('/api/groups', async ({ readJson, json }) => {
    const body = await readJson<any>();
    json(
      201,
      await groups.create({
        name: body?.name ?? body?.group ?? body?.groupName ?? '',
        repoPath: body?.repoPath,
        at: nowIso(),
      }),
    );
  });

  router.post('/api/groups/:groupName/rename', async ({ params, readJson, json }) => {
    const body = await readJson<any>();
    json(
      200,
      await groups.rename({
        groupRef: params.groupName,
        repoPath: String(body?.repoPath ?? '').trim(),
        newName: body?.newName ?? body?.name ?? '',
        at: nowIso(),
      }),
    );
  });

  router.delete('/api/groups/:groupName/drones', async ({ params, url, json }) => {
    const keepVolume = parseBoolParam(url.searchParams.get('keepVolume'), false);
    const forget = parseBoolParam(url.searchParams.get('forget'), true);
    const result = await groups.deleteDrones({
      groupRef: params.groupName,
      repoPath: String(url.searchParams.get('repoPath') ?? '').trim(),
      keepVolume,
      forget,
    });
    json(result.ok ? 200 : 500, result);
  });

  router.delete('/api/groups/:groupName', async ({ params, url, json }) => {
    const keepVolume = parseBoolParam(url.searchParams.get('keepVolume'), false);
    const forget = parseBoolParam(url.searchParams.get('forget'), true);
    const result = await groups.delete({
      groupRef: params.groupName,
      repoPath: String(url.searchParams.get('repoPath') ?? '').trim(),
      keepVolume,
      forget,
    });
    json(result.ok ? 200 : 500, result);
  });
}
