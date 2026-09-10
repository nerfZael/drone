import { expect, test } from 'bun:test';
import { HubRouter } from '../src/hub/hub-router';
import { registerUsageRoutes } from '../src/hub/routes/usage-routes';
import { getUsageStore } from '../src/hub/usage/UsageStore';
import { importChatFromRegistry, resetTranscriptStoreForTests } from '../src/hub/transcript-store';
import { withTempDroneDataDir } from './test-helpers';

test('usage endpoints validate filters and prices and resolve chat summaries by stable identity', async () => {
  await withTempDroneDataDir('usage-routes-', async () => {
    const store = getUsageStore();
    const price = { provider: 'test', model: 'test', source: 'Fixture', effectiveAt: store.trackingSince,
      input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 };
    store.addPrice(price); // Avoid downloading a catalog in this test.
    await importChatFromRegistry({ droneId: 'drone', chatName: 'my chat', chatEntry: { id: 'chat', turns: [] } });
    store.record({ id: 'run', chatId: 'chat', agent: 'native', startedAt: store.trackingSince, status: 'completed' }, [{
      id: 'request', provider: 'test', model: 'test', input: 100, output: 20, cacheRead: 0, cacheWrite: 0,
      reasoning: null, scope: 'request', complete: true, raw: {},
    }]);
    let body: unknown;
    let response: { status: number; body: any };
    const router = new HubRouter((_res, status, value) => { response = { status, body: value }; }, async () => body);
    registerUsageRoutes(router);
    const request = async (method: string, route: string) => {
      await router.handle({ method } as any, {} as any, new URL(route, 'http://hub.test'));
      return response;
    };
    try {
      const chat = await request('GET', '/api/drones/drone/chats/my%20chat/usage');
      expect(chat.status).toBe(200);
      expect(chat.body.totals.total).toBe(120);
      expect((await request('GET', '/api/usage?agent=cursor')).body.totals.executions).toBe(0);
      expect((await request('GET', '/api/usage?from=invalid')).status).toBe(400);
      expect((await request('GET', '/api/usage?groupBy=invalid')).status).toBe(400);
      expect((await request('GET', '/api/drones/drone/chats/missing/usage')).status).toBe(404);
      body = { ...price, input: -1 };
      expect((await request('POST', '/api/usage/prices')).status).toBe(400);
      body = { ...price, input: 5 };
      expect((await request('POST', '/api/usage/prices')).status).toBe(201);
      const prices = await request('GET', '/api/usage/prices');
      expect(prices.body.prices).toHaveLength(2);
      expect(prices.body.prices[0].origin).toBe('manual');
    } finally { await resetTranscriptStoreForTests(); }
  });
});
