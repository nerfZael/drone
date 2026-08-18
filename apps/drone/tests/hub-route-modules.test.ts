import { describe, expect, test } from 'bun:test';

import { HubRouter } from '../src/hub/hub-router';
import { createEditorRouteHandler } from '../src/hub/routes/editor-routes';
import { createDroneLifecycleRouteHandler } from '../src/hub/routes/drone-lifecycle-routes';
import { registerFleetRoutes } from '../src/hub/routes/fleet-routes';
import { registerGroupRoutes } from '../src/hub/routes/group-routes';
import { registerOperationalRoutes } from '../src/hub/routes/operational-routes';
import { registerNativeChatRoutes } from '../src/hub/routes/native-chat-routes';
import { registerSettingsRoutes } from '../src/hub/routes/settings-routes';
import { registerSidebarRoutes } from '../src/hub/routes/sidebar-routes';
import { registerSystemRoutes } from '../src/hub/routes/system-routes';
import { createTerminalRouteHandler } from '../src/hub/routes/terminal-routes';

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
  test('lists archived drones from canonical lifecycle state without loading the full registry', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const response = {
      writableEnded: false,
      statusCode: 0,
      setHeader: () => {},
      end(data: string) {
        responses.push({ status: this.statusCode, body: JSON.parse(data) });
        this.writableEnded = true;
      },
    };
    let fullRegistryLoads = 0;
    const handler = createDroneLifecycleRouteHandler({
      triggerArchiveCleanup: () => {},
      listCanonicalDroneLifecycleForRead: async () => [{
        state: 'archived', id: 'archived-a', name: 'Archived A', containerName: null,
        runtimeKind: 'host', phase: null, archivedAt: '2026-08-08T00:00:00.000Z',
        deleteAt: '2026-08-10T00:00:00.000Z', archiveRetention: '1d',
        archiveRuntimePolicy: 'keep-running', lifecycle: { repoPath: '/repo' },
      }],
      loadRegistry: async () => {
        fullRegistryLoads += 1;
        return { archived: {} };
      },
      normalizeDroneIdentity: (value: unknown) => String(value ?? '').trim(),
      nowIso: () => '2026-08-09T00:00:00.000Z',
      parseIsoToMs: (value: unknown) => Date.parse(String(value)),
      resolveArchiveDeleteAtIso: (entry: any) => entry.deleteAt,
      normalizeArchiveRetention: (value: unknown) => value,
      normalizeArchiveRuntimePolicy: (value: unknown) => value,
      archiveRetentionMs: () => 86_400_000,
    } as any);

    expect(await handler({
      req: { headers: {} } as any,
      res: response as any,
      url: new URL('http://hub.test/api/archive/drones'),
      method: 'GET',
      parts: ['api', 'archive', 'drones'],
    })).toBe(true);
    expect(fullRegistryLoads).toBe(0);
    expect(responses[0]).toMatchObject({
      status: 200,
      body: { ok: true, total: 1, archived: [{ id: 'archived-a', name: 'Archived A' }] },
    });
  });

  test('archives one drone through targeted lifecycle state without loading every transcript', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const response = {
      writableEnded: false,
      statusCode: 0,
      setHeader: () => {},
      end(data: string) {
        responses.push({ status: this.statusCode, body: JSON.parse(data) });
        this.writableEnded = true;
      },
    };
    let fullRegistryLoads = 0;
    let stoppedDroneId = '';
    const handler = createDroneLifecycleRouteHandler({
      resolveCanonicalDroneOrPendingForReadRef: async () => ({
        kind: 'real', id: 'drone-a', drone: { id: 'drone-a', name: 'Alpha', runtime: 'host', chats: {} },
      }),
      loadRegistry: async () => {
        fullRegistryLoads += 1;
        return { drones: {} };
      },
      normalizeDroneIdentity: (value: unknown) => String(value ?? '').trim(),
      resolveEffectiveDeleteActionSettings: async () => ({
        archiveRetention: '1d', archiveRuntimePolicy: 'keep-running',
      }),
      stopAllDroneChatActivity: async ({ droneId }: any) => { stoppedDroneId = droneId; },
      droneRuntime: (entry: any) => entry.runtime,
      archiveDroneById: async () => ({
        hadEntry: true, archived: true, id: 'drone-a', name: 'Alpha',
        archiveRetention: '1d', archiveRuntimePolicy: 'keep-running',
        archivedAt: '2026-08-09T00:00:00.000Z', deleteAt: '2026-08-10T00:00:00.000Z',
      }),
      revokeMcpAccessTokensForDrone: async () => {},
    } as any);

    expect(await handler({
      req: { headers: {} } as any,
      res: response as any,
      url: new URL('http://hub.test/api/drones/drone-a/archive'),
      method: 'POST',
      parts: ['api', 'drones', 'drone-a', 'archive'],
    })).toBe(true);
    expect(fullRegistryLoads).toBe(0);
    expect(stoppedDroneId).toBe('drone-a');
    expect(responses[0]).toMatchObject({ status: 200, body: { ok: true, archived: true } });
  });

  test('delegates terminal routes and rejects invalid session names', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const response = {
      writableEnded: false,
      statusCode: 0,
      setHeader: () => {},
      end(data: string) {
        responses.push({ status: this.statusCode, body: JSON.parse(data) });
        this.writableEnded = true;
      },
    };
    const handler = createTerminalRouteHandler({
      isSafeTmuxSessionName: () => false,
    } as any);

    expect(
      await handler({
        req: { headers: {} } as any,
        res: response as any,
        url: new URL('http://hub.test/api/drones/alpha/terminal/not-safe'),
        method: 'DELETE',
        parts: ['api', 'drones', 'alpha', 'terminal', 'not-safe'],
      }),
    ).toBe(true);
    expect(responses).toEqual([
      { status: 400, body: { ok: false, error: 'invalid session name' } },
    ]);
  });

  test('leaves unrelated requests unhandled by terminal and editor routes', async () => {
    const request = {
      req: { headers: {} } as any,
      res: {} as any,
      url: new URL('http://hub.test/api/health'),
      method: 'GET',
      parts: ['api', 'health'],
    };

    expect(await createTerminalRouteHandler({} as any)(request)).toBe(false);
    expect(await createEditorRouteHandler({} as any)(request)).toBe(false);
  });

  test('delegates editor routes and validates the editor name', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const response = {
      writableEnded: false,
      statusCode: 0,
      setHeader: () => {},
      end(data: string) {
        responses.push({ status: this.statusCode, body: JSON.parse(data) });
        this.writableEnded = true;
      },
    };

    expect(
      await createEditorRouteHandler({} as any)({
        req: { headers: {} } as any,
        res: response as any,
        url: new URL('http://hub.test/api/drones/alpha/open-editor?editor=vim'),
        method: 'POST',
        parts: ['api', 'drones', 'alpha', 'open-editor'],
      }),
    ).toBe(true);
    expect(responses).toEqual([
      {
        status: 400,
        body: { ok: false, error: 'invalid editor: vim (expected code|cursor)' },
      },
    ]);
  });

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
      resolveSpeechSettings: async () => ({
        enabled: true,
        muted: false,
        volume: 1,
        voice: 'troy',
      }),
      emitAssistantUiAction: () => {},
      hubLog: () => {},
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

  test('accepts bounded chat load telemetry and writes one structured timing log', async () => {
    const logs: any[] = [];
    const { router, request, responses } = routeHarness({
      version: 1,
      navigationId: 'navigation-1',
      source: 'chat',
      target: { droneId: 'drone-alpha', chatName: 'default' },
      startedAt: '2026-08-18T10:00:00.000Z',
      durationMs: 42.25,
      status: 'completed',
      surface: 'transcript',
      agentKind: 'builtin:codex',
      runtime: 'container',
      cacheStatus: 'miss',
      itemCount: 4,
      milestones: { click: 0, content_painted: 42.25, injected: 9 },
      requests: [{
        name: 'chat_state',
        startMs: 3,
        durationMs: 20,
        fetchMs: 12,
        bodyMs: 7,
        parseMs: 1,
        status: 200,
        responseBytes: 1024,
        outcome: 'completed',
        serverTiming: { lifecycle: 2, rows: 5 },
      }],
    });
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: async () => null,
      loadCanonicalActiveModel: async () => ({ drones: {} }),
      summarizeAssistantChatIdle: () => null,
      resolveGroqApiKeySettings: async () => ({ apiKey: null }),
      resolveSpeechSettings: async () => ({ enabled: false, muted: true, volume: 1, voice: 'troy' }),
      emitAssistantUiAction: () => {},
      hubLog: (level, message, meta) => logs.push({ level, message, meta }),
    });

    expect(await request('POST', '/api/telemetry/chat-load')).toBe(true);
    expect(responses).toEqual([{ status: 202, body: { ok: true } }]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      message: 'chat load timing',
      meta: {
        navigationId: 'navigation-1',
        durationMs: 42.3,
        milestones: { click: 0, content_painted: 42.3 },
        requests: [{ name: 'chat_state', serverTiming: { lifecycle: 2, rows: 5 } }],
      },
    });
    expect(logs[0].meta.milestones).not.toHaveProperty('injected');
  });

  test('adds resolve, ensure, and history phases to Built-in chat bootstrap', async () => {
    const headers = new Map<string, string>();
    const responses: Array<{ status: number; body: any }> = [];
    const router = new HubRouter(
      (_res, status, body) => responses.push({ status, body }),
      async () => null,
    );
    registerNativeChatRoutes(router, {
      resolveDroneOrPendingForReadRef: async () => ({ id: 'drone-1', kind: 'real', drone: {} }),
      getChatEntry: async () => ({ chat: { id: 'thread-1' } }),
      inferChatAgent: () => ({ kind: 'native' }),
      nativeChatLifecycle: { ensure: async () => ({ ok: true, threads: [] }) },
      nativeChatHistoryPage: async () => ({
        version: 1,
        threadId: 'thread-1',
        sessionId: null,
        entries: [],
        page: { limit: 200, beforeCursor: null, hasOlder: false },
      }),
      createRequestTimer: () => {
        const phases: string[] = [];
        return {
          mark: (name: string) => phases.push(name),
          setHeader: (res: any) => res.setHeader('server-timing', phases.join(',')),
        };
      },
    });

    expect(
      await router.handle(
        { method: 'POST', headers: {} } as any,
        { setHeader: (name: string, value: string) => headers.set(name, value) } as any,
        new URL('http://hub.test/api/drones/drone-1/chats/default/native?includeHistory=1'),
      ),
    ).toBe(true);
    expect(headers.get('server-timing')).toBe('resolve,ensure,history,format');
    expect(responses[0]).toMatchObject({
      status: 200,
      body: { nativeChatId: 'thread-1', initialHistory: { entries: [] } },
    });
  });

  test('returns a queued speech job before GROQ synthesis finishes', async () => {
    const originalFetch = globalThis.fetch;
    let resolveFetch: ((response: Response) => void) | null = null;
    const synthesisResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    globalThis.fetch = (() => synthesisResponse) as typeof fetch;
    const emittedActions: any[] = [];
    const { router, request, responses } = routeHarness({
      text: 'Background speech.',
      voice: 'hannah',
      threadId: 'thread-one',
    });
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: async () => null,
      loadCanonicalActiveModel: async () => ({ drones: {} }),
      summarizeAssistantChatIdle: () => null,
      resolveGroqApiKeySettings: async () => ({ apiKey: 'groq-secret' }),
      resolveSpeechSettings: async () => ({
        enabled: true,
        muted: false,
        volume: 0.75,
        voice: 'troy',
      }),
      emitAssistantUiAction: (action: unknown, threadId: string) => {
        emittedActions.push({ action, threadId });
      },
      hubLog: () => {},
    });

    try {
      expect(await request('POST', '/api/audio/speech')).toBe(true);
      expect(responses).toHaveLength(1);
      expect(responses[0]).toMatchObject({
        status: 202,
        body: {
          ok: true,
          status: 'queued',
          model: 'canopylabs/orpheus-v1-english',
          voice: 'hannah',
        },
      });
      expect(String(responses[0]?.body?.jobId)).toStartWith('speech_');
      expect(emittedActions).toEqual([]);

      resolveFetch?.(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(emittedActions).toHaveLength(1);
      expect(emittedActions[0]).toMatchObject({
        action: {
          type: 'play_audio',
          data: 'AQID',
          mimeType: 'audio/wav',
          volume: 0.75,
        },
        threadId: 'thread-one',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns muted speech without requiring a GROQ API key', async () => {
    let groqSettingsLookups = 0;
    const { router, request, responses } = routeHarness({ text: 'Muted speech.' });
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: async () => null,
      loadCanonicalActiveModel: async () => ({ drones: {} }),
      summarizeAssistantChatIdle: () => null,
      resolveGroqApiKeySettings: async () => {
        groqSettingsLookups += 1;
        return { apiKey: null };
      },
      resolveSpeechSettings: async () => ({
        enabled: true,
        muted: true,
        volume: 1,
        voice: 'troy',
      }),
      emitAssistantUiAction: () => {},
      hubLog: () => {},
    });

    expect(await request('POST', '/api/audio/speech')).toBe(true);
    expect(groqSettingsLookups).toBe(0);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      status: 202,
      body: { ok: true, status: 'muted', voice: 'troy' },
    });
  });

  test('respects mute changes made while speech is being synthesized', async () => {
    const originalFetch = globalThis.fetch;
    let resolveFetch: ((response: Response) => void) | null = null;
    const synthesisResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    globalThis.fetch = (() => synthesisResponse) as typeof fetch;
    let muted = false;
    const emittedActions: any[] = [];
    const { router, request } = routeHarness({ text: 'Mute me before playback.' });
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: async () => null,
      loadCanonicalActiveModel: async () => ({ drones: {} }),
      summarizeAssistantChatIdle: () => null,
      resolveGroqApiKeySettings: async () => ({ apiKey: 'groq-secret' }),
      resolveSpeechSettings: async () => ({ enabled: true, muted, volume: 1, voice: 'troy' }),
      emitAssistantUiAction: (action: unknown) => emittedActions.push(action),
      hubLog: () => {},
    });

    try {
      expect(await request('POST', '/api/audio/speech')).toBe(true);
      muted = true;
      resolveFetch?.(new Response(new Uint8Array([1]), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(emittedActions).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('synthesizes simultaneous speech calls one at a time in call order', async () => {
    const originalFetch = globalThis.fetch;
    const speechSettings = { enabled: true, muted: false, volume: 1, voice: 'troy' };
    let resolveFirstSettings: ((settings: typeof speechSettings) => void) | null = null;
    const firstSettings = new Promise<typeof speechSettings>((resolve) => {
      resolveFirstSettings = resolve;
    });
    let settingsLookupCount = 0;
    let resolveFirstFetch: ((response: Response) => void) | null = null;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirstFetch = resolve;
    });
    let fetchCount = 0;
    const synthesizedTexts: string[] = [];
    globalThis.fetch = ((_url, init) => {
      fetchCount += 1;
      synthesizedTexts.push(JSON.parse(String(init?.body)).input);
      return fetchCount === 1
        ? firstFetch
        : Promise.resolve(new Response(new Uint8Array([2]), { status: 200 }));
    }) as typeof fetch;
    const emittedActions: any[] = [];
    const responses = new Map<string, any>();
    const router = new HubRouter(
      (res: any, status, body) => responses.set(res.requestId, { status, body }),
      async (req: any) => req.body,
    );
    registerOperationalRoutes(router, {
      resolveDroneOrPendingForReadRef: async () => null,
      loadCanonicalActiveModel: async () => ({ drones: {} }),
      summarizeAssistantChatIdle: () => null,
      resolveGroqApiKeySettings: async () => ({ apiKey: 'groq-secret' }),
      resolveSpeechSettings: async () => {
        settingsLookupCount += 1;
        return settingsLookupCount === 1 ? await firstSettings : speechSettings;
      },
      emitAssistantUiAction: (action: unknown) => emittedActions.push(action),
      hubLog: () => {},
    });
    const request = (requestId: string, text: string) =>
      router.handle(
        { method: 'POST', headers: {}, body: { text } } as any,
        { requestId } as any,
        new URL('/api/audio/speech', 'http://hub.test'),
      );

    try {
      const firstRequest = request('first', 'First speech.');
      const secondRequest = request('second', 'Second speech.');
      await secondRequest;
      expect(responses.get('second')?.body.queuePosition).toBe(2);
      expect(fetchCount).toBe(0);

      resolveFirstSettings?.(speechSettings);
      await firstRequest;
      expect(responses.get('first')?.body.queuePosition).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchCount).toBe(1);
      expect(synthesizedTexts).toEqual(['First speech.']);
      expect(emittedActions).toEqual([]);

      resolveFirstFetch?.(new Response(new Uint8Array([1]), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchCount).toBe(2);
      expect(synthesizedTexts).toEqual(['First speech.', 'Second speech.']);
      expect(emittedActions.map((action) => action.data)).toEqual(['AQ==', 'Ag==']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('serves fleet actor reads from the fleet router', async () => {
    const { router, request, responses } = routeHarness();
    registerFleetRoutes(router, {
      fleet: {
        get: async (droneRef: string) => ({ ok: true, id: droneRef }),
        setDroneParent: async () => ({ ok: true, id: 'owner-id', parentId: null }),
      },
    } as any);

    expect(await request('GET', '/api/fleet/actors/owner-id')).toBe(true);
    expect(responses).toEqual([{ status: 200, body: { ok: true, id: 'owner-id' } }]);
  });

  test('keeps group deletion transport details in the route adapter', async () => {
    const { router, request, responses } = routeHarness();
    const deletions: unknown[] = [];
    registerGroupRoutes(router, {
      nowIso: () => 'now',
      groups: {
        delete: async (input: unknown) => {
          deletions.push(input);
          return {
            ok: true,
            group: 'Review',
            repoPath: '/repo',
            removed: [],
            total: 0,
          };
        },
      },
    } as any);

    expect(
      await request(
        'DELETE',
        '/api/groups/group-id?repoPath=%2Frepo&keepVolume=1&forget=false',
      ),
    ).toBe(true);
    expect(deletions).toEqual([
      {
        groupRef: 'group-id',
        repoPath: '/repo',
        keepVolume: true,
        forget: false,
      },
    ]);
    expect(responses).toEqual([
      {
        status: 200,
        body: {
          ok: true,
          group: 'Review',
          repoPath: '/repo',
          removed: [],
          total: 0,
        },
      },
    ]);
  });

  test('exposes the automatic Codex connection lifecycle', async () => {
    const { router, request, responses } = routeHarness();
    const calls: string[] = [];
    const waiting = {
      ok: true,
      status: 'waiting',
      authorizationUrl: 'https://auth.openai.com/authorize',
      startedAt: '2026-07-17T10:00:00.000Z',
      completedAt: null,
      error: null,
    };
    registerSettingsRoutes(router, {
      codexLoginStatus: () => ({ ...waiting, status: 'idle', authorizationUrl: null }),
      startCodexLogin: async () => {
        calls.push('start');
        return waiting;
      },
      cancelCodexLogin: () => {
        calls.push('cancel');
        return { ...waiting, status: 'idle', authorizationUrl: null };
      },
    } as any);

    expect(await request('GET', '/api/settings/codex/connect')).toBe(true);
    expect(await request('POST', '/api/settings/codex/connect')).toBe(true);
    expect(await request('DELETE', '/api/settings/codex/connect')).toBe(true);
    expect(calls).toEqual(['start', 'cancel']);
    expect(responses).toEqual([
      { status: 200, body: { ...waiting, status: 'idle', authorizationUrl: null } },
      { status: 200, body: waiting },
      { status: 200, body: { ...waiting, status: 'idle', authorizationUrl: null } },
    ]);
  });

  test('notifies desktop clients after a general UI preference write', async () => {
    const requestBody = {
      uiPreferences: { sidebarNodeOrderByParent: { group: ['drone:a', 'drone:b'] } },
      expectedVersion: 12,
    };
    const { router, request, responses } = routeHarness(requestBody);
    const writes: Array<{ preferences: unknown; expectedVersion: unknown }> = [];
    let notificationCount = 0;
    registerSettingsRoutes(router, {
      hubSettings: {
        uiPreferences: {
          update: async (input: any) => {
            writes.push({
              preferences: input.uiPreferences,
              expectedVersion: input.expectedVersion,
            });
            notificationCount += 1;
            return {
              ok: true,
              ...requestBody,
              updatedAt: '2026-08-06T08:24:17.707Z',
              version: 13,
            };
          },
        },
      },
    } as any);

    expect(await request('POST', '/api/settings/ui-preferences')).toBe(true);
    expect(writes).toEqual([
      { preferences: requestBody.uiPreferences, expectedVersion: requestBody.expectedVersion },
    ]);
    expect(notificationCount).toBe(1);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ status: 200, body: { ok: true, version: 13 } });
  });

  test('publishes a combined sidebar move through the registry snapshot stream', async () => {
    const requestBody = {
      uiPreferences: { sidebarNodeOrderByParent: { group: ['drone:b', 'drone:a'] } },
      expectedVersion: 13,
      notificationMode: 'sidebar_snapshot',
    };
    const { router, request } = routeHarness(requestBody);
    let generalNotifications = 0;
    let snapshotNotifications = 0;
    registerSettingsRoutes(router, {
      hubSettings: {
        uiPreferences: {
          update: async (input: any) => {
            if (input.notificationMode === 'sidebar-snapshot') snapshotNotifications += 1;
            else generalNotifications += 1;
            return {
              ok: true,
              uiPreferences: requestBody.uiPreferences,
              updatedAt: '2026-08-06T10:00:00.000Z',
              version: 14,
            };
          },
        },
      },
    } as any);

    expect(await request('POST', '/api/settings/ui-preferences')).toBe(true);
    expect({ generalNotifications, snapshotNotifications }).toEqual({
      generalNotifications: 0,
      snapshotNotifications: 1,
    });
  });

  test('routes desktop sidebar commands through the shared command service', async () => {
    const body = {
      mutationId: 'desktop-1',
      intent: { kind: 'set-pinned', droneIds: ['alpha'], pinned: true },
    };
    const { router, request, responses } = routeHarness(body);
    const received: unknown[] = [];
    registerSidebarRoutes(router, {
      move: async (value: unknown) => {
        received.push(value);
        return {
          ok: true,
          mutationId: 'desktop-1',
          version: 2,
          uiPreferences: {
            sidebarNodeOrderByParent: {},
            sidebarChatOrderByDrone: {},
            pinnedDroneIds: ['alpha'],
          },
        };
      },
    } as any);

    expect(await request('POST', '/api/sidebar/move')).toBe(true);
    expect(received).toEqual([body]);
    expect(responses[0]).toMatchObject({
      status: 200,
      body: { ok: true, mutationId: 'desktop-1', version: 2 },
    });
  });

  test('saves speech settings and notifies active MCP sessions', async () => {
    const requested = {
      enabled: false,
      muted: true,
      volume: 0.4,
      voice: 'hannah',
    };
    const { router, request, responses } = routeHarness(requested);
    let stored: any = null;
    let notified: any = null;
    registerSettingsRoutes(router, {
      upsertStoredSpeechSettings: async (input: unknown) => {
        stored = input;
      },
      resolveSpeechSettingsResponse: async () => ({
        ok: true,
        speech: { ...requested, voices: ['hannah', 'troy'] },
      }),
      notifySpeechSettingsChanged: (speech: unknown) => {
        notified = speech;
      },
    } as any);

    expect(await request('POST', '/api/settings/speech')).toBe(true);
    expect(stored).toEqual(requested);
    expect(notified).toEqual({ ...requested, voices: ['hannah', 'troy'] });
    expect(responses).toEqual([
      {
        status: 200,
        body: { ok: true, speech: { ...requested, voices: ['hannah', 'troy'] } },
      },
    ]);
  });

  test('validates and saves continuous voice input settings', async () => {
    const requested = {
      endThoughtPreset: 'patient',
      customSilenceMillis: 3_000,
      noiseHandling: 'noisy',
      language: 'hr-HR',
      quality: 'accurate',
      confirmationFeedback: true,
    };
    const { router, request, responses } = routeHarness(requested);
    let stored: any = null;
    registerSettingsRoutes(router, {
      upsertStoredVoiceInputSettings: async (input: unknown) => {
        stored = input;
      },
      resolveVoiceInputSettingsResponse: async () => ({
        ok: true,
        voiceInput: { ...requested, silenceMillis: 4_000 },
      }),
    } as any);

    expect(await request('POST', '/api/settings/voice-input')).toBe(true);
    expect(stored).toEqual(requested);
    expect(responses).toEqual([
      {
        status: 200,
        body: { ok: true, voiceInput: { ...requested, silenceMillis: 4_000 } },
      },
    ]);
  });
});
