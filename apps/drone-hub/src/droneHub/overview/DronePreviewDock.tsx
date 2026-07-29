import React from 'react';
import {
  UiCountBadge,
  UiPaneState,
  UiPanel,
  UiPanelBody,
  UiPanelHeader,
  UiPanelStatusStrip,
  UiPanelToolbar,
  UiToolbarButton,
  UiToolbarIconButton,
  UiToolbarInput,
} from '../../ui/components';
import type { DronePortMapping, PortReachabilityByHostPort } from '../types';
import { DroneLinksContent } from './DroneLinksDock';
import { displayUrlForPreviewInput, normalizePreviewUrl } from './helpers';
import {
  isPreviewFocusUserRequested,
  NO_PREVIEW_POINTER_TIME,
  previewIframeSandboxForUrl,
} from './preview-iframe-containment';

function canRestoreFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element) return false;
  if (!document.contains(element)) return false;
  if (element.getClientRects().length === 0) return false;
  if ('disabled' in element && Boolean(element.disabled)) return false;
  return true;
}

export function DronePreviewDock({
  droneId,
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
  agentLabel,
  chatName,
}: {
  droneId: string;
  selectedPort: DronePortMapping | null;
  portRows: DronePortMapping[];
  portReachabilityByHostPort: PortReachabilityByHostPort;
  portsLoading: boolean;
  portsError: string | null;
  startup?: { waiting: boolean; timedOut: boolean; hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null; hubMessage?: string | null } | null;
  defaultPreviewUrl: string | null;
  previewUrlOverride: string | null;
  onSetPreviewUrlOverride: (nextUrl: string | null) => void;
  locked: boolean;
  onToggleLocked: () => void;
  agentLabel: string;
  chatName: string;
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
  const [linksExpanded, setLinksExpanded] = React.useState(false);
  const linksPanelId = React.useId();
  const iframeWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const lastFocusedElementRef = React.useRef<HTMLElement | null>(null);
  const lastPreviewPointerAtRef = React.useRef(NO_PREVIEW_POINTER_TIME);
  const usingCustomUrl = Boolean(previewUrlOverride);
  const reachableLinkCount = React.useMemo(
    () => portRows.filter((port) => (portReachabilityByHostPort[String(port.hostPort)] ?? 'checking') === 'up').length,
    [portReachabilityByHostPort, portRows],
  );
  const shouldShowOfflineState = Boolean(!usingCustomUrl && selectedPort && selectedReachability === 'down');
  const showStartupPlaceholder = Boolean(startup?.waiting) && !usingCustomUrl && !selectedUrl;
  const startupLabel = startup?.hubPhase === 'seeding' ? 'Seeding' : 'Starting';
  const startupDetail = String(startup?.hubMessage ?? '').trim();
  const previewIframeSandbox = React.useMemo(
    () => previewIframeSandboxForUrl(selectedUrl, typeof window === 'undefined' ? null : window.location.origin),
    [selectedUrl],
  );

  React.useEffect(() => {
    setIframeLoadFailed(false);
  }, [selectedUrl]);

  React.useEffect(() => {
    setLinksExpanded(false);
  }, [droneId]);

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

  React.useEffect(() => {
    const restoreFocusIfPreviewTookIt = () => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      const previewHovered = Boolean(iframe.matches(':hover') || iframeWrapperRef.current?.matches(':hover'));
      const focusWasUserRequested = isPreviewFocusUserRequested(
        performance.now(),
        lastPreviewPointerAtRef.current,
        previewHovered,
      );
      if (focusWasUserRequested) return;

      window.requestAnimationFrame(() => {
        if (!document.hasFocus()) return;
        if (document.activeElement !== iframe) return;

        const previous = lastFocusedElementRef.current;
        if (canRestoreFocus(previous)) {
          previous.focus({ preventScroll: true });
        } else {
          iframe.blur();
        }
      });
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const iframe = iframeRef.current;
      if (!(target instanceof HTMLElement) || !iframe) return;

      if (target !== iframe) {
        lastFocusedElementRef.current = target;
        return;
      }

      restoreFocusIfPreviewTookIt();
    };

    const onFocusOut = () => {
      window.setTimeout(restoreFocusIfPreviewTookIt, 0);
    };

    const onWindowBlur = () => {
      window.setTimeout(restoreFocusIfPreviewTookIt, 0);
    };

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, []);

  return (
    <UiPanel
      surface="alternate"
      className="relative h-full w-full rounded-none border-0"
    >
      <UiPanelHeader
        title="Browser"
        density="compact"
        meta={
          selectedPort ? (
            <span
              className="font-mono text-[length:var(--text-9)] text-[var(--muted-dim)]"
              title={`Browser container:${selectedPort.containerPort}`}
            >
              :{selectedPort.containerPort}
            </span>
          ) : (
            <span className="text-[length:var(--text-9)] text-[var(--muted-dim)]">
              {usingCustomUrl
                ? 'custom URL'
                : showStartupPlaceholder
                  ? startupLabel.toLowerCase()
                  : portsLoading
                    ? 'loading'
                    : 'none selected'}
            </span>
          )
        }
        actions={
          <>
            <UiToolbarIconButton
              label={locked ? 'Unlock browser session' : 'Lock browser session'}
              icon={
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={locked ? 'M4.5 7.25V5.75a3.5 3.5 0 0 1 7 0v1.5' : 'M5.5 7.25V5.75a2.5 2.5 0 1 1 5 0v1.5'} />
                  <rect x="3.25" y="7.25" width="9.5" height="6" rx="1.5" />
                </svg>
              }
              size="xsmall"
              tone="accent"
              pressed={locked}
              onClick={onToggleLocked}
              title={
                locked
                  ? 'Unlock browser session. Unlocking lets the Browser tab follow the active drone again.'
                  : 'Lock browser session. While locked, the Browser tab keeps this live page mounted across tab and drone switches.'
              }
            />
            <UiToolbarButton
              size="xsmall"
              tone="accent"
              active={linksExpanded}
              onClick={() => setLinksExpanded((expanded) => !expanded)}
              aria-expanded={linksExpanded}
              aria-controls={linksPanelId}
              title={linksExpanded ? 'Hide mapped links' : 'Show mapped links'}
            >
              Links
              <UiCountBadge>
                {portsLoading ? '…' : portsError ? '!' : `${reachableLinkCount}/${portRows.length}`}
              </UiCountBadge>
            </UiToolbarButton>
            <UiToolbarButton
              size="xsmall"
              onClick={refreshPreview}
              disabled={!selectedUrl}
              title={selectedUrl ? 'Reload browser preview' : 'No preview URL to reload'}
            >
              Refresh
            </UiToolbarButton>
            {selectedOpenUrl ? (
              <a
                href={selectedOpenUrl}
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap font-mono text-[length:var(--text-9)] text-[var(--link)] transition-colors hover:text-[var(--link-hover)]"
                title={`Open ${selectedOpenUrl} in a new tab`}
              >
                Open tab →
              </a>
            ) : null}
          </>
        }
      />

      <UiPanelToolbar aria-label="Browser address bar" className="px-3 py-2">
        <UiToolbarInput
          type="text"
          value={urlInput}
          readOnly={locked}
          invalid={Boolean(urlError)}
          onChange={(event) => {
            if (locked) return;
            setUrlInput(event.currentTarget.value);
            if (urlError) setUrlError(null);
          }}
          onKeyDown={(event) => {
            if (locked) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              savePreviewUrl();
            }
          }}
          placeholder={
            defaultDisplayUrl ||
            (selectedPort
              ? `http://localhost:${selectedPort.containerPort}/`
              : 'http://localhost:3000/')
          }
          aria-label="Browser URL"
          className="flex-1"
          title={
            locked
              ? 'Browser session is locked. Unlock to edit or save a new URL.'
              : 'Browser URL (saved per drone)'
          }
        />
        <UiToolbarButton
          onClick={savePreviewUrl}
          disabled={locked}
          title={
            locked
              ? 'Unlock the browser session to save a new URL.'
              : 'Save browser URL for this drone'
          }
        >
          Save
        </UiToolbarButton>
        <UiToolbarButton
          tone="accent"
          active={!locked && usingCustomUrl}
          onClick={() => {
            setUrlInput(defaultDisplayUrl);
            setUrlError(null);
            onSetPreviewUrlOverride(null);
          }}
          disabled={locked || !usingCustomUrl}
          title={
            locked
              ? 'Unlock the browser session to change its saved URL.'
              : 'Reset to selected port URL'
          }
        >
          Port URL
        </UiToolbarButton>
      </UiPanelToolbar>
      {urlError ? <UiPanelStatusStrip tone="danger">{urlError}</UiPanelStatusStrip> : null}

      <UiPanelBody className="flex flex-col">
        {linksExpanded ? (
          <div
            id={linksPanelId}
            className="max-h-[14rem] flex-shrink-0 overflow-auto border-b border-[var(--border-subtle)] bg-[var(--surface-inset-faint)]"
          >
            <DroneLinksContent
              agentLabel={agentLabel}
              chatName={chatName}
              portRows={portRows}
              portReachabilityByHostPort={portReachabilityByHostPort}
              portsError={portsError}
            />
          </div>
        ) : null}

        {!selectedUrl ? (
          <div className="min-h-0 flex-1 bg-[var(--surface-inset-faint)]">
            {showStartupPlaceholder ? (
              <UiPaneState
                kind={startup?.timedOut ? 'warning' : 'loading'}
                title={startupLabel}
                description={
                  <>
                  {startup?.timedOut
                    ? 'Still waiting for mapped ports. If this persists, the drone may be stuck provisioning.'
                    : 'Connecting… waiting for mapped ports.'}
                    {startupDetail ? <span className="mt-1 block">{startupDetail}</span> : null}
                  </>
                }
              />
            ) : portsError ? (
              <UiPaneState
                kind="error"
                title="Ports unavailable"
                description={portsError}
              />
            ) : portsLoading ? (
              <UiPaneState kind="loading" title="Loading mapped ports" />
            ) : (
              <UiPaneState
                kind="unavailable"
                title="No preview selected"
                description="Select a mapped port to open it here."
              />
            )}
          </div>
        ) : shouldShowOfflineState ? (
          <div className="min-h-0 flex-1 bg-[var(--surface-inset-faint)]">
            <UiPaneState
              kind="offline"
              title="Port looks offline"
              description="The saved URL is preserved while the service is unavailable."
              action={
                <UiToolbarButton tone="accent" onClick={refreshPreview}>
                  Try again
                </UiToolbarButton>
              }
            />
          </div>
        ) : iframeLoadFailed ? (
          <div className="min-h-0 flex-1 bg-[var(--surface-inset-faint)]">
            <UiPaneState
              kind="unavailable"
              title="Preview cannot be embedded"
              description="This service does not allow iframe embedding."
              action={
                selectedOpenUrl ? (
                  <a
                    href={selectedOpenUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[length:var(--text-10)] font-[var(--weight-semibold)] text-[var(--link)] hover:text-[var(--link-hover)]"
                  >
                    Open in a new tab →
                  </a>
                ) : null
              }
            />
          </div>
        ) : (
          <div
            ref={iframeWrapperRef}
            className="flex-1 min-h-0 w-full border-y border-[var(--border-subtle)] bg-white overflow-hidden"
            onPointerDownCapture={() => {
              lastPreviewPointerAtRef.current = performance.now();
            }}
            onPointerOverCapture={() => {
              lastPreviewPointerAtRef.current = performance.now();
            }}
            onTouchStartCapture={() => {
              lastPreviewPointerAtRef.current = performance.now();
            }}
          >
            <iframe
              ref={iframeRef}
              key={`${selectedUrl}::${iframeRefreshNonce}`}
              title={selectedPort ? `Browser container:${selectedPort.containerPort}` : `Browser ${selectedUrl}`}
              src={selectedUrl}
              loading="lazy"
              sandbox={previewIframeSandbox}
              className="w-full h-full"
              onError={() => setIframeLoadFailed(true)}
            />
          </div>
        )}
      </UiPanelBody>
    </UiPanel>
  );
}
