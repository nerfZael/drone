import { afterEach, describe, expect, test } from 'bun:test';
import { createDroneControlCapability } from '../src/hub/device-mesh/drone-control-capability';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('device mesh drone actions', () => {
  test('forwards drone deletion to the local Hub', async () => {
    let request: { url: string; method: string } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), method: String(init?.method ?? 'GET') };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });

    await expect(capability.invoke('drone.delete', { droneId: 'drone one' })).resolves.toEqual({
      deleted: true,
      droneId: 'drone one',
    });
    expect(request).toEqual({
      url: 'http://127.0.0.1:7777/api/drones/drone%20one',
      method: 'DELETE',
    });
  });

  test('honors archive mode when deleting through the mesh', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, method: String(init?.method ?? 'GET') });
      return new Response(
        JSON.stringify(
          url.endsWith('/api/settings/delete-action')
            ? { ok: true, deleteAction: { mode: 'archive' } }
            : { ok: true },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });

    await capability.invoke('drone.delete', { droneId: 'drone one' });

    expect(requests.at(-1)).toEqual({
      url: 'http://127.0.0.1:7777/api/drones/drone%20one/archive',
      method: 'POST',
    });
  });

  test('does not permanently delete when delete settings are unavailable', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), method: String(init?.method ?? 'GET') });
      return new Response(JSON.stringify({ ok: false, error: 'settings unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });

    await expect(capability.invoke('drone.delete', { droneId: 'drone one' })).rejects.toThrow(
      'settings unavailable',
    );
    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:7777/api/settings/delete-action',
        method: 'GET',
      },
    ]);
  });

  test('creates a cloned drone chat through the local Hub', async () => {
    let request: { url: string; method: string; body: string } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = {
        url: String(input),
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      };
      return new Response(JSON.stringify({ chat: 'chat-2', chats: ['default', 'chat-2'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const capability = createDroneControlCapability({
      baseUrl: () => 'http://127.0.0.1:7777',
      apiToken: 'test',
    });

    await expect(
      capability.invoke('chat.create', {
        droneId: 'drone one',
        name: 'chat-2',
        copyFrom: 'default',
      }),
    ).resolves.toEqual({
      droneId: 'drone one',
      chatName: 'chat-2',
      chats: ['default', 'chat-2'],
    });
    expect(request).toEqual({
      url: 'http://127.0.0.1:7777/api/drones/drone%20one/chats',
      method: 'POST',
      body: JSON.stringify({ name: 'chat-2', copyFrom: 'default' }),
    });
  });
});
