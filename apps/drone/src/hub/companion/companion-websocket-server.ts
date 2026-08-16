import type http from 'node:http';
import { validateCompanionRunInput, type CompanionClientMessage } from '@drone/assistant-chat';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

import { CompanionRunSession } from './companion-run-session';
import type { CompanionRuntime } from './companion-runtime';

const MAX_CLIENT_PAYLOAD_BYTES = 4 * 1024 * 1024;

function messageText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

export function createCompanionWebSocketServer(runtime: CompanionRuntime): WebSocketServer {
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_PAYLOAD_BYTES });
  server.on('connection', (socket: WebSocket, _request: http.IncomingMessage) => {
    let session: CompanionRunSession | null = null;
    let cleanedUp = false;

    const send = (payload: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // The socket can close after the ready-state check.
      }
    };

    socket.on('message', (raw) => {
      let message: CompanionClientMessage;
      try {
        message = JSON.parse(messageText(raw)) as CompanionClientMessage;
      } catch {
        send({ type: 'error', error: 'Invalid Companion message.' });
        return;
      }
      if (message?.type === 'tool_result') {
        if (message.runId !== session?.clientRunId) return;
        session.resolveBrowserTool({
          callId: String(message.callId ?? ''),
          generation: Number(message.generation),
          ok: message.ok !== false,
          result: message.result,
          error: message.error,
        });
        return;
      }
      if (message?.type === 'cancel_run') {
        const requestedRunId = String(message.runId ?? '');
        if (requestedRunId && requestedRunId === session?.clientRunId) {
          const activeSession = session;
          send({ type: 'status', runId: requestedRunId, status: 'cancelled' });
          void activeSession.close('Companion run cancelled').catch(() => undefined);
        }
        return;
      }
      if (message?.type !== 'start_run') return;
      const validation = validateCompanionRunInput(message);
      if (!validation.ok) {
        send({ type: 'error', runId: validation.runId, error: validation.error });
        return;
      }
      const { runId, prompt, messageId, telemetry } = validation;
      if (session && runId !== session.clientRunId) {
        send({
          type: 'error',
          runId,
          error: 'This Companion socket already owns another session.',
        });
        return;
      }
      if (!session) {
        let createdSession!: CompanionRunSession;
        createdSession = new CompanionRunSession({
          clientRunId: runId,
          runtimeRunId: runId,
          transport: 'websocket',
          runtime,
          emit: (event) => send({ runId, ...event }),
          isAvailable: () =>
            session === createdSession && !cleanedUp && socket.readyState === WebSocket.OPEN,
          unavailableMessage: 'Companion browser disconnected',
          onClose: () => {
            if (session === createdSession) session = null;
          },
        });
        session = createdSession;
      }
      void session.enqueue({ prompt, messageId, telemetry });
    });

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      void session?.close('Companion browser disconnected').catch(() => undefined);
    };
    socket.once('close', cleanup);
    socket.once('error', cleanup);
  });
  return server;
}
