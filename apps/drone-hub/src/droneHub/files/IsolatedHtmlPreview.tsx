import React from 'react';
import {
  buildIsolatedHtmlPreviewDocument,
  HTML_PREVIEW_IFRAME_SANDBOX,
  HTML_PREVIEW_PERMISSIONS_POLICY,
} from './html-preview-security';

// React 18's iframe types predate this Chromium attribute. Its presence gives
// the preview an ephemeral, credential-free network/storage context.
const credentiallessIframeProps = { credentialless: '' };

export function IsolatedHtmlPreview({
  source,
  fileName,
}: {
  source: string;
  fileName?: string | null;
}) {
  const document = React.useMemo(() => buildIsolatedHtmlPreviewDocument(source), [source]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-1.5 text-[var(--text-10)] text-[var(--muted)]">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--green)]"
          aria-hidden="true"
        />
        Isolated preview: scripts run; network, storage, and DroneHub access are blocked.
      </div>
      <iframe
        title={`${fileName || 'HTML file'} preview`}
        sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
        allow={HTML_PREVIEW_PERMISSIONS_POLICY}
        referrerPolicy="no-referrer"
        srcDoc={document}
        {...credentiallessIframeProps}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
