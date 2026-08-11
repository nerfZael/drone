import React from 'react';
import type { ChangeRequestView } from '@drone/hub-model/change-requests';

import { cn } from '../../ui/cn';
import { requestJson } from '../http';
import { ChangeRequestDetail } from './ChangeRequestDetail';
import {
  changeRequestStatusClasses,
  changeRequestStatusLabel,
  relativeChangeRequestTime,
} from './change-request-presentation';

type RequestMutationPayload = { ok: true; request: ChangeRequestView };

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
  const [requests, setRequests] = React.useState<ChangeRequestView[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [createTitle, setCreateTitle] = React.useState('');
  const [createDescription, setCreateDescription] = React.useState('');
  const [createDestination, setCreateDestination] = React.useState('');
  const selected = requests.find((request) => request.id === selectedId) ?? null;

  const loadRequests = React.useCallback(
    async (preserveSelection = true) => {
      setLoading(true);
      setError(null);
      try {
        const data = await requestJson<{ ok: true; requests: ChangeRequestView[] }>(
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
      } catch (cause: unknown) {
        setError(errorMessage(cause));
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

  const replaceRequest = React.useCallback((request: ChangeRequestView) => {
    setRequests((current) =>
      current.map((candidate) => (candidate.id === request.id ? request : candidate)),
    );
  }, []);

  const createRequest = React.useCallback(async () => {
    if (!createTitle.trim()) return;
    setCreating(true);
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
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }, [chatName, createDescription, createDestination, createTitle, droneId]);

  if (!repoAttached) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[var(--text-12)] text-[var(--muted)]">
        Attach a repository to use change requests.
      </div>
    );
  }

  if (selected) {
    return (
      <ChangeRequestDetail
        request={selected}
        disabled={disabled}
        onBack={() => setSelectedId(null)}
        onChange={replaceRequest}
      />
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
          disabled={disabled || creating}
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
                disabled={creating || !createTitle.trim()}
                onClick={() => void createRequest()}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent-fg)] disabled:opacity-40"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                disabled={creating}
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
                      <span>{relativeChangeRequestTime(request.updatedAt)}</span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase',
                      changeRequestStatusClasses(request),
                    )}
                  >
                    {changeRequestStatusLabel(request)}
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
