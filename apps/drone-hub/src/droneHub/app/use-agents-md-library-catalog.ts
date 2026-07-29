import React from 'react';

import type { AgentsMdFileSummary, AgentsSettingsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export function useAgentsMdLibraryCatalog(requestJson: RequestJsonFn, enabled: boolean) {
  const [files, setFiles] = React.useState<AgentsMdFileSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestJson<AgentsSettingsResponse>('/api/settings/agents');
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (loadError: any) {
      setError(loadError?.message ?? String(loadError));
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  React.useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return { files, loading, error, load };
}
