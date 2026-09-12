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
  });
});

test('Live instructions keep editable guidance separate from the required Hub contract', () => {
  const instructions = companionLiveSessionInstructions('Sound curious and upbeat.');
  expect(instructions).toContain('User-configurable voice guidance');
  expect(instructions).toContain('Sound curious and upbeat.');
  expect(instructions).toContain('Required Drone Hub contract (takes precedence');
  expect(instructions).toContain('Delegation policy:');
  expect(instructions).toContain('Never invent results');
  expect(instructions).not.toContain(DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT);
});
