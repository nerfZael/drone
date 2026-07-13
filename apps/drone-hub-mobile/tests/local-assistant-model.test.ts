import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LOCAL_ASSISTANT_MODEL,
  localAssistantModelOptions,
  migrateLocalAssistantModel,
  normalizeLocalAssistantThinkingLevel,
} from '../src/local-assistant/local-assistant-model';

describe('phone assistant model migration', () => {
  test('uses Sol only when no saved model exists', () => {
    expect(migrateLocalAssistantModel('')).toBe(DEFAULT_LOCAL_ASSISTANT_MODEL);
  });

  test('keeps explicitly selected models including Luna', () => {
    expect(migrateLocalAssistantModel('gpt-5.6-terra')).toBe('gpt-5.6-terra');
    expect(migrateLocalAssistantModel('gpt-5.6-luna')).toBe('gpt-5.6-luna');
  });

  test('offers supported alternatives for both phone providers', () => {
    expect(localAssistantModelOptions('codex')).toEqual([
      { provider: 'codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { provider: 'codex', id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      { provider: 'codex', id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
      { provider: 'codex', id: 'gpt-5.5', name: 'GPT-5.5' },
    ]);
    expect(
      localAssistantModelOptions('openai').every((option) => option.provider === 'openai'),
    ).toBe(true);
  });

  test('normalizes saved phone reasoning levels', () => {
    expect(normalizeLocalAssistantThinkingLevel('off')).toBe('off');
    expect(normalizeLocalAssistantThinkingLevel('medium')).toBe('medium');
    expect(normalizeLocalAssistantThinkingLevel('high')).toBe('high');
    expect(normalizeLocalAssistantThinkingLevel('unexpected')).toBe('low');
  });
});
