import React from 'react';
import {
  githubPullRequestDiffStatsPresentation,
  githubPullRequestMatchesRepo,
  pullRequestCloseConfirmation,
  pullRequestMergeConfirmation,
} from '@drone/assistant-chat';
import { invalidateHeaderRepoPullRequestSummaryCache } from '../app/HeaderPullRequestShortcuts';
import { requestJson } from '../http';
import {
  forceMergeReason,
  mergeBlockedReason,
  PullRequestStatusBadgeStrip,
} from '../pullRequests/pull-request-ui';
import type {
  RepoPullRequestClosePayload,
  RepoPullRequestMergePayload,
  RepoPullRequestSummary,
  RepoPullRequestsPayload,
} from '../types';
import { extractGithubPullRequestLinks, type GithubPullRequestLink } from './github-pull-request-links';
import { IconSpinner } from './icons';
import { invalidateLinkedPullRequestCache, useLinkedPullRequests } from './linked-pull-request-resource';
import { readPullRequestMergeMethod } from '../pullRequests/pull-request-preferences';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';

export type LinkedPullRequestContext = {
  droneId: string;
  repoPath: string;
  repoAttached: boolean;
  disabled: boolean;
  openPullRequestsData: Extract<RepoPullRequestsPayload, { ok: true }> | null;
  openPullRequestsLoading: boolean;
  openPullRequestsError: string | null;
};

function openRequest(link: GithubPullRequestLink, onOpenLink: ((href: string) => boolean) | undefined): void {
  if (onOpenLink?.(link.href)) return;
  window.open(link.href, '_blank', 'noopener,noreferrer');
}

function pullRequestStatePillClassName(
  stateRaw: string | null | undefined,
  isDraft: boolean,
): string {
  if (isDraft) return 'bg-[var(--surface-strong)] text-[var(--muted)]';
  const normalizedState = String(stateRaw ?? '').trim().toLowerCase();
  if (normalizedState === 'open') return 'bg-[var(--green-subtle)] text-[var(--green)]';
  if (normalizedState === 'merged') return 'bg-[var(--accent-subtle)] text-[var(--accent)]';
  if (normalizedState === 'closed') return 'bg-[var(--red-subtle)] text-[var(--red)]';
  return 'bg-[var(--surface-strong)] text-[var(--muted)]';
}

function MergedPullRequestIcon() {
  return (
    <svg
      data-icon="pull-request-merged"
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

function PullRequestDiffStats({
  stats,
}: {
  stats: NonNullable<RepoPullRequestSummary['diffStats']>;
}) {
  const presentation = githubPullRequestDiffStatsPresentation(stats);
  return (
    <span
      aria-label={presentation.accessibilityLabel}
      className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[var(--text-10)] tabular-nums"
    >
      <span className="text-[var(--muted-dim)]" title="Files changed">
        ({presentation.changed})
      </span>
      <span className="text-[var(--green)]" title="Lines added">
        +{presentation.additions}
      </span>
      <span className="text-[var(--red)]" title="Lines deleted">
        -{presentation.deletions}
      </span>
      <span aria-hidden="true" className="text-[var(--border)]">
        │
      </span>
      <span className="text-[var(--accent)]" title="Net line change">
        {presentation.netLabel}
      </span>
    </span>
  );
}

function LinkedPullRequestCard({
  link,
  pullRequest,
  loading,
  loadError,
  sameRepo,
  context,
  anyActionBusy,
  onActionBegin,
  onActionEnd,
  onOpenLink,
  initiallyExpanded,
}: {
  link: GithubPullRequestLink;
  pullRequest: RepoPullRequestSummary | null;
  loading: boolean;
  loadError: string | null;
  sameRepo: boolean | null;
  context: LinkedPullRequestContext;
  anyActionBusy: boolean;
  onActionBegin: () => boolean;
  onActionEnd: () => void;
  onOpenLink?: (href: string) => boolean;
  initiallyExpanded: boolean;
}) {
  const confirm = useAppConfirmDialog();
  const [busyAction, setBusyAction] = React.useState<'merge' | 'close' | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  const state = String(pullRequest?.state ?? '').trim().toLowerCase();
  const isDraft = state === 'open' && Boolean(pullRequest?.draft);
  const preferredExpanded =
    initiallyExpanded && (state === 'open' || Boolean(loadError));
  const [expanded, setExpanded] = React.useState(preferredExpanded);
  const previousInitiallyExpanded = React.useRef(initiallyExpanded);
  const previousState = React.useRef(state);
  const previousLoadError = React.useRef(loadError);
  const isOpen = state === 'open';
  const blockedReason = pullRequest ? mergeBlockedReason(pullRequest) : null;
  const forceReason = pullRequest && !blockedReason ? forceMergeReason(pullRequest) : null;
  const canManage = Boolean(pullRequest && sameRepo && isOpen && !context.disabled && !actionNotice);

  React.useEffect(() => {
    setActionError(null);
    setActionNotice(null);
    setBusyAction(null);
  }, [context.droneId, context.repoPath, link.href]);

  React.useEffect(() => {
    const initialPreferenceChanged = previousInitiallyExpanded.current !== initiallyExpanded;
    const becameMerged = previousState.current !== 'merged' && state === 'merged';
    const becameOpen = previousState.current !== 'open' && state === 'open';
    const resolvedWithError = !previousLoadError.current && Boolean(loadError);
    previousInitiallyExpanded.current = initiallyExpanded;
    previousState.current = state;
    previousLoadError.current = loadError;
    if (initialPreferenceChanged) {
      setExpanded(preferredExpanded);
      return;
    }
    if (becameMerged) {
      setExpanded(false);
      return;
    }
    if (initiallyExpanded && (becameOpen || resolvedWithError)) setExpanded(true);
  }, [initiallyExpanded, loadError, preferredExpanded, state]);

  const finishAction = React.useCallback(() => {
    setBusyAction(null);
    onActionEnd();
  }, [onActionEnd]);

  const mergePullRequest = React.useCallback(async () => {
    if (!pullRequest || !canManage || blockedReason || busyAction || anyActionBusy) return;
    const method = readPullRequestMergeMethod();
    if (
      !(await confirm(
        pullRequestMergeConfirmation({
          pullNumber: pullRequest.number,
          baseRefName: pullRequest.baseRefName,
          method,
          forceReason,
        }),
      ))
    )
      return;
    if (!onActionBegin()) return;
    setBusyAction('merge');
    setActionError(null);
    setActionNotice(null);
    try {
      const result = await requestJson<Extract<RepoPullRequestMergePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(context.droneId)}/repo/pull-requests/${pullRequest.number}/merge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method }),
        },
      );
      if (!result.merged) {
        setActionError(result.message || `GitHub did not merge PR #${pullRequest.number}.`);
        return;
      }
      setActionNotice(result.message || `Merged PR #${pullRequest.number}.`);
      invalidateHeaderRepoPullRequestSummaryCache(context.repoPath);
      invalidateLinkedPullRequestCache(context.repoPath);
    } catch (error: any) {
      setActionError(error?.message ?? String(error));
    } finally {
      finishAction();
    }
  }, [anyActionBusy, blockedReason, busyAction, canManage, confirm, context.droneId, context.repoPath, finishAction, forceReason, onActionBegin, pullRequest]);

  const closePullRequest = React.useCallback(async () => {
    if (!pullRequest || !canManage || busyAction || anyActionBusy) return;
    if (!(await confirm(pullRequestCloseConfirmation({ pullNumber: pullRequest.number })))) return;
    if (!onActionBegin()) return;
    setBusyAction('close');
    setActionError(null);
    setActionNotice(null);
    try {
      const result = await requestJson<Extract<RepoPullRequestClosePayload, { ok: true }>>(
        `/api/drones/${encodeURIComponent(context.droneId)}/repo/pull-requests/${pullRequest.number}/close`,
        { method: 'POST' },
      );
      if (String(result.state ?? '').trim().toLowerCase() !== 'closed') {
        setActionError(`GitHub did not close PR #${pullRequest.number}.`);
        return;
      }
      setActionNotice(`Closed PR #${pullRequest.number}.`);
      invalidateHeaderRepoPullRequestSummaryCache(context.repoPath);
      invalidateLinkedPullRequestCache(context.repoPath);
    } catch (error: any) {
      setActionError(error?.message ?? String(error));
    } finally {
      finishAction();
    }
  }, [anyActionBusy, busyAction, canManage, confirm, context.droneId, context.repoPath, finishAction, onActionBegin, pullRequest]);

  const statusLabel = pullRequest
    ? isDraft
      ? 'Draft'
      : state || 'Unknown'
    : loading
      ? 'Loading status'
      : loadError || context.disabled || !context.repoAttached
        ? 'Status unavailable'
        : sameRepo === false
          ? 'External repository'
          : 'Status unavailable';
  const displayedStatusLabel =
    statusLabel.length > 0
      ? `${statusLabel.charAt(0).toUpperCase()}${statusLabel.slice(1)}`
      : statusLabel;
  const title = pullRequest?.title ?? `${link.owner}/${link.repo} pull request #${link.pullNumber}`;
  const footerMessage = actionError ?? (loadError ? `Status unavailable: ${loadError}` : null);

  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="w-full self-start overflow-hidden rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-soft)]"
    >
      <summary
        aria-expanded={expanded}
        className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent-muted)] [&::-webkit-details-marker]:hidden"
      >
        {loading ? (
          <span
            role="status"
            aria-label="Loading pull request status"
            title="Loading pull request status"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--muted)]"
          >
            <IconSpinner className="h-3 w-3" />
          </span>
        ) : state === 'merged' ? (
          <span
            data-pull-request-state="merged"
            aria-live="polite"
            aria-label={`Pull request state: ${displayedStatusLabel}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-subtle)] px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] leading-none text-[var(--accent)]"
            title={statusLabel}
          >
            <MergedPullRequestIcon />
            {displayedStatusLabel}
          </span>
        ) : (
          <span
            aria-live="polite"
            aria-label={`Pull request state: ${displayedStatusLabel}`}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[var(--text-9)] font-[var(--weight-semibold)] leading-none ${pullRequestStatePillClassName(
              pullRequest?.state,
              isDraft,
            )}`}
            title={loadError ?? statusLabel}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80"
            />
            {displayedStatusLabel}
          </span>
        )}
        <span className="shrink-0 text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)]">
          PR
        </span>
        <span className="shrink-0 font-mono text-[var(--text-10)] text-[var(--muted)]">#{link.pullNumber}</span>
        <a
          href={link.href}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            openRequest(link, onOpenLink);
          }}
          className="min-w-0 max-w-full shrink truncate text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)] outline-none transition-colors hover:text-[var(--link-hover)] hover:underline focus-visible:text-[var(--link-hover)] focus-visible:underline"
          title={`Open ${title}`}
        >
          {title}
        </a>
        {pullRequest?.diffStats ? <PullRequestDiffStats stats={pullRequest.diffStats} /> : null}
        <span aria-hidden="true" className="min-w-6 flex-1 self-stretch" />
        {actionNotice ? (
          <span role="status" className="shrink-0 text-[var(--text-9)] text-[var(--green)]">
            {actionNotice}
          </span>
        ) : isOpen && sameRepo ? (
          <span
            className="flex shrink-0 items-center gap-1.5"
            aria-label="Pull request actions"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void closePullRequest();
              }}
              disabled={!canManage || Boolean(busyAction) || anyActionBusy}
              className="inline-flex h-6 min-w-[46px] items-center justify-center whitespace-nowrap rounded bg-[var(--surface-strong)] px-2 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] transition-[background-color,color] hover:bg-[var(--red-subtle)] hover:text-[var(--red)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ fontFamily: 'var(--display)' }}
              title="Close this pull request without merging"
            >
              {busyAction === 'close' ? 'Closing…' : 'Close'}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void mergePullRequest();
              }}
              disabled={!canManage || Boolean(blockedReason) || Boolean(busyAction) || anyActionBusy}
              className="inline-flex h-6 min-w-[50px] items-center justify-center whitespace-nowrap rounded bg-[var(--green-subtle)] px-2 text-[var(--text-9)] font-[var(--weight-semibold)] text-[var(--green)] transition-[background-color,filter] hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--green)] disabled:cursor-not-allowed disabled:opacity-45"
              style={{ fontFamily: 'var(--display)' }}
              title={blockedReason ? `Cannot merge: ${blockedReason}` : forceReason ? `Force merge: ${forceReason}` : `Merge PR #${link.pullNumber}`}
            >
              {busyAction === 'merge' ? 'Merging…' : blockedReason ? 'Blocked' : forceReason ? 'Force merge' : 'Merge'}
            </button>
          </span>
        ) : null}
      </summary>

      {expanded ? (
        <div className="min-w-0 px-3 pb-2.5 pt-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--text-10)] text-[var(--muted-dim)]">
            <span className="font-mono text-[var(--muted)]">{link.owner}/{link.repo}</span>
            {pullRequest?.headRefName || pullRequest?.baseRefName ? (
              <>
                <span aria-hidden="true" className="text-[var(--border)]">·</span>
                <span className="min-w-0 font-mono break-all" title={`${pullRequest.headRefName} → ${pullRequest.baseRefName}`}>
                  {pullRequest.headRefName || '-'} → {pullRequest.baseRefName || '-'}
                </span>
              </>
            ) : null}
            {pullRequest?.authorLogin ? (
              <>
                <span aria-hidden="true" className="text-[var(--border)]">·</span>
                <span>by {pullRequest.authorLogin}</span>
              </>
            ) : null}
            {pullRequest && isOpen && !actionNotice ? (
              <span className="ml-auto inline-flex shrink-0" aria-label="Pull request status details">
                <PullRequestStatusBadgeStrip pullRequest={pullRequest} compact appearance="plain" />
              </span>
            ) : null}
          </div>
          {footerMessage ? (
            <div role="alert" className="mt-2 border-t border-[var(--red-border)] pt-2 text-[var(--text-9)] text-[var(--red)]">
              {footerMessage}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function findPullRequest(
  link: GithubPullRequestLink,
  data: Extract<RepoPullRequestsPayload, { ok: true }> | null,
): RepoPullRequestSummary | null {
  if (githubPullRequestMatchesRepo(link, data?.github) !== true) return null;
  return data?.pullRequests.find((candidate) => Number(candidate.number) === link.pullNumber) ?? null;
}

function LinkedPullRequestCardsContent({
  links,
  context,
  onOpenLink,
  allData,
  statusLoading,
  statusError,
  className,
  initiallyExpanded,
}: {
  links: GithubPullRequestLink[];
  context: LinkedPullRequestContext;
  onOpenLink?: (href: string) => boolean;
  allData: Extract<RepoPullRequestsPayload, { ok: true }> | null;
  statusLoading: boolean;
  statusError: string | null;
  className?: string;
  initiallyExpanded: boolean;
}) {
  const [anyActionBusy, setAnyActionBusy] = React.useState(false);
  const anyActionBusyRef = React.useRef(false);
  const beginAction = React.useCallback(() => {
    if (anyActionBusyRef.current) return false;
    anyActionBusyRef.current = true;
    setAnyActionBusy(true);
    return true;
  }, []);
  const endAction = React.useCallback(() => {
    anyActionBusyRef.current = false;
    setAnyActionBusy(false);
  }, []);

  return (
    <div className={`mt-3 flex flex-col gap-2.5 ${className ?? ''}`} aria-label="Pull requests linked in this message">
      {links.map((link) => {
        const openRepoMatch = githubPullRequestMatchesRepo(link, context.openPullRequestsData?.github);
        const sameRepo = openRepoMatch ?? githubPullRequestMatchesRepo(link, allData?.github);
        const pullRequest = findPullRequest(link, context.openPullRequestsData) ?? findPullRequest(link, allData);
        return (
          <LinkedPullRequestCard
            key={`${link.owner}/${link.repo}#${link.pullNumber}`}
            link={link}
            pullRequest={pullRequest}
            loading={!pullRequest && statusLoading}
            loadError={pullRequest ? null : statusError}
            sameRepo={sameRepo}
            context={context}
            anyActionBusy={anyActionBusy}
            onActionBegin={beginAction}
            onActionEnd={endAction}
            onOpenLink={onOpenLink}
            initiallyExpanded={initiallyExpanded}
          />
        );
      })}
    </div>
  );
}

function LinkedPullRequestCardsWithAllStatus({
  links,
  context,
  onOpenLink,
  className,
  initiallyExpanded,
}: {
  links: GithubPullRequestLink[];
  context: LinkedPullRequestContext;
  onOpenLink?: (href: string) => boolean;
  className?: string;
  initiallyExpanded: boolean;
}) {
  const { data, loading, error } = useLinkedPullRequests(context);
  return (
    <LinkedPullRequestCardsContent
      links={links}
      context={context}
      onOpenLink={onOpenLink}
      allData={data}
      statusLoading={loading || (!data && !error)}
      statusError={error}
      className={className}
      initiallyExpanded={initiallyExpanded}
    />
  );
}

export function LinkedPullRequestCards({
  text,
  context,
  onOpenLink,
  className,
  initiallyExpanded = false,
}: {
  text: string;
  context?: LinkedPullRequestContext;
  onOpenLink?: (href: string) => boolean;
  className?: string;
  initiallyExpanded?: boolean;
}) {
  const links = React.useMemo(() => extractGithubPullRequestLinks(text), [text]);
  if (!context || links.length === 0) return null;
  const needsAllStatus = Boolean(
    context.openPullRequestsData &&
      links.some(
        (link) =>
          githubPullRequestMatchesRepo(link, context.openPullRequestsData?.github) === true &&
          !findPullRequest(link, context.openPullRequestsData),
      ),
  );
  if (needsAllStatus) {
    return <LinkedPullRequestCardsWithAllStatus links={links} context={context} onOpenLink={onOpenLink} className={className} initiallyExpanded={initiallyExpanded} />;
  }
  const initialStatusLoading = Boolean(
    context.repoAttached &&
      !context.disabled &&
      !context.openPullRequestsData &&
      !context.openPullRequestsError,
  );
  return (
    <LinkedPullRequestCardsContent
      links={links}
      context={context}
      onOpenLink={onOpenLink}
      allData={null}
      statusLoading={context.openPullRequestsLoading || initialStatusLoading}
      statusError={context.openPullRequestsError}
      className={className}
      initiallyExpanded={initiallyExpanded}
    />
  );
}
