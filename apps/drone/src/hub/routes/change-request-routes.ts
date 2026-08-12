import type { ServerResponse } from 'node:http';

import { ChangeRequestError } from '../change-requests/change-request-error';
import type { ChangeRequestGithubMirrorService } from '../change-requests/change-request-github-mirror-service';
import type { ChangeRequestService } from '../change-requests/change-request-service';
import type {
  ChangeRequestActor,
  ChangeRequestStatus,
} from '../change-requests/change-request-types';
import type { HubRouteHandler, HubRouter } from '../hub-router';

type ChangeRequestRouteDependencies = {
  service: ChangeRequestService | null;
  githubMirrorService: ChangeRequestGithubMirrorService | null;
  writeSseEvent: (res: ServerResponse, event: string, data: unknown) => void;
  nowIso: () => string;
};

export function registerChangeRequestRoutes(
  apiRouter: HubRouter,
  deps: ChangeRequestRouteDependencies,
): void {
  const service = () => {
    if (!deps.service) {
      throw new ChangeRequestError(
        'Change requests are unavailable because the Hub database is unavailable.',
        503,
      );
    }
    return deps.service;
  };
  const githubMirrorService = () => {
    if (!deps.githubMirrorService) {
      throw new ChangeRequestError(
        'GitHub mirroring is unavailable because the Hub database is unavailable.',
        503,
      );
    }
    return deps.githubMirrorService;
  };
  const route = changeRequestRouter(apiRouter);
  const eventClients = new Map<string, Set<ServerResponse>>();
  const publishChange = (request: { droneId: string; number: number; status: string; updatedAt: string }) => {
    const clients = eventClients.get(request.droneId);
    if (!clients) return;
    for (const response of clients) {
      deps.writeSseEvent(response, 'change_request_changed', {
        droneId: request.droneId,
        requestNumber: request.number,
        status: request.status,
        updatedAt: request.updatedAt,
      });
    }
  };

  route.get('/api/change-requests', async ({ url, json }) => {
    const requests = await service().list({
      droneId: url.searchParams.get('droneId')?.trim() || undefined,
      chatName: url.searchParams.get('chatName')?.trim() || undefined,
      status: statusFilter(url.searchParams.get('status')),
    });
    json(200, { ok: true, requests });
  });

  route.get('/api/change-requests/events', ({ req, res, url }) => {
    const droneId = url.searchParams.get('droneId')?.trim();
    if (!droneId) throw new ChangeRequestError('droneId is required');
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as ServerResponse & { flushHeaders?: () => void }).flushHeaders?.();
    let clients = eventClients.get(droneId);
    if (!clients) {
      clients = new Set();
      eventClients.set(droneId, clients);
    }
    clients.add(res);
    deps.writeSseEvent(res, 'connected', { ok: true, droneId, at: deps.nowIso() });
    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
    }, 25_000);
    keepAlive.unref?.();
    const cleanup = () => {
      clearInterval(keepAlive);
      clients?.delete(res);
      if (clients?.size === 0) eventClients.delete(droneId);
    };
    req.once('close', cleanup);
    res.once('close', cleanup);
  });

  route.post('/api/change-requests', async ({ readJson, json }) => {
    const body = await readJson<Record<string, unknown>>();
    const request = await service().create({
      droneRef: String(body.droneRef ?? body.droneId ?? ''),
      chatName: typeof body.chatName === 'string' ? body.chatName : undefined,
      chatId: typeof body.chatId === 'string' ? body.chatId : null,
      title: String(body.title ?? ''),
      description: typeof body.description === 'string' ? body.description : undefined,
      destinationBranch:
        typeof body.destinationBranch === 'string' ? body.destinationBranch : undefined,
      actor: requestActor(body.actor),
    });
    publishChange(request);
    json(201, { ok: true, request });
  });

  route.get('/api/change-requests/:requestNumber', async ({ params, url, json }) => {
    const droneId = url.searchParams.get('droneId');
    const request = droneId
      ? await service().getByNumber(params.requestNumber, droneId)
      : await service().get(params.requestNumber);
    json(200, { ok: true, request });
  });

  route.post('/api/change-requests/:requestNumber/refresh-assessment', async ({ params, json }) => {
    const request = await service().refreshAssessment(params.requestNumber);
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.patch('/api/change-requests/:requestNumber', async ({ params, readJson, json }) => {
    const body = await readJson<Record<string, unknown>>();
    const request = await service().update(params.requestNumber, {
      title: typeof body.title === 'string' ? body.title : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      destinationBranch:
        typeof body.destinationBranch === 'string' ? body.destinationBranch : undefined,
      refreshSnapshot: typeof body.refreshSnapshot === 'boolean' ? body.refreshSnapshot : undefined,
    });
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.post('/api/change-requests/:requestNumber/close', async ({ params, json }) => {
    const request = await service().close(params.requestNumber);
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.post('/api/change-requests/:requestNumber/merge', async ({ params, readJson, json }) => {
    const body = await readJson<Record<string, unknown>>();
    const request = await service().merge(params.requestNumber, {
      actor: requestActor(body.actor),
      commitMessage: typeof body.commitMessage === 'string' ? body.commitMessage : undefined,
    });
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.post(
    '/api/change-requests/:requestNumber/github/publish',
    async ({ params, readJson, json }) => {
      const body = await readJson<Record<string, unknown>>();
      await githubMirrorService().publish(params.requestNumber, {
        merge: body.merge === true,
        mergeMethod: mergeMethod(body.mergeMethod),
      });
      const request = await service().get(params.requestNumber);
      publishChange(request);
      json(201, { ok: true, request });
    },
  );

  route.post('/api/change-requests/:requestNumber/github/sync', async ({ params, json }) => {
    await githubMirrorService().sync(params.requestNumber);
    const request = await service().get(params.requestNumber);
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.post('/api/change-requests/:requestNumber/github/refresh', async ({ params, json }) => {
    await githubMirrorService().refresh(params.requestNumber);
    const request = await service().get(params.requestNumber);
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.patch('/api/change-requests/:requestNumber/github', async ({ params, readJson, json }) => {
    const body = await readJson<Record<string, unknown>>();
    if (typeof body.autoUpdate !== 'boolean') {
      throw new ChangeRequestError('autoUpdate must be a boolean');
    }
    await githubMirrorService().setAutoUpdate(params.requestNumber, body.autoUpdate);
    const request = await service().get(params.requestNumber);
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.post(
    '/api/change-requests/:requestNumber/github/merge',
    async ({ params, readJson, json }) => {
      const body = await readJson<Record<string, unknown>>();
      await githubMirrorService().merge(params.requestNumber, mergeMethod(body.method));
      const request = await service().get(params.requestNumber);
      publishChange(request);
      json(200, { ok: true, request });
    },
  );

  route.post('/api/change-requests/:requestNumber/github/close', async ({ params, json }) => {
    await githubMirrorService().close(params.requestNumber);
    const request = await service().get(params.requestNumber);
    publishChange(request);
    json(200, { ok: true, request });
  });

  route.get('/api/change-requests/:requestNumber/changes', async ({ params, json }) => {
    const changes = await service().changes(params.requestNumber);
    const request = changes.request;
    json(200, {
      ok: true,
      id: request.droneId,
      name: request.droneName,
      repoRoot: request.repoRoot,
      reviewScopeId: `change-request:${request.number}:${request.revision}`,
      baseSha: request.baseSha,
      headSha: request.snapshotSha,
      counts: changes.counts,
      entries: changes.entries,
      mode: 'change-request',
      branchContext: {
        hostCurrent: request.destinationBranch,
        droneCurrent: null,
        droneConfigured: null,
        droneFromRef: request.baseBranch,
      },
      request,
    });
  });

  route.get('/api/change-requests/:requestNumber/diff', async ({ params, url, json }) => {
    const result = await service().diff(
      params.requestNumber,
      url.searchParams.get('path') ?? '',
      Number(url.searchParams.get('contextLines')),
    );
    json(200, {
      ok: true,
      id: result.request.droneId,
      name: result.request.droneName,
      repoRoot: result.request.repoRoot,
      baseSha: result.request.baseSha,
      headSha: result.request.snapshotSha,
      path: result.path,
      diff: result.diff,
      truncated: result.truncated,
      isBinary: false,
    });
  });
}

function changeRequestRouter(apiRouter: HubRouter) {
  const wrap =
    (handler: HubRouteHandler): HubRouteHandler =>
    async (context) => {
      try {
        await handler(context);
      } catch (error) {
        if (!(error instanceof ChangeRequestError)) throw error;
        context.json(error.statusCode, {
          ok: false,
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...error.details,
        });
      }
    };
  return {
    get: (path: string, handler: HubRouteHandler) => apiRouter.get(path, wrap(handler)),
    patch: (path: string, handler: HubRouteHandler) => apiRouter.patch(path, wrap(handler)),
    post: (path: string, handler: HubRouteHandler) => apiRouter.post(path, wrap(handler)),
  };
}

function requestActor(value: unknown): ChangeRequestActor {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    kind: input.kind === 'chat' || input.kind === 'system' ? input.kind : 'user',
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : null,
    label: String(input.label ?? '').trim() || 'DroneHub user',
  };
}

function statusFilter(value: string | null): ChangeRequestStatus | undefined {
  return value === 'open' || value === 'merged' || value === 'closed' ? value : undefined;
}

function mergeMethod(value: unknown): 'merge' | 'rebase' | 'squash' {
  return value === 'merge' || value === 'rebase' || value === 'squash' ? value : 'squash';
}
