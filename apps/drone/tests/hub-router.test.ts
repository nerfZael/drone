import { describe, expect, test } from 'bun:test';

import { HubRouter } from '../src/hub/hub-router';

function testRouter(readBody: () => Promise<unknown> = async () => ({})) {
  const responses: Array<{ status: number; body: unknown }> = [];
  const router = new HubRouter(
    (_res, status, body) => responses.push({ status, body }),
    async () => await readBody(),
  );
  const request = (method: string, path: string) =>
    router.handle({ method } as any, {} as any, new URL(path, 'http://hub.test'));
  return { router, request, responses };
}

describe('HubRouter', () => {
  test('matches methods and decodes path parameters', async () => {
    const { router, request, responses } = testRouter();
    router.get('/api/drones/:droneId/chats/:chatName', ({ params, json }) => {
      json(200, params);
    });

    expect(await request('POST', '/api/drones/d-1/chats/default')).toBe(false);
    expect(await request('GET', '/api/drones/d-1/chats/my%20chat')).toBe(true);
    expect(responses).toEqual([{ status: 200, body: { droneId: 'd-1', chatName: 'my chat' } }]);
  });

  test('turns JSON parse failures and explicit failures into API responses', async () => {
    const { router, request, responses } = testRouter(async () => {
      throw new Error('request body must be valid JSON');
    });
    router.post('/api/settings/example', async ({ readJson }) => {
      await readJson();
    });
    router.get('/api/settings/example', ({ fail }) => {
      fail(409, 'conflict', { version: 3 });
    });

    expect(await request('POST', '/api/settings/example')).toBe(true);
    expect(await request('GET', '/api/settings/example')).toBe(true);
    expect(responses).toEqual([
      {
        status: 400,
        body: { ok: false, error: 'request body must be valid JSON' },
      },
      {
        status: 409,
        body: { ok: false, error: 'conflict', version: 3 },
      },
    ]);
  });

  test('rejects duplicate routes and malformed patterns at registration', () => {
    const { router } = testRouter();
    router.get('/api/health', () => {});
    expect(() => router.get('/api/health', () => {})).toThrow('Duplicate Hub route');
    expect(() => router.get('api/no-leading-slash', () => {})).toThrow('must start with /');
    expect(() => router.get('/api/:bad-name', () => {})).toThrow('Invalid Hub route parameter');
    expect(() => router.get('/api/*/invalid', () => {})).toThrow(
      'wildcard must be the final segment',
    );
    router.get('/api/items/:itemId', () => {});
    expect(() => router.get('/api/items/:otherId', () => {})).toThrow('Ambiguous Hub route');
  });

  test('normalizes route patterns before indexing and duplicate checks', async () => {
    const { router, request, responses } = testRouter();
    router.get('  /api/trimmed  ', ({ json }) => json(200, { ok: true }));

    expect(await request('GET', '/api/trimmed')).toBe(true);
    expect(responses).toEqual([{ status: 200, body: { ok: true } }]);
    expect(() => router.get('/api/trimmed', () => {})).toThrow('Duplicate Hub route');
  });

  test('preserves registration precedence across indexed static and parameter buckets', async () => {
    const { router, request, responses } = testRouter();
    router.get('/api/:resource', ({ json }) => json(200, { route: 'parameter' }));
    router.get('/api/settings', ({ json }) => json(200, { route: 'exact' }));
    router.get('/:area/health', ({ params, json }) => json(200, params));

    expect(await request('GET', '/api/settings')).toBe(true);
    expect(await request('GET', '/internal/health')).toBe(true);
    expect(responses).toEqual([
      { status: 200, body: { route: 'parameter' } },
      { status: 200, body: { area: 'internal' } },
    ]);
  });

  test('reports malformed encoded parameters from indexed routes', async () => {
    const { router, request, responses } = testRouter();
    router.get('/api/skills/:skillId', () => {});

    expect(await request('GET', '/api/skills/%E0%A4%A')).toBe(true);
    expect(responses).toEqual([
      { status: 400, body: { ok: false, error: 'invalid URL parameter: skillId' } },
    ]);
  });
});
