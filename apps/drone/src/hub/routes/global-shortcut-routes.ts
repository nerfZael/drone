import type { HubRouter } from '../hub-router';
import type { GlobalShortcutService } from '../global-shortcut-service';
import { openHubSseStream } from './hub-sse-stream';

export function registerGlobalShortcutRoutes(
  apiRouter: HubRouter,
  service: GlobalShortcutService,
): void {
  apiRouter.get('/api/global-shortcuts/desktop/events', ({ url, req, res, fail }) => {
    const id = url.searchParams.get('sessionId') ?? '';
    const writeEvent = (response: typeof res, event: string, data: unknown) => {
      if (response.destroyed || response.writableEnded) throw new Error('Desktop disconnected');
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      openHubSseStream({
        request: req, response: res, connectedData: { ok: true }, writeEvent,
        subscribe: () => service.connectDesktop(id, (config) => writeEvent(res, 'configure', config)),
      });
    } catch (error) {
      return fail(409, error instanceof Error ? error.message : String(error));
    }
  });

  apiRouter.post('/api/global-shortcuts/desktop/:sessionId/status', async ({ params, readJson, json }) => {
    const body = await readJson<any>();
    const accepted = service.reportDesktopStatus(params.sessionId, body?.revision, body?.status);
    json(accepted ? 200 : 409, { ok: accepted });
  });

  apiRouter.post('/api/global-shortcuts/desktop/:sessionId/dispatch', async ({ params, readJson, json }) => {
    const body = await readJson<any>();
    const accepted = service.dispatchDesktop(params.sessionId, body?.revision, body?.actionId);
    json(accepted ? 200 : 409, { ok: accepted });
  });

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
          capturing: body?.capturing,
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
        subscribe: () => {
          const disconnect = service.connectClient(clientId, (event) => writeEvent(res, 'shortcut', event));
          const unsubscribe = service.onSettingsChanged(() => {
            try { writeEvent(res, 'settings', service.snapshot()); } catch { /* Stream cleanup removes the listener. */ }
          });
          return () => { unsubscribe(); disconnect(); };
        },
      });
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : String(error));
    }
  });
}
