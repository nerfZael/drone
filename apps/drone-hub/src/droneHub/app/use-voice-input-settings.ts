import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { VoiceInputSettingsResponse } from './settings-types';
import {
  settingsErrorMessage,
  settingsQueryError,
  settingsQueryKey,
  useSettingsPostMutation,
  useSettingsQuery,
} from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;
type VoiceInputDraft = Omit<VoiceInputSettingsResponse['voiceInput'], 'silenceMillis'>;

export type UseVoiceInputSettingsResult = ReturnType<typeof useVoiceInputSettings>;

export function useVoiceInputSettings(requestJson: RequestJsonFn) {
  const queryClient = useQueryClient();
  const queryKey = settingsQueryKey('voice-input');
  const query = useSettingsQuery<VoiceInputSettingsResponse>(
    requestJson,
    queryKey,
    '/api/settings/voice-input',
  );
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<VoiceInputDraft>({
    endThoughtPreset: 'balanced',
    customSilenceMillis: 2_500,
    noiseHandling: 'auto',
    language: null,
    quality: 'fast',
    confirmationFeedback: false,
  });

  const applySettings = React.useCallback((data: VoiceInputSettingsResponse) => {
    const { silenceMillis: _silenceMillis, ...nextDraft } = data.voiceInput;
    setDraft(nextDraft);
  }, []);

  React.useEffect(() => {
    if (query.data) applySettings(query.data);
  }, [applySettings, query.data]);

  const saveMutation = useSettingsPostMutation<VoiceInputSettingsResponse, VoiceInputDraft>(
    requestJson,
    '/api/settings/voice-input',
  );
  const save = React.useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const data = await saveMutation.mutateAsync(draft);
      queryClient.setQueryData(queryKey, data);
      applySettings(data);
      setNotice('Saved voice input settings.');
    } catch (nextError) {
      setError(settingsErrorMessage(nextError));
    }
  }, [applySettings, draft, queryClient, queryKey, saveMutation]);

  const load = React.useCallback(async () => {
    setError(null);
    const { data } = await query.refetch();
    if (data) applySettings(data);
  }, [applySettings, query.refetch]);

  return {
    settings: query.data ?? null,
    loading: query.isFetching,
    saving: saveMutation.isPending,
    error: settingsQueryError(error, false, query),
    notice,
    draft,
    setDraft,
    save,
    load,
  };
}
