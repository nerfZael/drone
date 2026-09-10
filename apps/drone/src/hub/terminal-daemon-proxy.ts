import { WebSocket, type RawData } from 'ws';
import type { TerminalWebSocketContext } from './terminal-websocket-server';

// Prefer a single authenticated, full-duplex connection. Keep the old SSE/HTTP
// bridge for older daemons during rolling upgrades, before any input is sent.
export function proxyDaemonTerminal(
  ws: WebSocket,
  context: TerminalWebSocketContext,
  legacy: () => void,
) {
  const started = performance.now();
  const diagnostic = (phase: string, reason?: string) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({ type: 'diagnostic', phase, ms: performance.now() - started, reason }),
      );
  };
  const url = new URL('/v1/terminal/connect', context.client.baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('session', context.sessionName);
  if (context.since != null) url.searchParams.set('since', String(context.since));
  if (context.generation) url.searchParams.set('generation', context.generation);
  if (context.cols && context.rows) {
    url.searchParams.set('cols', String(context.cols));
    url.searchParams.set('rows', String(context.rows));
  }
  const upstream = new WebSocket(url, {
    headers: { authorization: `Bearer ${context.client.token}` },
    handshakeTimeout: 2500,
    maxPayload: 4 * 1024 * 1024,
  });
  let active = true;
  let opened = false;
  let queuedBytes = 0;
  const queued: Array<{ data: RawData; binary: boolean }> = [];
  const send = (target: WebSocket, data: RawData, binary: boolean) => {
    if (target.bufferedAmount > 1024 * 1024) {
      ws.close(1013, 'Terminal transport is busy');
      upstream.close();
      return;
    }
    target.send(data, { binary }, (error) => {
      if (error) target.close();
    });
  };
  const onInput = (data: RawData, binary: boolean) => {
    if (!active) return;
    if (opened) {
      if (upstream.readyState === WebSocket.OPEN) send(upstream, data, binary);
      return;
    }
    const size = Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : data.byteLength;
    queuedBytes += size;
    if (queuedBytes > 1024 * 1024) {
      ws.close(1009, 'Terminal input queue is full');
      return;
    }
    queued.push({ data, binary });
  };
  const onClose = () => {
    active = false;
    upstream.terminate();
  };
  const fallback = (reason: string) => {
    if (!active || opened) return;
    active = false;
    ws.off('message', onInput);
    ws.off('close', onClose);
    upstream.terminate();
    if (ws.readyState !== WebSocket.OPEN) return;
    diagnostic('hub-legacy-fallback', reason);
    legacy();
    for (const item of queued) ws.emit('message', item.data, item.binary);
    queued.length = 0;
  };
  ws.on('message', onInput);
  ws.once('close', onClose);
  upstream.on('open', () => {
    if (!active) {
      upstream.terminate();
      return;
    }
    opened = true;
    diagnostic('hub-daemon-handshake');
    for (const item of queued) send(upstream, item.data, item.binary);
    queued.length = 0;
  });
  upstream.on('message', (data, binary) => {
    if (active && ws.readyState === WebSocket.OPEN) send(ws, data, binary);
  });
  upstream.on('unexpected-response', (_req, response) => {
    response.resume();
    if (response.statusCode === 404 || response.statusCode === 400 || response.statusCode === 426)
      fallback(`daemon-http-${response.statusCode}`);
    else {
      ws.close(1011, 'Terminal daemon unavailable');
      upstream.terminate();
    }
  });
  upstream.on('error', () => {
    if (!active) return;
    if (!opened) fallback('daemon-unavailable-or-timeout');
    else ws.close(1011, 'Terminal daemon disconnected');
  });
  upstream.on('close', (code) => {
    if (active && opened) ws.close(code === 1000 ? 1000 : 1011, 'Terminal daemon disconnected');
  });
}
