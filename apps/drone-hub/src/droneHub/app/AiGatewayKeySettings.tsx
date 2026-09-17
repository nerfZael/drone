import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { requestJson } from '../http';
import { UiButton } from '../../ui/components';
import { settingsQueryKey, useSettingsQuery } from './settings-query';
import type { ApiKeySettingsResponse } from './settings-types';

export function AiGatewayKeySettings() {
  const client = useQueryClient();
  const key = settingsQueryKey('ai-gateway');
  const query = useSettingsQuery<ApiKeySettingsResponse>(requestJson, key, '/api/settings/ai-gateway');
  const [draft, setDraft] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const mutation = useMutation({
    mutationFn: (action: 'save' | 'clear') => requestJson<ApiKeySettingsResponse>('/api/settings/ai-gateway', {
      method: action === 'save' ? 'POST' : 'DELETE',
      ...(action === 'save' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: draft.trim() }) } : {}),
    }),
    onSuccess: (data, action) => {
      client.setQueryData(key, data);
      setDraft('');
      setNotice(action === 'save' ? 'Saved AI Gateway API key.' : data.hasKey ? 'Using environment AI_GATEWAY_API_KEY.' : 'Cleared stored AI Gateway API key.');
    },
  });
  return <section className="space-y-3 rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
    <h3 className="text-sm font-semibold">AI Gateway API key</h3>
    <p className="text-xs text-[var(--muted)]">Vercel credential for Gateway requests, including Jev evaluations. {query.data?.hasKey ? 'Configured.' : 'No AI Gateway key configured.'}</p>
    <input aria-label="AI Gateway API key" name="ai-gateway-api-key" type="password" autoComplete="new-password"
      value={draft} onChange={(event) => setDraft(event.target.value)} disabled={mutation.isPending}
      placeholder="Paste AI Gateway API key" className="w-full rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm" />
    <div className="flex gap-2">
      <UiButton variant="primary" onClick={() => mutation.mutate('save')} disabled={!draft.trim() || mutation.isPending} loading={mutation.isPending && mutation.variables === 'save'}>Save</UiButton>
      <UiButton variant="danger" onClick={() => mutation.mutate('clear')} disabled={!query.data?.hasKey || mutation.isPending} loading={mutation.isPending && mutation.variables === 'clear'}>Clear</UiButton>
    </div>
    {query.error || mutation.error ? <p role="alert" className="text-xs text-[var(--red)]">{(mutation.error ?? query.error)?.message}</p> : notice ? <p role="status" className="text-xs text-[var(--muted)]">{notice}</p> : null}
  </section>;
}
