import { afterEach, describe, expect, test } from 'bun:test';
import { requestJson, setRequestJsonRemoteCsrf } from '../src/droneHub/http';

const originalFetch = globalThis.fetch;

afterEach(() => {
  setRequestJsonRemoteCsrf(null);
  globalThis.fetch = originalFetch;
});

describe('requestJson remote csrf', () => {
  test('adds the remote csrf token to mutating requests', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    setRequestJsonRemoteCsrf('csrf-token');
    await requestJson('/api/drones/drone-a/repo/pull-requests/1/merge', { method: 'POST' });

    expect(capturedHeaders?.get('x-drone-remote-csrf')).toBe('csrf-token');
  });

  test('does not add the remote csrf token to safe requests', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    setRequestJsonRemoteCsrf('csrf-token');
    await requestJson('/api/drones/drone-a/repo/pull-requests?state=open');

    expect(capturedHeaders?.has('x-drone-remote-csrf')).toBe(false);
  });
});
