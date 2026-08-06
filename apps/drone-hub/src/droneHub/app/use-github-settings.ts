import type { GithubSettingsResponse } from './settings-types';
import { settingsQueryKey, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseGithubSettingsResult = ReturnType<typeof useGithubSettings>;

export function useGithubSettings(requestJson: RequestJsonFn) {
  const query = useSettingsQuery<GithubSettingsResponse>(
    requestJson,
    settingsQueryKey('github'),
    '/api/settings/github',
  );

  const loadGithubSettings = async () => {
    await query.refetch();
  };

  return {
    githubSettings: query.data ?? null,
    githubSettingsLoading: query.isFetching,
    githubSettingsError: query.error?.message ?? null,
    loadGithubSettings,
  };
}
