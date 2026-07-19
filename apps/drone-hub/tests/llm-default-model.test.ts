import { describe, expect, test } from 'bun:test';
import {
  llmDefaultModelChoices,
  resolveLlmDefaultModelDraft,
  selectLlmDefaultModel,
} from '../src/droneHub/app/llm-default-model';

const models = [
  {
    provider: 'openai',
    id: 'gpt-primary',
    name: 'GPT Primary',
    reasoning: false,
    thinkingLevel: 'off',
  },
  {
    provider: 'openai',
    id: 'gpt-primary',
    name: 'GPT Primary',
    reasoning: true,
    thinkingLevel: 'high',
  },
  {
    provider: 'openai',
    id: 'gpt-fast',
    name: 'GPT Fast',
    reasoning: true,
    thinkingLevel: 'low',
  },
  {
    provider: 'codex',
    id: 'codex-primary',
    name: 'Codex Primary',
    reasoning: true,
    thinkingLevel: 'medium',
  },
] as any[];

describe('LLM default model picker', () => {
  test('groups reasoning levels and filters models to the selected provider', () => {
    expect(llmDefaultModelChoices(models, 'openai')).toEqual([
      {
        id: 'gpt-primary',
        label: 'GPT Primary',
        reasoningLevels: ['off', 'high'],
      },
      { id: 'gpt-fast', label: 'GPT Fast', reasoningLevels: ['low'] },
    ]);
  });

  test('uses the configured model only when it belongs to the active provider', () => {
    expect(
      resolveLlmDefaultModelDraft(models, 'openai', {
        provider: 'openai',
        model: 'gpt-primary',
        thinkingLevel: 'high',
      }),
    ).toEqual({ provider: 'openai', model: 'gpt-primary', thinkingLevel: 'high' });

    expect(
      resolveLlmDefaultModelDraft(models, 'codex', {
        provider: 'openai',
        model: 'gpt-primary',
        thinkingLevel: 'high',
      }),
    ).toEqual({ provider: 'codex', model: 'codex-primary', thinkingLevel: 'medium' });
  });

  test('normalizes reasoning when the selected model does not support the previous level', () => {
    expect(
      selectLlmDefaultModel(
        models,
        { provider: 'openai', model: 'gpt-primary', thinkingLevel: 'high' },
        'gpt-fast',
      ),
    ).toEqual({ provider: 'openai', model: 'gpt-fast', thinkingLevel: 'low' });
  });
});
