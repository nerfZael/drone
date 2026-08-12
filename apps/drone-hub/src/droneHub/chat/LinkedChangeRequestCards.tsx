import React from 'react';
import type { ChangeRequestView } from '@drone/hub-model/change-requests';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { cn } from '../../ui/cn';
import {
  closeChangeRequest,
  getChangeRequestByNumber,
  mergeChangeRequest,
} from '../changeRequests/change-request-api';
import { requestOpenChangeRequest } from '../changeRequests/change-request-navigation';
import {
  changeRequestStatusClasses,
  changeRequestStatusLabel,
} from '../changeRequests/change-request-presentation';
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
        ) : request ? (
          <span
            className={cn(
              'inline-flex shrink-0 rounded-full border px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase leading-none',
              changeRequestStatusClasses(request),
            )}
          >
            {status}
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
              <button
                type="button"
                onClick={openRequest}
                className="ml-auto text-[var(--accent)] hover:underline"
              >
                Open in change requests
              </button>
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
