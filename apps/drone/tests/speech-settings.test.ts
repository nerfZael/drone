import { describe, expect, test } from 'bun:test';

import {
  resolveEffectiveSpeechSettings,
  upsertStoredSpeechSettings,
} from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

describe('speech settings', () => {
  test('uses audible enabled defaults and persists valid overrides', async () => {
    await withTempDroneDataDir('drone-speech-settings-', async () => {
      expect(await resolveEffectiveSpeechSettings()).toEqual({
        enabled: true,
        muted: false,
        volume: 1,
        voice: 'troy',
      });

      await upsertStoredSpeechSettings({
        enabled: false,
        muted: true,
        volume: 0.35,
        voice: 'hannah',
      });
      expect(await resolveEffectiveSpeechSettings()).toEqual({
        enabled: false,
        muted: true,
        volume: 0.35,
        voice: 'hannah',
      });
    });
  });

  test('rejects invalid volume and voice settings', async () => {
    await withTempDroneDataDir('drone-speech-settings-invalid-', async () => {
      await expect(upsertStoredSpeechSettings({ volume: 2 })).rejects.toThrow('between 0 and 1');
      await expect(upsertStoredSpeechSettings({ voice: 'unknown' as any })).rejects.toThrow(
        'not supported',
      );
    });
  });
});
