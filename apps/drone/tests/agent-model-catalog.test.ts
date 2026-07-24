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
      },
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
      },
      {
        id: 'gpt-legacy',
        label: 'GPT Legacy',
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
      async readHostFile() {
        throw new Error('not found');
      },
      hostHomeDirectory: () => '/tmp',
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
    };
    const service = new AgentModelCatalogService(runtime);
    const request = {
      agentId: 'codex' as const,
      target: {
        runtime: 'container' as const,
        installationKey: 'shared:container',
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
      async readHostFile() {
        throw new Error('not found');
      },
      hostHomeDirectory: () => '/tmp',
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
      now: () => now,
    };
    const service = new AgentModelCatalogService(runtime);
    const request = {
      agentId: 'pi' as const,
      target: {
        runtime: 'container' as const,
        installationKey: 'shared:container',
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
      async readHostFile() {
        throw new Error('not found');
      },
      hostHomeDirectory: () => '/tmp',
      hostModelListCommand: () => null,
      timeoutMs: () => 1_000,
    };
    const service = new AgentModelCatalogService(runtime);
    const result = await service.get({
      agentId: 'pi',
      target: {
        runtime: 'container',
        installationKey: 'shared:container',
        containerName: 'drone-a',
      },
    });

    expect(result.models).toEqual([]);
    expect(result.error).toContain('No models discovered');
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
