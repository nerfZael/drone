import React from 'react';

export type CompanionSettingsDraft = {
  provider: 'openai' | 'codex' | 'gemini';
  model: string;
  thinkingLevel: string;
  systemPrompt: string;
  enabledTools: string[];
};

export type CompanionSettingsResponse = {
  ok: true;
  settings: CompanionSettingsDraft;
  defaultSystemPrompt: string;
  maxSystemPromptChars: number;
  tools: Array<{
    name: string;
    label: string;
    category: string;
    execution: 'server' | 'mcp' | 'browser';
    requires: string | null;
    description: string;
  }>;
  models: Array<{
    provider: 'openai' | 'codex' | 'gemini';
    id: string;
    name: string;
    thinkingLevel: string;
  }>;
  credentials: Record<'openai' | 'codex' | 'gemini', boolean>;
};

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export function useCompanionSettings(requestJson: RequestJson) {
  const [data, setData] = React.useState<CompanionSettingsResponse | null>(null);
  const [draft, setDraft] = React.useState<CompanionSettingsDraft | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await requestJson<CompanionSettingsResponse>('/api/settings/companion');
      setData(response);
      setDraft(response.settings);
      setSaved(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => void load(), [load]);

  const dirty = Boolean(data && draft && JSON.stringify(data.settings) !== JSON.stringify(draft));
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = React.useCallback(async () => {
    if (!draft || saving) return false;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await requestJson<CompanionSettingsResponse>('/api/settings/companion', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      setData(response);
      setDraft(response.settings);
      setSaved(true);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, requestJson, saving]);

  return { data, draft, setDraft, loading, saving, error, saved, dirty, load, save };
}
