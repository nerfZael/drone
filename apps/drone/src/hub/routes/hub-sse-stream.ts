import type { IncomingMessage, ServerResponse } from 'node:http';

export type HubSseEventWriter = (response: ServerResponse, event: string, data: unknown) => void;

export function openHubSseStream(input: {
  request: IncomingMessage;
  response: ServerResponse;
  writeEvent: HubSseEventWriter;
  connectedData: unknown;
  subscribe: () => (() => void) | undefined;
}): void {
  const { request, response } = input;
  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-cache, no-transform');
  response.setHeader('connection', 'keep-alive');
  request.socket.setTimeout(0);

  const unsubscribe = input.subscribe();
  const keepAlive = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n');
  }, 25_000);
  keepAlive.unref?.();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    unsubscribe?.();
  };
  request.once('close', cleanup);
  response.once('close', cleanup);

  try {
    (response as ServerResponse & { flushHeaders?: () => void }).flushHeaders?.();
    input.writeEvent(response, 'connected', input.connectedData);
  } catch (error) {
    cleanup();
    throw error;
  }
}
