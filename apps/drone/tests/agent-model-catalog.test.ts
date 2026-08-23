import { describe, expect, test } from 'bun:test';

import { AgentModelCatalogService } from '../src/hub/agent-model-catalog/service';
import { registerAgentModelCatalogRoutes } from '../src/hub/agent-model-catalog/routes';
import {
  parseAgentModelList,
  parseCodexModelCache,
} from '../src/hub/agent-model-catalog/parsers';
import type { AgentModelCatalogRuntime } from '../src/hub/agent-model-catalog/types';
import { HubRouter } from '../src/hub/hub-router';

describe('agent model catalog', () => {
  test('normalizes JSON catalogs with defaults and model-specific reasoning', () => {
    expect(
      parseAgentModelList(
        JSON.stringify({
          models: [
            {
              id: 'gpt-test',
              label: 'GPT Test',
              default: true,
              reasoning_levels: ['low', 'high', 'high'],
              default_reasoning_level: 'high',
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: 'gpt-test',
        label: 'GPT Test',
        isDefault: true,
        reasoningLevels: ['low', 'high'],
        defaultReasoningLevel: 'high',
      },
    ]);
  });

  test('reads Codex model cache metadata', () => {
    expect(
      parseCodexModelCache(
        JSON.stringify({
          current_model: 'gpt-current',
          models: [
            {
              slug: 'gpt-current',
              display_name: 'GPT Current',
              supported_reasoning_efforts: ['medium', 'high'],
              default_reasoning_effort: 'medium',
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: 'gpt-current',
        label: 'GPT Current',
        isCurrent: true,
        reasoningLevels: ['medium', 'high'],
        defaultReasoningLevel: 'medium',
      },
    ]);
  });

  test('uses an updated Codex cache even while the Drone Hub catalog is still fresh', async () => {
    const discoveredAt = '2026-01-01T00:00:00.000Z';
    let containerCalls = 0;
    const hostCommands: string[] = [];
    const runtime: AgentModelCatalogRuntime = {
      async runContainer() {
        containerCalls += 1;
        return { code: 1 };
      },
      async runHost(command) {
        hostCommands.push(command);
        return {
          code: 0,
          stdout: JSON.stringify({
            models: [
              { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', visibility: 'list' },
              { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list' },
              { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list' },
            ],
          }),
        };
      },
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
      now: () => Date.parse('2026-01-01T00:01:00.000Z'),
    };
    const service = new AgentModelCatalogService(runtime, {
      read: () => ({
        key: 'v3:shared:codex',
        agentId: 'codex',
        runtime: 'container',
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }] as any,
        discoveredAt,
      }),
      async write() {},
    });

    const result = await service.get({
      agentId: 'codex',
      target: { runtime: 'container', containerName: 'drone-a' },
    });

    expect(result.models.map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(result.source).toBe('live');
    expect(containerCalls).toBe(0);
    expect(hostCommands).toHaveLength(1);
    expect(hostCommands[0]).toContain('CODEX_HOME');
    expect(hostCommands[0]).toContain('/dvm-data/home/.codex/models_cache.json');
  });

  test('uses Codex visibility and priority metadata', () => {
    expect(
      parseCodexModelCache(
        JSON.stringify({
          models: [
            {
              slug: 'gpt-legacy',
              display_name: 'GPT Legacy',
              visibility: 'list',
              supported_in_api: true,
              priority: 10,
            },
            {
              slug: 'codex-auto-review',
              display_name: 'Codex Auto Review',
              visibility: 'hide',
              supported_in_api: true,
              priority: 1,
            },
            {
              slug: 'gpt-chatgpt-only',
              display_name: 'GPT ChatGPT Only',
              visibility: 'list',
              supported_in_api: false,
              priority: 2,
            },
            {
              slug: 'gpt-5.6-sol',
              display_name: 'GPT-5.6-Sol',
              visibility: 'list',
              supported_in_api: true,
              priority: 3,
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: 'gpt-chatgpt-only',
        label: 'GPT ChatGPT Only',
        reasoningLevels: [],
        defaultReasoningLevel: '',
      },
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
        reasoningLevels: [],
        defaultReasoningLevel: '',
      },
      {
        id: 'gpt-legacy',
        label: 'GPT Legacy',
        reasoningLevels: [],
        defaultReasoningLevel: '',
      },
    ]);
  });

  test('shares one in-flight probe and caches it across containers', async () => {
    let modelListCalls = 0;
    const runtime: AgentModelCatalogRuntime = {
      async runContainer(_containerName, command) {
        if (command.startsWith('command -v')) return { code: 0 };
        if (command.endsWith('--help')) return { code: 0, stdout: '--list-models' };
        if (command.endsWith('--version')) return { code: 0, stdout: 'codex 1.2.3' };
        if (command.endsWith('--list-models')) {
          modelListCalls += 1;
          return {
            code: 0,
            stdout: JSON.stringify({ models: [{ id: 'gpt-shared', default: true }] }),
          };
        }
        return { code: 1 };
      },
      async runHost() {
        return { code: 1 };
      },
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
    };
    const service = new AgentModelCatalogService(runtime);
    const request = {
      agentId: 'codex' as const,
      target: {
        runtime: 'container' as const,
        containerName: 'drone-a',
      },
    };

    const [first, second] = await Promise.all([service.get(request), service.get(request)]);
    const fromAnotherDrone = await service.get({
      ...request,
      target: { ...request.target, containerName: 'drone-b' },
    });

    expect(first.models[0]?.id).toBe('gpt-shared');
    expect(second.models).toEqual(first.models);
    expect(fromAnotherDrone.source).toBe('cache');
    expect(modelListCalls).toBe(1);
  });

  test('shares one catalog across host and container discovery', async () => {
    let hostModelListCalls = 0;
    let containerCalls = 0;
    const runtime: AgentModelCatalogRuntime = {
      async runContainer() {
        containerCalls += 1;
        return { code: 1 };
      },
      async runHost(command) {
        if (command.startsWith('command -v')) return { code: 0 };
        if (command.endsWith('--help')) return { code: 0, stdout: '--list-models' };
        if (command.endsWith('--version')) return { code: 0, stdout: 'codex 1.2.3' };
        if (command.endsWith('--list-models')) {
          hostModelListCalls += 1;
          return {
            code: 0,
            stdout: JSON.stringify({ models: [{ id: 'gpt-shared' }] }),
          };
        }
        return { code: 1 };
      },
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
    };
    const service = new AgentModelCatalogService(runtime);

    const host = await service.get({
      agentId: 'codex',
      target: { runtime: 'host' },
      forceRefresh: true,
    });
    const container = await service.get({
      agentId: 'codex',
      target: {
        runtime: 'container',
        containerName: 'drone-a',
      },
    });

    expect(host.models[0]?.id).toBe('gpt-shared');
    expect(container.models).toEqual(host.models);
    expect(container.source).toBe('cache');
    expect(hostModelListCalls).toBe(1);
    expect(containerCalls).toBe(0);
  });

  test('keeps the last good catalog when a refresh fails', async () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    let failing = false;
    let modelListCalls = 0;
    const runtime: AgentModelCatalogRuntime = {
      async runContainer(_containerName, command) {
        if (command.startsWith('command -v')) return { code: 0 };
        if (command.endsWith('--help')) return { code: 0, stdout: '--list-models' };
        if (command.endsWith('--version')) return { code: 0, stdout: 'agent 1.2.3' };
        if (command.endsWith('--list-models')) {
          modelListCalls += 1;
          return failing
            ? { code: 1, stderr: 'temporary failure' }
            : { code: 0, stdout: JSON.stringify({ models: [{ id: 'stable-model' }] }) };
        }
        return { code: 1 };
      },
      async runHost() {
        return { code: 1 };
      },
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
      now: () => now,
    };
    const service = new AgentModelCatalogService(runtime);
    const request = {
      agentId: 'pi' as const,
      target: {
        runtime: 'container' as const,
        containerName: 'drone-a',
      },
    };

    expect((await service.get(request)).models[0]?.id).toBe('stable-model');
    now += 7 * 60 * 60 * 1000;
    failing = true;
    const failedRefresh = await service.get({ ...request, forceRefresh: true });
    const callsAfterFailure = modelListCalls;
    const cached = await service.get(request);

    expect(failedRefresh.models[0]?.id).toBe('stable-model');
    expect(failedRefresh.stale).toBe(true);
    expect(cached.models[0]?.id).toBe('stable-model');
    expect(cached.error).toContain('No models discovered');
    expect(modelListCalls).toBe(callsAfterFailure);
  });

  test('normalizes catalogs loaded from older persisted cache entries', async () => {
    const discoveredAt = new Date().toISOString();
    const runtime: AgentModelCatalogRuntime = {
      async runContainer() {
        return { code: 1 };
      },
      async runHost() {
        return { code: 1 };
      },
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
    };
    const service = new AgentModelCatalogService(runtime, {
      read: () => ({
        key: 'v2:host:codex',
        agentId: 'codex',
        runtime: 'host',
        models: [{ id: 'cached-model', label: 'Cached Model' }] as any,
        discoveredAt,
      }),
      async write() {},
    });

    expect(
      (
        await service.get({
          agentId: 'codex',
          target: { runtime: 'host' },
        })
      ).models,
    ).toEqual([
      {
        id: 'cached-model',
        label: 'Cached Model',
        reasoningLevels: [],
        defaultReasoningLevel: '',
      },
    ]);
  });

  test('does not parse failed command output as a model', async () => {
    const runtime: AgentModelCatalogRuntime = {
      async runContainer(_containerName, command) {
        if (command.startsWith('command -v')) return { code: 0 };
        if (command.endsWith('--help')) return { code: 0, stdout: '--list-models' };
        if (command.endsWith('--version')) return { code: 0, stdout: 'pi 1.2.3' };
        return { code: 1, stderr: 'error' };
      },
      async runHost() {
        return { code: 1, stderr: 'error' };
      },
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
    };
    const service = new AgentModelCatalogService(runtime);
    const result = await service.get({
      agentId: 'pi',
      target: {
        runtime: 'container',
        containerName: 'drone-a',
      },
    });

    expect(result.models).toEqual([]);
    expect(result.error).toContain('No models discovered');
  });

  test('discovers models from an agent installed on the host', async () => {
    const hostCommands: string[] = [];
    const runtime: AgentModelCatalogRuntime = {
      async runContainer() {
        return { code: 1 };
      },
      async runHost(command) {
        hostCommands.push(command);
        if (command.startsWith('command -v')) return { code: 0 };
        if (command === 'opencode --help') return { code: 0, stdout: 'models  list models' };
        if (command === 'opencode --version') return { code: 0, stdout: '1.2.3' };
        if (command === 'opencode models --json') {
          return { code: 0, stdout: JSON.stringify({ models: [{ id: 'host-model' }] }) };
        }
        return { code: 1 };
      },
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
    };

    const result = await new AgentModelCatalogService(runtime).get({
      agentId: 'opencode',
      target: { runtime: 'host' },
      forceRefresh: true,
    });

    expect(result.models[0]?.id).toBe('host-model');
    expect(result.source).toBe('live');
    expect(hostCommands).toContain('command -v opencode >/dev/null 2>&1');
  });

  test('refreshes every installed host agent and reports skipped agents', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const discoveredAgents: string[] = [];
    const router = new HubRouter(
      (_response, status, body) => responses.push({ status, body }),
      async () => ({}),
    );
    registerAgentModelCatalogRoutes(router, {
      normalizeBuiltinAgentId: (value: string) => value,
      nativeModelCatalog: async () => ({ models: [] }),
      loadRegistry: async () => ({ drones: {} }),
      droneRuntime: () => 'host',
      hostAgentInstalled: async (agentId: string) => agentId === 'codex' || agentId === 'opencode',
      discoverModels: async ({ agentId, forceRefresh, runtime }: any) => {
        expect(forceRefresh).toBe(true);
        expect(runtime).toBe('host');
        discoveredAgents.push(agentId);
        return {
          models: [{ id: `${agentId}-model`, label: `${agentId} model` }],
          source: 'live',
          discoveredAt: '2026-01-01T00:00:00.000Z',
        };
      },
    });

    await router.handle(
      { method: 'POST' } as any,
      {} as any,
      new URL('http://hub.test/api/model-catalog/refresh'),
    );

    expect(discoveredAgents.sort()).toEqual(['codex', 'opencode']);
    expect(responses[0]?.status).toBe(200);
    expect(responses[0]?.body).toMatchObject({
      ok: true,
      runtime: 'host',
      catalogs: [
        { agent: 'cursor', installed: false, models: [] },
        { agent: 'codex', installed: true, models: [{ id: 'codex-model' }] },
        { agent: 'claude', installed: false, models: [] },
        { agent: 'opencode', installed: true, models: [{ id: 'opencode-model' }] },
        { agent: 'pi', installed: false, models: [] },
        { agent: 'blip', installed: false, models: [] },
      ],
    });
  });

  test('passes an explicit provider to native model discovery', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const providers: Array<string | undefined> = [];
    const router = new HubRouter(
      (_response, status, body) => responses.push({ status, body }),
      async () => ({}),
    );
    registerAgentModelCatalogRoutes(router, {
      normalizeBuiltinAgentId: () => null,
      nativeModelCatalog: async (provider?: string) => {
        providers.push(provider);
        return {
          provider,
          models: [{
            provider,
            id: 'gemini-model',
            reasoningLevels: ['high'],
            defaultReasoningLevel: 'high',
          }],
        };
      },
      loadRegistry: async () => ({ drones: {} }),
      droneRuntime: () => 'container',
      hostAgentInstalled: async () => false,
      discoverModels: async () => ({ models: [] }),
    });

    await router.handle(
      { method: 'GET' } as any,
      {} as any,
      new URL('http://hub.test/api/model-catalog?agent=native&provider=gemini'),
    );

    expect(providers).toEqual(['gemini']);
    expect(responses[0]).toMatchObject({
      status: 200,
      body: {
        ok: true,
        agent: 'native',
        provider: 'gemini',
        models: [{ id: 'gemini-model', reasoningLevels: ['high'] }],
      },
    });
  });

  test('uses another shared container when the first catalog probe fails', async () => {
    const responses: Array<{ status: number; body: any }> = [];
    const calls: Array<{ containerName: string; forceRefresh: boolean }> = [];
    const router = new HubRouter(
      (_response, status, body) => responses.push({ status, body }),
      async () => ({}),
    );
    registerAgentModelCatalogRoutes(router, {
      normalizeBuiltinAgentId: (value: string) => value === 'codex' ? 'codex' : null,
      nativeModelCatalog: async () => ({ models: [] }),
      loadRegistry: async () => ({
        drones: {
          'drone-a': { runtime: 'container', containerName: 'container-a' },
          'drone-b': { runtime: 'container', containerName: 'container-b' },
        },
      }),
      droneRuntime: (drone: any) => drone.runtime,
      hostAgentInstalled: async () => false,
      discoverModels: async (request: any) => {
        calls.push({
          containerName: request.containerName,
          forceRefresh: request.forceRefresh,
        });
        return request.containerName === 'container-a'
          ? {
              models: [],
              source: 'none',
              discoveredAt: '2026-01-01T00:00:00.000Z',
              error: 'container unavailable',
            }
          : {
              models: [{ id: 'gpt-shared', label: 'GPT Shared' }],
              source: 'live',
              discoveredAt: '2026-01-01T00:00:01.000Z',
            };
      },
    });

    await router.handle(
      { method: 'GET' } as any,
      {} as any,
      new URL('http://hub.test/api/model-catalog?agent=codex&runtime=container'),
    );

    expect(calls).toEqual([
      { containerName: 'container-a', forceRefresh: false },
      { containerName: 'container-b', forceRefresh: true },
    ]);
    expect(responses).toEqual([{
      status: 200,
      body: {
        ok: true,
        agent: 'codex',
        runtime: 'container',
        models: [{ id: 'gpt-shared', label: 'GPT Shared' }],
        source: 'live',
        discoveredAt: '2026-01-01T00:00:01.000Z',
      },
    }]);
  });
});
