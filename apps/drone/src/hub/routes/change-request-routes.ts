import type {
  ChangeRequestActor,
  ChangeRequestStatus,
} from '../change-requests/change-request-types';
import type { ChangeRequestGithubMirrorService } from '../change-requests/change-request-github-mirror-service';
import {
  ChangeRequestError,
  type ChangeRequestService,
} from '../change-requests/change-request-service';
import type { HubRouter } from '../hub-router';

type ChangeRequestRouteDependencies = {
  service: ChangeRequestService | null;
  githubMirrorService: ChangeRequestGithubMirrorService | null;
};

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

function errorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ChangeRequestError) {
    return {
      status: error.statusCode,
      body: {
        ok: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
        ...error.details,
      },
    };
  }
  throw error;
}

export function registerChangeRequestRoutes(
  apiRouter: HubRouter,
  deps: ChangeRequestRouteDependencies,
): void {
  const service = (): ChangeRequestService => {
    if (!deps.service) {
      throw new ChangeRequestError(
        'Change requests are unavailable because the Hub database is unavailable.',
        503,
      );
    }
    return deps.service;
  };

  const githubMirrorService = (): ChangeRequestGithubMirrorService => {
    if (!deps.githubMirrorService) {
      throw new ChangeRequestError(
        'GitHub mirroring is unavailable because the Hub database is unavailable.',
        503,
      );
    }
    return deps.githubMirrorService;
  };

  apiRouter.get('/api/change-requests', async ({ url, json }) => {
    try {
      const requests = await service().list({
        droneId: url.searchParams.get('droneId')?.trim() || undefined,
        chatName: url.searchParams.get('chatName')?.trim() || undefined,
        status: statusFilter(url.searchParams.get('status')),
      });
      json(200, { ok: true, requests });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.post('/api/change-requests', async ({ readJson, json }) => {
    try {
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
      json(201, { ok: true, request });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.get('/api/change-requests/:requestId', async ({ params, json }) => {
    try {
      json(200, { ok: true, request: await service().get(params.requestId) });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.post('/api/change-requests/:requestId/refresh-assessment', async ({ params, json }) => {
    try {
      json(200, { ok: true, request: await service().refreshAssessment(params.requestId) });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.patch('/api/change-requests/:requestId', async ({ params, readJson, json }) => {
    try {
      const body = await readJson<Record<string, unknown>>();
      const request = await service().update(params.requestId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        destinationBranch:
          typeof body.destinationBranch === 'string' ? body.destinationBranch : undefined,
        refreshSnapshot:
          typeof body.refreshSnapshot === 'boolean' ? body.refreshSnapshot : undefined,
      });
      json(200, { ok: true, request });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.post('/api/change-requests/:requestId/close', async ({ params, json }) => {
    try {
      json(200, { ok: true, request: await service().close(params.requestId) });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.post('/api/change-requests/:requestId/merge', async ({ params, readJson, json }) => {
    try {
      const body = await readJson<Record<string, unknown>>();
      const request = await service().merge(params.requestId, {
        actor: requestActor(body.actor),
        commitMessage: typeof body.commitMessage === 'string' ? body.commitMessage : undefined,
      });
      json(200, { ok: true, request });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.post(
    '/api/change-requests/:requestId/github/publish',
    async ({ params, readJson, json }) => {
      try {
        const body = await readJson<Record<string, unknown>>();
        await githubMirrorService().publish(params.requestId, {
          merge: body.merge === true,
          mergeMethod:
            body.mergeMethod === 'merge' ||
            body.mergeMethod === 'rebase' ||
            body.mergeMethod === 'squash'
              ? body.mergeMethod
              : 'squash',
        });
        json(201, { ok: true, request: await service().get(params.requestId) });
      } catch (error) {
        const response = errorResponse(error);
        json(response.status, response.body);
      }
    },
  );

  apiRouter.post('/api/change-requests/:requestId/github/sync', async ({ params, json }) => {
    try {
      await githubMirrorService().sync(params.requestId);
      json(200, { ok: true, request: await service().get(params.requestId) });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.post('/api/change-requests/:requestId/github/refresh', async ({ params, json }) => {
    try {
      await githubMirrorService().refresh(params.requestId);
      json(200, { ok: true, request: await service().get(params.requestId) });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.patch('/api/change-requests/:requestId/github', async ({ params, readJson, json }) => {
    try {
      const body = await readJson<Record<string, unknown>>();
      if (typeof body.autoUpdate !== 'boolean') {
        throw new ChangeRequestError('autoUpdate must be a boolean');
      }
      await githubMirrorService().setAutoUpdate(params.requestId, body.autoUpdate);
      json(200, { ok: true, request: await service().get(params.requestId) });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.post(
    '/api/change-requests/:requestId/github/merge',
    async ({ params, readJson, json }) => {
      try {
        const body = await readJson<Record<string, unknown>>();
        const method =
          body.method === 'merge' || body.method === 'rebase' || body.method === 'squash'
            ? body.method
            : 'squash';
        await githubMirrorService().merge(params.requestId, method);
        json(200, { ok: true, request: await service().get(params.requestId) });
      } catch (error) {
        const response = errorResponse(error);
        json(response.status, response.body);
      }
    },
  );

  apiRouter.post('/api/change-requests/:requestId/github/close', async ({ params, json }) => {
    try {
      await githubMirrorService().close(params.requestId);
      json(200, { ok: true, request: await service().get(params.requestId) });
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.get('/api/change-requests/:requestId/changes', async ({ params, json }) => {
    try {
      const changes = await service().changes(params.requestId);
      const request = changes.request;
      json(200, {
        ok: true,
        id: request.droneId,
        name: request.droneName,
        repoRoot: request.repoRoot,
        reviewScopeId: `change-request:${request.id}:${request.revision}`,
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
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });

  apiRouter.get('/api/change-requests/:requestId/diff', async ({ params, url, json }) => {
    try {
      const result = await service().diff(
        params.requestId,
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
    } catch (error) {
      const response = errorResponse(error);
      json(response.status, response.body);
    }
  });
}
