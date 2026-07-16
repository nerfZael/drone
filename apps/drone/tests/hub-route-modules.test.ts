import { describe, expect, test } from 'bun:test';

import { HubRouter } from '../src/hub/hub-router';
import { registerFleetRoutes } from '../src/hub/routes/fleet-routes';
import { registerMessageRoutes } from '../src/hub/routes/message-routes';
import { registerOperationalRoutes } from '../src/hub/routes/operational-routes';
import { registerSystemRoutes } from '../src/hub/routes/system-routes';

function routeHarness(body: unknown = null) {
  const responses: Array<{ status: number; body: any }> = [];
  const router = new HubRouter(
    (_res, status, responseBody) => responses.push({ status, body: responseBody }),
    async () => body,
  );
  const request = (method: string, path: string) =>
    router.handle({ method, headers: {} } as any, {} as any, new URL(path, 'http://hub.test'));
  return { router, request, responses };
}

describe('extracted Hub route modules', () => {
  test('registers system and setup routes', async () => {
    const { router, request, responses } = routeHarness();
    registerSystemRoutes(router, {
      buildId: 'build-1',
      loadedAt: '2026-01-01T00:00:00.000Z',
      serverFilename: '/missing/server.js',
      resolveSetupStatusResponse: async () => ({ ok: true, ready: true }),
      readActiveProfileName: async () => 'default',
      resolveHubSetupScopeKey: () => 'profile:default',
      dismissWelcomeForScope: async () => ({
        welcomeDismissedAtByScope: { 'profile:default': '2026-01-02T00:00:00.000Z' },
      }),
    });

    expect(await request('GET', '/api/health')).toBe(true);
    expect(await request('GET', '/api/setup/status')).toBe(true);
    expect(await request('POST', '/api/setup/welcome/dismiss')).toBe(true);
    expect(responses).toEqual([
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: true, ready: true } },
      {
        status: 200,
        body: { ok: true, welcomeDismissedAt: '2026-01-02T00:00:00.000Z' },
      },
    ]);
  });

  test('keeps message routes behind provider configuration', async () => {
    const { router, request, responses } = routeHarness({ response: 'Finished the work.' });
    registerMessageRoutes(router, {
      resolveEffectiveLlmProvider: async () => ({ provider: 'openai' }),
      resolveEffectiveProviderApiKeySettings: async () => ({ apiKey: null }),
      resolveEffectiveAgentSuggestionSettings: async () => ({}),
      resolveNameSuggestionLlmSettings: async () => ({ provider: 'openai', apiKey: null }),
      logProviderApiKeyResolution: async () => {},
      llmProviderEnvLogMeta: () => ({}),
      normalizeDroneIdentity: (value: string) => value,
      hubLog: () => {},
    });

    expect(await request('POST', '/api/tldr/from-message')).toBe(true);
    expect(responses).toEqual([
      {
        status: 412,
        body: {
          ok: false,
          error: 'Missing OpenAI API key. Configure it in Settings.',
        },
      },
    ]);
  });

  test('summarizes chat idle targets through the operational router', async () => {
    const { router, request, responses } = routeHarness({
      mode: 'all',
      targets: [{ droneId: 'alpha', chatName: 'default' }],
    });
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: async () => ({ id: 'drone-alpha' }),
      loadCanonicalActiveModel: async () => ({ drones: {} }),
      summarizeAssistantChatIdle: (_registry: unknown, target: unknown) => ({
        ...target,
        idle: true,
      }),
      resolveGroqApiKeySettings: async () => ({ apiKey: null }),
    });

    expect(await request('POST', '/api/chats/idle/status')).toBe(true);
    expect(responses).toEqual([
      {
        status: 200,
        body: {
          ok: true,
          mode: 'all',
          matched: true,
          targets: [{ droneId: 'drone-alpha', chatName: 'default', idle: true }],
        },
      },
    ]);
  });

  test('serves fleet actor reads from the fleet router', async () => {
    const { router, request, responses } = routeHarness();
    registerFleetRoutes(router, {
      resolveDroneOrRespond: async () => ({ id: 'owner-id' }),
      loadRegistry: async () => ({ drones: {} }),
      fleetActorPayload: (_registry: unknown, id: string) => ({ ok: true, id }),
      findDroneIdByRef: () => null,
      resolveStableDroneOrPendingIdFromRef: () => null,
      fleetDescendantIdsForActor: () => [],
      updateDroneFleetMetadata: async () => {},
      fleetActorConfig: () => ({ assigned: [] }),
      fleetError: (message: string, status: number) =>
        Object.assign(new Error(message), { status }),
    });

    expect(await request('GET', '/api/fleet/actors/owner-id')).toBe(true);
    expect(responses).toEqual([{ status: 200, body: { ok: true, id: 'owner-id' } }]);
  });
});
