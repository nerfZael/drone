import React from 'react';
import type { ChangeRequestChanges, ChangeRequestView } from '@drone/hub-model/change-requests';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { cn } from '../../ui/cn';
import { DiffBlock } from '../changes/DiffBlock';
import type { DiffState } from '../changes/types';
import {
  readPullRequestMergeMethod,
  writePullRequestMergeMethod,
} from '../pullRequests/pull-request-preferences';
import { ChangeRequestGithubMirrorPanel } from './ChangeRequestGithubMirrorPanel';
import {
  closeChangeRequest,
  loadChangeRequestChanges,
  loadChangeRequestDiff,
  mergeChangeRequest,
  refreshChangeRequestAssessment,
  updateChangeRequest,
} from './change-request-api';
import {
  changeRequestStatusClasses,
  changeRequestStatusLabel,
  shortChangeRequestSha,
} from './change-request-presentation';

type ChangesPayload = Pick<ChangeRequestChanges, 'counts' | 'entries'> & { ok: true };
export function ChangeRequestDetail({
  request,
  disabled,
  onBack,
  onChange,
}: {
  request: ChangeRequestView;
  disabled: boolean;
  onBack: () => void;
  onChange: (request: ChangeRequestView) => void;
}) {
  const confirm = useAppConfirmDialog();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState(request.title);
  const [draftDescription, setDraftDescription] = React.useState(request.description);
  const [draftDestination, setDraftDestination] = React.useState(request.destinationBranch);
  const [mergeCommitMessage, setMergeCommitMessage] = React.useState('');
  const [assessmentLoading, setAssessmentLoading] = React.useState(false);
  const [githubMergeMethod, setGithubMergeMethod] = React.useState(() =>
    readPullRequestMergeMethod(),
  );
  const [changes, setChanges] = React.useState<ChangesPayload | null>(null);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [diff, setDiff] = React.useState('');
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState<string | null>(null);
  const [diffTruncated, setDiffTruncated] = React.useState(false);

  React.useEffect(() => {
    setError(null);
    setSelectedPath(null);
    setDiff('');
    setDiffError(null);
    setDiffTruncated(false);
    setDraftTitle(request.title);
    setDraftDescription(request.description);
    setDraftDestination(request.destinationBranch);
    setMergeCommitMessage('');
    if (request.status !== 'open') {
      setChanges(null);
      return;
    }
    let cancelled = false;
    setChangesLoading(true);
    loadChangeRequestChanges(request.id)
      .then((data) => {
        if (!cancelled) setChanges(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setChangesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request.id, request.revision, request.status]);

  React.useEffect(() => {
    if (request.status !== 'open') {
      setAssessmentLoading(false);
      return;
    }
    let cancelled = false;
    setAssessmentLoading(true);
    refreshChangeRequestAssessment(request.id)
      .then((updated) => {
        if (!cancelled) onChange(updated);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setAssessmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onChange, request.id, request.revision, request.status]);

  const mutate = React.useCallback(
    async (
      action: string,
      operation: () => Promise<ChangeRequestView>,
    ): Promise<ChangeRequestView | null> => {
      setBusy(action);
      setError(null);
      try {
        const updated = await operation();
        onChange(updated);
        return updated;
      } catch (cause: unknown) {
        setError(errorMessage(cause));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [onChange],
  );

  const loadDiff = React.useCallback(
    async (filePath: string) => {
      setSelectedPath(filePath);
      setDiffLoading(true);
      setDiffError(null);
      setDiffTruncated(false);
      setError(null);
      try {
        const data = await loadChangeRequestDiff(request.id, filePath);
        setDiff(data.diff);
        setDiffTruncated(data.truncated);
      } catch (cause: unknown) {
        const message = errorMessage(cause);
        setError(message);
        setDiffError(message);
        setDiff('');
      } finally {
        setDiffLoading(false);
      }
    },
    [request.id],
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
  const isOpen = request.status === 'open';
  const actionDisabled = disabled || busy !== null || assessmentLoading;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel-alt)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-2 py-1 text-[var(--text-11)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        >
          ← Requests
        </button>
        <div className="min-w-0 flex-1 truncate text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
          CR #{request.number}: {request.title}
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
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error ? (
          <div className="mb-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
            {error}
          </div>
        ) : null}
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
              {request.baseBranch} → {request.destinationBranch}
            </span>
            <span>·</span>
            <span>revision {request.revision}</span>
            <span>·</span>
            <span>
              {shortChangeRequestSha(request.baseSha)} →{' '}
              {shortChangeRequestSha(request.snapshotSha || request.mergeCommitSha)}
            </span>
            {!request.destinationExists && isOpen ? (
              <span className="text-[var(--accent)]">new branch</span>
            ) : null}
          </div>
          {request.conflicted ? (
            <div className="mt-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
              This request conflicts with its destination
              {request.conflictFiles.length ? `: ${request.conflictFiles.join(', ')}` : '.'}
            </div>
          ) : null}
          {request.lastError ? (
            <div className="mt-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
              {request.lastError}
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
                  placeholder={request.title}
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
                    void mutate('save', () =>
                      updateChangeRequest(request.id, {
                        title: draftTitle,
                        description: draftDescription,
                        destinationBranch: draftDestination,
                        refreshSnapshot: false,
                      }),
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
                    void mutate('refresh', () =>
                      updateChangeRequest(request.id, { refreshSnapshot: true }),
                    )
                  }
                  className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40"
                >
                  Refresh snapshot
                </button>
                <button
                  type="button"
                  disabled={actionDisabled || request.conflicted}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Merge change request?',
                        message: `Squash-merge this change request into ${request.destinationBranch}?`,
                        confirmLabel: 'Merge directly',
                      })
                    ) {
                      void mutate('merge', () =>
                        mergeChangeRequest(request.id, mergeCommitMessage.trim() || undefined),
                      );
                    }
                  }}
                  className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent-fg)] disabled:opacity-40"
                >
                  {busy === 'merge' ? 'Merging…' : 'Merge directly'}
                </button>
                <button
                  type="button"
                  disabled={actionDisabled}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Close change request?',
                        message: 'Close this change request without merging it?',
                        confirmLabel: 'Close request',
                        destructive: true,
                      })
                    ) {
                      void mutate('close', () => closeChangeRequest(request.id));
                    }
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

        <ChangeRequestGithubMirrorPanel
          requestId={request.id}
          nativeStatus={request.status}
          mirror={request.githubMirror}
          disabled={actionDisabled}
          busy={busy}
          mergeMethod={githubMergeMethod}
          onMergeMethodChange={(method) => {
            setGithubMergeMethod(method);
            writePullRequestMergeMethod(method);
          }}
          mutate={mutate}
        />

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
            The snapshot was cleaned up when this request was {request.status}.
          </div>
        )}
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
