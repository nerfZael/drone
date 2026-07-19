import React from 'react';
import { maybeExtractApiKey } from './helpers';
import {
  llmDefaultModelChoices,
  resolveLlmDefaultModelDraft,
  selectLlmDefaultModel,
  type LlmDefaultModelChoice,
  type LlmDefaultModelDraft,
} from './llm-default-model';
import type {
  ApiKeySettingsResponse,
  LlmDefaultModelSettingsResponse,
  LlmProviderId,
  LlmSettingsResponse,
} from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;
type ApiKeyProviderId = 'openai' | 'gemini' | 'groq';

function providerLabel(provider: LlmProviderId | ApiKeyProviderId): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'groq') return 'GROQ';
  return provider === 'gemini' ? 'Gemini' : 'OpenAI';
}

export type UseLlmSettingsResult = {
  llmSettings: LlmSettingsResponse | null;
  llmSettingsLoading: boolean;
  llmSettingsError: string | null;
  llmProviderDraft: LlmProviderId;
  llmDefaultModelSettings: LlmDefaultModelSettingsResponse | null;
  llmDefaultModelDraft: LlmDefaultModelDraft;
  llmDefaultModelChoices: LlmDefaultModelChoice[];
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
  groqSettingsDraft: string;
  savingGroqSettings: boolean;
  clearingGroqSettings: boolean;
  showGroqKey: boolean;
  revealingGroqKey: boolean;
  llmSettingsNotice: string | null;
  setLlmProviderDraft: (provider: LlmProviderId) => void;
  setLlmDefaultModelDraft: (model: string) => void;
  setLlmDefaultReasoningDraft: (thinkingLevel: string) => void;
  updateOpenAiSettingsDraft: (raw: string) => void;
  updateGeminiSettingsDraft: (raw: string) => void;
  updateGroqSettingsDraft: (raw: string) => void;
  loadLlmSettings: () => Promise<void>;
  saveLlmProviderSettings: () => Promise<void>;
  toggleApiKeyVisibility: (provider: ApiKeyProviderId) => Promise<void>;
  mutateApiKeySettings: (provider: ApiKeyProviderId, action: 'save' | 'clear') => Promise<void>;
};

export function useLlmSettings(requestJson: RequestJsonFn): UseLlmSettingsResult {
  const [llmSettings, setLlmSettings] = React.useState<LlmSettingsResponse | null>(null);
  const [llmSettingsLoading, setLlmSettingsLoading] = React.useState(false);
  const [llmSettingsError, setLlmSettingsError] = React.useState<string | null>(null);
  const [llmProviderDraft, setLlmProviderDraftValue] = React.useState<LlmProviderId>('openai');
  const [llmDefaultModelSettings, setLlmDefaultModelSettings] =
    React.useState<LlmDefaultModelSettingsResponse | null>(null);
  const [llmDefaultModelDraft, setLlmDefaultModelDraftValue] =
    React.useState<LlmDefaultModelDraft>({
      provider: 'openai',
      model: '',
      thinkingLevel: '',
    });
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
  const [groqSettingsDraft, setGroqSettingsDraft] = React.useState('');
  const [groqDraftLoadedFromSettings, setGroqDraftLoadedFromSettings] = React.useState(false);
  const [savingGroqSettings, setSavingGroqSettings] = React.useState(false);
  const [clearingGroqSettings, setClearingGroqSettings] = React.useState(false);
  const [showGroqKey, setShowGroqKey] = React.useState(false);
  const [revealingGroqKey, setRevealingGroqKey] = React.useState(false);
  const [llmSettingsNotice, setLlmSettingsNotice] = React.useState<string | null>(null);

  const loadLlmSettings = React.useCallback(async () => {
    setLlmSettingsLoading(true);
    setLlmSettingsError(null);
    try {
      const [data, defaults] = await Promise.all([
        requestJson<LlmSettingsResponse>('/api/settings/llm'),
        requestJson<LlmDefaultModelSettingsResponse>('/api/assistant/default-model'),
      ]);
      setLlmSettings(data);
      setLlmDefaultModelSettings(defaults);
      setLlmProviderDraftValue(data.provider.selected);
      setLlmDefaultModelDraftValue(
        resolveLlmDefaultModelDraft(defaults.models, data.provider.selected, defaults.defaultModel),
      );
    } catch (e: any) {
      setLlmSettingsError(e?.message ?? String(e));
    } finally {
      setLlmSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadLlmSettings();
  }, [loadLlmSettings]);

  const setLlmProviderDraft = React.useCallback(
    (provider: LlmProviderId) => {
      setLlmProviderDraftValue(provider);
      setLlmDefaultModelDraftValue(
        resolveLlmDefaultModelDraft(
          llmDefaultModelSettings?.models ?? [],
          provider,
          llmDefaultModelSettings?.defaultModel,
        ),
      );
    },
    [llmDefaultModelSettings],
  );

  const setLlmDefaultModelDraft = React.useCallback(
    (model: string) => {
      setLlmDefaultModelDraftValue((current) =>
        selectLlmDefaultModel(llmDefaultModelSettings?.models ?? [], current, model),
      );
    },
    [llmDefaultModelSettings],
  );

  const setLlmDefaultReasoningDraft = React.useCallback((thinkingLevel: string) => {
    setLlmDefaultModelDraftValue((current) => ({ ...current, thinkingLevel }));
  }, []);

  const defaultModelChoices = React.useMemo(
    () =>
      llmDefaultModelChoices(
        llmDefaultModelSettings?.models ?? [],
        llmDefaultModelDraft.provider,
      ),
    [llmDefaultModelDraft.provider, llmDefaultModelSettings],
  );

  const updateProviderKeySettings = React.useCallback((provider: LlmProviderId | ApiKeyProviderId, data: ApiKeySettingsResponse) => {
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
      if (provider === 'groq') return { ...prev, groq: next };
      return { ...prev, gemini: next };
    });
  }, []);

  const toggleApiKeyVisibility = React.useCallback(
    async (provider: ApiKeyProviderId) => {
      const showing = provider === 'openai' ? showOpenAiKey : provider === 'gemini' ? showGeminiKey : showGroqKey;
      const draft = provider === 'openai' ? openAiSettingsDraft : provider === 'gemini' ? geminiSettingsDraft : groqSettingsDraft;
      const hasKey =
        provider === 'openai'
          ? Boolean(llmSettings?.openai.hasKey)
          : provider === 'gemini'
            ? Boolean(llmSettings?.gemini.hasKey)
            : Boolean(llmSettings?.groq.hasKey);
      const draftLoadedFromSettings =
        provider === 'openai'
          ? openAiDraftLoadedFromSettings
          : provider === 'gemini'
            ? geminiDraftLoadedFromSettings
            : groqDraftLoadedFromSettings;

      if (showing) {
        if (provider === 'openai') {
          setShowOpenAiKey(false);
          if (draftLoadedFromSettings) {
            setOpenAiSettingsDraft('');
            setOpenAiDraftLoadedFromSettings(false);
          }
        } else if (provider === 'gemini') {
          setShowGeminiKey(false);
          if (draftLoadedFromSettings) {
            setGeminiSettingsDraft('');
            setGeminiDraftLoadedFromSettings(false);
          }
        } else {
          setShowGroqKey(false);
          if (draftLoadedFromSettings) {
            setGroqSettingsDraft('');
            setGroqDraftLoadedFromSettings(false);
          }
        }
        return;
      }

      if (!draft.trim() && hasKey) {
        if (provider === 'openai') setRevealingOpenAiKey(true);
        else if (provider === 'gemini') setRevealingGeminiKey(true);
        else setRevealingGroqKey(true);
        setLlmSettingsError(null);
        try {
          const data = await requestJson<ApiKeySettingsResponse>(`/api/settings/${provider}?reveal=1`);
          const apiKey = String(data.apiKey ?? '').trim();
          if (!apiKey) throw new Error(`${providerLabel(provider)} API key is unavailable.`);
          updateProviderKeySettings(provider, data);
          if (provider === 'openai') {
            setOpenAiSettingsDraft(apiKey);
            setOpenAiDraftLoadedFromSettings(true);
          } else if (provider === 'gemini') {
            setGeminiSettingsDraft(apiKey);
            setGeminiDraftLoadedFromSettings(true);
          } else {
            setGroqSettingsDraft(apiKey);
            setGroqDraftLoadedFromSettings(true);
          }
        } catch (e: any) {
          setLlmSettingsError(e?.message ?? String(e));
          return;
        } finally {
          if (provider === 'openai') setRevealingOpenAiKey(false);
          else if (provider === 'gemini') setRevealingGeminiKey(false);
          else setRevealingGroqKey(false);
        }
      }

      if (provider === 'openai') setShowOpenAiKey(true);
      else if (provider === 'gemini') setShowGeminiKey(true);
      else setShowGroqKey(true);
    },
    [
      geminiDraftLoadedFromSettings,
      geminiSettingsDraft,
      groqDraftLoadedFromSettings,
      groqSettingsDraft,
      llmSettings,
      openAiDraftLoadedFromSettings,
      openAiSettingsDraft,
      requestJson,
      showGeminiKey,
      showGroqKey,
      showOpenAiKey,
      updateProviderKeySettings,
    ],
  );

  const mutateApiKeySettings = React.useCallback(
    async (provider: ApiKeyProviderId, action: 'save' | 'clear') => {
      const label = providerLabel(provider);
      const envKeyName = provider === 'gemini' ? 'GEMINI_API_KEY' : provider === 'openai' ? 'OPENAI_API_KEY' : '';
      const draft = provider === 'openai' ? openAiSettingsDraft : provider === 'gemini' ? geminiSettingsDraft : groqSettingsDraft;
      const apiKey = String(maybeExtractApiKey(draft, provider) ?? '').trim();
      if (action === 'save') {
        if (!apiKey) {
          setLlmSettingsError(`${label} API key is required.`);
          return;
        }
        if (apiKey !== draft) {
          if (provider === 'openai') setOpenAiSettingsDraft(apiKey);
          else if (provider === 'gemini') setGeminiSettingsDraft(apiKey);
          else setGroqSettingsDraft(apiKey);
        }
      }
      if (provider === 'openai') {
        if (action === 'save') setSavingOpenAiSettings(true);
        else setClearingOpenAiSettings(true);
      } else if (provider === 'gemini') {
        if (action === 'save') setSavingGeminiSettings(true);
        else setClearingGeminiSettings(true);
      } else {
        if (action === 'save') setSavingGroqSettings(true);
        else setClearingGroqSettings(true);
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
        } else if (provider === 'gemini') {
          setGeminiSettingsDraft('');
          setGeminiDraftLoadedFromSettings(false);
          setShowGeminiKey(false);
        } else {
          setGroqSettingsDraft('');
          setGroqDraftLoadedFromSettings(false);
          setShowGroqKey(false);
        }
        if (action === 'save') {
          setLlmSettingsNotice(`Saved ${label} API key.`);
        } else {
          setLlmSettingsNotice(data.hasKey && envKeyName ? `Using environment ${envKeyName}.` : `Cleared stored ${label} API key.`);
        }
      } catch (e: any) {
        setLlmSettingsError(e?.message ?? String(e));
      } finally {
        if (provider === 'openai') {
          if (action === 'save') setSavingOpenAiSettings(false);
          else setClearingOpenAiSettings(false);
        } else if (provider === 'gemini') {
          if (action === 'save') setSavingGeminiSettings(false);
          else setClearingGeminiSettings(false);
        } else {
          if (action === 'save') setSavingGroqSettings(false);
          else setClearingGroqSettings(false);
        }
      }
    },
    [geminiSettingsDraft, groqSettingsDraft, openAiSettingsDraft, requestJson, updateProviderKeySettings],
  );

  const saveLlmProviderSettings = React.useCallback(async () => {
    setSavingLlmProvider(true);
    setLlmSettingsError(null);
    setLlmSettingsNotice(null);
    try {
      const selectedModel = defaultModelChoices.find(
        (choice) => choice.id === llmDefaultModelDraft.model,
      );
      if (!selectedModel) throw new Error('Select a default model for this provider.');
      if (!selectedModel.reasoningLevels.includes(llmDefaultModelDraft.thinkingLevel)) {
        throw new Error('Select a supported reasoning level for this model.');
      }
      const defaults = await requestJson<LlmDefaultModelSettingsResponse>(
        '/api/assistant/default-model',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(llmDefaultModelDraft),
        },
      );
      const data = await requestJson<LlmSettingsResponse>('/api/settings/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: llmProviderDraft }),
      });
      setLlmDefaultModelSettings(defaults);
      setLlmSettings((prev) => (prev ? { ...prev, provider: data.provider } : data));
      setLlmProviderDraftValue(data.provider.selected);
      setLlmDefaultModelDraftValue(
        resolveLlmDefaultModelDraft(defaults.models, data.provider.selected, defaults.defaultModel),
      );
      setLlmSettingsNotice(
        `Using ${providerLabel(data.provider.selected)} with ${selectedModel.label} (${llmDefaultModelDraft.thinkingLevel}) by default.`,
      );
    } catch (e: any) {
      const message = e?.message ?? String(e);
      // Provider selection and assistant defaults live behind separate APIs. If
      // one succeeds and the other fails, reload both so the form reflects the
      // actual persisted state and a retry cannot overwrite it from stale data.
      await loadLlmSettings();
      setLlmSettingsError(message);
    } finally {
      setSavingLlmProvider(false);
    }
  }, [defaultModelChoices, llmDefaultModelDraft, llmProviderDraft, loadLlmSettings, requestJson]);

  const updateOpenAiSettingsDraft = React.useCallback((raw: string) => {
    setOpenAiDraftLoadedFromSettings(false);
    setOpenAiSettingsDraft(maybeExtractApiKey(raw, 'openai'));
  }, []);

  const updateGeminiSettingsDraft = React.useCallback((raw: string) => {
    setGeminiDraftLoadedFromSettings(false);
    setGeminiSettingsDraft(maybeExtractApiKey(raw, 'gemini'));
  }, []);

  const updateGroqSettingsDraft = React.useCallback((raw: string) => {
    setGroqDraftLoadedFromSettings(false);
    setGroqSettingsDraft(maybeExtractApiKey(raw, 'groq'));
  }, []);

  return {
    llmSettings,
    llmSettingsLoading,
    llmSettingsError,
    llmProviderDraft,
    llmDefaultModelSettings,
    llmDefaultModelDraft,
    llmDefaultModelChoices: defaultModelChoices,
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
    groqSettingsDraft,
    savingGroqSettings,
    clearingGroqSettings,
    showGroqKey,
    revealingGroqKey,
    llmSettingsNotice,
    setLlmProviderDraft,
    setLlmDefaultModelDraft,
    setLlmDefaultReasoningDraft,
    updateOpenAiSettingsDraft,
    updateGeminiSettingsDraft,
    updateGroqSettingsDraft,
    loadLlmSettings,
    saveLlmProviderSettings,
    toggleApiKeyVisibility,
    mutateApiKeySettings,
  };
}
