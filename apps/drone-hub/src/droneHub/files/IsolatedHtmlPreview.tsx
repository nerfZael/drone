import React from 'react';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { UiButton } from '../../ui/components';
import {
  buildIsolatedHtmlPreviewDocument,
  HTML_PREVIEW_IFRAME_SANDBOX,
  HTML_PREVIEW_PERMISSIONS_POLICY,
} from './html-preview-security';
import { htmlPreviewMediaBase, useHtmlPreviewSession } from './use-html-preview-session';

// React 18's iframe types predate this Chromium attribute. Its presence gives
// the preview an ephemeral, credential-free network/storage context.
const credentiallessIframeProps = { credentialless: '' };

/**
 * Renders `source` when given (an open editor buffer, including unsaved edits);
 * otherwise the frame loads the file itself from the Hub, so file size is not
 * bounded by the Hub page's memory. Sandboxed frames run in their own process.
 */
export function IsolatedHtmlPreview({
  source,
  fileName,
  droneId,
  filePath,
}: {
  source: string | null;
  fileName?: string | null;
  droneId?: string;
  filePath?: string;
}) {
  // A key is an identity, never a serialization of the document. Keep the source
  // reference only, and reset consent whenever the accepted document changes.
  const [session, setSession] = React.useState({ droneId, filePath, fileName, source, id: 0 });
  let current = session;
  if (session.droneId !== droneId || session.filePath !== filePath || session.fileName !== fileName || session.source !== source) {
    current = { droneId, filePath, fileName, source, id: session.id + 1 };
    setSession(current);
  }
  return <HtmlPreviewSession key={current.id} source={source} fileName={fileName} droneId={droneId} filePath={filePath} />;
}

function HtmlPreviewSession({ source, fileName, droneId, filePath }: { source: string | null; fileName?: string | null; droneId?: string; filePath?: string }) {
  const confirm = useAppConfirmDialog();
  const [allowExternalResources, setAllowExternalResources] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const local = Boolean(droneId && filePath);
  const preview = useHtmlPreviewSession({ droneId, filePath, allowExternalResources });
  const document = React.useMemo(() => {
    if (source == null) return null;
    if (!local) return buildIsolatedHtmlPreviewDocument(source, allowExternalResources);
    // Without a session the page still renders; only its local images are missing.
    if (!preview.url && !preview.error) return null;
    return buildIsolatedHtmlPreviewDocument(
      source,
      allowExternalResources,
      preview.url ? { baseHref: preview.url, mediaBase: htmlPreviewMediaBase(droneId!) } : undefined,
    );
  }, [source, local, droneId, allowExternalResources, preview.url, preview.error]);

  async function enableExternalResources() {
    setConfirming(true);
    try {
      if (await confirm({
        title: 'Enable external resources?',
        message: 'This reloads the preview and lets it download and run external scripts, load other resources, and make network requests. Scripts can send this file’s contents to third parties or contact services on your local network. Only enable this for HTML you trust. Browser storage and direct access to DroneHub remain blocked. This permission lasts only for the current preview; refreshing or reopening it requires confirmation again.',
        confirmLabel: 'Enable external resources',
        cancelLabel: 'Keep isolated',
        destructive: true,
      })) setAllowExternalResources(true);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-1.5 text-10 text-[var(--muted)]">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${allowExternalResources ? 'bg-[var(--yellow)]' : 'bg-[var(--green)]'}`}
          aria-hidden="true"
        />
        <span className="flex-1">
          {allowExternalResources
            ? 'External resources enabled: scripts and network requests can run. Storage and direct DroneHub access remain blocked.'
            : 'Isolated preview: local images and inline scripts work; external resources, network, storage, and DroneHub access are blocked.'}
        </span>
        <UiButton
          disabled={confirming}
          onClick={() => allowExternalResources ? setAllowExternalResources(false) : void enableExternalResources()}
        >
          {allowExternalResources ? 'Return to isolated preview' : 'Enable external resources'}
        </UiButton>
      </div>
      {preview.error ? <div role={source == null ? 'alert' : 'status'} className="shrink-0 bg-[var(--panel-alt)] px-3 py-1.5 text-10 text-[var(--muted)]">
        {source == null ? `Could not load the preview: ${preview.error}` : `Local images are unavailable: ${preview.error}`}
      </div> : null}
      {document != null || (source == null && preview.url) ? <iframe
        key={String(allowExternalResources)}
        title={`${fileName || 'HTML file'} preview`}
        sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
        allow={HTML_PREVIEW_PERMISSIONS_POLICY}
        referrerPolicy="no-referrer"
        {...(document != null ? { srcDoc: document } : { src: preview.url! })}
        {...credentiallessIframeProps}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      /> : preview.error ? null : <div role="status" className="p-3 text-12 text-[var(--muted)]">Loading preview…</div>}
    </div>
  );
}
