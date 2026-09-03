import { afterEach, describe, expect, test } from 'bun:test';

import {
  localHubBinaryRequest,
  localHubBoundedJsonRequest,
} from '../src/hub/device-mesh/local-hub-request';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const access = { baseUrl: () => 'http://127.0.0.1:7777', apiToken: 'test' };

describe('local Hub bounded binary reads', () => {
  test('streams exactly the authoritative byte count', async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3, 4, 5]), {
        headers: { 'content-type': 'video/mp4', 'content-length': '5' },
      })) as typeof fetch;
    const result = await localHubBinaryRequest(access, '/media', {
      maxBytes: 8,
      expectedBytes: 5,
    });
    expect([...result.bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(result.contentType).toBe('video/mp4');
  });

  test('rejects declared, streamed, and prematurely ended size violations', async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(9), { headers: { 'content-length': '9' } })) as typeof fetch;
    await expect(
      localHubBinaryRequest(access, '/media', { maxBytes: 8, expectedBytes: 5 }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });

    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.enqueue(new Uint8Array([4, 5, 6]));
            controller.close();
          },
        }),
      )) as typeof fetch;
    await expect(
      localHubBinaryRequest(access, '/media', { maxBytes: 8, expectedBytes: 5 }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });

    globalThis.fetch = (async () => new Response(new Uint8Array(4))) as typeof fetch;
    await expect(
      localHubBinaryRequest(access, '/media', { maxBytes: 8, expectedBytes: 5 }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('local Hub bounded JSON reads', () => {
  test('parses a response within the admitted byte limit', async () => {
    globalThis.fetch = (async () => Response.json({ ok: true, entries: [1, 2] })) as typeof fetch;
    await expect(
      localHubBoundedJsonRequest(access, '/list', { maxBytes: 128 }),
    ).resolves.toEqual({ ok: true, entries: [1, 2] });
  });

  test('rejects declared and streamed responses beyond the admitted limit', async () => {
    globalThis.fetch = (async () =>
      new Response('{"large":true}', { headers: { 'content-length': '64' } })) as typeof fetch;
    await expect(
      localHubBoundedJsonRequest(access, '/list', { maxBytes: 32 }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });

    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"text":"'));
            controller.enqueue(new TextEncoder().encode('x'.repeat(40)));
            controller.close();
          },
        }),
      )) as typeof fetch;
    await expect(
      localHubBoundedJsonRequest(access, '/list', { maxBytes: 32 }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  });
});
