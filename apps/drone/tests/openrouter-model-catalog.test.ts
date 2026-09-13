import { describe, expect, test } from 'bun:test';
import { parseOpenRouterModels, refreshOpenRouterCatalog, loadOpenRouterCatalog, cachedOpenRouterModel } from '../src/hub/openrouter-model-catalog';
import { HubAssistantService } from '../src/hub/assistant';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { withTempDroneDataDir } from './test-helpers';

const entry = {
  id: 'example/new-model', name: 'New model', context_length: 128000,
  supported_parameters: ['tools', 'reasoning'],
  architecture: { input_modalities: ['text', 'image'] },
  top_provider: { max_completion_tokens: 8192 },
  pricing: { prompt: '0.000001', completion: '0.000002' },
};
const glmFlash = {
  ...entry,
  id: 'z-ai/glm-5.3-flash',
  name: 'Z.ai: GLM 5.3 Flash',
  reasoning: {
    mandatory: true,
    default_enabled: true,
    supported_efforts: ['max', 'high', 'low'],
    default_effort: 'max',
  },
};
const fetchCatalog = (data: unknown) => (async () => Response.json(data)) as typeof fetch;

describe('OpenRouter model discovery', () => {
  test('uses published capabilities and excludes models without tool support', () => {
    const models = parseOpenRouterModels({ data: [entry, { ...entry, id: 'text-only', supported_parameters: [] }] });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: entry.id, contextWindow: 128000, maxTokens: 8192,
      reasoning: true, input: ['text', 'image'], cost: { input: 1, output: 2 } });
    expect(() => parseOpenRouterModels({ data: [] })).toThrow('no usable');
    expect(() => parseOpenRouterModels({ error: 'bad request' })).toThrow('Invalid');
  });

  test('uses OpenRouter reasoning efforts, mandatory state, and default', async () => {
    const [model] = parseOpenRouterModels({ data: [glmFlash] });
    expect(model).toMatchObject({
      reasoningLevels: ['xhigh', 'high', 'low'],
      defaultReasoningLevel: 'xhigh',
      thinkingLevelMap: { off: null, minimal: null, medium: null, xhigh: 'max' },
    });

    await withTempDroneDataDir('openrouter-reasoning-', async () => {
      await refreshOpenRouterCatalog(fetchCatalog({ data: [glmFlash] }));
      const service = new HubAssistantService({ listDrones: async () => [] });
      const catalogModel = (await service.defaultSettings()).models.find(
        (candidate) => candidate.id === glmFlash.id,
      );
      expect(catalogModel).toMatchObject({
        reasoningLevels: ['xhigh', 'high', 'low'],
        defaultReasoningLevel: 'xhigh',
      });
    });
  });

  test('new models validate and survive reload; a failed refresh preserves the catalog', async () => {
    await withTempDroneDataDir('openrouter-catalog-', async () => {
      await refreshOpenRouterCatalog(fetchCatalog({ data: [entry] }));
      const service = new HubAssistantService({ listDrones: async () => [] });
      await service.updateDefaultModel({ provider: 'openrouter', model: entry.id, thinkingLevel: 'high' });
      const reloaded = new HubAssistantService({ listDrones: async () => [] });
      expect((await reloaded.defaultSettings()).defaultModel).toEqual({ provider: 'openrouter', model: entry.id, thinkingLevel: 'high' });
      expect(cachedOpenRouterModel('openrouter', entry.id)?.contextWindow).toBe(128000);
      const host = new BlipAssistantHost(async () => ({
        provider: 'openrouter', model: entry.id, thinkingLevel: 'high', systemPrompt: 'Test', tools: [],
      }));
      try {
        await host.prepareThread('discovered-model-thread');
        expect(host.hasThreadHandle('discovered-model-thread')).toBe(true);
      } finally {
        await host.close();
      }
      await expect(refreshOpenRouterCatalog(fetchCatalog({ data: [] }))).rejects.toThrow();
      await expect(refreshOpenRouterCatalog((async () => new Response('unavailable', { status: 503 })) as typeof fetch)).rejects.toThrow('503');
      expect((await loadOpenRouterCatalog()).count).toBe(1);
      expect((await reloaded.defaultSettings()).models.some((model) => model.id === entry.id)).toBe(true);
    });
  });
});
