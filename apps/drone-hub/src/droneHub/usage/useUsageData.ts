import React from 'react';
import type { UsageAnalytics } from '@drone/assistant-chat';
import { requestJson } from '../http';

export function useUsageData(url: string) {
  const [state, setState] = React.useState<{ url: string; data?: UsageAnalytics; error?: string }>({ url });
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await requestJson<UsageAnalytics>(url, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ url, data });
      } catch (error) {
        if (!controller.signal.aborted) setState((previous) => ({ url,
          data: previous.url === url ? previous.data : undefined,
          error: error instanceof Error ? error.message : String(error) }));
      }
      if (!controller.signal.aborted) timer = setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
        else timer = setTimeout(() => void load(), 30_000);
      }, 10_000);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [url, revision]);
  return { ...(state.url === url ? state : { url }), refresh };
}
