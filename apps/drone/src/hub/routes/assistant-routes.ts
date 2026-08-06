import type { ServerResponse } from 'node:http';

import type { AssistantUiAction } from '../assistant';
import type { HubRouter } from '../hub-router';

export type AssistantRouteDependencies = {
  assistantService: any;
  blipAssistantHost: any;
  nowIso: () => string;
  writeAssistantSseEvent: (res: ServerResponse, event: string, data: any) => void;
  resolveDroneOrPendingForReadRef: (ref: string) => Promise<{ id: string } | null>;
  requireWhiteboardStore: () => any;
  submitAssistantPrompt: (input: {
    threadId: string;
    promptId?: string;
    prompt: string;
    promptImages?: any[];
    deliveryMode?: 'queue' | 'asap';
  }) => Promise<any>;
  validateAssistantPromptImages: (attachments: any[]) => any[];
  saveAssistantArtifactUploads: (threadId: string, attachments: any[]) => Promise<any[]>;
  updateStoredUserTimeZone: (timeZone: unknown) => Promise<unknown>;
};

export function registerAssistantRoutes(
  apiRouter: HubRouter,
  deps: AssistantRouteDependencies,
): void {
  const {
    assistantService,
    blipAssistantHost,
    nowIso,
    writeAssistantSseEvent,
    resolveDroneOrPendingForReadRef,
    requireWhiteboardStore,
    submitAssistantPrompt,
    validateAssistantPromptImages,
    saveAssistantArtifactUploads,
    updateStoredUserTimeZone,
  } = deps;
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

  const respondAssistantError = (
    respond: (status: number, body: unknown) => void,
    error: any,
    unknownPattern: RegExp = /unknown assistant thread/i,
  ) => {
    const message = errorMessage(error);
    respond(unknownPattern.test(message) ? 404 : 400, { ok: false, error: message });
  };

  apiRouter.get('/api/assistant/system-prompt', async ({ json: respond }) => {
    respond(200, await assistantService.systemPromptSettings());
  });

  apiRouter.get('/api/assistant/default-model', async ({ json: respond }) => {
    respond(200, await assistantService.defaultSettings());
  });

  apiRouter.post('/api/assistant/system-prompt', async ({ readJson, json: respond }) => {
    try {
      respond(200, await assistantService.updateSystemPrompt((await readJson()) ?? {}));
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.get('/api/assistant/events', ({ req, res }) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as any).flushHeaders?.();
    writeAssistantSseEvent(res, 'connected', { ok: true, at: nowIso() });
    const unsubscribe = assistantService.subscribeChanges((event: any) => {
      writeAssistantSseEvent(res, 'assistant_change', event);
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

  apiRouter.post('/api/assistant/default-model', async ({ readJson, json: respond }) => {
    try {
      respond(200, await assistantService.updateDefaultModel((await readJson()) ?? {}));
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.post('/api/assistant/default-tools', async ({ readJson, json: respond }) => {
    try {
      respond(200, await assistantService.updateDefaultEnabledTools((await readJson()) ?? {}));
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.post('/api/assistant/ui-action', async ({ readJson, json: respond }) => {
    const body = await readJson<any>();
    try {
      const rawAction = body?.uiAction && typeof body.uiAction === 'object' ? body.uiAction : body;
      const actionType = String(rawAction?.type ?? '').trim();
      const at = nowIso();
      let uiAction: AssistantUiAction;

      if (actionType === 'open_drone_chat') {
        const droneRef = String(rawAction?.droneId ?? rawAction?.drone ?? '').trim();
        const resolved = await resolveDroneOrPendingForReadRef(droneRef);
        if (!resolved) throw new Error(`unknown drone: ${droneRef || 'missing drone'}`);
        const chatName = String(rawAction?.chatName ?? rawAction?.chat ?? '').trim() || 'default';
        uiAction = {
          type: 'open_drone_chat',
          droneId: resolved.id,
          droneIds: [resolved.id],
          chatName,
          at,
        };
      } else if (actionType === 'highlight_drones') {
        const droneRefs = Array.from(
          new Set(
            [
              ...(Array.isArray(rawAction?.droneIds) ? rawAction.droneIds : []),
              ...(Array.isArray(rawAction?.drones) ? rawAction.drones : []),
              rawAction?.droneId,
              rawAction?.drone,
            ]
              .map((item: unknown) => String(item ?? '').trim())
              .filter(Boolean),
          ),
        );
        const droneIds: string[] = [];
        for (const droneRef of droneRefs) {
          const resolved = await resolveDroneOrPendingForReadRef(droneRef);
          if (!resolved) throw new Error(`unknown drone: ${droneRef}`);
          if (!droneIds.includes(resolved.id)) droneIds.push(resolved.id);
        }
        if (droneIds.length === 0) throw new Error('droneIds is required');
        const durationRaw = Number(rawAction?.durationMs);
        uiAction = {
          type: 'highlight_drones',
          droneIds,
          durationMs: Number.isFinite(durationRaw)
            ? Math.max(1000, Math.min(60_000, Math.floor(durationRaw)))
            : 10_000,
          at,
        };
      } else if (actionType === 'open_whiteboard') {
        const whiteboardId =
          String(rawAction?.whiteboardId ?? rawAction?.id ?? '').trim() || 'main';
        const whiteboard = requireWhiteboardStore().get(whiteboardId);
        if (!whiteboard) throw new Error(`unknown whiteboard: ${whiteboardId}`);
        uiAction = { type: 'open_whiteboard', whiteboardId: whiteboard.id, at };
      } else if (actionType === 'close_whiteboard') {
        uiAction = { type: 'close_whiteboard', at };
      } else {
        throw new Error(`unsupported ui action: ${actionType || 'missing type'}`);
      }

      respond(
        200,
        assistantService.emitExternalUiAction(
          uiAction,
          String(body?.threadId ?? '').trim() || undefined,
        ),
      );
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.post('/api/assistant/scope', async ({ readJson, json: respond }) => {
    try {
      const accessScope = await assistantService.updateAccessScope((await readJson()) ?? {});
      blipAssistantHost?.invalidateAll();
      respond(200, { ok: true, accessScope });
    } catch (error: any) {
      respondStatusError(respond, error);
    }
  });

  apiRouter.get('/api/assistant/threads/:threadId/events', async ({ params, req, res, fail }) => {
    try {
      await assistantService.threadSnapshot(params.threadId);
    } catch {
      return fail(404, `unknown assistant thread: ${params.threadId}`);
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as any).flushHeaders?.();
    const unsubscribeBlip = blipAssistantHost.subscribeEvents(params.threadId, (event: any) => {
      writeAssistantSseEvent(res, 'blip_event', {
        type: 'blip_event',
        version: 1,
        threadId: params.threadId,
        event,
      });
    });
    const unsubscribeChanges = assistantService.subscribeChanges((event: any) => {
      if (event.threadId !== params.threadId) return;
      writeAssistantSseEvent(res, 'native_change', {
        type: 'native_change',
        version: 1,
        threadId: params.threadId,
        reason: event.reason,
        sequence: event.sequence,
        at: event.at,
      });
    });
    writeAssistantSseEvent(res, 'connected', {
      type: 'connected',
      version: 1,
      threadId: params.threadId,
      running: blipAssistantHost.isThreadRunning(params.threadId),
      at: nowIso(),
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
      unsubscribeBlip();
      unsubscribeChanges();
    };
    req.once('close', cleanup);
    res.once('close', cleanup);
  });

  apiRouter.get(
    '/api/assistant/threads/:threadId/history',
    async ({ params, url, json: respond }) => {
      try {
        await assistantService.threadSnapshot(params.threadId);
        const before = Number(url.searchParams.get('before'));
        const limit = Number(url.searchParams.get('limit'));
        respond(
          200,
          await blipAssistantHost.historyPage(params.threadId, {
            ...(Number.isFinite(before) && before > 0 ? { before } : {}),
            ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
          }),
        );
      } catch (error: any) {
        respondAssistantError(respond, error);
      }
    },
  );

  apiRouter.delete(
    '/api/assistant/threads/:threadId/messages/:messageId',
    async ({ params, url, json: respond }) => {
      try {
        await assistantService.threadSnapshot(params.threadId);
        await blipAssistantHost.deleteMessage(
          params.threadId,
          params.messageId,
          url.searchParams.get('following') === 'true',
        );
        await assistantService.notifyCanonicalHistoryChanged(params.threadId);
        respond(200, {
          ok: true,
          deleted: true,
          threadId: params.threadId,
          messageId: params.messageId,
        });
      } catch (error: any) {
        respondAssistantError(respond, error, /unknown (assistant thread|assistant message)/i);
      }
    },
  );

  apiRouter.get(
    '/api/assistant/threads/:threadId/messages/:messageId',
    async ({ params, json: respond }) => {
      try {
        await assistantService.threadSnapshot(params.threadId);
        respond(200, await blipAssistantHost.message(params.threadId, params.messageId));
      } catch (error: any) {
        respondAssistantError(respond, error, /unknown assistant message/i);
      }
    },
  );

  apiRouter.get('/api/assistant/threads/:threadId', async ({ params, json: respond }) => {
    try {
      respond(200, await assistantService.threadSnapshot(params.threadId));
    } catch (error: any) {
      respond(404, { ok: false, error: `unknown assistant thread: ${params.threadId}` });
    }
  });

  apiRouter.patch(
    '/api/assistant/threads/:threadId',
    async ({ params, readJson, json: respond }) => {
      const body = await readJson();
      try {
        const snapshot = await assistantService.updateThread(params.threadId, body ?? {});
        blipAssistantHost.invalidateThread(params.threadId);
        respond(200, snapshot);
      } catch (error: any) {
        respondAssistantError(respond, error);
      }
    },
  );

  apiRouter.post('/api/assistant/threads/:threadId/stop', async ({ params, json: respond }) => {
    try {
      blipAssistantHost.stopThread(params.threadId);
      respond(200, await assistantService.stopThread(params.threadId));
    } catch (error: any) {
      respondAssistantError(respond, error);
    }
  });

  apiRouter.post('/api/assistant/threads/:threadId/retry', async ({ params, json: respond }) => {
    try {
      await assistantService.threadSnapshot(params.threadId);
      await blipAssistantHost.beginRetryThread(params.threadId);
      respond(202, { ok: true, threadId: params.threadId, status: 'running' });
    } catch (error: any) {
      const message = errorMessage(error);
      const status = /already processing/i.test(message)
        ? 409
        : /not retryable|no safe response checkpoint/i.test(message)
          ? 422
          : /unknown assistant thread/i.test(message)
            ? 404
            : 400;
      respond(status, { ok: false, error: message });
    }
  });

  apiRouter.get(
    '/api/assistant/threads/:threadId/system-prompt',
    async ({ params, json: respond }) => {
      try {
        respond(200, await assistantService.threadSystemPromptSettings(params.threadId));
      } catch (error: any) {
        respondAssistantError(respond, error);
      }
    },
  );

  apiRouter.post(
    '/api/assistant/threads/:threadId/system-prompt',
    async ({ params, readJson, json: respond }) => {
      const body = await readJson();
      try {
        const result = await assistantService.updateThreadSystemPrompt(params.threadId, body ?? {});
        blipAssistantHost?.invalidateThread(params.threadId);
        respond(200, result);
      } catch (error: any) {
        respondAssistantError(respond, error);
      }
    },
  );

  apiRouter.post(
    '/api/assistant/threads/:threadId/promote-system-prompt',
    async ({ params, readJson, json: respond }) => {
      const body = await readJson();
      try {
        respond(200, await assistantService.promoteThreadSystemPrompt(params.threadId, body ?? {}));
      } catch (error: any) {
        respondAssistantError(respond, error);
      }
    },
  );

  apiRouter.get('/api/assistant/threads/:threadId/artifacts', async ({ params, json: respond }) => {
    try {
      respond(200, {
        ok: true,
        threadId: params.threadId,
        files: await assistantService.listArtifactFiles(params.threadId),
      });
    } catch (error: any) {
      const status =
        Number(error?.statusCode ?? 0) ||
        (/unknown assistant thread/i.test(errorMessage(error)) ? 404 : 400);
      respond(status, { ok: false, error: errorMessage(error) });
    }
  });

  apiRouter.get(
    '/api/assistant/threads/:threadId/artifacts/file',
    async ({ params, url, json: respond }) => {
      try {
        respond(200, {
          ok: true,
          threadId: params.threadId,
          file: await assistantService.readArtifactFile(
            params.threadId,
            url.searchParams.get('path') ?? '',
          ),
        });
      } catch (error: any) {
        const status =
          Number(error?.statusCode ?? 0) ||
          (/unknown assistant thread/i.test(errorMessage(error)) ? 404 : 400);
        respond(status, { ok: false, error: errorMessage(error) });
      }
    },
  );

  apiRouter.post(
    '/api/assistant/threads/:threadId/prompt',
    async ({ params, req, res, readJson }) => {
      const body = await readJson<any>();
      res.statusCode = 200;
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('cache-control', 'no-cache, no-transform');
      res.setHeader('connection', 'keep-alive');
      req.socket.setTimeout(0);
      const writeEvent = (event: any) => {
        if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
      };
      const keepAlive = setInterval(() => {
        writeEvent({ type: 'heartbeat', at: nowIso() });
      }, 15_000);
      (keepAlive as any).unref?.();
      try {
        if (body?.userTimeZone != null) {
          await updateStoredUserTimeZone(body.userTimeZone).catch(() => undefined);
        }
        let prompt = String(body?.prompt ?? '').trim();
        const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
        const promptImages = validateAssistantPromptImages(
          attachments.filter((item: any) => item?.disposition === 'prompt'),
        );
        const artifactUploads = attachments.filter((item: any) => item?.disposition !== 'prompt');
        const uploaded = await saveAssistantArtifactUploads(params.threadId, artifactUploads);
        if (uploaded.length > 0) {
          if (await assistantService.ensureArtifactsWorkspaceEnabled(params.threadId)) {
            blipAssistantHost.invalidateThread(params.threadId);
          }
          const references = uploaded.map((file) => `- ${file.path}`).join('\n');
          prompt = `${prompt}${prompt ? '\n\n' : ''}Attached files:\n${references}`;
        }
        if (!prompt && promptImages.length === 0) throw new Error('missing prompt');

        const queued = await submitAssistantPrompt({
          threadId: params.threadId,
          promptId: String(body?.promptId ?? '').trim() || undefined,
          prompt,
          promptImages,
          deliveryMode:
            body?.deliveryMode === 'asap'
              ? 'asap'
              : body?.deliveryMode === 'queue'
                ? 'queue'
                : undefined,
        });
        writeEvent({ type: 'queued', threadId: params.threadId, prompt: queued });
        writeEvent({ type: 'done' });
      } catch (error: any) {
        writeEvent({ type: 'error', error: errorMessage(error) });
      } finally {
        clearInterval(keepAlive);
        res.end();
      }
    },
  );

  apiRouter.delete(
    '/api/assistant/threads/:threadId/queued/:promptId',
    async ({ params, json: respond }) => {
      try {
        respond(200, await assistantService.cancelQueuedPrompt(params.threadId, params.promptId));
      } catch (error: any) {
        const message = errorMessage(error);
        const status = /unknown queued assistant prompt/i.test(message)
          ? 404
          : /already running/i.test(message)
            ? 409
            : 400;
        respond(status, { ok: false, error: message });
      }
    },
  );

  for (const decision of ['approve', 'deny'] as const) {
    apiRouter.post(
      `/api/assistant/threads/:threadId/approvals/:approvalId/${decision}`,
      async ({ params, json: respond }) => {
        try {
          respond(
            200,
            await assistantService.approve(
              params.approvalId,
              decision === 'approve',
              params.threadId,
            ),
          );
        } catch (error: any) {
          respondAssistantError(respond, error, /unknown approval/i);
        }
      },
    );
  }
}
