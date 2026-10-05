import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  CHAT_ASKS_SETTINGS_QUERY_KEY,
  useChatAsksSettings,
  type ChatAsksSettings,
  type ChatAsksSettingsResponse,
} from '../chat/chat-asks';
import { settingsErrorMessage, type SettingsRequestJson } from './settings-query';

export function useChatAsksSettingsDraft(requestJson: SettingsRequestJson, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useChatAsksSettings(enabled);
  const data = query.data ?? null;
  const [draft, setDraft] = React.useState<ChatAsksSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  // Costs change while the tab is open; refresh them without touching the draft.
  const { refetch } = query;
  React.useEffect(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);

  const dirty = Boolean(data && draft && JSON.stringify(draft) !== JSON.stringify(data.settings));

  const save = React.useCallback(async () => {
    if (!draft || saving) return false;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const response = await requestJson<ChatAsksSettingsResponse>('/api/settings/chat-asks', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      queryClient.setQueryData(CHAT_ASKS_SETTINGS_QUERY_KEY, response);
      void queryClient.invalidateQueries({ queryKey: ['chat-asks', 'chat'] });
      setDraft(response.settings);
      setSaved(true);
      return true;
    } catch (error) {
      setSaveError(settingsErrorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, queryClient, requestJson, saving]);

  /** Drops unsaved edits and reloads the stored settings. */
  const reset = React.useCallback(async () => {
    setDraft(null);
    setSaved(false);
    setSaveError('');
    await query.refetch();
  }, [query]);

  const edit = React.useCallback((next: ChatAsksSettings) => {
    setDraft(next);
    setSaved(false);
  }, []);

  return {
    data,
    draft,
    setDraft: edit,
    loading: query.isPending && enabled,
    loadError: query.error?.message ?? '',
    saving,
    saveError,
    saved,
    dirty,
    save,
    reset,
  };
}

export type UseChatAsksSettingsDraftResult = ReturnType<typeof useChatAsksSettingsDraft>;
