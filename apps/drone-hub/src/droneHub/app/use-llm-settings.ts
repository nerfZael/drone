import React from 'react';
import { maybeExtractApiKey } from './helpers';
import type { ApiKeySettingsResponse, LlmProviderId, LlmSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;
type ApiKeyProviderId = 'openai' | 'gemini';

function providerLabel(provider: LlmProviderId): string {
  if (provider === 'codex') return 'Codex';
  return provider === 'gemini' ? 'Gemini' : 'OpenAI';
}

export type UseLlmSettingsResult = {
  llmSettings: LlmSettingsResponse | null;
  llmSettingsLoading: boolean;
  llmSettingsError: string | null;
  llmProviderDraft: LlmProviderId;
  savingLlmProvider: boolean;
  showGeminiKey: boolean;
  revealingGeminiKey: boolean;
  geminiSettingsDraft: string;
  savingGeminiSettings: boolean;
  clearingGeminiSettings: boolean;
  openAiSettingsDraft: string;
  savingOpenAiSettings: boolean;
  clearingOpenAiSettings: boolean;
  showOpenAiKey: boolean;
  revealingOpenAiKey: boolean;
  llmSettingsNotice: string | null;
  setLlmProviderDraft: React.Dispatch<React.SetStateAction<LlmProviderId>>;
  updateOpenAiSettingsDraft: (raw: string) => void;
  updateGeminiSettingsDraft: (raw: string) => void;
  loadLlmSettings: () => Promise<void>;
  saveLlmProviderSettings: () => Promise<void>;
  toggleApiKeyVisibility: (provider: ApiKeyProviderId) => Promise<void>;
  mutateApiKeySettings: (provider: ApiKeyProviderId, action: 'save' | 'clear') => Promise<void>;
};

export function useLlmSettings(requestJson: RequestJsonFn): UseLlmSettingsResult {
  const [llmSettings, setLlmSettings] = React.useState<LlmSettingsResponse | null>(null);
  const [llmSettingsLoading, setLlmSettingsLoading] = React.useState(false);
  const [llmSettingsError, setLlmSettingsError] = React.useState<string | null>(null);
  const [llmProviderDraft, setLlmProviderDraft] = React.useState<LlmProviderId>('openai');
  const [savingLlmProvider, setSavingLlmProvider] = React.useState(false);
  const [showGeminiKey, setShowGeminiKey] = React.useState(false);
  const [revealingGeminiKey, setRevealingGeminiKey] = React.useState(false);
  const [geminiSettingsDraft, setGeminiSettingsDraft] = React.useState('');
  const [geminiDraftLoadedFromSettings, setGeminiDraftLoadedFromSettings] = React.useState(false);
  const [savingGeminiSettings, setSavingGeminiSettings] = React.useState(false);
  const [clearingGeminiSettings, setClearingGeminiSettings] = React.useState(false);
  const [openAiSettingsDraft, setOpenAiSettingsDraft] = React.useState('');
  const [openAiDraftLoadedFromSettings, setOpenAiDraftLoadedFromSettings] = React.useState(false);
  const [savingOpenAiSettings, setSavingOpenAiSettings] = React.useState(false);
  const [clearingOpenAiSettings, setClearingOpenAiSettings] = React.useState(false);
  const [showOpenAiKey, setShowOpenAiKey] = React.useState(false);
  const [revealingOpenAiKey, setRevealingOpenAiKey] = React.useState(false);
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
      if (provider === 'codex') return { ...prev, codex: next };
      return { ...prev, gemini: next };
    });
  }, []);

  const toggleApiKeyVisibility = React.useCallback(
    async (provider: ApiKeyProviderId) => {
      const showing = provider === 'openai' ? showOpenAiKey : showGeminiKey;
      const draft = provider === 'openai' ? openAiSettingsDraft : geminiSettingsDraft;
      const hasKey = provider === 'openai' ? Boolean(llmSettings?.openai.hasKey) : Boolean(llmSettings?.gemini.hasKey);
      const draftLoadedFromSettings = provider === 'openai' ? openAiDraftLoadedFromSettings : geminiDraftLoadedFromSettings;

      if (showing) {
        if (provider === 'openai') {
          setShowOpenAiKey(false);
          if (draftLoadedFromSettings) {
            setOpenAiSettingsDraft('');
            setOpenAiDraftLoadedFromSettings(false);
          }
        } else {
          setShowGeminiKey(false);
          if (draftLoadedFromSettings) {
            setGeminiSettingsDraft('');
            setGeminiDraftLoadedFromSettings(false);
          }
        }
        return;
      }

      if (!draft.trim() && hasKey) {
        if (provider === 'openai') setRevealingOpenAiKey(true);
        else setRevealingGeminiKey(true);
        setLlmSettingsError(null);
        try {
          const data = await requestJson<ApiKeySettingsResponse>(`/api/settings/${provider}?reveal=1`);
          const apiKey = String(data.apiKey ?? '').trim();
          if (!apiKey) throw new Error(`${providerLabel(provider)} API key is unavailable.`);
          updateProviderKeySettings(provider, data);
          if (provider === 'openai') {
            setOpenAiSettingsDraft(apiKey);
            setOpenAiDraftLoadedFromSettings(true);
          } else {
            setGeminiSettingsDraft(apiKey);
            setGeminiDraftLoadedFromSettings(true);
          }
        } catch (e: any) {
          setLlmSettingsError(e?.message ?? String(e));
          return;
        } finally {
          if (provider === 'openai') setRevealingOpenAiKey(false);
          else setRevealingGeminiKey(false);
        }
      }

      if (provider === 'openai') setShowOpenAiKey(true);
      else setShowGeminiKey(true);
    },
    [
      geminiDraftLoadedFromSettings,
      geminiSettingsDraft,
      llmSettings,
      openAiDraftLoadedFromSettings,
      openAiSettingsDraft,
      requestJson,
      showGeminiKey,
      showOpenAiKey,
      updateProviderKeySettings,
    ],
  );

  const mutateApiKeySettings = React.useCallback(
    async (provider: ApiKeyProviderId, action: 'save' | 'clear') => {
      const label = providerLabel(provider);
      const envKeyName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
      const draft = provider === 'openai' ? openAiSettingsDraft : geminiSettingsDraft;
      const apiKey = String(maybeExtractApiKey(draft, provider) ?? '').trim();
      if (action === 'save') {
        if (!apiKey) {
          setLlmSettingsError(`${label} API key is required.`);
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
          setOpenAiDraftLoadedFromSettings(false);
          setShowOpenAiKey(false);
        } else {
          setGeminiSettingsDraft('');
          setGeminiDraftLoadedFromSettings(false);
          setShowGeminiKey(false);
        }
        if (action === 'save') {
          setLlmSettingsNotice(`Saved ${label} API key.`);
        } else {
          setLlmSettingsNotice(data.hasKey ? `Using environment ${envKeyName}.` : `Cleared stored ${label} API key.`);
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
      setLlmSettingsNotice(`Using ${providerLabel(data.provider.selected)} for LLM calls.`);
    } catch (e: any) {
      setLlmSettingsError(e?.message ?? String(e));
    } finally {
      setSavingLlmProvider(false);
    }
  }, [llmProviderDraft, requestJson]);

  const updateOpenAiSettingsDraft = React.useCallback((raw: string) => {
    setOpenAiDraftLoadedFromSettings(false);
    setOpenAiSettingsDraft(maybeExtractApiKey(raw, 'openai'));
  }, []);

  const updateGeminiSettingsDraft = React.useCallback((raw: string) => {
    setGeminiDraftLoadedFromSettings(false);
    setGeminiSettingsDraft(maybeExtractApiKey(raw, 'gemini'));
  }, []);

  return {
    llmSettings,
    llmSettingsLoading,
    llmSettingsError,
    llmProviderDraft,
    savingLlmProvider,
    showGeminiKey,
    revealingGeminiKey,
    geminiSettingsDraft,
    savingGeminiSettings,
    clearingGeminiSettings,
    openAiSettingsDraft,
    savingOpenAiSettings,
    clearingOpenAiSettings,
    showOpenAiKey,
    revealingOpenAiKey,
    llmSettingsNotice,
    setLlmProviderDraft,
    updateOpenAiSettingsDraft,
    updateGeminiSettingsDraft,
    loadLlmSettings,
    saveLlmProviderSettings,
    toggleApiKeyVisibility,
    mutateApiKeySettings,
  };
}
