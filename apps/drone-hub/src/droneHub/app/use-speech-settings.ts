import React from 'react';
import { applySpeechPlaybackSettings } from '../media/speech-playback';
import type { SpeechSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseSpeechSettingsResult = {
  speechSettings: SpeechSettingsResponse | null;
  speechSettingsLoading: boolean;
  speechSettingsSaving: boolean;
  speechSettingsError: string | null;
  speechSettingsNotice: string | null;
  enabledDraft: boolean;
  mutedDraft: boolean;
  volumeDraft: number;
  voiceDraft: string;
  setEnabledDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setMutedDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setVolumeDraft: React.Dispatch<React.SetStateAction<number>>;
  setVoiceDraft: React.Dispatch<React.SetStateAction<string>>;
  loadSpeechSettings: () => Promise<void>;
  saveSpeechSettings: () => Promise<void>;
};

export function useSpeechSettings(requestJson: RequestJsonFn): UseSpeechSettingsResult {
  const [speechSettings, setSpeechSettings] = React.useState<SpeechSettingsResponse | null>(null);
  const [speechSettingsLoading, setSpeechSettingsLoading] = React.useState(false);
  const [speechSettingsSaving, setSpeechSettingsSaving] = React.useState(false);
  const [speechSettingsError, setSpeechSettingsError] = React.useState<string | null>(null);
  const [speechSettingsNotice, setSpeechSettingsNotice] = React.useState<string | null>(null);
  const [enabledDraft, setEnabledDraft] = React.useState(true);
  const [mutedDraft, setMutedDraft] = React.useState(false);
  const [volumeDraft, setVolumeDraft] = React.useState(100);
  const [voiceDraft, setVoiceDraft] = React.useState('troy');

  const applySettings = React.useCallback((data: SpeechSettingsResponse) => {
    applySpeechPlaybackSettings(data.speech);
    setSpeechSettings(data);
    setEnabledDraft(data.speech.enabled);
    setMutedDraft(data.speech.muted);
    setVolumeDraft(Math.round(data.speech.volume * 100));
    setVoiceDraft(data.speech.voice);
  }, []);

  const loadSpeechSettings = React.useCallback(async () => {
    setSpeechSettingsLoading(true);
    setSpeechSettingsError(null);
    try {
      applySettings(await requestJson<SpeechSettingsResponse>('/api/settings/speech'));
    } catch (error: any) {
      setSpeechSettingsError(error?.message ?? String(error));
    } finally {
      setSpeechSettingsLoading(false);
    }
  }, [applySettings, requestJson]);

  React.useEffect(() => {
    void loadSpeechSettings();
  }, [loadSpeechSettings]);

  const saveSpeechSettings = React.useCallback(async () => {
    setSpeechSettingsSaving(true);
    setSpeechSettingsError(null);
    setSpeechSettingsNotice(null);
    try {
      const data = await requestJson<SpeechSettingsResponse>('/api/settings/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: enabledDraft,
          muted: mutedDraft,
          volume: volumeDraft / 100,
          voice: voiceDraft,
        }),
      });
      applySettings(data);
      setSpeechSettingsNotice('Saved speech settings.');
    } catch (error: any) {
      setSpeechSettingsError(error?.message ?? String(error));
    } finally {
      setSpeechSettingsSaving(false);
    }
  }, [applySettings, enabledDraft, mutedDraft, requestJson, voiceDraft, volumeDraft]);

  return {
    speechSettings,
    speechSettingsLoading,
    speechSettingsSaving,
    speechSettingsError,
    speechSettingsNotice,
    enabledDraft,
    mutedDraft,
    volumeDraft,
    voiceDraft,
    setEnabledDraft,
    setMutedDraft,
    setVolumeDraft,
    setVoiceDraft,
    loadSpeechSettings,
    saveSpeechSettings,
  };
}
