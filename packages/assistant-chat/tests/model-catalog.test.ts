import { describe, expect, test } from 'bun:test';
import {
  buildModelCatalogChoices,
  formatModelDisplayLabel,
  formatReasoningLabel,
  groupProviderModelOptions,
  normalizeExternalModelCatalog,
  normalizeProviderModelCatalog,
  resolveModelCatalogSelection,
  selectModelCatalogModel,
} from '../src';

describe('model catalog', () => {
  test('normalizes agent-scoped entries without inventing provider identity', () => {
    expect(
      normalizeExternalModelCatalog(
        {
          models: [
            {
              id: 'gpt-5.2-codex',
              label: 'gpt-5.2-codex',
              current: true,
              reasoning_levels: ['LOW', 'high', 'high', 'not valid'],
              default_reasoning_level: 'medium',
            },
            { id: 'gpt-5.2-codex', label: 'duplicate' },
          ],
        },
        { formatLabels: true },
      ),
    ).toEqual([
      {
        id: 'gpt-5.2-codex',
        label: 'GPT-5.2 Codex',
        isCurrent: true,
        reasoningLevels: ['low', 'high', 'medium'],
        defaultReasoningLevel: 'medium',
      },
    ]);
  });

  test('uses provider and model together when provider identity is available', () => {
    expect(
      normalizeProviderModelCatalog(
        {
          models: [
            { provider: 'codex', id: 'shared', label: 'Codex Shared' },
            { provider: 'codex', id: 'shared', label: 'duplicate' },
            { provider: 'openai', id: 'shared', label: 'OpenAI Shared' },
            { id: 'fallback', name: 'Fallback', thinkingLevel: 'High' },
          ],
        },
        'external',
      ),
    ).toEqual([
      {
        provider: 'codex',
        id: 'shared',
        label: 'Codex Shared',
        reasoningLevels: [],
        defaultReasoningLevel: '',
      },
      {
        provider: 'openai',
        id: 'shared',
        label: 'OpenAI Shared',
        reasoningLevels: [],
        defaultReasoningLevel: '',
      },
      {
        provider: 'external',
        id: 'fallback',
        label: 'Fallback',
        reasoningLevels: ['high'],
        defaultReasoningLevel: 'high',
      },
    ]);
  });

  test('keeps provider identities distinct even when identifiers contain separators', () => {
    expect(
      normalizeProviderModelCatalog({
        models: [
          { provider: 'one\u0000two', id: 'three', label: 'First' },
          { provider: 'one', id: 'two\u0000three', label: 'Second' },
        ],
      }),
    ).toHaveLength(2);
  });

  test('groups native runtime variants and honors only a supported configured default', () => {
    const models = [
      { provider: 'openai', id: 'reasoning', name: 'Reasoning', thinkingLevel: 'off' },
      { provider: 'openai', id: 'reasoning', name: 'Reasoning', thinkingLevel: 'high' },
      { provider: 'codex', id: 'reasoning', name: 'Codex Reasoning', thinkingLevel: 'medium' },
    ];

    expect(
      groupProviderModelOptions(
        models,
        { provider: 'openai', model: 'reasoning', thinkingLevel: 'high' },
        'openai',
      ),
    ).toEqual([
      {
        provider: 'openai',
        id: 'reasoning',
        label: 'Reasoning',
        reasoningLevels: ['off', 'high'],
        defaultReasoningLevel: 'high',
      },
    ]);
  });

  test('builds choices and keeps every reasoning selection valid for its model', () => {
    const models = normalizeProviderModelCatalog({
      models: [
        {
          provider: 'codex',
          id: 'reasoning',
          label: 'Reasoning',
          reasoningLevels: ['low', 'high'],
          defaultReasoningLevel: 'high',
        },
        { provider: 'codex', id: 'fixed', label: 'Fixed' },
      ],
    });

    expect(buildModelCatalogChoices(models)).toEqual([
      { provider: 'codex', id: 'reasoning', name: 'Reasoning', thinkingLevel: 'low' },
      { provider: 'codex', id: 'reasoning', name: 'Reasoning', thinkingLevel: 'high' },
      { provider: 'codex', id: 'fixed', name: 'Fixed' },
    ]);
    expect(resolveModelCatalogSelection(models, 'reasoning', 'unsupported')).toEqual({
      modelId: 'reasoning',
      reasoningLevel: 'high',
    });
    expect(selectModelCatalogModel(models, 'fixed', 'high')).toEqual({
      modelId: 'fixed',
      reasoningLevel: '',
    });
  });

  test('sanitizes legacy choice inputs and repairs invalid selection defaults', () => {
    expect(
      buildModelCatalogChoices(
        [
          {
            provider: ' codex ',
            id: ' reasoning ',
            label: '',
            reasoningLevels: ['HIGH', 'high', 'not valid'],
          },
          { provider: 'codex', id: '' },
        ],
      ),
    ).toEqual([
      {
        provider: 'codex',
        id: 'reasoning',
        name: 'reasoning',
        thinkingLevel: 'high',
      },
    ]);
    expect(
      resolveModelCatalogSelection(
        [
          {
            id: 'reasoning',
            label: 'Reasoning',
            reasoningLevels: ['low', 'high'],
            defaultReasoningLevel: 'unsupported',
          },
        ],
        'reasoning',
        'also-unsupported',
      ),
    ).toEqual({ modelId: 'reasoning', reasoningLevel: 'low' });
  });

  test('formats model and reasoning labels without platform dependencies', () => {
    expect(formatModelDisplayLabel('gpt-5.6-sol (custom)')).toBe('GPT-5.6 Sol');
    expect(formatReasoningLabel('XHIGH')).toBe('X-high');
  });
});
