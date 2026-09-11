import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
import { WebSocket } from 'ws';
import { CompanionLiveSocket } from '../src/hub/companion/CompanionLiveSocket';
import { readCompanionLiveSettings, writeCompanionLiveSettings } from '../src/hub/companion/companion-live-settings';
import { getHubSettingsRepository, resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
import { withTempDroneDataDir } from './test-helpers';
import { HubRouter } from '../src/hub/hub-router';
import { registerCompanionRoutes } from '../src/hub/companion/companion-routes';

test('Live defaults off, survives reopening storage, and does not overwrite model settings', async () => {
  await withTempDroneDataDir('companion-live-', async () => {
    const repository = await getHubSettingsRepository();
    const backend = { provider: 'gemini', model: 'chosen-model', thinkingLevel: 'medium' };
    await repository.put('companion', backend);
    expect(await readCompanionLiveSettings()).toEqual({ enabled: false });
    await writeCompanionLiveSettings({ enabled: true });
    resetHubSettingsRepositoryForTests();
    expect(await readCompanionLiveSettings()).toEqual({ enabled: true });
    expect((await getHubSettingsRepository()).get('companion')?.value).toEqual(backend);
    await expect(writeCompanionLiveSettings({ enabled: 'false' })).rejects.toThrow('boolean');
    await writeCompanionLiveSettings({ enabled: false });
    expect(await readCompanionLiveSettings()).toEqual({ enabled: false });
  });
});

test('Live settings routes validate writes and return persisted state', async () => {
  await withTempDroneDataDir('companion-live-routes-', async () => {
    let body: unknown;
    let result: { status: number; body: any };
    const router = new HubRouter((_res, status, value) => { result = { status, body: value }; }, async () => body);
    registerCompanionRoutes(router);
    const request = async (method: string, value?: unknown) => {
      body = value;
      await router.handle({ method } as any, {} as any, new URL('http://hub.test/api/settings/companion/live-voice'));
      return result!;
    };
    expect((await request('GET')).body.enabled).toBe(false);
    expect((await request('PUT', { enabled: true })).body.enabled).toBe(true);
    expect((await request('PUT', {})).status).toBe(400);
    expect((await request('GET')).body.enabled).toBe(true);
  });
});

test('Live session fixes client delegation, keeps keys server-side, forwards events and closes', async () => {
  const h = harness();
  h.session.handle({ type: 'live_start', sdp: 'v=0\r\n' });
  await tick();
  expect(h.requests[0].session).toMatchObject({ model: 'gpt-live-1', delegation: { type: 'client' }, store: false });
  expect(h.requests[0].session.delegation.responses).toBeUndefined();
  h.upstream.readyState = WebSocket.OPEN;
  h.upstream.emit('open');
  expect(h.messages[0]).toEqual({ type: 'live_ready', sdp: 'answer', backendModel: 'chosen-model' });
  expect(JSON.stringify(h.messages)).not.toContain('test-private-key');
  expect(() => h.upstream.emit('message', Buffer.from('null'))).not.toThrow();
  const event = { type: 'session.delegation.created', delegation: { id: 'opaque', target: 'client' } };
  h.upstream.emit('message', Buffer.from(JSON.stringify(event)));
  expect(h.messages.at(-1)).toEqual({ type: 'live_event', event });
  h.session.handle({ type: 'live_event', event: { type: 'session.update', session: { model: 'other' } } });
  expect(h.upstream.sent).toEqual([]);
  h.session.handle({ type: 'live_event', event: { type: 'session.commentary.append', delegation_id: 'opaque', content: '界'.repeat(200) } });
  expect(h.upstream.sent).toEqual([]);
  h.session.handle({ type: 'live_event', event: { type: 'session.commentary.append', delegation_id: 'opaque', content: 'Done.' } });
  expect(h.upstream.sent.at(-1)).toMatchObject({ delegation_id: 'opaque', content: 'Done.' });
  h.session.close();
  expect(h.upstream.sent.at(-1)).toEqual({ type: 'session.close' });
  h.upstream.emit('message', Buffer.from(JSON.stringify({ type: 'session.closed' })));
  expect(h.upstream.closed).toBe(true);
});

test('a session created after the browser leaves is hung up without opening a sideband', async () => {
  let finish!: (value: Response) => void;
  const hangups: string[] = [];
  const h = harness({ fetch: ((url: string) => {
    if (url.endsWith('/hangup')) { hangups.push(url); return Promise.resolve(new Response(null, { status: 200 })); }
    return new Promise((resolve) => { finish = resolve; });
  }) as typeof fetch });
  h.session.handle({ type: 'live_start', sdp: 'v=0\r\n' });
  await tick();
  h.session.close();
  finish(response());
  await tick();
  expect(h.messages).toEqual([]);
  expect(h.upstream.sent).toEqual([]);
  expect(hangups).toEqual(['https://api.openai.com/v1/live/sessions/opaque%2Fid/hangup']);
});

test('sideband connection failure hangs up the allocated session exactly once', async () => {
  const requests: string[] = [];
  const h = harness({ fetch: (async (url: string) => {
    requests.push(url);
    return url.endsWith('/hangup') ? new Response(null, { status: 200 }) : response();
  }) as typeof fetch });
  h.session.handle({ type: 'live_start', sdp: 'v=0\r\n' });
  await tick();
  h.upstream.emit('error', new Error('attach failed'));
  h.upstream.emit('close');
  await tick();
  expect(requests.filter((url) => url.endsWith('/hangup'))).toHaveLength(1);
  expect(h.messages[0].type).toBe('live_error');
});

test('malformed session creation data fails safely and cleans up any known session', async () => {
  for (const payload of [null, { session: { id: 'opaque/id' }, transport: { sdp: 123 } }]) {
    const requests: string[] = [];
    const h = harness({ fetch: (async (url: string) => {
      requests.push(url);
      return url.endsWith('/hangup') ? new Response(null, { status: 200 }) : Response.json(payload);
    }) as typeof fetch });
    h.session.handle({ type: 'live_start', sdp: 'v=0\r\n' });
    await tick();
    expect(h.messages[0]).toMatchObject({ type: 'live_error', error: 'OpenAI returned an incomplete Live session.' });
    expect(requests.filter((url) => url.endsWith('/hangup'))).toHaveLength(payload ? 1 : 0);
  }
});

test('disabled Live and missing API credentials fail without allocating sessions', async () => {
  for (const override of [
    { enabled: async () => ({ enabled: false }) },
    { credentials: async () => ({ apiKey: null }) },
  ]) {
    const h = harness(override);
    h.session.handle({ type: 'live_start', sdp: 'v=0\r\n' });
    await tick();
    expect(h.requests).toHaveLength(0);
    expect(h.messages[0].type).toBe('live_error');
  }
});

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  sent: any[] = [];
  closed = false;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; this.emit('close'); }
  terminate() { this.close(); }
}

function response() { return Response.json({ session: { id: 'opaque/id' }, transport: { sdp: 'answer' } }); }
function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }
function harness(overrides: Record<string, unknown> = {}) {
  const upstream = new FakeSocket();
  const requests: any[] = [];
  const messages: any[] = [];
  const session = new CompanionLiveSocket((message) => messages.push(message), {
    fetch: (async (_url: unknown, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return response(); }) as typeof fetch,
    connect: (url, key) => {
      expect(url).toEndWith('/opaque%2Fid/attach');
      expect(key).toBe('test-private-key');
      return upstream as unknown as WebSocket;
    },
    credentials: async () => ({ apiKey: 'test-private-key' }),
    backend: async () => ({ model: 'chosen-model', provider: 'gemini' }),
    enabled: async () => ({ enabled: true }),
    ...overrides,
  });
  return { session, upstream, requests, messages };
}
