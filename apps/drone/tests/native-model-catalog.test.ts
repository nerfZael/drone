import { describe, expect, test } from 'bun:test';
import { buildNativeModelCatalog } from '../src/hub/assistant/native-model-catalog';

describe('native model catalog', () => {
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
