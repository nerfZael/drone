import type { HubRouter } from '../hub-router';
import type { GlobalShortcutService } from '../global-shortcut-service';

export function registerGlobalShortcutRoutes(
  apiRouter: HubRouter,
  service: GlobalShortcutService,
): void {
  apiRouter.get('/api/settings/global-shortcuts', ({ json: respond }) => {
    respond(200, service.snapshot());
  });

  apiRouter.put('/api/settings/global-shortcuts', async ({ readJson, json: respond }) => {
    const body = await readJson<any>();
    respond(200, await service.update(body?.bindings));
  });

  apiRouter.post(
    '/api/global-shortcuts/clients/:clientId/activity',
    async ({ params, readJson, json: respond }) => {
      const body = await readJson<any>();
      respond(200, {
        ok: true,
        connected: service.updateClientActivity(params.clientId, {
          focused: body?.focused,
          visible: body?.visible,
        }),
      });
    },
  );

  apiRouter.get('/api/global-shortcuts/events', ({ url, req, res, fail }) => {
    const clientId = url.searchParams.get('clientId');
    function write(eventName: string, value: unknown) {
      if (res.destroyed || res.writableEnded) throw new Error('shortcut event client disconnected');
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`);
    }
    let disconnect: (() => void) | null = null;
    try {
      disconnect = service.connectClient(clientId, (event) => write('shortcut', event));
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : String(error));
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as any).flushHeaders?.();
    write('connected', { ok: true, clientId });
    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
    }, 25_000);
    (keepAlive as any).unref?.();
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(keepAlive);
      disconnect?.();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('finish', cleanup);
  });
}
