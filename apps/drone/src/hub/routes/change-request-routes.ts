import type { ServerResponse } from 'node:http';
import path from 'node:path';

import { ChangeRequestError } from '../change-requests/change-request-error';
import type { ChangeRequestGithubMirrorService } from '../change-requests/change-request-github-mirror-service';
import type { ChangeRequestService } from '../change-requests/change-request-service';
import type {
  ChangeRequestActor,
  ChangeRequestStatus,
} from '../change-requests/change-request-types';
import type { ChangeRequestDomainEvent } from '../change-requests/change-request-events';
import type { HubRouteHandler, HubRouter } from '../hub-router';
import { openHubSseStream } from './hub-sse-stream';

type ChangeRequestRouteDependencies = {
  service: ChangeRequestService | null;
  githubMirrorService: ChangeRequestGithubMirrorService | null;
  writeSseEvent: (res: ServerResponse, event: string, data: unknown) => void;
  nowIso: () => string;
  subscribeToChanges?: (observer: (event: ChangeRequestDomainEvent) => void) => () => void;
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

  route.get('/api/change-requests', async ({ url, json }) => {
    const requests = await service().list({
      droneId: url.searchParams.get('droneId')?.trim() || undefined,
      chatName: url.searchParams.get('chatName')?.trim() || undefined,
      status: statusFilter(url.searchParams.get('status')),
    });
    json(200, { ok: true, requests });
  });

  route.get('/api/change-requests/events', async ({ req, res, url }) => {
    const droneId = url.searchParams.get('droneId')?.trim();
    if (!droneId) throw new ChangeRequestError('droneId is required');
    const repoRoot = await service().repositoryRootForDrone(droneId);
    openHubSseStream({
      request: req,
      response: res,
      writeEvent: deps.writeSseEvent,
      connectedData: { ok: true, droneId, at: deps.nowIso() },
      subscribe: () =>
        deps.subscribeToChanges?.((event) => {
          if (
            path.resolve(event.request.repoRoot) !== repoRoot ||
            res.destroyed ||
            res.writableEnded
          ) {
            return;
          }
          deps.writeSseEvent(res, 'change_request_changed', {
            droneId: event.request.droneId,
            requestNumber: event.requestNumber,
            stateVersion: event.stateVersion,
            status: event.request.status,
            updatedAt: event.request.updatedAt,
          });
        }),
    });
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
    json(201, { ok: true, request });
  });

  route.get('/api/change-requests/:requestNumber', async ({ params, url, json }) => {
    const droneId = url.searchParams.get('droneId');
    const request = droneId
      ? await service().getByNumber(params.requestNumber, droneId)
      : await service().get(params.requestNumber);
    json(200, { ok: true, request });
  });

  route.get('/api/change-requests/:requestNumber/revisions', async ({ params, json }) => {
    const revisions = await service().revisions(params.requestNumber);
    json(200, { ok: true, revisions });
  });

  route.post(
    '/api/change-requests/:requestNumber/review-workspace',
    async ({ params, readJson, json }) => {
      const body = await readJson<Record<string, unknown>>();
      const workspace = await service().prepareReviewWorkspace({
        requestNumber: params.requestNumber,
        revision: body.revision,
        reviewerDroneRef: String(body.reviewerDroneRef ?? body.drone ?? ''),
      });
      json(201, { ok: true, workspace });
    },
  );

  route.post(
    '/api/change-requests/:requestNumber/review-workspace/promote',
    async ({ params, readJson, json }) => {
      const body = await readJson<Record<string, unknown>>();
      const request = await service().updateFromReviewWorkspace({
        requestNumber: params.requestNumber,
        workspaceId: String(body.workspaceId ?? ''),
        reviewerDroneRef: String(body.reviewerDroneRef ?? body.drone ?? ''),
        actor: requestActor(body.actor),
      });
      json(200, { ok: true, request });
    },
  );

  route.post('/api/change-requests/:requestNumber/refresh-assessment', async ({ params, json }) => {
    const request = await service().refreshAssessment(params.requestNumber);
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
      actor: requestActor(body.actor),
    });
    json(200, { ok: true, request });
  });

  route.post('/api/change-requests/:requestNumber/close', async ({ params, json }) => {
    const request = await service().close(params.requestNumber);
    json(200, { ok: true, request });
  });

  route.post(
    '/api/change-requests/:requestNumber/apply-to-host',
    async ({ params, readJson, json }) => {
      const body = await readJson<Record<string, unknown>>();
      const application = await service().applyToHostCheckout(params.requestNumber, {
        droneId: body.droneId,
        expectedRevision:
          typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
      });
      json(200, { ok: true, application });
    },
  );

  route.post('/api/change-requests/:requestNumber/merge', async ({ params, readJson, json }) => {
    const body = await readJson<Record<string, unknown>>();
    const request = await service().merge(params.requestNumber, {
      actor: requestActor(body.actor),
      commitMessage: typeof body.commitMessage === 'string' ? body.commitMessage : undefined,
      expectedRevision:
        typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
      expectedDestinationBranch:
        typeof body.expectedDestinationBranch === 'string'
          ? body.expectedDestinationBranch
          : undefined,
      expectedDestinationSha:
        typeof body.expectedDestinationSha === 'string' ? body.expectedDestinationSha : undefined,
      expectedCandidateTreeSha:
        typeof body.expectedCandidateTreeSha === 'string'
          ? body.expectedCandidateTreeSha
          : undefined,
    });
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
      json(201, { ok: true, request });
    },
  );

  route.post('/api/change-requests/:requestNumber/github/sync', async ({ params, json }) => {
    await githubMirrorService().sync(params.requestNumber);
    const request = await service().get(params.requestNumber);
    json(200, { ok: true, request });
  });

  route.post('/api/change-requests/:requestNumber/github/refresh', async ({ params, json }) => {
    await githubMirrorService().refresh(params.requestNumber);
    const request = await service().get(params.requestNumber);
    json(200, { ok: true, request });
  });

  route.patch('/api/change-requests/:requestNumber/github', async ({ params, readJson, json }) => {
    const body = await readJson<Record<string, unknown>>();
    if (typeof body.autoUpdate !== 'boolean') {
      throw new ChangeRequestError('autoUpdate must be a boolean');
    }
    await githubMirrorService().setAutoUpdate(params.requestNumber, body.autoUpdate);
    const request = await service().get(params.requestNumber);
    json(200, { ok: true, request });
  });

  route.post(
    '/api/change-requests/:requestNumber/github/merge',
    async ({ params, readJson, json }) => {
      const body = await readJson<Record<string, unknown>>();
      await githubMirrorService().merge(params.requestNumber, mergeMethod(body.method));
      const request = await service().get(params.requestNumber);
      json(200, { ok: true, request });
    },
  );

  route.post('/api/change-requests/:requestNumber/github/close', async ({ params, json }) => {
    await githubMirrorService().close(params.requestNumber);
    const request = await service().get(params.requestNumber);
    json(200, { ok: true, request });
  });

  route.get('/api/change-requests/:requestNumber/changes', async ({ params, url, json }) => {
    const changes = await service().changes(params.requestNumber, url.searchParams.get('revision'));
    const request = changes.request;
    json(200, {
      ok: true,
      id: request.droneId,
      name: request.droneName,
      repoRoot: request.repoRoot,
      reviewScopeId: `change-request:${request.number}:${changes.revision.number}`,
      baseSha: changes.revision.baseSha,
      headSha: changes.revision.snapshotSha,
      counts: changes.counts,
      entries: changes.entries,
      revision: changes.revision,
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
      url.searchParams.get('revision'),
    );
    json(200, {
      ok: true,
      id: result.request.droneId,
      name: result.request.droneName,
      repoRoot: result.request.repoRoot,
      baseSha: result.revision.baseSha,
      headSha: result.revision.snapshotSha,
      revision: result.revision,
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
