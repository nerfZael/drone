import type http from 'node:http';
import {
  validateCompanionRunInput,
  type CompanionClientMessage,
} from '@drone/assistant-chat';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

import type { CompanionBrowserCall, CompanionRuntime } from './companion-runtime';
import {
  boundedCompanionActivityEvent,
  CompanionBrowserToolBroker,
} from './companion-transport-shared';

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
    let activeRunId = '';
    let generation = 0;
    let cleanedUp = false;

    const send = (payload: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // The socket can close after the ready-state check.
      }
    };

    const browserTools = new CompanionBrowserToolBroker({
      available: () => Boolean(activeRunId && socket.readyState === WebSocket.OPEN),
      unavailableMessage: 'Companion browser disconnected',
      dispatch: (call) => send({ type: 'tool_call', runId: activeRunId, ...call }),
    });
    socket.on('message', (raw) => {
      let message: CompanionClientMessage;
      try {
        message = JSON.parse(messageText(raw)) as CompanionClientMessage;
      } catch {
        send({ type: 'error', error: 'Invalid Companion message.' });
        return;
      }
      if (message?.type === 'tool_result') {
        if (message.runId !== activeRunId) return;
        browserTools.resolve({
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
        if (requestedRunId && requestedRunId === activeRunId) {
          generation += 1;
          runtime.cancel(activeRunId);
          browserTools.rejectAll('Companion run cancelled');
          activeRunId = '';
          send({ type: 'status', runId: requestedRunId, status: 'cancelled' });
        }
        return;
      }
      if (message?.type !== 'start_run') return;
      const validation = validateCompanionRunInput(message);
      if (!validation.ok) {
        send({ type: 'error', runId: validation.runId, error: validation.error });
        return;
      }
      const { runId, prompt } = validation;
      if (activeRunId) {
        send({ type: 'error', runId, error: 'This Companion socket already has an active run.' });
        return;
      }
      activeRunId = runId;
      generation += 1;
      const runGeneration = generation;
      const callBrowser: CompanionBrowserCall = (tool, args, signal) => {
        if (activeRunId !== runId || generation !== runGeneration) {
          return Promise.reject(new Error('Companion run is no longer active'));
        }
        return browserTools.request(tool, args, runGeneration, signal);
      };
      send({ type: 'status', runId, status: 'working' });
      void runtime.run({
        runId,
        prompt,
        callBrowser,
        onEvent: (event) => {
          if (activeRunId === runId && generation === runGeneration) {
            const visibleEvent = boundedCompanionActivityEvent(event);
            if (visibleEvent) send({ type: 'activity', runId, event: visibleEvent });
          }
        },
      }).then((reply) => {
        if (activeRunId !== runId || generation !== runGeneration) return;
        send({ type: 'reply', runId, reply });
        send({ type: 'status', runId, status: 'completed' });
        activeRunId = '';
      }).catch((error) => {
        if (activeRunId !== runId || generation !== runGeneration) return;
        send({ type: 'error', runId, error: error instanceof Error ? error.message : String(error) });
        activeRunId = '';
      }).finally(() => {
        if (generation === runGeneration) browserTools.rejectAll('Companion run finished');
      });
    });

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      generation += 1;
      if (activeRunId) runtime.cancel(activeRunId);
      activeRunId = '';
      browserTools.rejectAll('Companion browser disconnected');
    };
    socket.once('close', cleanup);
    socket.once('error', cleanup);
  });
  return server;
}
