import { describe, expect, test } from 'bun:test';
import {
  buildDetectedModelMenuEntries,
  cacheAgentModelCatalog,
  normalizeAgentModelCatalog,
} from '../src/droneHub/app/use-agent-model-catalog';

describe('agent model catalog', () => {
  test('retains detected labels and model-specific reasoning levels', () => {
    const models = normalizeAgentModelCatalog({
      models: [{
        id: 'gpt-5.2-codex',
        label: 'gpt-5.2-codex',
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
      { value: 'custom-model', label: 'custom-model' },
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
      label: 'GPT DEFAULT Only',
      reasoningLevels: ['high'],
      defaultReasoningLevel: 'high',
    }]);
  });

  test('caches one catalog per agent without a runtime namespace', () => {
    const storage = new Map<string, string>();
    const previousLocalStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      get length() {
        return storage.size;
      },
      key(index: number) {
        return Array.from(storage.keys())[index] ?? null;
      },
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
    };
    try {
      cacheAgentModelCatalog('codex', {
        models: [{ id: 'gpt-shared', label: 'GPT Shared' }],
      });

      const cached = JSON.parse(Array.from(storage.values())[0] ?? '{}');
      expect(Object.keys(cached)).toEqual(['codex']);
      expect(cached.codex[0]?.id).toBe('gpt-shared');
    } finally {
      if (previousLocalStorage === undefined) delete (globalThis as any).localStorage;
      else (globalThis as any).localStorage = previousLocalStorage;
    }
  });
});
