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
});
