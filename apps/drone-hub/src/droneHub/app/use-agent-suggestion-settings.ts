import React from 'react';
import type { AgentSuggestionSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseAgentSuggestionSettingsResult = {
  agentSuggestionSettings: AgentSuggestionSettingsResponse | null;
  agentSuggestionSettingsLoading: boolean;
  agentSuggestionSettingsError: string | null;
  agentSuggestionSettingsNotice: string | null;
  agentSuggestionPolicyDraft: string;
  agentSuggestionEnabledByDefaultDraft: boolean;
  savingAgentSuggestionSettings: boolean;
  setAgentSuggestionPolicyDraft: React.Dispatch<React.SetStateAction<string>>;
  setAgentSuggestionEnabledByDefaultDraft: React.Dispatch<React.SetStateAction<boolean>>;
  loadAgentSuggestionSettings: () => Promise<void>;
  saveAgentSuggestionSettings: () => Promise<void>;
};

export function useAgentSuggestionSettings(
  requestJson: RequestJsonFn,
): UseAgentSuggestionSettingsResult {
  const [agentSuggestionSettings, setAgentSuggestionSettings] =
    React.useState<AgentSuggestionSettingsResponse | null>(null);
  const [agentSuggestionSettingsLoading, setAgentSuggestionSettingsLoading] = React.useState(false);
  const [agentSuggestionSettingsError, setAgentSuggestionSettingsError] = React.useState<string | null>(null);
  const [agentSuggestionSettingsNotice, setAgentSuggestionSettingsNotice] = React.useState<string | null>(null);
  const [agentSuggestionPolicyDraft, setAgentSuggestionPolicyDraft] = React.useState('');
  const [agentSuggestionEnabledByDefaultDraft, setAgentSuggestionEnabledByDefaultDraft] = React.useState(false);
  const [savingAgentSuggestionSettings, setSavingAgentSuggestionSettings] = React.useState(false);

  const loadAgentSuggestionSettings = React.useCallback(async () => {
    setAgentSuggestionSettingsLoading(true);
    setAgentSuggestionSettingsError(null);
    setAgentSuggestionSettingsNotice(null);
    try {
      const data = await requestJson<AgentSuggestionSettingsResponse>('/api/settings/agent-suggestion');
      setAgentSuggestionSettings(data);
      setAgentSuggestionPolicyDraft(data.agentSuggestion.policyMarkdown);
      setAgentSuggestionEnabledByDefaultDraft(data.agentSuggestion.enabledByDefault);
    } catch (e: any) {
      setAgentSuggestionSettingsError(e?.message ?? String(e));
    } finally {
      setAgentSuggestionSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadAgentSuggestionSettings();
  }, [loadAgentSuggestionSettings]);

  const saveAgentSuggestionSettings = React.useCallback(async () => {
    setAgentSuggestionSettingsError(null);
    setAgentSuggestionSettingsNotice(null);
    setSavingAgentSuggestionSettings(true);
    try {
      const data = await requestJson<AgentSuggestionSettingsResponse>('/api/settings/agent-suggestion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyMarkdown: agentSuggestionPolicyDraft,
          enabledByDefault: agentSuggestionEnabledByDefaultDraft,
        }),
      });
      setAgentSuggestionSettings(data);
      setAgentSuggestionPolicyDraft(data.agentSuggestion.policyMarkdown);
      setAgentSuggestionEnabledByDefaultDraft(data.agentSuggestion.enabledByDefault);
      setAgentSuggestionSettingsNotice('Saved assistant suggestion settings.');
    } catch (e: any) {
      setAgentSuggestionSettingsError(e?.message ?? String(e));
    } finally {
      setSavingAgentSuggestionSettings(false);
    }
  }, [agentSuggestionEnabledByDefaultDraft, agentSuggestionPolicyDraft, requestJson]);

  return {
    agentSuggestionSettings,
    agentSuggestionSettingsLoading,
    agentSuggestionSettingsError,
    agentSuggestionSettingsNotice,
    agentSuggestionPolicyDraft,
    agentSuggestionEnabledByDefaultDraft,
    savingAgentSuggestionSettings,
    setAgentSuggestionPolicyDraft,
    setAgentSuggestionEnabledByDefaultDraft,
    loadAgentSuggestionSettings,
    saveAgentSuggestionSettings,
  };
}
