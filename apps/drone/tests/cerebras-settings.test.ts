import { expect, test } from 'bun:test';
import { withTempDroneDataDir } from './test-helpers';
import { resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
import { clearStoredProviderApiKey, resolveEffectiveProviderApiKeySettings, resolveBlipProviderApiKey, upsertStoredProviderApiKey } from '../src/hub/hub-settings';
import { DEFAULT_COMPANION_SETTINGS, normalizeCompanionSettings } from '../src/hub/companion/companion-config';
import { resolveNativeModel } from '../src/hub/assistant/resolve-native-model';

test('Cerebras credentials prefer settings and fall back to their own environment key', async () => {
  const previous = process.env.CEREBRAS_API_KEY;
  try {
    process.env.CEREBRAS_API_KEY = 'test-cerebras-environment';
    await withTempDroneDataDir('cerebras-settings-', async () => {
      resetHubSettingsRepositoryForTests();
      expect(await resolveBlipProviderApiKey('cerebras')).toBe('test-cerebras-environment');
      await upsertStoredProviderApiKey('cerebras', 'test-cerebras-saved');
      expect(await resolveEffectiveProviderApiKeySettings('cerebras')).toMatchObject({ apiKey: 'test-cerebras-saved', source: 'settings' });
      await clearStoredProviderApiKey('cerebras');
      expect(await resolveBlipProviderApiKey('cerebras')).toBe('test-cerebras-environment');
      delete process.env.CEREBRAS_API_KEY;
      expect(await resolveBlipProviderApiKey('cerebras')).toBeUndefined();
    });
  } finally {
    if (previous === undefined) delete process.env.CEREBRAS_API_KEY;
    else process.env.CEREBRAS_API_KEY = previous;
    resetHubSettingsRepositoryForTests();
  }
});

test('Companion accepts supported Qwen levels and resolves its actual transport', async () => {
  for (const thinkingLevel of ['off', 'low', 'medium', 'high']) {
    expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, provider: 'cerebras', model: 'qwen-3.8-27b', thinkingLevel })).toMatchObject({ provider: 'cerebras', thinkingLevel });
  }
  expect(() => normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, provider: 'cerebras', model: 'qwen-3.8-27b', thinkingLevel: 'xhigh' })).toThrow();
  expect(await resolveNativeModel('cerebras', 'qwen-3.8-27b', true)).toMatchObject({ provider: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', contextWindow: 131072, maxTokens: 40960 });
});
