import type http from 'node:http';

import { type RawData, WebSocket, WebSocketServer } from 'ws';

import { terminalInput, terminalOutput, terminalPrompt, type DroneClient } from '../host/api';

const INPUT_FLUSH_MS = 24;
const INPUT_BURST_BYTES = 1024;
const INPUT_CHUNK_MAX = 16_384;
const INPUT_MAX_BYTES = 128 * 1024;

export type TerminalWebSocketContext = {
  droneName: string;
  sessionName: string;
  client: DroneClient;
  since?: number;
  maxBytes: number;
};

export function createTerminalWebSocketServer(opts: {
  isStaleSessionError: (error: unknown) => boolean;
}): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on(
    'connection',
    (ws: WebSocket, _req: http.IncomingMessage, context: TerminalWebSocketContext) => {
      let closed = false;
      let outputOffset =
        typeof context.since === 'number' && Number.isFinite(context.since) && context.since >= 0
          ? Math.floor(context.since)
          : 0;
      let outputStreamAbortRef: AbortController | null = null;
      let outputReconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let outputReconnectAttempt = 0;
      let inputBuffer = '';
      let inputFlushTimer: ReturnType<typeof setTimeout> | null = null;
      let flushingInput = false;

      const wsSendJson = (payload: unknown) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          // The socket may close between the ready-state check and send.
        }
      };

      const cleanup = () => {
        closed = true;
        if (outputReconnectTimer != null) {
          clearTimeout(outputReconnectTimer);
          outputReconnectTimer = null;
        }
        if (outputStreamAbortRef) {
          try {
            outputStreamAbortRef.abort();
          } catch {
            // Ignore an already-aborted stream.
          }
          outputStreamAbortRef = null;
        }
        if (inputFlushTimer != null) {
          clearTimeout(inputFlushTimer);
          inputFlushTimer = null;
        }
      };

      const scheduleInputFlush = (delayMs: number) => {
        if (inputFlushTimer != null) return;
        inputFlushTimer = setTimeout(
          () => {
            inputFlushTimer = null;
            void flushInput();
          },
          Math.max(0, Math.floor(delayMs)),
        );
      };

      const flushInput = async () => {
        if (closed || flushingInput) return;
        const chunk = inputBuffer.slice(0, INPUT_CHUNK_MAX);
        if (!chunk) return;
        inputBuffer = inputBuffer.slice(chunk.length);
        flushingInput = true;
        try {
          await terminalInput(context.client, { session: context.sessionName, data: chunk });
        } catch (error: any) {
          const message = error?.message ?? String(error);
          wsSendJson({
            type: 'error',
            error: message,
            ...(opts.isStaleSessionError(message) ? { code: 'STALE_TERMINAL_SESSION' } : {}),
          });
        } finally {
          flushingInput = false;
          if (inputBuffer) void flushInput();
        }
      };

      const parseSseEvent = (eventName: string, dataText: string) => {
        if (!dataText) return;
        let payload: any = null;
        try {
          payload = JSON.parse(dataText);
        } catch {
          return;
        }

        if (eventName === 'ready') {
          const nextOffset = Number(
            payload?.since ?? payload?.nextOffset ?? payload?.offsetBytes ?? outputOffset,
          );
          if (Number.isFinite(nextOffset) && nextOffset >= 0) outputOffset = Math.floor(nextOffset);
          return;
        }

        if (eventName === 'output') {
          const text = typeof payload?.chunk === 'string' ? payload.chunk : '';
          const nextOffset = Number(
            payload?.nextOffset ?? outputOffset + Buffer.byteLength(text, 'utf8'),
          );
          if (Number.isFinite(nextOffset) && nextOffset >= 0) outputOffset = Math.floor(nextOffset);
          if (!text) return;
          wsSendJson({
            type: 'output',
            name: context.droneName,
            sessionName: context.sessionName,
            offsetBytes: outputOffset,
            text,
          });
          return;
        }

        if (eventName === 'error') {
          const error = String(payload?.error ?? 'terminal stream error');
          wsSendJson({
            type: 'error',
            error,
            ...(opts.isStaleSessionError(error) ? { code: 'STALE_TERMINAL_SESSION' } : {}),
          });
        }
      };

      const scheduleOutputReconnect = (delayMs: number) => {
        if (closed) return;
        if (outputReconnectTimer != null) clearTimeout(outputReconnectTimer);
        outputReconnectTimer = setTimeout(
          () => {
            outputReconnectTimer = null;
            startOutputStream(outputOffset);
          },
          Math.max(40, Math.floor(delayMs)),
        );
      };

      const startOutputStream = (since: number) => {
        if (closed) return;
        if (outputStreamAbortRef) {
          try {
            outputStreamAbortRef.abort();
          } catch {
            // Ignore an already-aborted stream.
          }
        }
        const controller = new AbortController();
        outputStreamAbortRef = controller;
        const streamUrl = new URL('/v1/terminal/output/stream', context.client.baseUrl);
        streamUrl.searchParams.set('session', context.sessionName);
        streamUrl.searchParams.set('since', String(Math.max(0, Math.floor(since))));

        void fetch(streamUrl.toString(), {
          headers: { authorization: `Bearer ${context.client.token}` },
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok || !response.body) {
              throw new Error(
                `terminal stream request failed: ${response.status} ${response.statusText}`,
              );
            }

            outputReconnectAttempt = 0;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let sseBuffer = '';

            while (!closed) {
              const { value, done } = await reader.read();
              if (done) break;
              sseBuffer += decoder.decode(value, { stream: true });

              let separatorIndex = sseBuffer.indexOf('\n\n');
              while (separatorIndex !== -1) {
                const frame = sseBuffer.slice(0, separatorIndex);
                sseBuffer = sseBuffer.slice(separatorIndex + 2);
                let eventName = 'message';
                const dataLines: string[] = [];
                for (const rawLine of frame.split('\n')) {
                  const line = rawLine.replace(/\r$/, '');
                  if (!line) continue;
                  if (line.startsWith('event:')) {
                    eventName = line.slice('event:'.length).trim();
                  } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice('data:'.length).trimStart());
                  }
                }
                if (dataLines.length > 0) parseSseEvent(eventName, dataLines.join('\n'));
                separatorIndex = sseBuffer.indexOf('\n\n');
              }
            }

            if (closed || controller.signal.aborted) return;
            outputReconnectAttempt = Math.min(12, outputReconnectAttempt + 1);
            scheduleOutputReconnect(Math.min(1600, 120 * Math.pow(1.7, outputReconnectAttempt)));
          })
          .catch((error: any) => {
            if (closed || controller.signal.aborted) return;
            outputReconnectAttempt = Math.min(12, outputReconnectAttempt + 1);
            wsSendJson({ type: 'error', error: error?.message ?? String(error) });
            scheduleOutputReconnect(Math.min(1800, 140 * Math.pow(1.8, outputReconnectAttempt)));
          });
      };

      const sendReadyAndStart = async () => {
        try {
          const sync: any = await terminalOutput(context.client, {
            session: context.sessionName,
            since: context.since == null ? Number.MAX_SAFE_INTEGER : context.since,
            max: 1,
          });
          const nextOffset = Number(sync?.nextOffset ?? outputOffset);
          if (Number.isFinite(nextOffset) && nextOffset >= 0) outputOffset = Math.floor(nextOffset);
          wsSendJson({
            type: 'ready',
            name: context.droneName,
            sessionName: context.sessionName,
            offsetBytes: outputOffset,
          });
          if (context.since == null) {
            try {
              const prompt: any = await terminalPrompt(context.client, {
                session: context.sessionName,
              });
              const text = typeof prompt?.text === 'string' ? prompt.text : '';
              if (text) {
                wsSendJson({
                  type: 'output',
                  name: context.droneName,
                  sessionName: context.sessionName,
                  offsetBytes: outputOffset,
                  text,
                });
              }
            } catch {
              // Prompt bootstrap failure does not prevent streaming.
            }
          }
          startOutputStream(outputOffset);
        } catch (error: any) {
          wsSendJson({ type: 'error', error: error?.message ?? String(error) });
          try {
            ws.close();
          } catch {
            // Ignore a socket that has already closed.
          }
        }
      };

      ws.on('message', (raw: RawData) => {
        if (closed) return;
        let text = '';
        if (typeof raw === 'string') text = raw;
        else if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
        else if (Array.isArray(raw)) text = Buffer.concat(raw).toString('utf8');
        else text = String(raw ?? '');
        if (!text) return;

        let message: any = null;
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (message?.type === 'ping') {
          wsSendJson({ type: 'pong' });
          return;
        }
        if (message?.type !== 'input') return;

        const data = typeof message?.data === 'string' ? message.data : '';
        if (!data) return;
        if (Buffer.byteLength(data, 'utf8') > INPUT_MAX_BYTES) {
          wsSendJson({ type: 'error', error: 'input too large' });
          return;
        }

        inputBuffer += data;
        if (inputBuffer.length > INPUT_MAX_BYTES) inputBuffer = inputBuffer.slice(-INPUT_MAX_BYTES);
        const immediate = /[\r\n\t\u0003\u0004\u001b]/.test(data);
        if (immediate || inputBuffer.length >= INPUT_BURST_BYTES) {
          if (inputFlushTimer != null) {
            clearTimeout(inputFlushTimer);
            inputFlushTimer = null;
          }
          void flushInput();
        } else {
          scheduleInputFlush(INPUT_FLUSH_MS);
        }
      });

      ws.on('close', cleanup);
      ws.on('error', cleanup);
      void sendReadyAndStart();
    },
  );

  return wss;
}
