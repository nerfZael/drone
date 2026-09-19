import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { applySpeechPlaybackSettings } from '../media/speech-playback';
import type { SpeechSettingsResponse } from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsPostMutation, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseSpeechSettingsResult = ReturnType<typeof useSpeechSettings>;

export function useSpeechSettings(requestJson: RequestJsonFn, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('speech');
  const query = useSettingsQuery<SpeechSettingsResponse>(requestJson, queryKey, '/api/settings/speech', enabled);
  const [speechSettingsError, setSpeechSettingsError] = React.useState<string | null>(null);
  const [speechSettingsNotice, setSpeechSettingsNotice] = React.useState<string | null>(null);
  const [enabledDraft, setEnabledDraft] = React.useState(true);
  const [mutedDraft, setMutedDraft] = React.useState(false);
  const [volumeDraft, setVolumeDraft] = React.useState(100);
  const [modelDraft, setModelDraft] = React.useState('tts-1');
  const [voiceDraft, setVoiceDraft] = React.useState('alloy');

  const applySettings = React.useCallback((data: SpeechSettingsResponse) => {
    applySpeechPlaybackSettings(data.speech);
    setEnabledDraft(data.speech.enabled);
    setMutedDraft(data.speech.muted);
    setVolumeDraft(Math.round(data.speech.volume * 100));
    setModelDraft(data.speech.model);
    setVoiceDraft(data.speech.voice);
  }, []);

  React.useEffect(() => {
    if (query.data) applySettings(query.data);
  }, [applySettings, query.data]);

  const loadSpeechSettings = React.useCallback(async () => {
    setSpeechSettingsError(null);
    const { data } = await query.refetch();
    if (data) applySettings(data);
  }, [applySettings, query.refetch]);

  const saveMutation = useSettingsPostMutation<
    SpeechSettingsResponse,
    Partial<Pick<SpeechSettingsResponse['speech'], 'enabled' | 'muted' | 'volume' | 'model' | 'voice'>>
  >(
    requestJson,
    '/api/settings/speech',
  );

  const saveSpeechSettings = React.useCallback(async () => {
    setSpeechSettingsError(null);
    setSpeechSettingsNotice(null);
    try {
      const data = await saveMutation.mutateAsync({
        enabled: enabledDraft,
        muted: mutedDraft,
        volume: volumeDraft / 100,
        model: modelDraft,
        voice: voiceDraft,
      });
      queryClient.setQueryData(queryKey, data);
      applySettings(data);
      setSpeechSettingsNotice('Saved speech settings.');
    } catch (error) {
      setSpeechSettingsError(settingsErrorMessage(error));
    }
  }, [applySettings, enabledDraft, modelDraft, mutedDraft, queryClient, queryKey, saveMutation, voiceDraft, volumeDraft]);

  const saveSpeechOutputSettings = React.useCallback(async () => {
    setSpeechSettingsError(null);
    setSpeechSettingsNotice(null);
    try {
      const data = await saveMutation.mutateAsync({ model: modelDraft, voice: voiceDraft });
      queryClient.setQueryData(queryKey, data);
      applySettings(data);
      setSpeechSettingsNotice('Saved spoken output settings.');
    } catch (error) {
      setSpeechSettingsError(settingsErrorMessage(error));
    }
  }, [applySettings, modelDraft, queryClient, queryKey, saveMutation, voiceDraft]);

  return {
    speechSettings: query.data ?? null,
    speechSettingsLoading: query.isFetching,
    speechSettingsSaving: saveMutation.isPending,
    speechSettingsError: settingsQueryError(speechSettingsError, false, query),
    speechSettingsNotice,
    enabledDraft,
    mutedDraft,
    volumeDraft,
    modelDraft,
    voiceDraft,
    setEnabledDraft,
    setMutedDraft,
    setVolumeDraft,
    setModelDraft,
    setVoiceDraft,
    loadSpeechSettings,
    saveSpeechSettings,
    saveSpeechOutputSettings,
  };
}
