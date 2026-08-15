import crypto from 'node:crypto';
import type http from 'node:http';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

import type { CompanionBrowserCall, CompanionRuntime } from './companion-runtime';

const BROWSER_TOOL_TIMEOUT_MS = 20_000;
const ACTIVITY_RESULT_MAX_CHARS = 20_000;
const MAX_CLIENT_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_CHARS = 20_000;
const MAX_RUN_ID_CHARS = 128;

type PendingToolCall = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener(): void;
};

function messageText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

function boundedActivityValue(value: unknown): unknown {
  let serialized = '';
  try {
    serialized = JSON.stringify(value) ?? String(value ?? '');
  } catch {
    serialized = String(value ?? '');
  }
  return serialized.length <= ACTIVITY_RESULT_MAX_CHARS
    ? value
    : `${serialized.slice(0, ACTIVITY_RESULT_MAX_CHARS)}\n… value truncated`;
}

function boundedActivityEvent(event: any): any | null {
  const type = String(event?.type ?? '');
  if (!type.startsWith('tool_call_')) return null;
  if (type === 'tool_call_started') return { ...event, args: boundedActivityValue(event.args) };
  if (type === 'tool_call_completed') return { ...event, result: boundedActivityValue(event.result) };
  if (type === 'tool_call_failed') return { ...event, error: boundedActivityValue(event.error) };
  return event;
}

export function createCompanionWebSocketServer(runtime: CompanionRuntime): WebSocketServer {
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_PAYLOAD_BYTES });
  server.on('connection', (socket: WebSocket, _request: http.IncomingMessage) => {
    let activeRunId = '';
    let generation = 0;
    let cleanedUp = false;
    const pendingTools = new Map<string, PendingToolCall>();

    const send = (payload: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // The socket can close after the ready-state check.
      }
    };

    const rejectPending = (message: string) => {
      for (const pending of pendingTools.values()) {
        clearTimeout(pending.timer);
        pending.removeAbortListener();
        pending.reject(new Error(message));
      }
      pendingTools.clear();
    };

    const callBrowser: CompanionBrowserCall = (tool, args, signal) => {
      const callId = crypto.randomUUID();
      const callGeneration = generation;
      return new Promise((resolve, reject) => {
        if (!activeRunId || socket.readyState !== WebSocket.OPEN) {
          reject(new Error('Companion browser disconnected'));
          return;
        }
        const onAbort = () => {
          const pending = pendingTools.get(callId);
          if (!pending) return;
          pendingTools.delete(callId);
          clearTimeout(pending.timer);
          pending.removeAbortListener();
          pending.reject(new Error('browser tool cancelled'));
        };
        const removeAbortListener = () => signal?.removeEventListener('abort', onAbort);
        const timer = setTimeout(() => {
          const pending = pendingTools.get(callId);
          if (!pending) return;
          pendingTools.delete(callId);
          pending.removeAbortListener();
          pending.reject(new Error(`browser tool timed out: ${tool}`));
        }, BROWSER_TOOL_TIMEOUT_MS);
        (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
        pendingTools.set(callId, { resolve, reject, timer, removeAbortListener });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        send({ type: 'tool_call', runId: activeRunId, generation: callGeneration, callId, tool, args });
      });
    };

    socket.on('message', (raw) => {
      let message: any;
      try {
        message = JSON.parse(messageText(raw));
      } catch {
        send({ type: 'error', error: 'Invalid Companion message.' });
        return;
      }
      if (message?.type === 'tool_result') {
        if (message.runId !== activeRunId || Number(message.generation) !== generation) return;
        const pending = pendingTools.get(String(message.callId ?? ''));
        if (!pending) return;
        pendingTools.delete(String(message.callId));
        clearTimeout(pending.timer);
        pending.removeAbortListener();
        if (message.ok === false) pending.reject(new Error(String(message.error ?? 'browser tool failed')));
        else pending.resolve(message.result);
        return;
      }
      if (message?.type === 'cancel_run') {
        const requestedRunId = String(message.runId ?? '');
        if (requestedRunId && requestedRunId === activeRunId) {
          generation += 1;
          runtime.cancel(activeRunId);
          rejectPending('Companion run cancelled');
          activeRunId = '';
          send({ type: 'status', runId: requestedRunId, status: 'cancelled' });
        }
        return;
      }
      if (message?.type !== 'start_run') return;
      const runId = typeof message.runId === 'string' ? message.runId.trim() : '';
      const prompt = typeof message.prompt === 'string' ? message.prompt.trim() : '';
      if (!runId || runId.length > MAX_RUN_ID_CHARS || /[\u0000-\u001f\u007f]/.test(runId)) {
        send({ type: 'error', runId: runId.slice(0, MAX_RUN_ID_CHARS), error: 'A valid runId is required.' });
        return;
      }
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
        send({
          type: 'error',
          runId,
          error: !prompt
            ? 'A non-empty prompt is required.'
            : `Companion prompts cannot exceed ${MAX_PROMPT_CHARS} characters.`,
        });
        return;
      }
      if (activeRunId) {
        send({ type: 'error', runId, error: 'This Companion socket already has an active run.' });
        return;
      }
      activeRunId = runId;
      generation += 1;
      const runGeneration = generation;
      send({ type: 'status', runId, status: 'working' });
      void runtime.run({
        runId,
        prompt,
        callBrowser,
        onEvent: (event) => {
          if (activeRunId === runId && generation === runGeneration) {
            const visibleEvent = boundedActivityEvent(event);
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
        if (generation === runGeneration) rejectPending('Companion run finished');
      });
    });

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      generation += 1;
      if (activeRunId) runtime.cancel(activeRunId);
      activeRunId = '';
      rejectPending('Companion browser disconnected');
    };
    socket.once('close', cleanup);
    socket.once('error', cleanup);
  });
  return server;
}
