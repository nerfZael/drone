import { expect, test } from 'bun:test';
import {
  companionLiveSessionInstructions,
  COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS,
  DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
  DEFAULT_COMPANION_JEV_SYSTEM_PROMPT,
  PREVIOUS_COMPANION_JEV_SYSTEM_PROMPTS,
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

    expect(await readCompanionLiveSettings()).toEqual({ jevDecisionIntervalMs: 250, mode: 'live', autonomy: 'off', brain: false, jevSystemPrompt: DEFAULT_COMPANION_JEV_SYSTEM_PROMPT,
      enabled: true,
      systemPrompt: DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
    });
    await writeCompanionLiveSettings({ systemPrompt: 'Speak like a patient teacher.' });
    await writeCompanionLiveSettings({ enabled: false });
    resetHubSettingsRepositoryForTests();

    expect(await readCompanionLiveSettings()).toEqual({ jevDecisionIntervalMs: 250, mode: 'live', autonomy: 'off', brain: false, jevSystemPrompt: DEFAULT_COMPANION_JEV_SYSTEM_PROMPT, enabled: false, systemPrompt: 'Speak like a patient teacher.' });
    expect((await getHubSettingsRepository()).get('companion')?.value).toEqual(backend);
    await Promise.all([
      writeCompanionLiveSettings({ enabled: true }),
      writeCompanionLiveSettings({ systemPrompt: 'Speak with a measured pace.' }),
    ]);
    expect(await readCompanionLiveSettings()).toEqual({ jevDecisionIntervalMs: 250, mode: 'live', autonomy: 'off', brain: false, jevSystemPrompt: DEFAULT_COMPANION_JEV_SYSTEM_PROMPT, enabled: true, systemPrompt: 'Speak with a measured pace.' });
    await expect(writeCompanionLiveSettings({ enabled: 'false' })).rejects.toThrow('boolean');
    await expect(writeCompanionLiveSettings({
      systemPrompt: 'x'.repeat(COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS + 1),
    })).rejects.toThrow('cannot exceed');
    await writeCompanionLiveSettings({ systemPrompt: '' });
    resetHubSettingsRepositoryForTests();
    expect(await readCompanionLiveSettings()).toEqual({ jevDecisionIntervalMs: 250, mode: 'live', autonomy: 'off', brain: false, jevSystemPrompt: DEFAULT_COMPANION_JEV_SYSTEM_PROMPT, enabled: true, systemPrompt: '' });
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


test('Jev decision interval validates bounds, persists, and preserves other voice settings', async () => {
  await withTempDroneDataDir('jev-interval-', async () => {
    expect((await readCompanionLiveSettings()).jevDecisionIntervalMs).toBe(250);
    await writeCompanionLiveSettings({ enabled: true, mode: 'jev', jevSystemPrompt: 'Wait for a clear request.' });
    await writeCompanionLiveSettings({ jevDecisionIntervalMs: 750 });
    resetHubSettingsRepositoryForTests();
    expect(await readCompanionLiveSettings()).toMatchObject({ jevDecisionIntervalMs: 750, enabled: true, mode: 'jev', jevSystemPrompt: 'Wait for a clear request.' });
    for (const value of [0, 49, 10001, 250.5, '250', null]) {
      await expect(writeCompanionLiveSettings({ jevDecisionIntervalMs: value })).rejects.toThrow('interval');
    }
    await writeCompanionLiveSettings({ jevDecisionIntervalMs: 50 });
    await writeCompanionLiveSettings({ jevDecisionIntervalMs: 10000 });
    expect((await readCompanionLiveSettings()).jevDecisionIntervalMs).toBe(10000);
  });
});

test('a saved copy of an earlier default Jev prompt follows the current default; customized text is kept', async () => {
  await withTempDroneDataDir('jev-prompt-migration-', async () => {
    await writeCompanionLiveSettings({ jevSystemPrompt: PREVIOUS_COMPANION_JEV_SYSTEM_PROMPTS[1] });
    expect((await readCompanionLiveSettings()).jevSystemPrompt).toBe(DEFAULT_COMPANION_JEV_SYSTEM_PROMPT);
    await writeCompanionLiveSettings({ jevSystemPrompt: 'Send only explicit requests.' });
    expect((await readCompanionLiveSettings()).jevSystemPrompt).toBe('Send only explicit requests.');
  });
});
