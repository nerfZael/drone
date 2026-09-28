import { expect, test } from 'bun:test';
import { HubRouter } from '../src/hub/hub-router';
import { registerChatStepsRoutes } from '../src/hub/routes/chat-steps-routes';
import { withTempDroneDataDir } from './test-helpers';

test('chat step settings default to off with a cheap model, and reject a model without a provider', async () => {
  await withTempDroneDataDir('chat-steps-routes-', async () => {
    let body: unknown;
    let response: { status: number; body: any };
    const router = new HubRouter((_res, status, value) => { response = { status, body: value }; }, async () => body);
    registerChatStepsRoutes(router);
    const request = async (method: string, route: string) => {
      await router.handle({ method } as any, {} as any, new URL(route, 'http://hub.test'));
      return response;
    };
    expect((await request('GET', '/api/settings/chat-steps')).body.settings).toEqual({ enabled: false, model: 'openai-codex/gpt-6-luna', reasoning: 'low' });
    body = { enabled: true, reasoning: 'medium' };
    expect((await request('POST', '/api/settings/chat-steps')).body.settings).toEqual({ enabled: true, model: 'openai-codex/gpt-6-luna', reasoning: 'medium' });
    body = { model: 'gpt-6-luna' };
    expect((await request('POST', '/api/settings/chat-steps')).status).toBe(400);
    expect((await request('GET', '/api/settings/chat-steps')).body.settings.enabled).toBe(true);
    expect((await request('GET', '/api/chats/steps')).body.steps).toEqual([]);
  });
});
