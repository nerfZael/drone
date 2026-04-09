import React from 'react';
import type { AgentsSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseAgentsSettingsResult = {
  agentsSettings: AgentsSettingsResponse | null;
  agentsSettingsLoading: boolean;
  agentsSettingsError: string | null;
  agentsSettingsNotice: string | null;
  agentsContentDraft: string;
  savingAgentsSettings: boolean;
  setAgentsContentDraft: React.Dispatch<React.SetStateAction<string>>;
  loadAgentsSettings: () => Promise<void>;
  saveAgentsSettings: () => Promise<void>;
};

export function useAgentsSettings(requestJson: RequestJsonFn): UseAgentsSettingsResult {
  const [agentsSettings, setAgentsSettings] = React.useState<AgentsSettingsResponse | null>(null);
  const [agentsSettingsLoading, setAgentsSettingsLoading] = React.useState(false);
  const [agentsSettingsError, setAgentsSettingsError] = React.useState<string | null>(null);
  const [agentsSettingsNotice, setAgentsSettingsNotice] = React.useState<string | null>(null);
  const [agentsContentDraft, setAgentsContentDraft] = React.useState('');
  const [savingAgentsSettings, setSavingAgentsSettings] = React.useState(false);

  const loadAgentsSettings = React.useCallback(async () => {
    setAgentsSettingsLoading(true);
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    try {
      const data = await requestJson<AgentsSettingsResponse>('/api/settings/agents');
      setAgentsSettings(data);
      setAgentsContentDraft(data.agents.content);
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setAgentsSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadAgentsSettings();
  }, [loadAgentsSettings]);

  const saveAgentsSettings = React.useCallback(async () => {
    setAgentsSettingsError(null);
    setAgentsSettingsNotice(null);
    setSavingAgentsSettings(true);
    try {
      const data = await requestJson<AgentsSettingsResponse>('/api/settings/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: agentsContentDraft }),
      });
      setAgentsSettings(data);
      setAgentsContentDraft(data.agents.content);
      setAgentsSettingsNotice(
        data.agents.enabled ? 'Saved default AGENTS.md for repo-attached container drones.' : 'Cleared the default AGENTS.md.',
      );
    } catch (e: any) {
      setAgentsSettingsError(e?.message ?? String(e));
    } finally {
      setSavingAgentsSettings(false);
    }
  }, [agentsContentDraft, requestJson]);

  return {
    agentsSettings,
    agentsSettingsLoading,
    agentsSettingsError,
    agentsSettingsNotice,
    agentsContentDraft,
    savingAgentsSettings,
    setAgentsContentDraft,
    loadAgentsSettings,
    saveAgentsSettings,
  };
}
