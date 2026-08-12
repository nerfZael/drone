import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { openHubSseStream } from '../src/hub/routes/hub-sse-stream';

type FakeResponse = EventEmitter & {
  destroyed: boolean;
  flushHeaders: () => void;
  headers: Map<string, string>;
  statusCode: number;
  writableEnded: boolean;
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => boolean;
};

function createRequest(): IncomingMessage {
  const request = new EventEmitter() as IncomingMessage;
  request.socket = {
    setTimeout: () => request.socket,
  } as IncomingMessage['socket'];
  return request;
}

function createResponse(): FakeResponse {
  const response = new EventEmitter() as FakeResponse;
  response.destroyed = false;
  response.writableEnded = false;
  response.statusCode = 0;
  response.headers = new Map();
  response.setHeader = (name, value) => {
    response.headers.set(name, value);
  };
  response.write = () => true;
  response.flushHeaders = () => {};
  return response;
}

describe('hub SSE streams', () => {
  test('sets up the stream and unsubscribes exactly once when either side closes', () => {
    const request = createRequest();
    const response = createResponse();
    const writes: Array<{ event: string; data: unknown }> = [];
    let unsubscribeCalls = 0;

    openHubSseStream({
      request,
      response: response as ServerResponse,
      connectedData: { ready: true },
      subscribe: () => () => {
        unsubscribeCalls += 1;
      },
      writeEvent: (_response, event, data) => writes.push({ event, data }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(writes).toEqual([{ event: 'connected', data: { ready: true } }]);

    request.emit('close');
    response.emit('close');
    expect(unsubscribeCalls).toBe(1);
  });

  test('unsubscribes if the initial event cannot be written', () => {
    const request = createRequest();
    const response = createResponse();
    let unsubscribeCalls = 0;

    expect(() =>
      openHubSseStream({
        request,
        response: response as ServerResponse,
        connectedData: null,
        subscribe: () => () => {
          unsubscribeCalls += 1;
        },
        writeEvent: () => {
          throw new Error('disconnected');
        },
      }),
    ).toThrow('disconnected');
    expect(unsubscribeCalls).toBe(1);
  });
});
