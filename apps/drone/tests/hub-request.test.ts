import { describe, expect, test } from 'bun:test';

import {
  handleHubRequestFailure,
  prepareHubHttpRequest,
  rejectUnauthorizedHubApiRequest,
} from '../src/hub/hub-request';

function request(
  opts: {
    method?: string;
    url?: string;
    origin?: string;
    authorization?: string;
  } = {},
) {
  return {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/api/health',
    headers: {
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
    },
  } as any;
}

function response() {
  const headers = new Map<string, unknown>();
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    end(body?: string) {
      this.body = body ?? '';
      this.writableEnded = true;
    },
    headers,
  } as any;
}

describe('Hub request infrastructure', () => {
  test('applies CORS and handles preflight requests centrally', () => {
    const allowedOrigins = new Set(['http://hub.test']);
    const allowedResponse = response();
    const handled = prepareHubHttpRequest(
      request({ method: 'OPTIONS', origin: 'http://hub.test' }),
      allowedResponse,
      allowedOrigins,
    );

    expect(handled).toBe(true);
    expect(allowedResponse.statusCode).toBe(204);
    expect(allowedResponse.getHeader('access-control-allow-origin')).toBe('http://hub.test');
    expect(allowedResponse.getHeader('timing-allow-origin')).toBe('http://hub.test');
    expect(allowedResponse.getHeader('access-control-allow-headers')).toContain(
      'x-drone-transcription-quality',
    );
    expect(allowedResponse.getHeader('access-control-allow-headers')).toContain(
      'x-drone-transcription-language',
    );
    expect(allowedResponse.getHeader('access-control-allow-headers')).toContain(
      'x-drone-transcription-prompt-base64',
    );
    expect(allowedResponse.getHeader('access-control-allow-headers')).toContain(
      'x-drone-companion-message-id',
    );

    const deniedResponse = response();
    expect(
      prepareHubHttpRequest(
        request({ method: 'OPTIONS', origin: 'http://elsewhere.test' }),
        deniedResponse,
        allowedOrigins,
      ),
    ).toBe(true);
    expect(deniedResponse.statusCode).toBe(403);
    expect(JSON.parse(deniedResponse.body)).toEqual({
      ok: false,
      error: 'origin not allowed',
    });
  });

  test('rejects unauthorized API calls and leaves other requests alone', () => {
    const logs: any[] = [];
    const deniedResponse = response();
    expect(
      rejectUnauthorizedHubApiRequest({
        req: request(),
        res: deniedResponse,
        url: new URL('http://hub.test/api/health'),
        apiToken: 'secret',
        log: (...args) => logs.push(args),
      }),
    ).toBe(true);
    expect(deniedResponse.statusCode).toBe(401);
    expect(deniedResponse.getHeader('www-authenticate')).toBe('Bearer realm="drone-hub-api"');
    expect(logs[0]?.[1]).toBe('unauthorized api request');

    expect(
      rejectUnauthorizedHubApiRequest({
        req: request({ authorization: 'Bearer secret' }),
        res: response(),
        url: new URL('http://hub.test/api/health'),
        apiToken: 'secret',
        log: () => {},
      }),
    ).toBe(false);
    expect(
      rejectUnauthorizedHubApiRequest({
        req: request(),
        res: response(),
        url: new URL('http://hub.test/mcp'),
        apiToken: 'secret',
        log: () => {},
      }),
    ).toBe(false);
  });

  test('logs unexpected failures and returns a consistent error body', () => {
    const logs: any[] = [];
    const res = response();
    handleHubRequestFailure({
      req: request({ method: 'POST', url: '/api/drones' }),
      res,
      error: new Error('boom'),
      log: (...args) => logs.push(args),
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'boom' });
    expect(logs).toEqual([
      ['error', 'request handler crashed', { method: 'POST', path: '/api/drones', error: 'boom' }],
    ]);
  });
});
