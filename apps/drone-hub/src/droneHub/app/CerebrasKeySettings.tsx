import React from 'react';
import { useCompanionSettings, type CompanionSettingsResponse } from '../companion/use-companion-settings';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { requestJson } from '../http';
import { UiButton } from '../../ui/components';
import { settingsQueryKey, useSettingsQuery } from './settings-query';
import type { ApiKeySettingsResponse } from './settings-types';

export function CerebrasKeySettings() {
  const client = useQueryClient();
  const { acceptSaved } = useCompanionSettings(requestJson, false);
  const key = settingsQueryKey('cerebras');
  const query = useSettingsQuery<ApiKeySettingsResponse>(requestJson, key, '/api/settings/cerebras');
  const [draft, setDraft] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const mutation = useMutation({
    mutationFn: (action: 'save' | 'clear') => requestJson<ApiKeySettingsResponse>('/api/settings/cerebras', {
      method: action === 'save' ? 'POST' : 'DELETE',
      ...(action === 'save' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: draft.trim() }) } : {}),
    }),
    onSuccess: (data, action) => {
      client.setQueryData(key, data);
      void client.invalidateQueries({ queryKey: settingsQueryKey('llm') });
      void requestJson<CompanionSettingsResponse>('/api/settings/companion').then(acceptSaved).catch(() => {
        // The key is saved; Companion can refresh settings when its picker opens.
      });
      setDraft('');
      setNotice(action === 'save' ? 'Saved Cerebras API key.' : data.hasKey ? 'Using environment CEREBRAS_API_KEY.' : 'Cleared stored Cerebras API key.');
    },
  });
  return <section className="space-y-3 rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
    <h3 className="text-sm font-semibold">Cerebras API key</h3>
    <p className="text-xs text-[var(--muted)]">Used for built-in chats, Companion, and automatic naming. {query.data?.hasKey ? `Configured (${query.data.keyHint ?? query.data.source}).` : 'No Cerebras key configured.'}</p>
    <input aria-label="Cerebras API key" name="cerebras-api-key" type="password" autoComplete="new-password"
      value={draft} onChange={(event) => setDraft(event.target.value)} disabled={mutation.isPending}
      placeholder="Paste Cerebras API key" className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm" />
    <div className="flex gap-2">
      <UiButton variant="primary" onClick={() => mutation.mutate('save')} disabled={!draft.trim() || mutation.isPending} loading={mutation.isPending && mutation.variables === 'save'}>Save</UiButton>
      <UiButton variant="danger" onClick={() => mutation.mutate('clear')} disabled={!query.data?.hasKey || mutation.isPending} loading={mutation.isPending && mutation.variables === 'clear'}>Clear</UiButton>
    </div>
    {query.error || mutation.error ? <p role="alert" className="text-xs text-[var(--red)]">{(mutation.error ?? query.error)?.message}</p> : notice ? <p role="status" className="text-xs text-[var(--muted)]">{notice}</p> : null}
  </section>;
}
