import { expect, test } from 'bun:test';
import {
  companionLiveSessionInstructions,
  COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS,
  DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
  readCompanionLiveSettings,
  writeCompanionLiveSettings,
} from '../src/hub/companion/companion-live-settings';
import { getHubSettingsRepository, resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
import { withTempDroneDataDir } from './test-helpers';

test('Live prompt migrates legacy settings and partial writes preserve independent fields', async () => {
  await withTempDroneDataDir('companion-live-settings-', async () => {
    const repository = await getHubSettingsRepository();
    const backend = { provider: 'gemini', model: 'chosen-model', thinkingLevel: 'medium' };
    await repository.put('companion', backend);
    await repository.put('companion-live-voice', { enabled: true });

    expect(await readCompanionLiveSettings()).toEqual({
      enabled: true,
      systemPrompt: DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
    });
    await writeCompanionLiveSettings({ systemPrompt: 'Speak like a patient teacher.' });
    await writeCompanionLiveSettings({ enabled: false });
    resetHubSettingsRepositoryForTests();

    expect(await readCompanionLiveSettings()).toEqual({ enabled: false, systemPrompt: 'Speak like a patient teacher.' });
    expect((await getHubSettingsRepository()).get('companion')?.value).toEqual(backend);
    await Promise.all([
      writeCompanionLiveSettings({ enabled: true }),
      writeCompanionLiveSettings({ systemPrompt: 'Speak with a measured pace.' }),
    ]);
    expect(await readCompanionLiveSettings()).toEqual({ enabled: true, systemPrompt: 'Speak with a measured pace.' });
    await expect(writeCompanionLiveSettings({ enabled: 'false' })).rejects.toThrow('boolean');
    await expect(writeCompanionLiveSettings({
      systemPrompt: 'x'.repeat(COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS + 1),
    })).rejects.toThrow('cannot exceed');
    await writeCompanionLiveSettings({ systemPrompt: '' });
    resetHubSettingsRepositoryForTests();
    expect(await readCompanionLiveSettings()).toEqual({ enabled: true, systemPrompt: '' });
  });
});

test('Live sends custom and empty prompts verbatim; only an absent prompt uses the complete default', () => {
  for (const prompt of ['Sound curious and upbeat.', '', '  Keep my formatting.\n\n']) {
    expect(companionLiveSessionInstructions(prompt)).toBe(prompt);
  }
  expect(companionLiveSessionInstructions()).toBe(DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT);
  expect(DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT).toContain('Backchannel policy:');
  expect(DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT).toContain('Delegation policy:');
  expect(DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT).toContain('Interruption policy:');
});
