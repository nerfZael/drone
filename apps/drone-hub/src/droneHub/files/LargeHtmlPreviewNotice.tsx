import React from 'react';
import { HTML_PREVIEW_LIMIT_MESSAGE } from './html-preview-limits';

export function LargeHtmlPreviewNotice({ droneId, path, onViewSource }: { droneId: string; path: string; onViewSource?: () => void }) {
  const [opening, setOpening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const openPreview = window.droneHubDesktop?.openHtmlPreview;
  return <div role="alert" className="m-3 rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-2 text-compact">
    <p>{HTML_PREVIEW_LIMIT_MESSAGE}</p>
    {openPreview ? <p className="mt-2">You can open it in a separate preview window. External resources stay blocked.</p> : null}
    <div className="mt-2 flex gap-4">
      {onViewSource ? <button type="button" className="underline" onClick={onViewSource}>View source</button> : null}
      {openPreview ? <button type="button" className="underline" disabled={opening} onClick={() => {
        setOpening(true); setError(null);
        void openPreview({ droneId, path }).catch(error => setError(String(error?.message ?? error))).finally(() => setOpening(false));
      }}>{opening ? 'Opening…' : 'Open separate preview'}</button> : null}
    </div>
    {error ? <p className="mt-2 text-[var(--red)]">{error}</p> : null}
  </div>;
}
