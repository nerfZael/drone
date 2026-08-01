import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';
import type { ResourceSubscriptionService } from '../subscriptions/resource-subscription-service';
import {
  readResourceSubscriptionSettings,
  writeResourceSubscriptionSettings,
} from '../subscriptions/resource-subscription-settings';

export function registerResourceSubscriptionRoutes(
  apiRouter: HubRouter,
  service: ResourceSubscriptionService | null,
): void {
  const availableService = (json: (status: number, body: unknown) => void) => {
    if (service) return service;
    json(503, { ok: false, error: 'resource subscriptions require the Hub database' });
    return null;
  };
  apiRouter.get('/api/resource-subscriptions/settings', async ({ json }) => {
    json(200, { ok: true, settings: await readResourceSubscriptionSettings() });
  });

  apiRouter.get('/api/resource-subscriptions/chat-resource/:resourceId', ({ params, json }) => {
    const current = availableService(json);
    if (!current) return;
    const location = current.resolveChatResource(params.resourceId);
    if (!location) {
      json(404, { ok: false, error: 'chat resource not found' });
      return;
    }
    json(200, { ok: true, resource: location });
  });

  apiRouter.post('/api/resource-subscriptions/settings', async ({ readJson, json }) => {
    try {
      const body = await readJson<any>();
      const settings = await writeResourceSubscriptionSettings(body?.settings ?? body);
      json(200, { ok: true, settings });
    } catch (error) {
      json(400, { ok: false, error: errorMessage(error) });
    }
  });

  apiRouter.get('/api/resource-subscriptions', ({ url, json }) => {
    const current = availableService(json);
    if (!current) return;
    const subscriberChatId = String(url.searchParams.get('subscriberChatId') ?? '').trim();
    if (!subscriberChatId) {
      json(400, { ok: false, error: 'subscriberChatId is required' });
      return;
    }
    const includeInactive = url.searchParams.get('includeInactive') === 'true';
    json(200, {
      ok: true,
      subscriptions: current.list(subscriberChatId, includeInactive),
    });
  });

  apiRouter.get('/api/resource-subscriptions/:subscriptionId', ({ params, url, json }) => {
    const current = availableService(json);
    if (!current) return;
    const subscriberChatId = String(url.searchParams.get('subscriberChatId') ?? '').trim();
    const subscription = current.get(params.subscriptionId, subscriberChatId);
    if (!subscriberChatId || !subscription) {
      json(404, { ok: false, error: 'subscription not found' });
      return;
    }
    json(200, { ok: true, subscription });
  });

  apiRouter.post('/api/resource-subscriptions', async ({ readJson, json }) => {
    try {
      const current = availableService(json);
      if (!current) return;
      const body = await readJson<any>();
      const result = await current.subscribe({
        subscriber: body?.subscriber,
        provider: body?.provider,
        resourceType: body?.resourceType,
        resourceId: body?.resourceId,
        events: body?.events,
        intent: body?.intent,
      });
      json(result.created ? 201 : 200, { ok: true, ...result });
    } catch (error) {
      json(400, { ok: false, error: errorMessage(error) });
    }
  });

  apiRouter.patch(
    '/api/resource-subscriptions/:subscriptionId',
    async ({ params, readJson, json }) => {
      try {
        const current = availableService(json);
        if (!current) return;
        const body = await readJson<any>();
        const subscription = await current.update({
          id: params.subscriptionId,
          subscriberChatId: String(body?.subscriberChatId ?? '').trim(),
          ...(body?.events !== undefined ? { events: body.events } : {}),
          ...(body?.intent !== undefined ? { intent: body.intent } : {}),
        });
        if (!subscription) {
          json(404, { ok: false, error: 'subscription not found' });
          return;
        }
        json(200, { ok: true, subscription });
      } catch (error) {
        json(400, { ok: false, error: errorMessage(error) });
      }
    },
  );

  apiRouter.delete('/api/resource-subscriptions/:subscriptionId', async ({ params, url, json }) => {
    const current = availableService(json);
    if (!current) return;
    const subscriberChatId = String(url.searchParams.get('subscriberChatId') ?? '').trim();
    const subscription = await current.cancel(params.subscriptionId, subscriberChatId);
    if (!subscriberChatId || !subscription) {
      json(404, { ok: false, error: 'subscription not found' });
      return;
    }
    json(200, { ok: true, subscription });
  });
}
