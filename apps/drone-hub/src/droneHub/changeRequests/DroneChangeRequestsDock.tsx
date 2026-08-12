import React from 'react';
import type { ChangeRequestView } from '@drone/hub-model/change-requests';

import {
  UiButton,
  UiCenteredLoadingState,
  UiPaneState,
  UiPanel,
  UiPanelStatusStrip,
} from '../../ui/components';
import { UnifiedRequestList, type UnifiedRequestListItem } from '../requests/UnifiedRequestList';
import { ChangeRequestDetail } from './ChangeRequestDetail';
import {
  changeRequestEventsUrl,
  createChangeRequest,
  listChangeRequests,
} from './change-request-api';
import {
  consumeRequestedChangeRequest,
  OPEN_CHANGE_REQUEST_EVENT,
  type OpenChangeRequestDetail,
} from './change-request-navigation';

type ChangeRequestFilter = 'all' | 'open' | 'merged' | 'closed';

export function DroneChangeRequestsDock({
  droneId,
  chatName,
  repoAttached,
  repoPath,
  disabled,
  onRevealFileInFiles,
  onOpenFileInEditor,
}: {
  droneId: string;
  chatName: string;
  repoAttached: boolean;
  repoPath: string;
  disabled: boolean;
  onRevealFileInFiles: (repoRelativePath: string) => void;
  onOpenFileInEditor: (repoRelativePath: string) => void;
}) {
  const [requests, setRequests] = React.useState<ChangeRequestView[]>([]);
  const [selectedNumber, setSelectedNumber] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [checkedNumbers, setCheckedNumbers] = React.useState<Set<number>>(() => new Set());
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<ChangeRequestFilter>('all');
  const [createTitle, setCreateTitle] = React.useState('');
  const [createDescription, setCreateDescription] = React.useState('');
  const [createDestination, setCreateDestination] = React.useState('');
  const requestedNumberRef = React.useRef<number | null>(null);
  const selected = requests.find((request) => request.number === selectedNumber) ?? null;
  const requestCounts = React.useMemo(
    () => ({
      all: requests.length,
      open: requests.filter((request) => request.status === 'open').length,
      merged: requests.filter((request) => request.status === 'merged').length,
      closed: requests.filter((request) => request.status === 'closed').length,
    }),
    [requests],
  );
  const visibleRequests = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return requests.filter((request) => {
      if (statusFilter !== 'all' && request.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [
        request.title,
        request.chatName,
        request.baseBranch,
        request.destinationBranch,
        `#${request.number}`,
      ].some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [query, requests, statusFilter]);
  const listItems = React.useMemo<UnifiedRequestListItem[]>(
    () =>
      visibleRequests.map((request) => ({
        number: request.number,
        title: request.title,
        state: request.status,
        updatedAt: request.updatedAt,
        lineStats: request.lineStats,
        metadata: (
          <>
            <span>{request.chatName}</span>
            <span aria-hidden="true">·</span>
            <span
              className="font-mono"
              title={`${request.baseBranch} → ${request.destinationBranch}`}
            >
              {request.baseBranch} → {request.destinationBranch}
            </span>
            <span aria-hidden="true">·</span>
            <span>revision {request.revision}</span>
          </>
        ),
        signals: (
          <>
            {request.conflicted ? (
              <span className="text-[var(--text-9)] text-[var(--red)]">Conflicts</span>
            ) : request.stale ? (
              <span className="text-[var(--text-9)] text-[var(--yellow)]">Out of date</span>
            ) : null}
            {!request.destinationExists && request.status === 'open' ? (
              <span className="text-[var(--text-9)] text-[var(--accent)]">New branch</span>
            ) : null}
          </>
        ),
        selectionDisabled: request.status !== 'open',
      })),
    [visibleRequests],
  );

  const loadRequests = React.useCallback(
    async (preserveSelection = true, silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const loaded = await listChangeRequests(droneId);
        setRequests(loaded);
        const queuedRequestNumber = consumeRequestedChangeRequest(droneId);
        const requestedNumber = requestedNumberRef.current ?? queuedRequestNumber;
        const requested = loaded.find((request) => request.number === requestedNumber);
        if (requested) {
          requestedNumberRef.current = null;
          setSelectedNumber(requested.number);
          return;
        }
        requestedNumberRef.current = null;
        setSelectedNumber((current) => {
          if (
            preserveSelection &&
            current &&
            loaded.some((request) => request.number === current)
          ) {
            return current;
          }
          return null;
        });
      } catch (cause: unknown) {
        setError(errorMessage(cause));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [droneId],
  );

  React.useEffect(() => {
    setSelectedNumber(null);
    setShowCreate(false);
    setCheckedNumbers(new Set());
    setQuery('');
    setStatusFilter('all');
    void loadRequests(false);
  }, [loadRequests]);

  React.useEffect(() => {
    const available = new Set(
      requests.filter((request) => request.status === 'open').map((request) => request.number),
    );
    setCheckedNumbers((current) => {
      const next = new Set([...current].filter((number) => available.has(number)));
      return next.size === current.size ? current : next;
    });
  }, [requests]);

  React.useEffect(() => {
    const openRequest = (event: Event) => {
      const detail = (event as CustomEvent<OpenChangeRequestDetail>).detail;
      if (!detail || detail.droneId !== droneId) return;
      requestedNumberRef.current = detail.requestNumber;
      void loadRequests();
    };
    window.addEventListener(OPEN_CHANGE_REQUEST_EVENT, openRequest);
    return () => window.removeEventListener(OPEN_CHANGE_REQUEST_EVENT, openRequest);
  }, [droneId, loadRequests]);

  React.useEffect(() => {
    if (
      !repoAttached ||
      disabled ||
      typeof window === 'undefined' ||
      typeof window.EventSource === 'undefined'
    ) {
      return;
    }
    const events = new window.EventSource(changeRequestEventsUrl(droneId));
    const refresh = () => void loadRequests(true, true);
    events.addEventListener('connected', refresh);
    events.addEventListener('change_request_changed', refresh);
    return () => events.close();
  }, [disabled, droneId, loadRequests, repoAttached]);

  const replaceRequest = React.useCallback((request: ChangeRequestView) => {
    setRequests((current) =>
      current.map((candidate) => (candidate.number === request.number ? request : candidate)),
    );
  }, []);

  const createRequest = React.useCallback(async () => {
    if (!createTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const request = await createChangeRequest({
        droneRef: droneId,
        chatName,
        title: createTitle,
        description: createDescription,
        destinationBranch: createDestination || undefined,
      });
      setRequests((current) => [request, ...current]);
      setSelectedNumber(request.number);
      setCreateTitle('');
      setCreateDescription('');
      setCreateDestination('');
      setShowCreate(false);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }, [chatName, createDescription, createDestination, createTitle, droneId]);

  if (selected) {
    return (
      <ChangeRequestDetail
        request={selected}
        droneId={droneId}
        repoAttached={repoAttached}
        repoPath={repoPath}
        disabled={disabled}
        onBack={() => setSelectedNumber(null)}
        onChange={replaceRequest}
        onRevealFileInFiles={onRevealFileInFiles}
        onOpenFileInEditor={onOpenFileInEditor}
      />
    );
  }

  return (
    <UiPanel flush surface="alternate" className="h-full w-full">
      {showCreate ? (
        <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-3">
          <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">
            Capture committed changes
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <input
              autoFocus
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
              placeholder="Title"
              className="h-8 w-full rounded-[var(--radius-medium)] border border-transparent bg-[var(--surface-inset)] px-2.5 text-[var(--text-11)] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
            />
            <input
              value={createDestination}
              onChange={(event) => setCreateDestination(event.target.value)}
              placeholder="Destination branch (optional)"
              className="h-8 w-full rounded-[var(--radius-medium)] border border-transparent bg-[var(--surface-inset)] px-2.5 font-mono text-[var(--text-10)] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
            />
          </div>
          <textarea
            value={createDescription}
            onChange={(event) => setCreateDescription(event.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="mt-2 w-full resize-y rounded-[var(--radius-medium)] border border-transparent bg-[var(--surface-inset)] p-2.5 text-[var(--text-11)] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-1.5">
            <UiButton
              size="small"
              variant="primary"
              disabled={creating || !createTitle.trim()}
              onClick={() => void createRequest()}
            >
              {creating ? 'Creating…' : 'Create'}
            </UiButton>
            <UiButton size="small" variant="ghost" disabled={creating} onClick={() => setShowCreate(false)}>
              Cancel
            </UiButton>
            <span className="ml-1 text-[var(--text-9)] text-[var(--muted-dim)]">
              Uses chat {chatName}. Commit source changes first.
            </span>
          </div>
        </div>
      ) : null}
      {error ? <UiPanelStatusStrip tone="danger">{error}</UiPanelStatusStrip> : null}
      {!repoAttached ? (
        <UiPaneState
          kind="unavailable"
          title="Repository unavailable"
          description="Attach a repository to use change requests."
        />
      ) : loading && requests.length === 0 ? (
        <UiCenteredLoadingState message="Loading change requests…" />
      ) : (
        <UnifiedRequestList
          ariaLabel="Change requests"
          items={listItems}
          selectedNumbers={checkedNumbers}
          onSelectedNumbersChange={setCheckedNumbers}
          onOpenRequest={setSelectedNumber}
          query={query}
          onQueryChange={setQuery}
          queryPlaceholder="Search change requests"
          toolbarTrailing={
            <UiButton
              size="small"
              variant="primary"
              leadingIcon={<NewRequestIcon />}
              disabled={!repoAttached || disabled || creating}
              onClick={() => setShowCreate((value) => !value)}
              aria-pressed={showCreate}
              title="Create a change request"
            >
              New
            </UiButton>
          }
          emptyTitle={requests.length === 0 ? 'No change requests yet' : undefined}
          emptyDescription={
            requests.length === 0
              ? 'Create one here, or let an agent capture the next committed change.'
              : undefined
          }
          filters={[
            { value: 'all', label: 'All', count: requestCounts.all },
            { value: 'open', label: 'Open', count: requestCounts.open },
            { value: 'merged', label: 'Merged', count: requestCounts.merged },
            { value: 'closed', label: 'Closed', count: requestCounts.closed },
          ]}
          activeFilter={statusFilter}
          onFilterChange={(value) => setStatusFilter(value as ChangeRequestFilter)}
          mergeAction={{
            label: 'Merge',
            title: 'Bulk change-request merging is coming soon',
            tone: 'success',
            disabled: true,
          }}
          closeAction={{
            label: 'Close',
            title: 'Bulk change-request closing is coming soon',
            tone: 'danger',
            disabled: true,
          }}
        />
      )}
    </UiPanel>
  );
}

function NewRequestIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
