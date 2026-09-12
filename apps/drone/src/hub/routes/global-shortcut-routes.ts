import type { HubRouter } from '../hub-router';
import type { GlobalShortcutService } from '../global-shortcut-service';
import { openHubSseStream } from './hub-sse-stream';

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
    const writeEvent = (response: typeof res, eventName: string, value: unknown) => {
      if (response.destroyed || response.writableEnded) {
        throw new Error('shortcut event client disconnected');
      }
      response.write(`event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`);
    };
    try {
      openHubSseStream({
        request: req,
        response: res,
        connectedData: { ok: true, clientId },
        writeEvent,
        subscribe: () =>
          service.connectClient(clientId, (event) => writeEvent(res, 'shortcut', event)),
      });
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : String(error));
    }
  });
}
