import { describe, expect, test } from 'bun:test';

import {
  resolveEffectiveVoiceInputSettings,
  resolveVoiceInputSettingsResponse,
  upsertStoredVoiceInputSettings,
} from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

describe('voice input settings', () => {
  test('uses patient continuous-voice defaults and persists valid overrides', async () => {
    await withTempDroneDataDir('drone-voice-input-settings-', async () => {
      expect(await resolveEffectiveVoiceInputSettings()).toEqual({
        endThoughtPreset: 'balanced',
        customSilenceMillis: 2_500,
        noiseHandling: 'auto',
        language: null,
        quality: 'fast',
        confirmationFeedback: false,
      });
      await upsertStoredVoiceInputSettings({
        endThoughtPreset: 'custom',
        customSilenceMillis: 250,
        noiseHandling: 'noisy',
        language: 'hr-HR',
        quality: 'accurate',
        confirmationFeedback: true,
      });
      expect((await resolveVoiceInputSettingsResponse()).voiceInput).toEqual({
        endThoughtPreset: 'custom',
        customSilenceMillis: 250,
        silenceMillis: 250,
        noiseHandling: 'noisy',
        language: 'hr-HR',
        quality: 'accurate',
        confirmationFeedback: true,
      });
    });
  });

  test('rejects invalid endpoint settings', async () => {
    await withTempDroneDataDir('drone-voice-input-settings-invalid-', async () => {
      await expect(upsertStoredVoiceInputSettings({ customSilenceMillis: 249 })).rejects.toThrow(
        'between 250 and 10000',
      );
      await expect(upsertStoredVoiceInputSettings({ language: 'not a language tag' })).rejects.toThrow(
        'valid language tag',
      );
    });
  });

  test('clears a stored language when Auto, an empty value, or null is selected', async () => {
    await withTempDroneDataDir('drone-voice-input-settings-language-', async () => {
      await upsertStoredVoiceInputSettings({ language: 'hr-HR' });
      await upsertStoredVoiceInputSettings({ language: '' });
      expect((await resolveEffectiveVoiceInputSettings()).language).toBeNull();

      await upsertStoredVoiceInputSettings({ language: 'de-DE' });
      await upsertStoredVoiceInputSettings({ language: 'auto' });
      expect((await resolveEffectiveVoiceInputSettings()).language).toBeNull();

      await upsertStoredVoiceInputSettings({ language: 'fr-FR' });
      await upsertStoredVoiceInputSettings({ language: null });
      expect((await resolveEffectiveVoiceInputSettings()).language).toBeNull();
    });
  });
});
