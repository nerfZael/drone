import React from 'react';
import { requestJsonWithTimeout } from '../http';
import { useTimedRequest } from '../app/hooks';
import { provisioningLabel } from '../panes/usePaneReadiness';
import type { RepoPullRequestChangeEntry, RepoPullRequestChangesPayload } from '../types';
import { changeStatusLabel, MetaChip, pullRequestEntryPathExistsInHead, pullRequestStateClassName, shortSha } from './pull-request-ui';

const PR_DETAIL_REQUEST_TIMEOUT_MS = 45_000;

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? '').trim();
  return text || 'Pull request changes request failed.';
}

function PullRequestPatch({ entry }: { entry: RepoPullRequestChangeEntry }) {
  const patch = typeof entry.patch === 'string' ? entry.patch : '';
  if (entry.isBinary) {
    return <div className="px-2.5 py-2 text-[11px] text-[var(--muted)]">Binary file change.</div>;
  }
  if (!patch.trim()) {
    return (
      <div className="px-2.5 py-2 text-[11px] text-[var(--muted)]">
        Diff unavailable{entry.truncated ? ' or truncated by GitHub' : ''}.
      </div>
    );
  }
  return (
    <pre className="m-0 max-h-[360px] overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[11px] leading-5 text-[var(--fg-secondary)] bg-[rgba(0,0,0,.18)]">
      {patch}
    </pre>
  );
}

export function PullRequestDetailView({
  droneId,
  pullNumber,
  repoAttached,
  repoPath,
  repoUnavailableReason,
  disabled,
  hubPhase,
  hubMessage,
  refreshNonce,
  onRefresh,
  onRevealFileInFiles,
  onOpenFileInEditor,
}: {
  droneId: string;
  pullNumber: number;
  repoAttached: boolean;
  repoPath: string;
  repoUnavailableReason?: string | null;
  disabled: boolean;
  hubPhase?: 'draft' | 'creating' | 'starting' | 'seeding' | 'error' | null;
  hubMessage?: string | null;
  refreshNonce: number;
  onRefresh: () => void;
  onRevealFileInFiles: (repoRelativePath: string) => void;
  onOpenFileInEditor: (repoRelativePath: string) => void;
}) {
  const unavailableReason = String(repoUnavailableReason ?? '').trim();
  const normalizedPullNumber = Number.isFinite(pullNumber) && pullNumber > 0 ? Math.floor(pullNumber) : null;
  const enabled = repoAttached && !disabled && normalizedPullNumber !== null;
  const request = useTimedRequest<Extract<RepoPullRequestChangesPayload, { ok: true }>>(
    (signal) =>
      requestJsonWithTimeout<Extract<RepoPullRequestChangesPayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(droneId)}/repo/pull-requests/${normalizedPullNumber ?? 0}/changes`,
        { signal },
        PR_DETAIL_REQUEST_TIMEOUT_MS,
      ),
    [droneId, pullNumber, refreshNonce, repoPath],
    { enabled, keepPreviousData: false },
  );

  if (!repoAttached) {
    return <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">{unavailableReason || 'No repo attached.'}</div>;
  }

  if (disabled) {
    return (
      <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
          <div className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            {provisioningLabel(hubPhase)}
          </div>
          <div className="mt-1">Waiting for repository...</div>
          {String(hubMessage ?? '').trim() ? <div className="mt-1 text-[10px] text-[var(--muted-dim)]">{String(hubMessage ?? '').trim()}</div> : null}
        </div>
      </div>
    );
  }

  if (normalizedPullNumber === null) {
    return <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">No pull request selected.</div>;
  }

  const notFound = Number((request.error as any)?.status ?? 0) === 404;
  const error = notFound
    ? `PR #${normalizedPullNumber} was not found on GitHub (it may have been deleted or is inaccessible).`
    : errorMessage(request.error);
  const entries = request.data?.entries ?? [];
  const pr = request.data?.pullRequest ?? null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] text-[10px] text-[var(--muted)] flex items-center gap-1.5 min-h-[30px] overflow-x-auto whitespace-nowrap">
        {request.loading && !request.data ? (
          <span>Loading pull request...</span>
        ) : error ? (
          <span className="text-[var(--red)]">{error}</span>
        ) : (
          <>
            <span className="truncate max-w-[34ch]" title={request.data?.repoRoot || repoPath || '-'}>
              {request.data?.repoRoot || repoPath || '-'}
            </span>
            {request.data?.github ? (
              <MetaChip label="github" value={`${request.data.github.owner}/${request.data.github.repo}`} title={`${request.data.github.owner}/${request.data.github.repo}`} mono />
            ) : null}
            <MetaChip label="pr" value={`#${pr?.number ?? normalizedPullNumber}`} title={pr?.title || undefined} mono />
            {pr?.state ? (
              <span className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${pullRequestStateClassName(pr.state)}`}>
                {pr.state}
              </span>
            ) : null}
            <MetaChip label="files" value={request.data?.counts.changed ?? 0} />
            <MetaChip label="+" value={request.data?.counts.additions ?? 0} mono />
            <MetaChip label="-" value={request.data?.counts.deletions ?? 0} mono />
            <MetaChip label="base" value={shortSha(pr?.baseSha)} title={pr?.baseSha ?? ''} mono />
            <MetaChip label="head" value={shortSha(pr?.headSha)} title={pr?.headSha ?? ''} mono />
          </>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
          title="Refresh pull request"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--red)]">{error}</div>
      ) : entries.length === 0 && !request.loading ? (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 text-[11px] text-[var(--muted)]">No file changes found for PR #{normalizedPullNumber}.</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-2 py-2 flex flex-col gap-2">
          {entries.map((entry) => (
            <PullRequestFileSection
              key={`${entry.path}\u0000${entry.originalPath ?? ''}`}
              entry={entry}
              onRevealFileInFiles={onRevealFileInFiles}
              onOpenFileInEditor={onOpenFileInEditor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PullRequestFileSection({
  entry,
  onRevealFileInFiles,
  onOpenFileInEditor,
}: {
  entry: RepoPullRequestChangeEntry;
  onRevealFileInFiles: (repoRelativePath: string) => void;
  onOpenFileInEditor: (repoRelativePath: string) => void;
}) {
  const pathExistsInHead = pullRequestEntryPathExistsInHead(entry);

  return (
    <section className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] overflow-hidden">
      <div className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--panel-raised)]/70 flex items-start gap-2">
        <span className="inline-flex items-center justify-center min-w-[30px] h-6 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] font-mono text-[var(--muted)]">
          {entry.statusChar || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-[var(--fg-secondary)] font-mono break-all">{entry.path}</div>
          {entry.originalPath ? <div className="mt-1 text-[10px] text-[var(--muted-dim)] font-mono break-all">from {entry.originalPath}</div> : null}
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <MetaChip label="type" value={changeStatusLabel(entry)} />
            <MetaChip label="+" value={entry.additions} mono />
            <MetaChip label="-" value={entry.deletions} mono />
            {entry.truncated ? <MetaChip label="diff" value="truncated" /> : null}
            {entry.isBinary ? <MetaChip label="file" value="binary" /> : null}
          </div>
        </div>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onRevealFileInFiles(entry.path)}
            disabled={!pathExistsInHead}
            className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold tracking-wide uppercase text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--display)' }}
            title={pathExistsInHead ? 'Reveal file in Files' : 'File was deleted in this pull request'}
          >
            Reveal
          </button>
          <button
            type="button"
            onClick={() => onOpenFileInEditor(entry.path)}
            disabled={!pathExistsInHead}
            className="h-6 px-2 rounded-md border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[9px] font-semibold tracking-wide uppercase text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--display)' }}
            title={pathExistsInHead ? 'Open file in editor' : 'File was deleted in this pull request'}
          >
            Open
          </button>
        </div>
      </div>
      <PullRequestPatch entry={entry} />
    </section>
  );
}
