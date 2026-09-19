import { describe, expect, test } from 'bun:test';

import {
  resolveEffectiveSpeechSettings,
  upsertStoredSpeechSettings,
} from '../src/hub/hub-settings';
import { getHubSettingsRepository } from '../src/host/hub-settings-repository';
import { withTempDroneDataDir } from './test-helpers';

describe('speech settings', () => {
  test('uses audible enabled defaults and persists valid overrides', async () => {
    await withTempDroneDataDir('drone-speech-settings-', async () => {
      expect(await resolveEffectiveSpeechSettings()).toEqual({
        enabled: true,
        muted: false,
        volume: 1,
        model: 'tts-1',
        voice: 'alloy',
      });

      await upsertStoredSpeechSettings({
        enabled: false,
        muted: true,
        volume: 0.35,
        model: 'tts-1-hd',
        voice: 'nova',
      });
      expect(await resolveEffectiveSpeechSettings()).toEqual({
        enabled: false,
        muted: true,
        volume: 0.35,
        model: 'tts-1-hd',
        voice: 'nova',
      });
    });
  });

  test('rejects invalid volume and voice settings', async () => {
    await withTempDroneDataDir('drone-speech-settings-invalid-', async () => {
      await expect(upsertStoredSpeechSettings({ volume: 2 })).rejects.toThrow('between 0 and 1');
      await expect(upsertStoredSpeechSettings({ voice: 'unknown' as any })).rejects.toThrow(
        'not supported',
      );
      await expect(upsertStoredSpeechSettings({ model: 'unknown' as any })).rejects.toThrow(
        'model is not supported',
      );
      await expect(upsertStoredSpeechSettings({ model: 'tts-1', voice: 'troy' })).rejects.toThrow(
        'voice troy is not supported by tts-1',
      );
    });
  });

  test('keeps legacy Groq voice selections on their matching model', async () => {
    await withTempDroneDataDir('drone-speech-settings-legacy-', async () => {
      await (await getHubSettingsRepository()).put('speech', {
        enabled: true,
        muted: false,
        volume: 1,
        voice: 'hannah',
      });
      expect(await resolveEffectiveSpeechSettings()).toMatchObject({
        model: 'canopylabs/orpheus-v1-english',
        voice: 'hannah',
      });
    });
  });
});
