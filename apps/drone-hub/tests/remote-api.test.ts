import { describe, expect, test } from 'bun:test';

describe('remote api helpers', () => {
  test('adds remote csrf to same-origin api writes made through raw fetch', async () => {
    const previousWindow = (globalThis as any).window;
    const previousFetch = (globalThis as any).fetch;
    const calls: Array<{ input: unknown; init?: RequestInit }> = [];
    const fetchMock = async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const windowMock = {
      fetch: fetchMock,
      location: {
        origin: 'https://remote.example',
        href: 'https://remote.example/',
      },
    };

    (globalThis as any).window = windowMock;
    (globalThis as any).fetch = fetchMock;
    try {
      const mod = await import(`../src/remote/remote-api?test=${Date.now()}`);
      mod.setRemoteCsrf('csrf-123');
      mod.installRemoteCsrfFetch();

      await windowMock.fetch('/api/audio/transcriptions', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: new ArrayBuffer(0),
      });

      const headers = new Headers(calls[0]?.init?.headers);
      expect(headers.get('x-drone-remote-csrf')).toBe('csrf-123');
      expect(headers.get('content-type')).toBe('audio/wav');
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = previousWindow;
      }
      if (previousFetch === undefined) {
        delete (globalThis as any).fetch;
      } else {
        (globalThis as any).fetch = previousFetch;
      }
    }
  });
});
