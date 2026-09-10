import type { TerminalSnapshot } from '../terminal-control';
import type http from 'node:http';
import { proxyDaemonTerminal } from './terminal-daemon-proxy';

import { type RawData, WebSocket, WebSocketServer } from 'ws';

import { terminalInput, terminalOutput, type DroneClient } from '../host/api';

const INPUT_CHUNK_MAX = 16_384;
const INPUT_MAX_BYTES = 128 * 1024;

export type TerminalWebSocketContext = {
  droneName: string;
  runtime?: 'host' | 'container';
  containerName?: string;
  sessionName: string;
  client: DroneClient;
  since?: number;
  generation?: string;
  protocol?: number;
  transport?: string;
  cols?: number;
  rows?: number;
  maxBytes: number;
};

type TerminalSocketOptions = {
  isStaleSessionError: (error: unknown) => boolean;
  captureLegacySnapshot?: (context: TerminalWebSocketContext) => Promise<TerminalSnapshot>;
};

export function createTerminalWebSocketServer(opts: TerminalSocketOptions): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  wss.on(
    'connection',
    (ws: WebSocket, _req: http.IncomingMessage, context: TerminalWebSocketContext) => {
      if (context.protocol === 2 && context.transport !== 'legacy') {
        proxyDaemonTerminal(ws, context, () =>
          connectLegacyTerminal(
            ws,
            { ...context, since: context.generation ? undefined : context.since },
            opts,
          ),
        );
      } else connectLegacyTerminal(ws, context, opts);
    },
  );
  return wss;
}

function connectLegacyTerminal(
  ws: WebSocket,
  context: TerminalWebSocketContext,
  opts: TerminalSocketOptions,
) {
  let closed = false;
  let outputOffset =
    typeof context.since === 'number' && Number.isFinite(context.since) && context.since >= 0
      ? Math.floor(context.since)
      : 0;
  let outputStreamAbortRef: AbortController | null = null;
  let outputReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let outputReconnectAttempt = 0;
  let inputBuffer = '';
  let flushingInput = false;

  const wsSendJson = (payload: unknown) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.close(1013, 'Terminal output queue is full');
      return;
    }
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
  };

  const flushInput = async () => {
    if (closed || flushingInput) return;
    let end = Math.min(inputBuffer.length, INPUT_CHUNK_MAX);
    const last = inputBuffer.charCodeAt(end - 1);
    if (end < inputBuffer.length && last >= 0xd800 && last <= 0xdbff) end--;
    const chunk = inputBuffer.slice(0, end);
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
      // Delivery may have failed after accepting part of the command. Never
      // send its remaining suffix into a shell with an uncertain input state.
      inputBuffer = '';
      cleanup();
      ws.close(1011, 'Terminal input delivery failed');
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
      outputReconnectAttempt = 0;
      wsSendJson({ type: 'stream-state', state: 'connected' });
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
        wsSendJson({ type: 'stream-state', state: 'reconnecting', reason: 'stream-ended' });
        scheduleOutputReconnect(Math.min(1600, 120 * Math.pow(1.7, outputReconnectAttempt)));
      })
      .catch((error: any) => {
        if (closed || controller.signal.aborted) return;
        outputReconnectAttempt = Math.min(12, outputReconnectAttempt + 1);
        const code = String(error?.cause?.code ?? error?.code ?? '');
        wsSendJson({
          type: 'stream-state',
          state: 'reconnecting',
          reason: code === 'UND_ERR_BODY_TIMEOUT' ? 'idle-timeout' : 'stream-interrupted',
        });
        scheduleOutputReconnect(Math.min(1800, 140 * Math.pow(1.8, outputReconnectAttempt)));
      });
  };

  const sendReadyAndStart = async () => {
    try {
      if (context.since == null) {
        const started = performance.now();
        const screen: any = await terminalOutput(context.client, {
          session: context.sessionName,
          view: 'screen',
          tail: 40,
        });
        outputOffset = Number(screen?.nextOffset ?? 0);
        let exactSnapshot: TerminalSnapshot | null = null;
        if (context.protocol === 2 && opts.captureLegacySnapshot && context.runtime) {
          try {
            exactSnapshot = await opts.captureLegacySnapshot(context);
          } catch {
            /* Fall back for unavailable Docker/tmux. */
          }
        }
        wsSendJson({
          type: 'ready',
          offsetBytes: outputOffset,
          diagnostics: {
            scope: 'hub-stream',
            transport: 'legacy',
            exactSnapshot: Boolean(exactSnapshot),
            geometry: exactSnapshot?.geometry,
            captureFallback: !exactSnapshot ? 'text-only' : undefined,
            phases: [{ phase: 'legacy-snapshot', ms: performance.now() - started }],
          },
        });
        // Bare captures contain padding to the bottom of the remote pane, not
        // cursor placement. Never leave a compatibility viewer on that last row.
        const text = String(screen?.chunk ?? '')
          .replace(/(?:\r?\n[ \t]*)+$/, '')
          .replace(/\r?\n/g, '\r\n');
        wsSendJson(
          context.protocol === 2
            ? {
                type: 'snapshot',
                data: (exactSnapshot?.data ?? Buffer.from(text)).toString('base64'),
              }
            : { type: 'output', offsetBytes: outputOffset, text },
        );
      } else {
        // A cursor is a position, not a one-byte read. Forward all pending bytes.
        wsSendJson({
          type: 'ready',
          offsetBytes: outputOffset,
          diagnostics: { scope: 'hub-stream', transport: 'legacy', resumed: true },
        });
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

    if (
      Buffer.byteLength(inputBuffer, 'utf8') + Buffer.byteLength(data, 'utf8') >
      INPUT_MAX_BYTES
    ) {
      wsSendJson({ type: 'error', error: 'Terminal input queue is full; input was not accepted.' });
      ws.close(1009, 'Terminal input queue is full');
      return;
    }
    inputBuffer += data;
    void flushInput();
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
  void sendReadyAndStart();
}
