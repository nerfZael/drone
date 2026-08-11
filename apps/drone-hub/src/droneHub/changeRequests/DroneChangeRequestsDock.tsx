import React from 'react';

import { requestJson } from '../http';
import { cn } from '../../ui/cn';
import { DiffBlock } from '../changes/DiffBlock';
import type { DiffState } from '../changes/types';

type ChangeRequestStatus = 'open' | 'merged' | 'closed';

type ChangeRequest = {
  id: string;
  number: number;
  status: ChangeRequestStatus;
  droneId: string;
  droneName: string;
  chatName: string;
  baseBranch: string;
  baseSha: string;
  destinationBranch: string;
  snapshotSha: string | null;
  revision: number;
  title: string;
  description: string;
  stale: boolean;
  conflicted: boolean;
  destinationExists: boolean;
  destinationSha: string | null;
  conflictFiles: string[];
  mergeCommitSha: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChangeEntry = {
  path: string;
  originalPath: string | null;
  statusChar: string;
  statusType: string;
  additions: number;
  deletions: number;
};

type ChangesPayload = {
  ok: true;
  entries: ChangeEntry[];
  counts: { changed: number; additions: number; deletions: number };
};

type RequestMutationPayload = { ok: true; request: ChangeRequest };

function shortSha(value: string | null): string {
  return value ? value.slice(0, 8) : '—';
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function statusLabel(request: ChangeRequest): string {
  if (request.status !== 'open') return request.status;
  if (request.conflicted) return 'conflicted';
  if (request.stale) return 'stale';
  return 'open';
}

function statusClasses(request: ChangeRequest): string {
  const status = statusLabel(request);
  if (status === 'merged')
    return 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]';
  if (status === 'conflicted')
    return 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]';
  if (status === 'stale')
    return 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)] text-[var(--yellow)]';
  return 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]';
}

export function DroneChangeRequestsDock({
  droneId,
  droneName,
  chatName,
  repoAttached,
  disabled,
}: {
  droneId: string;
  droneName: string;
  chatName: string;
  repoAttached: boolean;
  disabled: boolean;
}) {
  const [requests, setRequests] = React.useState<ChangeRequest[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [createTitle, setCreateTitle] = React.useState('');
  const [createDescription, setCreateDescription] = React.useState('');
  const [createDestination, setCreateDestination] = React.useState('');
  const [draftTitle, setDraftTitle] = React.useState('');
  const [draftDescription, setDraftDescription] = React.useState('');
  const [draftDestination, setDraftDestination] = React.useState('');
  const [mergeCommitMessage, setMergeCommitMessage] = React.useState('');
  const [assessmentLoading, setAssessmentLoading] = React.useState(false);
  const [changes, setChanges] = React.useState<ChangesPayload | null>(null);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState('');
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState<string | null>(null);
  const [diffTruncated, setDiffTruncated] = React.useState(false);

  const selected = requests.find((request) => request.id === selectedId) ?? null;

  const loadRequests = React.useCallback(
    async (preserveSelection = true) => {
      setLoading(true);
      setError(null);
      try {
        const data = await requestJson<{ ok: true; requests: ChangeRequest[] }>(
          `/api/change-requests?droneId=${encodeURIComponent(droneId)}`,
        );
        setRequests(data.requests);
        setSelectedId((current) => {
          if (
            preserveSelection &&
            current &&
            data.requests.some((request) => request.id === current)
          ) {
            return current;
          }
          return null;
        });
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        setLoading(false);
      }
    },
    [droneId],
  );

  React.useEffect(() => {
    setSelectedId(null);
    setShowCreate(false);
    void loadRequests(false);
  }, [loadRequests]);

  React.useEffect(() => {
    if (!selected) {
      setChanges(null);
      setSelectedPath(null);
      setDiff('');
      setDiffError(null);
      setDiffTruncated(false);
      return;
    }
    setSelectedPath(null);
    setDiff('');
    setDiffError(null);
    setDiffTruncated(false);
    setDraftTitle(selected.title);
    setDraftDescription(selected.description);
    setDraftDestination(selected.destinationBranch);
    setMergeCommitMessage('');
    if (selected.status !== 'open') {
      setChanges(null);
      return;
    }
    let cancelled = false;
    setChangesLoading(true);
    requestJson<ChangesPayload>(`/api/change-requests/${encodeURIComponent(selected.id)}/changes`)
      .then((data) => {
        if (!cancelled) setChanges(data);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? String(err));
      })
      .finally(() => {
        if (!cancelled) setChangesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.revision, selected?.status]);

  React.useEffect(() => {
    if (!selected || selected.status !== 'open') {
      setAssessmentLoading(false);
      return;
    }
    let cancelled = false;
    setAssessmentLoading(true);
    requestJson<RequestMutationPayload>(
      `/api/change-requests/${encodeURIComponent(selected.id)}/refresh-assessment`,
      { method: 'POST' },
    )
      .then((data) => {
        if (cancelled) return;
        setRequests((current) =>
          current.map((request) => (request.id === data.request.id ? data.request : request)),
        );
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? String(err));
      })
      .finally(() => {
        if (!cancelled) setAssessmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.revision, selected?.status]);

  const replaceRequest = React.useCallback((request: ChangeRequest) => {
    setRequests((current) =>
      current.map((candidate) => (candidate.id === request.id ? request : candidate)),
    );
  }, []);

  const mutate = React.useCallback(
    async (
      action: string,
      pathname: string,
      method: 'PATCH' | 'POST',
      body: Record<string, unknown> = {},
    ) => {
      setBusy(action);
      setError(null);
      try {
        const data = await requestJson<RequestMutationPayload>(pathname, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        replaceRequest(data.request);
        return data.request;
      } catch (err: any) {
        setError(err?.message ?? String(err));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [replaceRequest],
  );

  const createRequest = React.useCallback(async () => {
    if (!createTitle.trim()) return;
    setBusy('create');
    setError(null);
    try {
      const data = await requestJson<RequestMutationPayload>('/api/change-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          droneRef: droneId,
          chatName,
          title: createTitle,
          description: createDescription,
          destinationBranch: createDestination || undefined,
          actor: { kind: 'user', id: null, label: 'DroneHub user' },
        }),
      });
      setRequests((current) => [data.request, ...current]);
      setSelectedId(data.request.id);
      setCreateTitle('');
      setCreateDescription('');
      setCreateDestination('');
      setShowCreate(false);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  }, [chatName, createDescription, createDestination, createTitle, droneId]);

  const loadDiff = React.useCallback(
    async (filePath: string) => {
      if (!selected) return;
      setSelectedPath(filePath);
      setDiffLoading(true);
      setDiffError(null);
      setDiffTruncated(false);
      setError(null);
      try {
        const data = await requestJson<{ ok: true; diff: string; truncated: boolean }>(
          `/api/change-requests/${encodeURIComponent(selected.id)}/diff?path=${encodeURIComponent(filePath)}&contextLines=5`,
        );
        setDiff(data.diff);
        setDiffTruncated(data.truncated);
      } catch (err: any) {
        setError(err?.message ?? String(err));
        setDiffError(err?.message ?? String(err));
        setDiff('');
      } finally {
        setDiffLoading(false);
      }
    },
    [selected],
  );

  const diffState: DiffState | undefined = diffLoading
    ? { status: 'loading' }
    : diffError
      ? { status: 'error', error: diffError }
      : selectedPath
        ? {
            status: 'loaded',
            text: diff,
            truncated: diffTruncated,
            fromUntracked: false,
            isBinary: false,
            noTextReason: diff ? null : 'empty',
            contextLines: 5,
          }
        : undefined;

  if (!repoAttached) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[var(--text-12)] text-[var(--muted)]">
        Attach a repository to use change requests.
      </div>
    );
  }

  if (selected) {
    const isOpen = selected.status === 'open';
    const actionDisabled = disabled || busy !== null || assessmentLoading;
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--panel-alt)]">
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2.5">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="rounded px-2 py-1 text-[var(--text-11)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          >
            ← Requests
          </button>
          <div className="min-w-0 flex-1 truncate text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
            CR #{selected.number}: {selected.title}
          </div>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase',
              statusClasses(selected),
            )}
          >
            {statusLabel(selected)}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-[var(--text-10)] text-[var(--muted)]">
                Title
                <input
                  value={draftTitle}
                  disabled={!isOpen || actionDisabled}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] px-2 text-[var(--text-12)] text-[var(--fg)]"
                />
              </label>
              <label className="text-[var(--text-10)] text-[var(--muted)]">
                Destination branch
                <input
                  value={draftDestination}
                  disabled={!isOpen || actionDisabled}
                  onChange={(event) => setDraftDestination(event.target.value)}
                  className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] px-2 font-mono text-[var(--text-11)] text-[var(--fg)]"
                />
              </label>
            </div>
            <label className="mt-3 block text-[var(--text-10)] text-[var(--muted)]">
              Description
              <textarea
                value={draftDescription}
                disabled={!isOpen || actionDisabled}
                onChange={(event) => setDraftDescription(event.target.value)}
                rows={3}
                className="mt-1 w-full resize-y rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-2 text-[var(--text-11)] text-[var(--fg)]"
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[var(--text-10)] text-[var(--muted-dim)]">
              <span>
                {selected.baseBranch} → {selected.destinationBranch}
              </span>
              <span>·</span>
              <span>revision {selected.revision}</span>
              <span>·</span>
              <span>
                {shortSha(selected.baseSha)} →{' '}
                {shortSha(selected.snapshotSha || selected.mergeCommitSha)}
              </span>
              {!selected.destinationExists && isOpen ? (
                <span className="text-[var(--accent)]">new branch</span>
              ) : null}
            </div>
            {selected.conflicted ? (
              <div className="mt-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
                This request conflicts with its destination
                {selected.conflictFiles.length ? `: ${selected.conflictFiles.join(', ')}` : '.'}
              </div>
            ) : null}
            {selected.lastError ? (
              <div className="mt-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
                {selected.lastError}
              </div>
            ) : null}
            {isOpen ? (
              <>
                <label className="mt-3 block text-[var(--text-10)] text-[var(--muted)]">
                  Squash commit message
                  <input
                    value={mergeCommitMessage}
                    disabled={actionDisabled}
                    onChange={(event) => setMergeCommitMessage(event.target.value)}
                    placeholder={selected.title}
                    className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] px-2 text-[var(--text-11)] text-[var(--fg)]"
                  />
                  <span className="mt-1 block text-[var(--text-9)] text-[var(--muted-dim)]">
                    Optional. The request title is used when this is empty.
                  </span>
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={actionDisabled || !draftTitle.trim() || !draftDestination.trim()}
                    onClick={() =>
                      void mutate(
                        'save',
                        `/api/change-requests/${encodeURIComponent(selected.id)}`,
                        'PATCH',
                        {
                          title: draftTitle,
                          description: draftDescription,
                          destinationBranch: draftDestination,
                          refreshSnapshot: false,
                        },
                      )
                    }
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40"
                  >
                    Save details
                  </button>
                  <button
                    type="button"
                    disabled={actionDisabled}
                    onClick={() =>
                      void mutate(
                        'refresh',
                        `/api/change-requests/${encodeURIComponent(selected.id)}`,
                        'PATCH',
                        { refreshSnapshot: true },
                      )
                    }
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40"
                  >
                    Refresh snapshot
                  </button>
                  <button
                    type="button"
                    disabled={actionDisabled || selected.conflicted}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Squash-merge this change request into ${selected.destinationBranch}?`,
                        )
                      )
                        void mutate(
                          'merge',
                          `/api/change-requests/${encodeURIComponent(selected.id)}/merge`,
                          'POST',
                          {
                            actor: { kind: 'user', id: null, label: 'DroneHub user' },
                            commitMessage: mergeCommitMessage.trim() || undefined,
                          },
                        );
                    }}
                    className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent-fg)] disabled:opacity-40"
                  >
                    {busy === 'merge' ? 'Merging…' : 'Merge directly'}
                  </button>
                  <button
                    type="button"
                    disabled={actionDisabled}
                    onClick={() => {
                      if (window.confirm('Close this change request without merging it?'))
                        void mutate(
                          'close',
                          `/api/change-requests/${encodeURIComponent(selected.id)}/close`,
                          'POST',
                        );
                    }}
                    className="rounded border border-[var(--red-border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--red)] disabled:opacity-40"
                  >
                    Close
                  </button>
                </div>
                {assessmentLoading ? (
                  <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
                    Refreshing destination status…
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {isOpen ? (
            <div className="mt-3 grid min-h-72 gap-3 lg:grid-cols-[minmax(14rem,0.38fr)_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)]">
                <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase text-[var(--muted-dim)]">
                  {changesLoading
                    ? 'Loading changes…'
                    : `${changes?.counts.changed ?? 0} files · +${changes?.counts.additions ?? 0} −${changes?.counts.deletions ?? 0}`}
                </div>
                <div className="max-h-[32rem] overflow-auto">
                  {changes?.entries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => void loadDiff(entry.path)}
                      className={cn(
                        'flex w-full items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-left text-[var(--text-11)] hover:bg-[var(--hover)]',
                        selectedPath === entry.path && 'bg-[var(--accent-subtle)]',
                      )}
                    >
                      <span className="w-4 flex-shrink-0 font-mono text-[var(--accent)]">
                        {entry.statusChar}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[var(--fg-secondary)]">
                        {entry.path}
                      </span>
                      <span className="flex-shrink-0 text-[var(--green)]">+{entry.additions}</span>
                      <span className="flex-shrink-0 text-[var(--red)]">−{entry.deletions}</span>
                    </button>
                  ))}
                  {!changesLoading && changes?.entries.length === 0 ? (
                    <div className="p-4 text-center text-[var(--text-11)] text-[var(--muted)]">
                      No changed files.
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="min-w-0 overflow-hidden rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)]">
                <div className="truncate border-b border-[var(--border-subtle)] px-3 py-2 font-mono text-[var(--text-10)] text-[var(--muted)]">
                  {selectedPath || 'Select a file to review'}
                </div>
                {selectedPath ? (
                  <div className="max-h-[32rem] overflow-auto">
                    <DiffBlock state={diffState} filePath={selectedPath} viewType="unified" />
                  </div>
                ) : (
                  <div className="p-6 text-center text-[var(--text-11)] text-[var(--muted)]">
                    Choose a changed file to see its patch.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] p-4 text-[var(--text-11)] text-[var(--muted)]">
              The snapshot was cleaned up when this request was {selected.status}.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel-alt)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
            Change requests
          </div>
          <div className="text-[var(--text-10)] text-[var(--muted-dim)]">
            {droneName} · native to DroneHub
          </div>
        </div>
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={() => setShowCreate((value) => !value)}
          className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent)] disabled:opacity-40"
        >
          New request
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadRequests()}
          className="rounded border border-[var(--border)] px-2 py-1.5 text-[var(--text-11)] text-[var(--muted)] disabled:opacity-40"
        >
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {showCreate ? (
          <div className="mb-3 rounded-[var(--radius-large)] border border-[var(--accent-muted)] bg-[var(--surface-softest)] p-3">
            <div className="text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
              Capture committed changes
            </div>
            <input
              autoFocus
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
              placeholder="Title"
              className="mt-3 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] px-2 text-[var(--text-12)] text-[var(--fg)]"
            />
            <input
              value={createDestination}
              onChange={(event) => setCreateDestination(event.target.value)}
              placeholder="Destination branch (defaults to base branch)"
              className="mt-2 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] px-2 font-mono text-[var(--text-11)] text-[var(--fg)]"
            />
            <textarea
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              placeholder="Description (optional)"
              rows={3}
              className="mt-2 w-full resize-y rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-2 text-[var(--text-11)] text-[var(--fg)]"
            />
            <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
              Uses chat {chatName}. Commit all source changes first.
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy !== null || !createTitle.trim()}
                onClick={() => void createRequest()}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent-fg)] disabled:opacity-40"
              >
                {busy === 'create' ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setShowCreate(false)}
                className="rounded px-3 py-1.5 text-[var(--text-11)] text-[var(--muted)] hover:bg-[var(--hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="mb-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
            {error}
          </div>
        ) : null}
        {loading ? (
          <div className="p-6 text-center text-[var(--text-11)] text-[var(--muted)]">
            Loading change requests…
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-[var(--radius-large)] border border-dashed border-[var(--border)] p-8 text-center">
            <div className="text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
              No change requests yet
            </div>
            <div className="mt-1 text-[var(--text-11)] text-[var(--muted)]">
              An agent or you can capture committed changes here without opening a GitHub pull
              request.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((request) => (
              <button
                key={request.id}
                type="button"
                onClick={() => setSelectedId(request.id)}
                className="block w-full rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3 text-left transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--hover)]"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
                      #{request.number} {request.title}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[var(--text-10)] text-[var(--muted-dim)]">
                      <span>{request.chatName}</span>
                      <span>
                        {request.baseBranch} → {request.destinationBranch}
                      </span>
                      <span>r{request.revision}</span>
                      <span>{relativeTime(request.updatedAt)}</span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase',
                      statusClasses(request),
                    )}
                  >
                    {statusLabel(request)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
