import { describe, expect, test } from 'bun:test';
import {
  buildDetectedModelMenuEntries,
  normalizeSpawnModelCatalog,
} from '../src/droneHub/app/use-spawn-model-catalog';

describe('spawn model catalog', () => {
  test('retains detected labels and model-specific reasoning levels', () => {
    const models = normalizeSpawnModelCatalog({
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
      { value: '', label: 'Default model' },
      { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      { value: 'custom-model', label: 'custom-model (custom)' },
    ]);
  });
});
