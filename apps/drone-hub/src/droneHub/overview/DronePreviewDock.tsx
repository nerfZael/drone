import React from 'react';
import type { DronePortMapping, PortReachabilityByHostPort } from '../types';
import { displayUrlForPreviewInput, normalizePreviewUrl } from './helpers';

export function DronePreviewDock({
  selectedPort,
  portRows,
  portReachabilityByHostPort,
  portsLoading,
  portsError,
  startup,
  defaultPreviewUrl,
  previewUrlOverride,
  onSetPreviewUrlOverride,
  locked,
  onToggleLocked,
}: {
  selectedPort: DronePortMapping | null;
  portRows: DronePortMapping[];
  portReachabilityByHostPort: PortReachabilityByHostPort;
  portsLoading: boolean;
  portsError: string | null;
  startup?: { waiting: boolean; timedOut: boolean; hubPhase?: 'creating' | 'starting' | 'seeding' | 'error' | null; hubMessage?: string | null } | null;
  defaultPreviewUrl: string | null;
  previewUrlOverride: string | null;
  onSetPreviewUrlOverride: (nextUrl: string | null) => void;
  locked: boolean;
  onToggleLocked: () => void;
}) {
  const selectedUrl = previewUrlOverride || defaultPreviewUrl;
  const selectedOpenUrl = selectedUrl;
  const displayedSelectedUrl = React.useMemo(() => displayUrlForPreviewInput(selectedUrl, portRows), [selectedUrl, portRows]);
  const defaultDisplayUrl = React.useMemo(() => displayUrlForPreviewInput(defaultPreviewUrl, portRows), [defaultPreviewUrl, portRows]);
  const selectedReachability = selectedPort
    ? (portReachabilityByHostPort[String(selectedPort.hostPort)] ?? 'checking')
    : 'checking';
  const [iframeLoadFailed, setIframeLoadFailed] = React.useState(false);
  const [iframeRefreshNonce, setIframeRefreshNonce] = React.useState(0);
  const [urlInput, setUrlInput] = React.useState(displayedSelectedUrl);
  const [urlError, setUrlError] = React.useState<string | null>(null);
  const usingCustomUrl = Boolean(previewUrlOverride);
  const shouldShowOfflineState = Boolean(!usingCustomUrl && selectedPort && selectedReachability === 'down');
  const showStartupPlaceholder = Boolean(startup?.waiting) && !usingCustomUrl && !selectedUrl;
  const startupLabel = startup?.hubPhase === 'seeding' ? 'Seeding' : 'Starting';
  const startupDetail = String(startup?.hubMessage ?? '').trim();

  React.useEffect(() => {
    setIframeLoadFailed(false);
  }, [selectedUrl]);

  React.useEffect(() => {
    setUrlInput(displayedSelectedUrl);
    setUrlError(null);
  }, [displayedSelectedUrl]);

  const savePreviewUrl = React.useCallback(() => {
    const normalized = normalizePreviewUrl(urlInput);
    if (!urlInput.trim()) {
      setUrlError(null);
      onSetPreviewUrlOverride(null);
      return;
    }
    if (!normalized) {
      setUrlError('Enter a valid http(s) URL.');
      return;
    }
    setUrlError(null);
    onSetPreviewUrlOverride(normalized);
  }, [onSetPreviewUrlOverride, urlInput]);

  const refreshPreview = React.useCallback(() => {
    if (!selectedUrl) return;
    setIframeLoadFailed(false);
    setIframeRefreshNonce((n) => n + 1);
  }, [selectedUrl]);

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] overflow-hidden flex flex-col relative">

      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div
          className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase flex items-center gap-1.5"
          style={{ fontFamily: 'var(--display)' }}
        >
          <span>Browser</span>
          <button
            type="button"
            onClick={onToggleLocked}
            aria-pressed={locked}
            className={`inline-flex items-center justify-center h-5 w-5 rounded border transition-colors ${
              locked
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            title={
              locked
                ? 'Unlock browser session. Unlocking lets the Browser tab follow the active drone again.'
                : 'Lock browser session. While locked, the Browser tab keeps this live page mounted across tab and drone switches.'
            }
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={locked ? 'M4.5 7.25V5.75a3.5 3.5 0 0 1 7 0v1.5' : 'M5.5 7.25V5.75a2.5 2.5 0 1 1 5 0v1.5'} />
              <rect x="3.25" y="7.25" width="9.5" height="6" rx="1.5" />
            </svg>
          </button>
        </div>
        <div className="min-w-0 flex items-center gap-2">
          {selectedPort ? (
            <div className="min-w-0 truncate text-[10px] text-[var(--muted-dim)] font-mono" title={`Browser container:${selectedPort.containerPort}`}>
              :{selectedPort.containerPort}
            </div>
          ) : (
            <div className="text-[10px] text-[var(--muted-dim)]">
              {usingCustomUrl ? 'custom URL' : showStartupPlaceholder ? startupLabel.toLowerCase() : portsLoading ? 'loading' : 'none selected'}
            </div>
          )}
          <button
            type="button"
            onClick={refreshPreview}
            disabled={!selectedUrl}
            className={`h-5 px-1.5 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
              selectedUrl
                ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-40 cursor-not-allowed'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={selectedUrl ? 'Reload browser preview' : 'No preview URL to reload'}
          >
            Refresh
          </button>
          {selectedOpenUrl && (
            <>
              <div className="w-px h-3 bg-[var(--border-subtle)] opacity-80" />
              <a
                href={selectedOpenUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[var(--accent)] hover:text-[var(--fg)] transition-colors font-mono whitespace-nowrap"
                title={`Open ${selectedOpenUrl} in a new tab`}
              >
                Open tab →
              </a>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={urlInput}
              readOnly={locked}
              onChange={(e) => {
                if (locked) return;
                setUrlInput(e.currentTarget.value);
                if (urlError) setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (locked) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  savePreviewUrl();
                }
              }}
              placeholder={defaultDisplayUrl || (selectedPort ? `http://localhost:${selectedPort.containerPort}/` : 'http://localhost:3000/')}
              className={`flex-1 min-w-0 h-7 rounded border px-2 text-[11px] text-[var(--fg-secondary)] font-mono transition-colors ${
                locked
                  ? 'border-[var(--accent-muted)] bg-[rgba(0,0,0,.22)] text-[var(--muted)] cursor-default'
                  : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] focus:outline-none focus:border-[var(--accent-muted)]'
              }`}
              title={locked ? 'Browser session is locked. Unlock to edit or save a new URL.' : 'Browser URL (saved per drone)'}
            />
            <button
              type="button"
              onClick={savePreviewUrl}
              disabled={locked}
              className="h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-colors"
              style={{ fontFamily: 'var(--display)' }}
              title={locked ? 'Unlock the browser session to save a new URL.' : 'Save browser URL for this drone'}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlInput(defaultDisplayUrl);
                setUrlError(null);
                onSetPreviewUrlOverride(null);
              }}
              disabled={locked || !usingCustomUrl}
              className={`h-7 px-2 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                !locked && usingCustomUrl
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-110'
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-40 cursor-not-allowed'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title={locked ? 'Unlock the browser session to change its saved URL.' : 'Reset to selected port URL'}
            >
              Port URL
            </button>
          </div>
          {urlError && <div className="mt-1 text-[10px] text-[var(--red)]">{urlError}</div>}
        </div>

        {!selectedUrl ? (
          <div className="flex-1 min-h-0 w-full border-y border-[var(--border-subtle)] bg-[rgba(0,0,0,.1)] text-[11px] text-[var(--muted-dim)] flex items-center justify-center text-center px-4">
            {showStartupPlaceholder ? (
              <div className="max-w-[340px]">
                <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                  {startupLabel}
                </div>
                <div className="mt-1">
                  {startup?.timedOut
                    ? 'Still waiting for mapped ports. If this persists, the drone may be stuck provisioning.'
                    : 'Connecting… waiting for mapped ports.'}
                </div>
                {startupDetail ? <div className="mt-1 text-[10px] text-[var(--muted-dim)]">{startupDetail}</div> : null}
              </div>
            ) : portsError ? (
              `Ports error: ${portsError}`
            ) : portsLoading ? (
              'Loading mapped ports...'
            ) : (
              'Select a mapped port to open it here.'
            )}
          </div>
        ) : shouldShowOfflineState ? (
          <div className="flex-1 min-h-0 w-full border-y border-[var(--border-subtle)] bg-[rgba(0,0,0,.1)] text-[11px] text-[var(--muted-dim)] flex items-center justify-center text-center px-4">
            Port looks offline right now.
          </div>
        ) : iframeLoadFailed ? (
          <div className="flex-1 min-h-0 w-full border-y border-[var(--border-subtle)] bg-[rgba(0,0,0,.1)] text-[11px] text-[var(--muted-dim)] flex items-center justify-center text-center px-4">
            This service does not allow iframe embedding.
          </div>
        ) : (
          <div className="flex-1 min-h-0 w-full border-y border-[var(--border-subtle)] bg-white overflow-hidden">
            <iframe
              key={`${selectedUrl}::${iframeRefreshNonce}`}
              title={selectedPort ? `Browser container:${selectedPort.containerPort}` : `Browser ${selectedUrl}`}
              src={selectedUrl}
              loading="lazy"
              className="w-full h-full"
              onError={() => setIframeLoadFailed(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
