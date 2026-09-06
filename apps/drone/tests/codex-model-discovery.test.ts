import { describe, expect, test } from 'bun:test';
import { discoverCodexModels } from '../src/hub/agent-model-catalog/codex-discovery';
import { AgentModelCatalogService } from '../src/hub/agent-model-catalog/service';
import { saveCodexCatalog } from '../src/hub/codex-model-catalog';
import { HubAssistantService } from '../src/hub/assistant';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { withTempDroneDataDir } from './test-helpers';

const model = { id: 'future-codex-model', label: 'Future Codex', reasoningLevels: ['low', 'xhigh'], defaultReasoningLevel: 'low' };

describe('Codex discovery', () => {
  test('reads every page and closes the connection without starting a turn', async () => {
    let calls = 0;
    let stopped = false;
    const models = await discoverCodexModels({
      async call(method, params) {
        expect(method).toBe('model/list');
        expect(params.includeHidden).toBe(false);
        calls++;
        if (calls === 1) return { data: [{ id: 'first', displayName: 'First' }], nextCursor: 'next' };
        expect(params.cursor).toBe('next');
        return { data: [{ id: model.id, displayName: model.label, supportedReasoningEfforts: [{ reasoningEffort: 'xhigh' }], defaultReasoningEffort: 'xhigh' }], nextCursor: null };
      },
      stop() { stopped = true; },
    });
    expect(models.map((entry) => entry.id)).toEqual(['first', model.id]);
    expect(models[1].reasoningLevels).toEqual(['xhigh']);
    expect(stopped).toBe(true);
  });

  test('forced refresh bypasses the file cache and reports cached fallback on failure', async () => {
    let fails = false;
    let discoveries = 0;
    const service = new AgentModelCatalogService({
      async discoverCodexModels() { discoveries++; if (fails) throw new Error('offline'); return [model]; },
      async runHost() { return { code: 0, stdout: JSON.stringify({ fetched_at: '2020-01-01T00:00:00Z', models: [{ slug: 'old' }] }) }; },
      async runContainer() { throw new Error('unexpected container call'); },
      hostModelListCommand: () => null, timeoutMs: () => 1000,
    });
    const request = { agentId: 'codex' as const, target: { runtime: 'host' as const }, forceRefresh: true };
    expect((await service.get(request)).models[0].id).toBe(model.id);
    fails = true;
    const result = await service.get(request);
    expect(discoveries).toBe(2);
    expect(result).toMatchObject({ source: 'cache', stale: true, error: 'offline' });
    expect(result.models[0].id).toBe(model.id);
    expect((await service.get({ ...request, forceRefresh: false })).models[0].id).toBe(model.id);
  });

  test('saved discovered models validate and initialize the built-in runtime after reload', async () => {
    await withTempDroneDataDir('codex-model-discovery-', async () => {
      await saveCodexCatalog([model]);
      const service = new HubAssistantService({ listDrones: async () => [] });
      await service.updateDefaultModel({ provider: 'codex', model: model.id, thinkingLevel: 'xhigh' });
      const reloaded = new HubAssistantService({ listDrones: async () => [] });
      expect((await reloaded.defaultSettings()).defaultModel.model).toBe(model.id);
      const host = new BlipAssistantHost(async () => ({ provider: 'codex', model: model.id, thinkingLevel: 'xhigh', systemPrompt: 'Test', tools: [] }));
      try { await host.prepareThread('new-codex-model'); expect(host.hasThreadHandle('new-codex-model')).toBe(true); }
      finally { await host.close(); }
    });
  });
});
