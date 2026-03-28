import React from 'react';
import type { GithubSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseGithubSettingsResult = {
  githubSettings: GithubSettingsResponse | null;
  githubSettingsLoading: boolean;
  githubSettingsError: string | null;
  loadGithubSettings: () => Promise<void>;
};

export function useGithubSettings(requestJson: RequestJsonFn): UseGithubSettingsResult {
  const [githubSettings, setGithubSettings] = React.useState<GithubSettingsResponse | null>(null);
  const [githubSettingsLoading, setGithubSettingsLoading] = React.useState(false);
  const [githubSettingsError, setGithubSettingsError] = React.useState<string | null>(null);

  const loadGithubSettings = React.useCallback(async () => {
    setGithubSettingsLoading(true);
    setGithubSettingsError(null);
    try {
      const data = await requestJson<GithubSettingsResponse>('/api/settings/github');
      setGithubSettings(data);
    } catch (e: any) {
      setGithubSettingsError(e?.message ?? String(e));
    } finally {
      setGithubSettingsLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    void loadGithubSettings();
  }, [loadGithubSettings]);

  return {
    githubSettings,
    githubSettingsLoading,
    githubSettingsError,
    loadGithubSettings,
  };
}
