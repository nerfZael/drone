import { describe, expect, test } from 'bun:test';
import { DeviceEventParser, DeviceHttpEventClient } from '../src/http-event-client';

describe('HTTP device events', () => {
  test('cancels one HTTP request without closing the session or delaying another request', async () => {
    let slowSignal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const client = new DeviceHttpEventClient('https://device.test', 'phone', (async (_, init) => {
      if (init?.method !== 'POST')
        return new Response(stream, { headers: { 'x-device-session': 'session' } });
      if (init.body === 'slow') {
        slowSignal = init.signal as AbortSignal;
        return await new Promise((_, reject) => {
          slowSignal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        });
      }
      return Response.json({ ok: true });
    }) as typeof fetch);
    await Promise.resolve();
    await Promise.resolve();
    const errors: Error[] = [];
    client.onerror = (error) => errors.push(error);
    const controller = new AbortController();
    const slow = new Promise<Error | undefined>((resolve) =>
      client.send('slow', resolve, undefined, controller.signal),
    );
    const fast = new Promise<Error | undefined>((resolve) => client.send('fast', resolve));
    expect(await fast).toBeUndefined();
    controller.abort();
    expect((await slow)?.name).toBe('AbortError');
    expect(slowSignal?.aborted).toBe(true);
    expect(errors).toEqual([]);
    expect(client.readyState).toBe(DeviceHttpEventClient.OPEN);
    client.close();
  });

  test('delivers response timing before the message and tolerates observer failures', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      },
    });
    const client = new DeviceHttpEventClient('https://device.test', 'phone', (async (
      _input,
      init,
    ) => {
      if (init?.method === 'POST')
        return new Response('{"ok":true}', {
          headers: {
            'x-drone-request-id': 'http-id',
            'server-timing': 'hub_entry_to_headers;dur=42',
          },
        });
      return new Response(stream, { headers: { 'x-device-session': 'session' } });
    }) as typeof fetch);
    await Promise.resolve();
    await Promise.resolve();
    const order: string[] = [];
    let timing: any;
    client.onmessage = () => order.push('message');
    try {
      const error = await new Promise<Error | undefined>((resolve) =>
        client.send('{}', resolve, (value) => {
          timing = value;
          order.push('timing');
          throw new Error('observer failure');
        }),
      );
      expect(error).toBeUndefined();
      expect(order).toEqual(['timing', 'message']);
      expect(timing.serverRequestId).toBe('http-id');
      expect(timing.serverTiming.hub_entry_to_headers).toBe(42);
      expect(timing.responseBytes).toBe(11);
    } finally {
      client.close();
    }
  });
  test('parses UTF-8 event data across reads and split CRLF separators', () => {
    const events: string[] = [];
    const parser = new DeviceEventParser((data) => events.push(data));
    parser.push(': heartbeat\r\n\r');
    parser.push('\ndata: {"text":"ž');
    parser.push('"}\r\n\r');
    parser.push('\ndata: first\ndata: second\n\n');
    expect(events).toEqual(['{"text":"ž"}', 'first\nsecond']);
  });

  test('rejects non-private cleartext endpoints before making a request', () => {
    expect(() => new DeviceHttpEventClient('http://example.com', 'device')).toThrow('HTTPS');
  });

  test('does not tear down a healthy event stream when one command request fails', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      },
    });
    const errors: Error[] = [];
    let closed = 0;
    const client = new DeviceHttpEventClient('https://device.test', 'phone', (async (
      _input,
      init,
    ) => {
      if (init?.method === 'POST') return new Response('', { status: 503 });
      return new Response(stream, {
        status: 200,
        headers: { 'x-device-session': 'session' },
      });
    }) as typeof fetch);
    client.onerror = (error) => errors.push(error);
    client.onclose = () => closed++;
    await Promise.resolve();
    await Promise.resolve();
    expect(client.readyState).toBe(DeviceHttpEventClient.OPEN);

    const result = await new Promise<Error | undefined>((resolve) => client.send('{}', resolve));

    expect(result?.message).toBe('Device request failed (503)');
    expect(errors.at(-1)?.message).toBe('Device request failed (503)');
    expect(client.readyState).toBe(DeviceHttpEventClient.OPEN);
    expect(closed).toBe(0);
    client.close();
  });
});
