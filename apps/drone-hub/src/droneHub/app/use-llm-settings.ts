import React from 'react';
import { maybeExtractApiKey } from './helpers';
import type { ApiKeySettingsResponse, LlmProviderId, LlmSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseLlmSettingsResult = {
  llmSettings: LlmSettingsResponse | null;
  llmSettingsLoading: boolean;
  llmSettingsError: string | null;
  llmProviderDraft: LlmProviderId;
  savingLlmProvider: boolean;
  showGeminiKey: boolean;
  geminiSettingsDraft: string;
  savingGeminiSettings: boolean;
  clearingGeminiSettings: boolean;
  openAiSettingsDraft: string;
  savingOpenAiSettings: boolean;
  clearingOpenAiSettings: boolean;
  showOpenAiKey: boolean;
  llmSettingsNotice: string | null;
  setLlmProviderDraft: React.Dispatch<React.SetStateAction<LlmProviderId>>;
  setShowGeminiKey: React.Dispatch<React.SetStateAction<boolean>>;
  setShowOpenAiKey: React.Dispatch<React.SetStateAction<boolean>>;
  updateOpenAiSettingsDraft: (raw: string) => void;
  updateGeminiSettingsDraft: (raw: string) => void;
  loadLlmSettings: () => Promise<void>;
  saveLlmProviderSettings: () => Promise<void>;
  mutateApiKeySettings: (provider: LlmProviderId, action: 'save' | 'clear') => Promise<void>;
};

export function useLlmSettings(requestJson: RequestJsonFn): UseLlmSettingsResult {
  const [llmSettings, setLlmSettings] = React.useState<LlmSettingsResponse | null>(null);
  const [llmSettingsLoading, setLlmSettingsLoading] = React.useState(false);
  const [llmSettingsError, setLlmSettingsError] = React.useState<string | null>(null);
  const [llmProviderDraft, setLlmProviderDraft] = React.useState<LlmProviderId>('openai');
  const [savingLlmProvider, setSavingLlmProvider] = React.useState(false);
  const [showGeminiKey, setShowGeminiKey] = React.useState(false);
  const [geminiSettingsDraft, setGeminiSettingsDraft] = React.useState('');
  const [savingGeminiSettings, setSavingGeminiSettings] = React.useState(false);
  const [clearingGeminiSettings, setClearingGeminiSettings] = React.useState(false);
  const [openAiSettingsDraft, setOpenAiSettingsDraft] = React.useState('');
  const [savingOpenAiSettings, setSavingOpenAiSettings] = React.useState(false);
  const [clearingOpenAiSettings, setClearingOpenAiSettings] = React.useState(false);
  const [showOpenAiKey, setShowOpenAiKey] = React.useState(false);
  const [llmSettingsNotice, setLlmSettingsNotice] = React.useState<string | null>(null);

  const loadLlmSettings = React.useCallback(async () => {
    setLlmSettingsLoading(true);
    setLlmSettingsError(null);
    try {
      const data = await requestJson<LlmSettingsResponse>('/api/settings/llm');
      setLlmSettings(data);
      setLlmProviderDraft(data.provider.selected);
    } catch (e: any) {
      setLlmSettingsError(e?.message ?? String(e));
    } finally {
      setLlmSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadLlmSettings();
  }, [loadLlmSettings]);

  const updateProviderKeySettings = React.useCallback((provider: LlmProviderId, data: ApiKeySettingsResponse) => {
    setLlmSettings((prev) => {
      if (!prev) return prev;
      const next = {
        hasKey: data.hasKey,
        source: data.source,
        keyHint: data.keyHint,
        updatedAt: data.updatedAt,
      };
      if (provider === 'openai') return { ...prev, openai: next };
      return { ...prev, gemini: next };
    });
  }, []);

  const mutateApiKeySettings = React.useCallback(
    async (provider: LlmProviderId, action: 'save' | 'clear') => {
      const providerLabel = provider === 'gemini' ? 'Gemini' : 'OpenAI';
      const envKeyName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
      const draft = provider === 'openai' ? openAiSettingsDraft : geminiSettingsDraft;
      const apiKey = String(maybeExtractApiKey(draft, provider) ?? '').trim();
      if (action === 'save') {
        if (!apiKey) {
          setLlmSettingsError(`${providerLabel} API key is required.`);
          return;
        }
        if (apiKey !== draft) {
          if (provider === 'openai') setOpenAiSettingsDraft(apiKey);
          else setGeminiSettingsDraft(apiKey);
        }
      }
      if (provider === 'openai') {
        if (action === 'save') setSavingOpenAiSettings(true);
        else setClearingOpenAiSettings(true);
      } else if (action === 'save') {
        setSavingGeminiSettings(true);
      } else {
        setClearingGeminiSettings(true);
      }
      setLlmSettingsError(null);
      setLlmSettingsNotice(null);
      try {
        const data = await requestJson<ApiKeySettingsResponse>(`/api/settings/${provider}`, {
          method: action === 'save' ? 'POST' : 'DELETE',
          ...(action === 'save'
            ? {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ apiKey }),
              }
            : {}),
        });
        updateProviderKeySettings(provider, data);
        if (provider === 'openai') {
          setOpenAiSettingsDraft('');
          setShowOpenAiKey(false);
        } else {
          setGeminiSettingsDraft('');
          setShowGeminiKey(false);
        }
        if (action === 'save') {
          setLlmSettingsNotice(`Saved ${providerLabel} API key.`);
        } else {
          setLlmSettingsNotice(data.hasKey ? `Using environment ${envKeyName}.` : `Cleared stored ${providerLabel} API key.`);
        }
      } catch (e: any) {
        setLlmSettingsError(e?.message ?? String(e));
      } finally {
        if (provider === 'openai') {
          if (action === 'save') setSavingOpenAiSettings(false);
          else setClearingOpenAiSettings(false);
        } else if (action === 'save') {
          setSavingGeminiSettings(false);
        } else {
          setClearingGeminiSettings(false);
        }
      }
    },
    [geminiSettingsDraft, openAiSettingsDraft, requestJson, updateProviderKeySettings],
  );

  const saveLlmProviderSettings = React.useCallback(async () => {
    setSavingLlmProvider(true);
    setLlmSettingsError(null);
    setLlmSettingsNotice(null);
    try {
      const data = await requestJson<LlmSettingsResponse>('/api/settings/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: llmProviderDraft }),
      });
      setLlmSettings((prev) => (prev ? { ...prev, provider: data.provider } : data));
      setLlmProviderDraft(data.provider.selected);
      setLlmSettingsNotice(`Using ${data.provider.selected === 'gemini' ? 'Gemini' : 'OpenAI'} for LLM calls.`);
    } catch (e: any) {
      setLlmSettingsError(e?.message ?? String(e));
    } finally {
      setSavingLlmProvider(false);
    }
  }, [llmProviderDraft, requestJson]);

  const updateOpenAiSettingsDraft = React.useCallback((raw: string) => {
    setOpenAiSettingsDraft(maybeExtractApiKey(raw, 'openai'));
  }, []);

  const updateGeminiSettingsDraft = React.useCallback((raw: string) => {
    setGeminiSettingsDraft(maybeExtractApiKey(raw, 'gemini'));
  }, []);

  return {
    llmSettings,
    llmSettingsLoading,
    llmSettingsError,
    llmProviderDraft,
    savingLlmProvider,
    showGeminiKey,
    geminiSettingsDraft,
    savingGeminiSettings,
    clearingGeminiSettings,
    openAiSettingsDraft,
    savingOpenAiSettings,
    clearingOpenAiSettings,
    showOpenAiKey,
    llmSettingsNotice,
    setLlmProviderDraft,
    setShowGeminiKey,
    setShowOpenAiKey,
    updateOpenAiSettingsDraft,
    updateGeminiSettingsDraft,
    loadLlmSettings,
    saveLlmProviderSettings,
    mutateApiKeySettings,
  };
}
