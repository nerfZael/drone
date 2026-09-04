import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { maybeExtractApiKey } from './helpers';
import {
  llmDefaultModelChoices,
  resolveLlmDefaultModelDraft,
  selectLlmDefaultModel,
  type LlmDefaultModelDraft,
} from './llm-default-model';
import type {
  ApiKeySettingsResponse,
  LlmDefaultModelSettingsResponse,
  LlmProviderId,
  LlmSettingsResponse,
} from './settings-types';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;
type ApiKeyProviderId = 'openai' | 'gemini' | 'openrouter' | 'groq';
type ApiKeyMutationInput = {
  provider: ApiKeyProviderId;
  action: 'save' | 'clear';
  apiKey: string;
};

function providerLabel(provider: LlmProviderId | ApiKeyProviderId): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'openrouter') return 'OpenRouter';
  if (provider === 'groq') return 'GROQ';
  return provider === 'gemini' ? 'Gemini' : 'OpenAI';
}

export type UseLlmSettingsResult = ReturnType<typeof useLlmSettings>;

export function useLlmSettings(requestJson: RequestJsonFn) {
  const queryClient = useQueryClient();
  const llmQueryKey = settingsQueryKey('llm');
  const defaultModelQueryKey = settingsQueryKey('llm-default-model');
  const llmQuery = useSettingsQuery<LlmSettingsResponse>(requestJson, llmQueryKey, '/api/settings/llm');
  const defaultModelQuery = useSettingsQuery<LlmDefaultModelSettingsResponse>(
    requestJson,
    defaultModelQueryKey,
    '/api/assistant/default-model',
  );
  const [llmSettingsError, setLlmSettingsError] = React.useState<string | null>(null);
  const [llmProviderDraft, setLlmProviderDraftValue] = React.useState<LlmProviderId>('openai');
  const [llmDefaultModelDraft, setLlmDefaultModelDraftValue] =
    React.useState<LlmDefaultModelDraft>({
      provider: 'openai',
      model: '',
      thinkingLevel: '',
    });
  const [showGeminiKey, setShowGeminiKey] = React.useState(false);
  const [geminiSettingsDraft, setGeminiSettingsDraft] = React.useState('');
  const [geminiDraftLoadedFromSettings, setGeminiDraftLoadedFromSettings] = React.useState(false);
  const [openAiSettingsDraft, setOpenAiSettingsDraft] = React.useState('');
  const [openAiDraftLoadedFromSettings, setOpenAiDraftLoadedFromSettings] = React.useState(false);
  const [showOpenAiKey, setShowOpenAiKey] = React.useState(false);
  const [openRouterSettingsDraft, setOpenRouterSettingsDraft] = React.useState('');
  const [openRouterDraftLoadedFromSettings, setOpenRouterDraftLoadedFromSettings] = React.useState(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = React.useState(false);
  const [groqSettingsDraft, setGroqSettingsDraft] = React.useState('');
  const [groqDraftLoadedFromSettings, setGroqDraftLoadedFromSettings] = React.useState(false);
  const [showGroqKey, setShowGroqKey] = React.useState(false);
  const [llmSettingsNotice, setLlmSettingsNotice] = React.useState<string | null>(null);

  const applyLlmDrafts = React.useCallback((
    settings: LlmSettingsResponse,
    defaults: LlmDefaultModelSettingsResponse,
  ) => {
    setLlmProviderDraftValue(settings.provider.selected);
    setLlmDefaultModelDraftValue(
      resolveLlmDefaultModelDraft(defaults.models, settings.provider.selected, defaults.defaultModel),
    );
  }, []);

  React.useEffect(() => {
    if (!llmQuery.data || !defaultModelQuery.data) return;
    applyLlmDrafts(llmQuery.data, defaultModelQuery.data);
  }, [applyLlmDrafts, defaultModelQuery.data, llmQuery.data?.provider.selected]);

  const loadLlmSettings = React.useCallback(async () => {
    setLlmSettingsError(null);
    const [llmResult, defaultsResult] = await Promise.all([
      llmQuery.refetch(),
      defaultModelQuery.refetch(),
    ]);
    const error = llmResult.error ?? defaultsResult.error;
    if (error) {
      setLlmSettingsError(settingsErrorMessage(error));
      return;
    }
    if (llmResult.data && defaultsResult.data) applyLlmDrafts(llmResult.data, defaultsResult.data);
  }, [applyLlmDrafts, defaultModelQuery.refetch, llmQuery.refetch]);

  const setLlmProviderDraft = React.useCallback(
    (provider: LlmProviderId) => {
      setLlmProviderDraftValue(provider);
      setLlmDefaultModelDraftValue(
        resolveLlmDefaultModelDraft(
          defaultModelQuery.data?.models ?? [],
          provider,
          defaultModelQuery.data?.defaultModel,
        ),
      );
    },
    [defaultModelQuery.data],
  );

  const setLlmDefaultModelDraft = React.useCallback(
    (model: string) => {
      setLlmDefaultModelDraftValue((current) =>
        selectLlmDefaultModel(defaultModelQuery.data?.models ?? [], current, model),
      );
    },
    [defaultModelQuery.data],
  );

  const setLlmDefaultReasoningDraft = React.useCallback((thinkingLevel: string) => {
    setLlmDefaultModelDraftValue((current) => ({ ...current, thinkingLevel }));
  }, []);

  const defaultModelChoices = React.useMemo(
    () =>
      llmDefaultModelChoices(
        defaultModelQuery.data?.models ?? [],
        llmDefaultModelDraft.provider,
      ),
    [defaultModelQuery.data, llmDefaultModelDraft.provider],
  );

  const updateProviderKeySettings = React.useCallback((provider: LlmProviderId | ApiKeyProviderId, data: ApiKeySettingsResponse) => {
    queryClient.setQueryData<LlmSettingsResponse>(llmQueryKey, (prev) => {
      if (!prev) return prev;
      const next = {
        hasKey: data.hasKey,
        source: data.source,
        keyHint: data.keyHint,
        updatedAt: data.updatedAt,
      };
      if (provider === 'openai') return { ...prev, openai: next };
      if (provider === 'codex') return { ...prev, codex: next };
      if (provider === 'openrouter') return { ...prev, openrouter: next };
      if (provider === 'groq') return { ...prev, groq: next };
      return { ...prev, gemini: next };
    });
  }, [llmQueryKey, queryClient]);

  const revealMutation = useMutation({
    mutationFn: (provider: ApiKeyProviderId) =>
      requestJson<ApiKeySettingsResponse>(`/api/settings/${provider}?reveal=1`),
  });
  const apiKeyMutation = useMutation({
    mutationFn: ({ provider, action, apiKey }: ApiKeyMutationInput) =>
      requestJson<ApiKeySettingsResponse>(`/api/settings/${provider}`, {
        method: action === 'save' ? 'POST' : 'DELETE',
        ...(action === 'save'
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ apiKey }),
            }
          : {}),
      }),
  });
  const providerMutation = useMutation({
    mutationFn: async () => {
      const defaults = await requestJson<LlmDefaultModelSettingsResponse>(
        '/api/assistant/default-model',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(llmDefaultModelDraft),
        },
      );
      const settings = await requestJson<LlmSettingsResponse>('/api/settings/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: llmProviderDraft }),
      });
      return { defaults, settings };
    },
  });

  const toggleApiKeyVisibility = React.useCallback(
    async (provider: ApiKeyProviderId) => {
      const showing =
        provider === 'openai'
          ? showOpenAiKey
          : provider === 'gemini'
            ? showGeminiKey
            : provider === 'openrouter'
              ? showOpenRouterKey
              : showGroqKey;
      const draft =
        provider === 'openai'
          ? openAiSettingsDraft
          : provider === 'gemini'
            ? geminiSettingsDraft
            : provider === 'openrouter'
              ? openRouterSettingsDraft
              : groqSettingsDraft;
      const hasKey =
        provider === 'openai'
          ? Boolean(llmQuery.data?.openai.hasKey)
          : provider === 'gemini'
            ? Boolean(llmQuery.data?.gemini.hasKey)
            : provider === 'openrouter'
              ? Boolean(llmQuery.data?.openrouter.hasKey)
              : Boolean(llmQuery.data?.groq.hasKey);
      const draftLoadedFromSettings =
        provider === 'openai'
          ? openAiDraftLoadedFromSettings
          : provider === 'gemini'
            ? geminiDraftLoadedFromSettings
            : provider === 'openrouter'
              ? openRouterDraftLoadedFromSettings
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
        } else if (provider === 'openrouter') {
          setShowOpenRouterKey(false);
          if (draftLoadedFromSettings) {
            setOpenRouterSettingsDraft('');
            setOpenRouterDraftLoadedFromSettings(false);
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
        setLlmSettingsError(null);
        try {
          const data = await revealMutation.mutateAsync(provider);
          const apiKey = String(data.apiKey ?? '').trim();
          if (!apiKey) throw new Error(`${providerLabel(provider)} API key is unavailable.`);
          updateProviderKeySettings(provider, data);
          if (provider === 'openai') {
            setOpenAiSettingsDraft(apiKey);
            setOpenAiDraftLoadedFromSettings(true);
          } else if (provider === 'gemini') {
            setGeminiSettingsDraft(apiKey);
            setGeminiDraftLoadedFromSettings(true);
          } else if (provider === 'openrouter') {
            setOpenRouterSettingsDraft(apiKey);
            setOpenRouterDraftLoadedFromSettings(true);
          } else {
            setGroqSettingsDraft(apiKey);
            setGroqDraftLoadedFromSettings(true);
          }
        } catch (e: any) {
          setLlmSettingsError(e?.message ?? String(e));
          return;
        }
      }

      if (provider === 'openai') setShowOpenAiKey(true);
      else if (provider === 'gemini') setShowGeminiKey(true);
      else if (provider === 'openrouter') setShowOpenRouterKey(true);
      else setShowGroqKey(true);
    },
    [
      geminiDraftLoadedFromSettings,
      geminiSettingsDraft,
      groqDraftLoadedFromSettings,
      groqSettingsDraft,
      llmQuery.data,
      openAiDraftLoadedFromSettings,
      openAiSettingsDraft,
      openRouterDraftLoadedFromSettings,
      openRouterSettingsDraft,
      requestJson,
      revealMutation,
      showGeminiKey,
      showGroqKey,
      showOpenAiKey,
      showOpenRouterKey,
      updateProviderKeySettings,
    ],
  );

  const mutateApiKeySettings = React.useCallback(
    async (provider: ApiKeyProviderId, action: 'save' | 'clear') => {
      const label = providerLabel(provider);
      const envKeyName =
        provider === 'gemini'
          ? 'GEMINI_API_KEY'
          : provider === 'openai'
            ? 'OPENAI_API_KEY'
            : provider === 'openrouter'
              ? 'OPENROUTER_API_KEY'
              : '';
      const draft =
        provider === 'openai'
          ? openAiSettingsDraft
          : provider === 'gemini'
            ? geminiSettingsDraft
            : provider === 'openrouter'
              ? openRouterSettingsDraft
              : groqSettingsDraft;
      const apiKey = String(maybeExtractApiKey(draft, provider) ?? '').trim();
      if (action === 'save') {
        if (!apiKey) {
          setLlmSettingsError(`${label} API key is required.`);
          return;
        }
        if (apiKey !== draft) {
          if (provider === 'openai') setOpenAiSettingsDraft(apiKey);
          else if (provider === 'gemini') setGeminiSettingsDraft(apiKey);
          else if (provider === 'openrouter') setOpenRouterSettingsDraft(apiKey);
          else setGroqSettingsDraft(apiKey);
        }
      }
      setLlmSettingsError(null);
      setLlmSettingsNotice(null);
      try {
        const data = await apiKeyMutation.mutateAsync({ provider, action, apiKey });
        updateProviderKeySettings(provider, data);
        if (provider === 'openai') {
          setOpenAiSettingsDraft('');
          setOpenAiDraftLoadedFromSettings(false);
          setShowOpenAiKey(false);
        } else if (provider === 'gemini') {
          setGeminiSettingsDraft('');
          setGeminiDraftLoadedFromSettings(false);
          setShowGeminiKey(false);
        } else if (provider === 'openrouter') {
          setOpenRouterSettingsDraft('');
          setOpenRouterDraftLoadedFromSettings(false);
          setShowOpenRouterKey(false);
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
      } catch (error) {
        setLlmSettingsError(settingsErrorMessage(error));
      }
    },
    [apiKeyMutation, geminiSettingsDraft, groqSettingsDraft, openAiSettingsDraft, openRouterSettingsDraft, updateProviderKeySettings],
  );

  const saveLlmProviderSettings = React.useCallback(async () => {
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
      const { defaults, settings: data } = await providerMutation.mutateAsync();
      queryClient.setQueryData(defaultModelQueryKey, defaults);
      queryClient.setQueryData<LlmSettingsResponse>(llmQueryKey, (prev) =>
        prev ? { ...prev, provider: data.provider } : data,
      );
      applyLlmDrafts(data, defaults);
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
    }
  }, [applyLlmDrafts, defaultModelChoices, defaultModelQueryKey, llmDefaultModelDraft, llmQueryKey, loadLlmSettings, providerMutation, queryClient]);

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

  const updateOpenRouterSettingsDraft = React.useCallback((raw: string) => {
    setOpenRouterDraftLoadedFromSettings(false);
    setOpenRouterSettingsDraft(maybeExtractApiKey(raw, 'openrouter'));
  }, []);

  return {
    llmSettings: llmQuery.data ?? null,
    llmSettingsLoading: llmQuery.isFetching || defaultModelQuery.isFetching,
    llmSettingsError: settingsQueryError(llmSettingsError, false, llmQuery, defaultModelQuery),
    llmProviderDraft,
    llmDefaultModelSettings: defaultModelQuery.data ?? null,
    llmDefaultModelDraft,
    llmDefaultModelChoices: defaultModelChoices,
    savingLlmProvider: providerMutation.isPending,
    showGeminiKey,
    revealingGeminiKey: revealMutation.isPending && revealMutation.variables === 'gemini',
    geminiSettingsDraft,
    savingGeminiSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'gemini' && apiKeyMutation.variables.action === 'save',
    clearingGeminiSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'gemini' && apiKeyMutation.variables.action === 'clear',
    openAiSettingsDraft,
    savingOpenAiSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'openai' && apiKeyMutation.variables.action === 'save',
    clearingOpenAiSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'openai' && apiKeyMutation.variables.action === 'clear',
    showOpenAiKey,
    revealingOpenAiKey: revealMutation.isPending && revealMutation.variables === 'openai',
    openRouterSettingsDraft,
    savingOpenRouterSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'openrouter' && apiKeyMutation.variables.action === 'save',
    clearingOpenRouterSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'openrouter' && apiKeyMutation.variables.action === 'clear',
    showOpenRouterKey,
    revealingOpenRouterKey: revealMutation.isPending && revealMutation.variables === 'openrouter',
    groqSettingsDraft,
    savingGroqSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'groq' && apiKeyMutation.variables.action === 'save',
    clearingGroqSettings: apiKeyMutation.isPending && apiKeyMutation.variables.provider === 'groq' && apiKeyMutation.variables.action === 'clear',
    showGroqKey,
    revealingGroqKey: revealMutation.isPending && revealMutation.variables === 'groq',
    llmSettingsNotice,
    setLlmProviderDraft,
    setLlmDefaultModelDraft,
    setLlmDefaultReasoningDraft,
    updateOpenAiSettingsDraft,
    updateGeminiSettingsDraft,
    updateOpenRouterSettingsDraft,
    updateGroqSettingsDraft,
    loadLlmSettings,
    saveLlmProviderSettings,
    toggleApiKeyVisibility,
    mutateApiKeySettings,
  };
}
