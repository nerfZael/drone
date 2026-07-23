import type { ServerResponse } from 'node:http';

import type { HubRouter } from '../hub-router';
import type { WorkflowService } from '../workflows/workflow-service';
import type { WorkflowActor } from '../workflows/workflow-types';

export type WorkflowRouteDependencies = {
  service: WorkflowService;
  writeSseEvent: (res: ServerResponse, event: string, data: unknown) => void;
  nowIso: () => string;
};

function uiActor(body?: any): WorkflowActor {
  return {
    kind: body?.actorKind === 'mcp' ? 'mcp' : 'ui',
    id: String(body?.actorId ?? 'drone-hub-user').trim() || 'drone-hub-user',
  };
}

export function registerWorkflowRoutes(
  router: HubRouter,
  dependencies: WorkflowRouteDependencies,
): void {
  const { service, writeSseEvent, nowIso } = dependencies;

  router.get('/api/drones/:droneId/workflows/events', ({ req, res, params }) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as any).flushHeaders?.();
    writeSseEvent(res, 'connected', { ok: true, at: nowIso() });
    const unsubscribe = service.events.subscribe(params.droneId, (event) => {
      writeSseEvent(res, 'workflow_change', event);
    });
    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
    }, 25_000);
    keepAlive.unref?.();
    const cleanup = () => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    req.once('close', cleanup);
    res.once('close', cleanup);
  });

  router.get('/api/drones/:droneId/workflows', ({ params, json }) => {
    json(200, { ok: true, workflows: service.listWorkflows(params.droneId) });
  });

  router.post('/api/drones/:droneId/workflows', async ({ params, readJson, json }) => {
    const body = await readJson<any>();
    const workflow = await service.createWorkflow(
      params.droneId,
      {
        name: body?.name,
        description: body?.description,
        definition: body?.definition,
      },
      uiActor(body),
    );
    json(201, { ok: true, workflow });
  });

  router.get('/api/drones/:droneId/workflows/:workflowId', ({ params, json }) => {
    json(200, {
      ok: true,
      workflow: service.getWorkflow(params.droneId, params.workflowId),
    });
  });

  router.patch('/api/drones/:droneId/workflows/:workflowId', async ({ params, readJson, json }) => {
    const body = await readJson<any>();
    const workflow = await service.updateWorkflow(
      params.droneId,
      params.workflowId,
      {
        baseVersion: body?.baseVersion,
        ...(body?.name === undefined ? {} : { name: body.name }),
        ...(body?.description === undefined ? {} : { description: body.description }),
        ...(body?.definition === undefined ? {} : { definition: body.definition }),
      },
      uiActor(body),
    );
    json(200, { ok: true, workflow });
  });

  router.delete('/api/drones/:droneId/workflows/:workflowId', async ({ params, json }) => {
    await service.deleteWorkflow(params.droneId, params.workflowId);
    json(200, { ok: true });
  });

  router.post(
    '/api/drones/:droneId/workflows/:workflowId/runs',
    async ({ params, readJson, json }) => {
      const body = await readJson<any>();
      const run = await service.requestRun(
        params.droneId,
        params.workflowId,
        body && Object.prototype.hasOwnProperty.call(body, 'input') ? body.input : {},
        uiActor(body),
      );
      json(202, { ok: true, run, approvalRequired: true });
    },
  );

  router.get('/api/drones/:droneId/workflow-runs', ({ params, url, json }) => {
    json(200, {
      ok: true,
      runs: service.listRuns(params.droneId, url.searchParams.get('workflowId') ?? undefined),
    });
  });

  router.get('/api/drones/:droneId/workflow-runs/:runId', ({ params, json }) => {
    json(200, { ok: true, run: service.getRun(params.droneId, params.runId) });
  });

  router.get(
    '/api/drones/:droneId/workflow-runs/:runId/invocations',
    async ({ params, url, json }) => {
      const page = await service.listInvocations(
        params.droneId,
        params.runId,
        url.searchParams.get('cursor') ?? undefined,
        Number(url.searchParams.get('limit') ?? 100),
      );
      json(200, { ok: true, ...page });
    },
  );

  router.post(
    '/api/drones/:droneId/workflow-runs/:runId/approve',
    async ({ params, readJson, json }) => {
      const body = await readJson<any>();
      const run = await service.approveRun(params.droneId, params.runId, uiActor(body));
      json(202, { ok: true, run });
    },
  );

  router.post(
    '/api/drones/:droneId/workflow-runs/:runId/deny',
    async ({ params, readJson, json }) => {
      const body = await readJson<any>();
      const run = await service.denyRun(params.droneId, params.runId, uiActor(body));
      json(200, { ok: true, run });
    },
  );

  router.post('/api/drones/:droneId/workflow-runs/:runId/cancel', async ({ params, json }) => {
    const run = await service.cancelRun(params.droneId, params.runId);
    json(202, { ok: true, run });
  });

  router.delete('/api/drones/:droneId/workflow-runs/:runId', async ({ params, json }) => {
    await service.deleteRun(params.droneId, params.runId);
    json(200, { ok: true });
  });
}
