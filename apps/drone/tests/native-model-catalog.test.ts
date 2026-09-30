import { describe, expect, test } from 'bun:test';
import { loadCodexCatalog, saveCodexCatalog } from '../src/hub/codex-model-catalog';
import { resolveNativeModel } from '../src/hub/assistant/resolve-native-model';
import { DEFAULT_COMPANION_SETTINGS, normalizeCompanionSettings } from '../src/hub/companion/companion-config';
import { getHubSettingsRepository, resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
import { withTempDroneDataDir } from './test-helpers';
import { HUB_AGENT_MODEL_OPTIONS } from '../src/hub/llm-model-catalog';
import { buildNativeModelCatalog } from '../src/hub/assistant/native-model-catalog';

describe('native model catalog', () => {
  test('offers GPT-6 models for OpenAI and Codex native agents', () => {
    const catalog = buildNativeModelCatalog(HUB_AGENT_MODEL_OPTIONS);
    for (const provider of ['openai', 'codex']) {
      for (const id of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']) {
        expect(catalog.find((model) => model.provider === provider && model.id === id))
          .toMatchObject({
            reasoningLevels: provider === 'openai' && id !== 'gpt-6.1-sol' ? ['off', 'low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high', 'xhigh'],
            defaultReasoningLevel: 'medium',
          });
      }
    }
  });

  test('companion accepts GPT-6.1 Sol for both providers and rejects unsupported reasoning', async () => {
    for (const provider of ['openai', 'codex'] as const) {
      for (const thinkingLevel of ['low', 'medium', 'high', 'xhigh']) {
        expect(normalizeCompanionSettings({
          ...DEFAULT_COMPANION_SETTINGS, provider, model: 'gpt-6.1-sol', thinkingLevel,
        })).toMatchObject({ provider, model: 'gpt-6.1-sol', thinkingLevel });
      }
      for (const thinkingLevel of ['off', 'minimal']) {
        expect(() => normalizeCompanionSettings({
          ...DEFAULT_COMPANION_SETTINGS, provider, model: 'gpt-6.1-sol', thinkingLevel,
        })).toThrow('Companion model selection is not supported');
      }
      const model = await resolveNativeModel(provider, 'gpt-6.1-sol', true);
      expect(model.id).toBe('gpt-6.1-sol');
      expect(model.contextWindow).toBe(provider === 'openai' ? 1050000 : 272000);
    }
  });

  test('GPT-6 selections and defaults survive Codex discovery and resolve in the runtime', async () => {
    const original = [...HUB_AGENT_MODEL_OPTIONS];
    await withTempDroneDataDir('gpt6-catalog-', async () => {
      resetHubSettingsRepositoryForTests();
      try {
        await saveCodexCatalog(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'].map((id) => ({
          id, label: id, reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          defaultReasoningLevel: 'medium',
        })));
        await loadCodexCatalog();
        const catalog = buildNativeModelCatalog(HUB_AGENT_MODEL_OPTIONS, undefined, 'codex');
        for (const id of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']) {
          const selected = catalog.find((model) => model.id === id)!;
          expect(selected.defaultReasoningLevel).toBe('medium');
          expect(selected.reasoningLevels).toEqual(['low', 'medium', 'high', 'xhigh']);
          for (const thinkingLevel of selected.reasoningLevels) {
            expect(normalizeCompanionSettings({
              ...DEFAULT_COMPANION_SETTINGS, provider: 'codex', model: id, thinkingLevel,
            })).toMatchObject({ model: id, thinkingLevel });
          }
          const model = await resolveNativeModel('codex', id, true);
          expect(model.id).toBe(id);
          expect(model.contextWindow).toBe(272000);
        }
      } finally {
        await (await getHubSettingsRepository()).put('llm.codex-models', []);
        await loadCodexCatalog();
        HUB_AGENT_MODEL_OPTIONS.splice(0, HUB_AGENT_MODEL_OPTIONS.length, ...original);
        resetHubSettingsRepositoryForTests();
      }
    });
  });

  test('groups model variants without inventing unsupported reasoning levels', () => {
    const catalog = buildNativeModelCatalog(
      [
        { provider: 'openai', id: 'reasoning', name: 'Reasoning', thinkingLevel: 'off' },
        { provider: 'openai', id: 'reasoning', name: 'Reasoning', thinkingLevel: 'high' },
        { provider: 'gemini', id: 'fixed', name: 'Fixed', thinkingLevel: 'medium' },
      ],
      { provider: 'openai', model: 'reasoning', thinkingLevel: 'high' },
    );

    expect(catalog).toEqual([
      {
        provider: 'openai',
        id: 'reasoning',
        label: 'Reasoning',
        reasoningLevels: ['off', 'high'],
        defaultReasoningLevel: 'high',
      },
      {
        provider: 'gemini',
        id: 'fixed',
        label: 'Fixed',
        reasoningLevels: ['medium'],
        defaultReasoningLevel: 'medium',
      },
    ]);
  });

  test('filters the catalog to the provider selected in Hub settings', () => {
    const catalog = buildNativeModelCatalog(
      [
        { provider: 'openai', id: 'shared', name: 'Shared', thinkingLevel: 'low' },
        { provider: 'codex', id: 'shared', name: 'Shared', thinkingLevel: 'medium' },
        { provider: 'openrouter', id: 'openrouter/auto', name: 'OpenRouter Auto', thinkingLevel: 'high' },
        { provider: 'gemini', id: 'gemini-only', name: 'Gemini only', thinkingLevel: 'high' },
      ],
      { provider: 'openrouter', model: 'openrouter/auto', thinkingLevel: 'high' },
      'openrouter',
    );

    expect(catalog).toEqual([
      {
        provider: 'openrouter',
        id: 'openrouter/auto',
        label: 'OpenRouter Auto',
        reasoningLevels: ['high'],
        defaultReasoningLevel: 'high',
      },
    ]);
  });
});
