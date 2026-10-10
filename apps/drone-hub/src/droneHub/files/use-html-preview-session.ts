import React from 'react';
import { requestJson } from '../http';
import { htmlPreviewContentSecurityPolicy, htmlPreviewDocumentPrefix } from './html-preview-security';

/** Every preview URL for this drone starts here; the policy admits local media from it only. */
export function htmlPreviewMediaBase(droneId: string): string {
  return `${window.location.origin}/api/drones/${encodeURIComponent(droneId)}/fs/html-preview/`;
}

/**
 * A preview session lets the sandboxed frame fetch the HTML file and its local
 * images by URL. The Hub page holds neither; the Hub serves both with the policy.
 */
export function useHtmlPreviewSession(input: { droneId?: string; filePath?: string; allowExternalResources: boolean }) {
  const { droneId, filePath, allowExternalResources } = input;
  const [state, setState] = React.useState<{ key: string; url: string | null; error: string | null } | null>(null);
  const key = JSON.stringify([droneId, filePath, allowExternalResources]);
  React.useEffect(() => {
    if (!droneId || !filePath) return;
    const controller = new AbortController();
    const policy = htmlPreviewContentSecurityPolicy(allowExternalResources, htmlPreviewMediaBase(droneId));
    let url: string | null = null;
    void requestJson<{ ok: true; url: string } | { ok: false; error: string }>(
      `/api/drones/${encodeURIComponent(droneId)}/fs/html-preview`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: filePath, contentSecurityPolicy: policy, documentPrefix: htmlPreviewDocumentPrefix(policy) }),
        signal: controller.signal,
      },
    ).then(result => {
      if (controller.signal.aborted) return;
      if (!result.ok) throw new Error(result.error);
      url = result.url;
      setState({ key, url: result.url, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, url: null, error: String(error?.message ?? error) });
    });
    return () => {
      controller.abort();
      if (url) void fetch(url.split('/').slice(0, 7).join('/'), { method: 'DELETE', keepalive: true }).catch(() => {});
    };
  }, [droneId, filePath, allowExternalResources, key]);
  const current = state?.key === key ? state : null;
  return { url: current?.url ?? null, error: current?.error ?? null };
}
