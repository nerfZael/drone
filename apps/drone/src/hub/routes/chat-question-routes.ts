import type { ChatQuestionRequestService } from '../chat-question-requests';
import type { HubRouter } from '../hub-router';

type ChatQuestionRoutesService = Pick<
  ChatQuestionRequestService,
  'create' | 'get' | 'listPending' | 'skip' | 'skipPendingForChat' | 'submit' | 'waitForResult'
>;

export function registerChatQuestionRoutes(
  router: HubRouter,
  service: ChatQuestionRoutesService,
): void {
  const respondError = (respond: (status: number, body: unknown) => void, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    respond(/unknown question request/i.test(message) ? 404 : 400, { ok: false, error: message });
  };

  router.get('/api/chat-question-requests', async ({ url, json: respond }) => {
    try {
      const droneId = String(url.searchParams.get('droneId') ?? '').trim();
      const chatName = String(url.searchParams.get('chatName') ?? '').trim() || 'default';
      respond(200, { ok: true, requests: service.listPending(droneId, chatName) });
    } catch (error) {
      respondError(respond, error);
    }
  });

  router.post('/api/chat-question-requests', async ({ readJson, json: respond }) => {
    try {
      respond(200, { ok: true, request: await service.create((await readJson()) ?? {}) });
    } catch (error) {
      respondError(respond, error);
    }
  });

  router.post(
    '/api/chat-question-requests/:requestId/wait',
    async ({ params, res, json: respond }) => {
      try {
        const controller = new AbortController();
        res.once('close', () => controller.abort());
        const request = service.get(params.requestId);
        if (!request) throw new Error(`unknown question request: ${params.requestId}`);
        const result =
          request.result ?? (await service.waitForResult(request.id, controller.signal));
        respond(200, { ok: true, result });
      } catch (error) {
        if (res.destroyed || res.writableEnded) return;
        respondError(respond, error);
      }
    },
  );

  router.post(
    '/api/chat-question-requests/:requestId/submit',
    async ({ params, readJson, json: respond }) => {
      try {
        respond(200, {
          ok: true,
          result: await service.submit(params.requestId, (await readJson()) ?? {}),
        });
      } catch (error) {
        respondError(respond, error);
      }
    },
  );

  router.post(
    '/api/chat-question-requests/:requestId/skip',
    async ({ params, readJson, json: respond }) => {
      try {
        const body = (await readJson<any>()) ?? {};
        const reason =
          body.reason === 'queued_message_pending' || body.reason === 'chat_stopped'
            ? body.reason
            : 'user_skipped';
        respond(200, {
          ok: true,
          result: await service.skip(params.requestId, reason, body.notes),
        });
      } catch (error) {
        respondError(respond, error);
      }
    },
  );

  router.post('/api/chat-question-requests/skip-pending', async ({ readJson, json: respond }) => {
    try {
      const body = (await readJson<any>()) ?? {};
      const reason = body.reason === 'chat_stopped' ? 'chat_stopped' : 'queued_message_pending';
      respond(200, {
        ok: true,
        results: await service.skipPendingForChat(
          String(body.droneId ?? ''),
          String(body.chatName ?? ''),
          reason,
        ),
      });
    } catch (error) {
      respondError(respond, error);
    }
  });
}
