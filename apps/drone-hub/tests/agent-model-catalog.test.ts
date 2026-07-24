import { describe, expect, test } from 'bun:test';
import {
  buildDetectedModelMenuEntries,
  normalizeAgentModelCatalog,
} from '../src/droneHub/app/use-agent-model-catalog';

describe('agent model catalog', () => {
  test('retains detected labels and model-specific reasoning levels', () => {
    const models = normalizeAgentModelCatalog({
      models: [{
        id: 'gpt-5.2-codex',
        label: 'GPT-5.2 Codex',
        reasoningLevels: ['low', 'medium', 'high', 'high'],
        defaultReasoningLevel: 'medium',
      }],
    });

    expect(models).toEqual([{
      id: 'gpt-5.2-codex',
      label: 'GPT-5.2 Codex',
      reasoningLevels: ['low', 'medium', 'high'],
      defaultReasoningLevel: 'medium',
    }]);
    expect(buildDetectedModelMenuEntries(models, 'custom-model')).toMatchObject([
      { value: '', label: 'Auto' },
      { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      { value: 'custom-model', label: 'custom-model (custom)' },
    ]);
  });

  test('retains a reported default when supported reasoning levels are omitted', () => {
    expect(
      normalizeAgentModelCatalog({
        models: [{
          id: 'gpt-default-only',
          defaultReasoningLevel: 'high',
        }],
      }),
    ).toEqual([{
      id: 'gpt-default-only',
      label: 'gpt-default-only',
      reasoningLevels: ['high'],
      defaultReasoningLevel: 'high',
    }]);
  });
});
