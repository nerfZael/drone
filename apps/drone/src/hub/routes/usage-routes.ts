import type { HubRouter } from '../hub-router';
import { getUsageStore, type UsageFilter } from '../usage/UsageStore';
import { refreshUsagePrices } from '../usage/refreshUsagePrices';
import { readChatMetadataFromStore } from '../transcript-store';

export function registerUsageRoutes(router: HubRouter): void {
  const store = getUsageStore();
  if (!store.prices().length) void refreshUsagePrices(store).catch((error) => console.warn('Usage price catalog unavailable:', error.message));

  router.get('/api/usage', ({ url, json, fail }) => {
    const filter: UsageFilter = {};
    for (const key of ['chatId', 'droneId', 'agent', 'provider', 'model', 'repo'] as const) {
      const value = url.searchParams.get(key);
      if (value) filter[key] = value;
    }
    for (const key of ['from', 'to'] as const) {
      const value = url.searchParams.get(key);
      if (!value) continue;
      if (!Number.isFinite(Date.parse(value))) fail(400, `Invalid ${key} date`);
      filter[key] = new Date(value).toISOString();
    }
    if (filter.from && filter.to && filter.from >= filter.to) fail(400, 'Usage date range must end after it starts');
    const group = url.searchParams.get('groupBy') ?? 'agent';
    if (!['agent', 'provider', 'model', 'chat', 'repo', 'purpose'].includes(group)) fail(400, 'Invalid usage grouping');
    filter.groupBy = group as UsageFilter['groupBy'];
    json(200, { ok: true, ...getUsageStore().analytics(filter) });
  });
  router.get('/api/drones/:droneId/chats/:chatName/usage', ({ params, json, fail }) => {
    const chat = readChatMetadataFromStore({ droneId: params.droneId, chatName: params.chatName }).chat;
    if (!chat?.id) fail(404, 'Chat not found');
    json(200, { ok: true, ...getUsageStore().analytics({ chatId: String(chat!.id) }) });
  });
  router.get('/api/usage/prices', ({ json }) => json(200, { ok: true, prices: getUsageStore().prices() }));
  router.post('/api/usage/prices', async ({ readJson, json, fail }) => {
    const input = await readJson();
    try { json(201, { ok: true, price: getUsageStore().addPrice({ ...input, origin: 'manual' }) }); }
    catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
  });
  let refreshing = false;
  router.post('/api/usage/prices/refresh', async ({ json, fail }) => {
    if (refreshing) fail(409, 'Price refresh already in progress');
    refreshing = true;
    try { json(200, { ok: true, added: await refreshUsagePrices() }); }
    finally { refreshing = false; }
  });
}
