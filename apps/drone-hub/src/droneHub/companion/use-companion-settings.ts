import React from 'react';

export type CompanionProvider = 'openai' | 'codex' | 'gemini' | 'openrouter';

export type CompanionSettingsDraft = {
  schemaVersion: number;
  promptDeliveryMode: 'asap' | 'queue';
  provider: CompanionProvider;
  model: string;
  thinkingLevel: string;
  systemPrompt: string;
  enabledTools: string[];
};

export type CompanionModelOption = {
  provider: CompanionProvider;
  id: string;
  name: string;
  thinkingLevel: string;
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
  models: CompanionModelOption[];
  credentials: Record<CompanionProvider, boolean>;
};

export function isCompanionModelSelectionValid(
  models: readonly CompanionModelOption[],
  draft: Pick<CompanionSettingsDraft, 'provider' | 'model' | 'thinkingLevel'>,
): boolean {
  return models.some(
    (model) =>
      model.provider === draft.provider &&
      model.id === draft.model &&
      model.thinkingLevel === draft.thinkingLevel,
  );
}

export function changeCompanionProvider(
  models: readonly CompanionModelOption[],
  draft: CompanionSettingsDraft,
  provider: CompanionProvider,
): CompanionSettingsDraft {
  const currentSelectionExists = models.some(
    (model) =>
      model.provider === provider &&
      model.id === draft.model &&
      model.thinkingLevel === draft.thinkingLevel,
  );
  return {
    ...draft,
    provider,
    ...(currentSelectionExists ? {} : { model: '', thinkingLevel: '' }),
  };
}

const SETTINGS_CHANGED_EVENT = 'companion-settings-changed';

// Rebase untouched fields while preserving edits in an open settings form.
function mergeSavedSettings(
  previous: CompanionSettingsDraft | undefined,
  draft: CompanionSettingsDraft | null,
  next: CompanionSettingsDraft,
): CompanionSettingsDraft {
  if (!previous || !draft) return next;
  const merged = { ...next };
  for (const key of ['promptDeliveryMode', 'systemPrompt', 'enabledTools'] as const) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(previous[key])) {
      Object.assign(merged, { [key]: draft[key] });
    }
  }
  // Provider, model and reasoning form one selection and must stay together.
  if (['provider', 'model', 'thinkingLevel'].some((key) =>
    draft[key as keyof CompanionSettingsDraft] !== previous[key as keyof CompanionSettingsDraft])) {
    Object.assign(merged, { provider: draft.provider, model: draft.model, thinkingLevel: draft.thinkingLevel });
  }
  return merged;
}

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export function useCompanionSettings(requestJson: RequestJson, enabled = true) {
  const [data, setData] = React.useState<CompanionSettingsResponse | null>(null);
  const [draft, setDraft] = React.useState<CompanionSettingsDraft | null>(null);
  const [loading, setLoading] = React.useState(enabled);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const dataRef = React.useRef(data);
  const generation = React.useRef(0);

  React.useEffect(() => {
    const onChanged = (event: Event) => {
      const response = (event as CustomEvent<CompanionSettingsResponse>).detail;
      generation.current++;
      const previous = dataRef.current;
      dataRef.current = response;
      setData(response);
      setDraft((current) => mergeSavedSettings(previous?.settings, current, response.settings));
      setLoading(false);
      setSaved(false);
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged);
  }, []);

  const acceptSaved = React.useCallback((response: CompanionSettingsResponse) => {
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: response }));
    setDraft(response.settings);
    setSaved(true);
    setError('');
  }, []);

  const load = React.useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const response = await requestJson<CompanionSettingsResponse>('/api/settings/companion');
      if (current !== generation.current) return;
      dataRef.current = response;
      setData(response);
      setDraft(response.settings);
      setSaved(false);
    } catch (loadError) {
      if (current === generation.current) setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

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
      acceptSaved(response);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, requestJson, saving, acceptSaved]);

  return { data, draft, setDraft, loading, saving, error, saved, dirty, load, save, acceptSaved };
}
