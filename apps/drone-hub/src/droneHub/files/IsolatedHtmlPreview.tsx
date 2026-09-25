import React from 'react';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { UiButton } from '../../ui/components';
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
  return <HtmlPreviewSession key={JSON.stringify([fileName, source])} source={source} fileName={fileName} />;
}

function HtmlPreviewSession({ source, fileName }: { source: string; fileName?: string | null }) {
  const confirm = useAppConfirmDialog();
  const [allowExternalResources, setAllowExternalResources] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const document = React.useMemo(
    () => buildIsolatedHtmlPreviewDocument(source, allowExternalResources),
    [source, allowExternalResources],
  );

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
            : 'Isolated preview: inline scripts run; external resources, network, storage, and DroneHub access are blocked.'}
        </span>
        <UiButton
          disabled={confirming}
          onClick={() => allowExternalResources ? setAllowExternalResources(false) : void enableExternalResources()}
        >
          {allowExternalResources ? 'Return to isolated preview' : 'Enable external resources'}
        </UiButton>
      </div>
      <iframe
        key={String(allowExternalResources)}
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
