import { afterEach, describe, expect, test } from 'bun:test';

import { installDirectApiFetch } from '../src/droneHub/app/direct-api-fetch';

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
});

describe('direct API fetch', () => {
  test('uses a tokenless runtime proxy on a separate localhost origin', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const originalFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const runtimeWindow = {
      location: new URL('http://127.0.0.1:41000/'),
      fetch: originalFetch,
      __DRONE_HUB_RUNTIME_CONFIG__: {
        directApiBase: 'http://localhost:41000/',
      },
    } as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: runtimeWindow,
    });

    installDirectApiFetch();
    await runtimeWindow.fetch('/api/drones/drone-1/chats/default/state?turn=all');
    await runtimeWindow.fetch('/api/drones');
    await runtimeWindow.fetch('/api/device-mesh/events');
    await runtimeWindow.fetch('/assets/app.js');

    expect(String(calls[0]?.input)).toBe(
      'http://localhost:41000/api/drones/drone-1/chats/default/state?turn=all',
    );
    expect(new Headers(calls[0]?.init?.headers).has('authorization')).toBe(false);
    expect(calls[0]?.init).toMatchObject({ mode: 'cors', credentials: 'omit' });
    expect(calls[1]?.input).toBe('/api/drones');
    expect(calls[2]?.input).toBe('/api/device-mesh/events');
    expect(calls[3]?.input).toBe('/assets/app.js');
  });
});
