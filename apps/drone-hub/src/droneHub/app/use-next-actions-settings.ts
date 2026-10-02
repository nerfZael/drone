import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  NEXT_ACTIONS_SETTINGS_QUERY_KEY,
  useNextActionsSettings,
  type NextActionsSettings,
  type NextActionsSettingsResponse,
} from '../chat/next-actions';
import { settingsErrorMessage, type SettingsRequestJson } from './settings-query';

/** What a save would store: blank action rows are dropped. */
function savedForm(draft: NextActionsSettings): NextActionsSettings {
  return { ...draft, actions: draft.actions.map((action) => action.trim()).filter(Boolean) };
}

export function useNextActionsSettingsDraft(requestJson: SettingsRequestJson, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useNextActionsSettings(enabled);
  const data = query.data ?? null;
  const [draft, setDraft] = React.useState<NextActionsSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  const dirty = Boolean(data && draft && JSON.stringify(savedForm(draft)) !== JSON.stringify(data.settings));

  const save = React.useCallback(async () => {
    if (!draft || saving) return false;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const response = await requestJson<NextActionsSettingsResponse>('/api/settings/next-actions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(savedForm(draft)),
      });
      queryClient.setQueryData(NEXT_ACTIONS_SETTINGS_QUERY_KEY, response);
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

  const edit = React.useCallback((next: NextActionsSettings) => {
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

export type UseNextActionsSettingsDraftResult = ReturnType<typeof useNextActionsSettingsDraft>;
