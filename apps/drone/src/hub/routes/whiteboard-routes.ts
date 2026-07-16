import type { ServerResponse } from 'node:http';

import { renderWhiteboardPng } from '../whiteboard-export';
import { requireWhiteboardStore } from '../whiteboard-store';
import type { HubRouter } from '../hub-router';

export type WhiteboardRouteDependencies = {
  nowIso: () => string;
  writeHubSseEvent: (res: ServerResponse, event: string, data: any) => void;
  subscribeWhiteboardChanges: (listener: (event: any) => void) => () => void;
  emitWhiteboardChange: (input: any) => any;
};

export function registerWhiteboardRoutes(
  apiRouter: HubRouter,
  deps: WhiteboardRouteDependencies,
): void {
  const { nowIso, writeHubSseEvent, subscribeWhiteboardChanges, emitWhiteboardChange } = deps;
  const errorMessage = (error: any): string => error?.message ?? String(error);
  const respondStatusError = (
    respond: (status: number, body: unknown) => void,
    error: any,
    fallbackStatus = 400,
  ) => {
    respond(Number(error?.statusCode ?? 0) || fallbackStatus, {
      ok: false,
      error: errorMessage(error),
    });
  };

  apiRouter.get('/api/whiteboards/events', ({ req, res }) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as any).flushHeaders?.();
    writeHubSseEvent(res, 'connected', { ok: true, at: nowIso() });
    const unsubscribe = subscribeWhiteboardChanges((event) => {
      writeHubSseEvent(res, 'whiteboard_change', event);
    });
    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
    }, 25_000);
    (keepAlive as any).unref?.();
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(keepAlive);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  apiRouter.get('/api/whiteboards', ({ url, json: respond }) => {
    respond(200, {
      ok: true,
      whiteboards: requireWhiteboardStore().list({
        scopeType: url.searchParams.get('scopeType') ?? undefined,
        scopeValue: url.searchParams.get('scopeValue') ?? undefined,
      }),
    });
  });

  apiRouter.post('/api/whiteboards', async ({ readJson, json: respond }) => {
    const body = await readJson<any>();
    try {
      const whiteboard = requireWhiteboardStore().create(body ?? {});
      emitWhiteboardChange({
        whiteboardId: whiteboard.id,
        version: whiteboard.version,
        reason: 'created',
        source: body?.actorId ?? 'ui',
      });
      respond(201, { ok: true, whiteboard });
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.get('/api/whiteboards/:whiteboardId/image', ({ params, url, fail, json: respond }) => {
    const store = requireWhiteboardStore();
    const whiteboard =
      params.whiteboardId === 'main'
        ? (store.get(params.whiteboardId) ?? store.ensureDefault())
        : store.get(params.whiteboardId);
    if (!whiteboard) return fail(404, `whiteboard not found: ${params.whiteboardId}`);
    try {
      const image = renderWhiteboardPng(whiteboard, {
        padding: url.searchParams.get('padding') ?? undefined,
        maxWidth: url.searchParams.get('maxWidth') ?? undefined,
        maxHeight: url.searchParams.get('maxHeight') ?? undefined,
        backgroundColor: url.searchParams.get('backgroundColor') ?? undefined,
      });
      const { data, ...metadata } = image;
      respond(200, { ok: true, data, metadata });
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.get('/api/whiteboards/:whiteboardId', ({ params, fail, json: respond }) => {
    const whiteboard = requireWhiteboardStore().get(params.whiteboardId);
    if (!whiteboard) return fail(404, `whiteboard not found: ${params.whiteboardId}`);
    respond(200, { ok: true, whiteboard });
  });

  apiRouter.patch('/api/whiteboards/:whiteboardId', async ({ params, readJson, json: respond }) => {
    const body = await readJson<any>();
    try {
      const store = requireWhiteboardStore();
      const whiteboard =
        Array.isArray(body?.operations) && body.operations.length > 0
          ? store.applyOperations(params.whiteboardId, body.operations, body?.actorId ?? 'ui')
          : store.save(params.whiteboardId, {
              baseVersion: body?.baseVersion,
              scene: body?.scene,
              title: body?.title,
              actorId: body?.actorId ?? 'ui',
            });
      emitWhiteboardChange({
        whiteboardId: whiteboard.id,
        version: whiteboard.version,
        reason: 'updated',
        source: body?.actorId ?? 'ui',
      });
      respond(200, { ok: true, whiteboard });
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.delete('/api/whiteboards/:whiteboardId', ({ params, json: respond }) => {
    try {
      const result = requireWhiteboardStore().delete(params.whiteboardId);
      if (result.deleted) {
        emitWhiteboardChange({
          whiteboardId: result.id,
          version: null,
          reason: 'deleted',
          source: 'ui',
        });
      }
      respond(200, { ok: true, ...result });
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });
}
