import React from 'react';
import type { ChangeRequestView } from '@drone/hub-model/change-requests';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import {
  closeChangeRequest,
  getChangeRequestByNumber,
  mergeChangeRequest,
} from '../changeRequests/change-request-api';
import { requestOpenChangeRequest } from '../changeRequests/change-request-navigation';
import { changeRequestStatusLabel } from '../changeRequests/change-request-presentation';
import { extractChangeRequestNumbers } from './change-request-references';
import { IconSpinner } from './icons';

export function LinkedChangeRequestCards({
  text,
  droneId,
  disabled = false,
  initiallyExpanded = false,
}: {
  text: string;
  droneId?: string;
  disabled?: boolean;
  initiallyExpanded?: boolean;
}) {
  const requestNumbers = React.useMemo(() => extractChangeRequestNumbers(text), [text]);
  if (!droneId || requestNumbers.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2.5" aria-label="Change requests linked in this message">
      {requestNumbers.map((requestNumber) => (
        <LinkedChangeRequestCard
          key={requestNumber}
          droneId={droneId}
          requestNumber={requestNumber}
          disabled={disabled}
          initiallyExpanded={initiallyExpanded}
        />
      ))}
    </div>
  );
}

function LinkedChangeRequestCard({
  droneId,
  requestNumber,
  disabled,
  initiallyExpanded,
}: {
  droneId: string;
  requestNumber: number;
  disabled: boolean;
  initiallyExpanded: boolean;
}) {
  const confirm = useAppConfirmDialog();
  const [request, setRequest] = React.useState<ChangeRequestView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'merge' | 'close' | null>(null);
  const [expanded, setExpanded] = React.useState(initiallyExpanded);

  React.useEffect(() => {
    setExpanded(initiallyExpanded);
  }, [initiallyExpanded]);

  React.useEffect(() => {
    let cancelled = false;
    setRequest(null);
    setLoading(true);
    setError(null);
    getChangeRequestByNumber(droneId, requestNumber)
      .then((loaded) => {
        if (!cancelled) setRequest(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [droneId, requestNumber]);

  const openRequest = React.useCallback(() => {
    requestOpenChangeRequest({ droneId, requestNumber });
  }, [droneId, requestNumber]);

  const merge = React.useCallback(async () => {
    if (!request || request.status !== 'open' || request.conflicted || disabled || busy) return;
    const accepted = await confirm({
      title: 'Merge change request?',
      message: `Squash-merge CR #${request.number} into ${request.destinationBranch}?`,
      confirmLabel: 'Merge directly',
    });
    if (!accepted) return;
    setBusy('merge');
    setError(null);
    try {
      setRequest(await mergeChangeRequest(request.number));
    } catch (cause: unknown) {
      setError(errorMessage(cause));
      setExpanded(true);
    } finally {
      setBusy(null);
    }
  }, [busy, confirm, disabled, request]);

  const close = React.useCallback(async () => {
    if (!request || request.status !== 'open' || disabled || busy) return;
    const accepted = await confirm({
      title: 'Close change request?',
      message: `Close CR #${request.number} without merging it?`,
      confirmLabel: 'Close request',
      destructive: true,
    });
    if (!accepted) return;
    setBusy('close');
    setError(null);
    try {
      setRequest(await closeChangeRequest(request.number));
    } catch (cause: unknown) {
      setError(errorMessage(cause));
      setExpanded(true);
    } finally {
      setBusy(null);
    }
  }, [busy, confirm, disabled, request]);

  const isOpen = request?.status === 'open';
  const status = request ? changeRequestStatusLabel(request) : loading ? 'loading' : 'unavailable';
  const displayedStatus = status.length > 0
    ? `${status.charAt(0).toUpperCase()}${status.slice(1)}`
    : status;
  const title = request?.title ?? `Change request #${requestNumber}`;

  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="w-full self-start overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-soft)]"
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)] [&::-webkit-details-marker]:hidden">
        {loading ? (
          <span
            role="status"
            aria-label="Loading change request"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--muted)]"
          >
            <IconSpinner className="h-3 w-3" />
          </span>
        ) : request?.status === 'merged' ? (
          <span
            data-change-request-state="merged"
            aria-live="polite"
            aria-label={`Change request state: ${displayedStatus}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-subtle)] px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] leading-none text-[var(--accent)]"
          >
            <MergedChangeRequestIcon />
            {displayedStatus}
          </span>
        ) : request ? (
          <span
            aria-live="polite"
            aria-label={`Change request state: ${displayedStatus}`}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] leading-none ${changeRequestStatePillClassName(status)}`}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80"
            />
            {displayedStatus}
          </span>
        ) : (
          <span className="inline-flex shrink-0 rounded-full bg-[var(--surface-strong)] px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--muted)]">
            Unavailable
          </span>
        )}
        <span className="shrink-0 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)]">
          CR
        </span>
        <span className="shrink-0 font-mono text-[var(--text-10)] text-[var(--muted)]">
          #{requestNumber}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openRequest();
          }}
          className="min-w-0 shrink truncate text-left text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)] hover:text-[var(--link-hover)] hover:underline"
          title={`Open ${title}`}
        >
          {title}
        </button>
        <span aria-hidden="true" className="min-w-4 flex-1" />
        {isOpen ? (
          <span
            className="flex shrink-0 items-center gap-1.5"
            aria-label="Change request actions"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={() => void close()}
              disabled={disabled || Boolean(busy)}
              className="inline-flex h-6 min-w-[46px] items-center justify-center rounded bg-[var(--surface-strong)] px-2 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] hover:bg-[var(--red-subtle)] hover:text-[var(--red)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy === 'close' ? 'Closing…' : 'Close'}
            </button>
            <button
              type="button"
              onClick={() => void merge()}
              disabled={disabled || request.conflicted || Boolean(busy)}
              className="inline-flex h-6 min-w-[50px] items-center justify-center rounded bg-[var(--green-subtle)] px-2 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--green)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-45"
              title={
                request.conflicted
                  ? 'Resolve conflicts before merging'
                  : `Merge CR #${request.number}`
              }
            >
              {busy === 'merge' ? 'Merging…' : request.conflicted ? 'Blocked' : 'Merge'}
            </button>
          </span>
        ) : null}
      </summary>
      {expanded ? (
        <div className="min-w-0 px-3 pb-2.5 pt-0.5 text-[var(--text-10)] text-[var(--muted-dim)]">
          {request ? (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="font-mono">
                {request.baseBranch} → {request.destinationBranch}
              </span>
              <span aria-hidden="true" className="text-[var(--border)]">
                ·
              </span>
              <span>{request.chatName}</span>
              <span aria-hidden="true" className="text-[var(--border)]">
                ·
              </span>
              <span>revision {request.revision}</span>
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="mt-2 border-t border-[var(--red-border)] pt-2 text-[var(--text-9)] text-[var(--red)]"
            >
              Status unavailable: {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function changeRequestStatePillClassName(status: string): string {
  if (status === 'open') return 'bg-[var(--green-subtle)] text-[var(--green)]';
  if (status === 'closed' || status === 'conflicted') {
    return 'bg-[var(--red-subtle)] text-[var(--red)]';
  }
  if (status === 'out of date') {
    return 'bg-[var(--yellow-subtle)] text-[var(--yellow)]';
  }
  return 'bg-[var(--surface-strong)] text-[var(--muted)]';
}

function MergedChangeRequestIcon() {
  return (
    <svg
      data-icon="change-request-merged"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="4" cy="3" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="13" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="11" cy="3" r="1.5" fill="currentColor" stroke="none" />
      <path d="M4 4.5v7M11 4.5v1A5.5 5.5 0 015.5 11H4" />
    </svg>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
