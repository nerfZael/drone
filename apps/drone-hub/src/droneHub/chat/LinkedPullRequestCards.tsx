import React from 'react';
import { githubPullRequestMatchesRepo } from '@drone/assistant-chat';
import { invalidateHeaderRepoPullRequestSummaryCache } from '../app/HeaderPullRequestShortcuts';
import { requestJson } from '../http';
import {
  forceMergeReason,
  mergeBlockedReason,
  PullRequestStatusBadgeStrip,
  pullRequestStateClassName,
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
}) {
  const [busyAction, setBusyAction] = React.useState<'merge' | 'close' | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  const state = String(pullRequest?.state ?? '').trim().toLowerCase();
  const isOpen = state === 'open';
  const blockedReason = pullRequest ? mergeBlockedReason(pullRequest) : null;
  const forceReason = pullRequest && !blockedReason ? forceMergeReason(pullRequest) : null;
  const canManage = Boolean(pullRequest && sameRepo && isOpen && !context.disabled && !actionNotice);

  React.useEffect(() => {
    setActionError(null);
    setActionNotice(null);
    setBusyAction(null);
  }, [context.droneId, context.repoPath, link.href]);

  const finishAction = React.useCallback(() => {
    setBusyAction(null);
    onActionEnd();
  }, [onActionEnd]);

  const mergePullRequest = React.useCallback(async () => {
    if (!pullRequest || !canManage || blockedReason || busyAction || anyActionBusy) return;
    const method = readPullRequestMergeMethod();
    const verb = forceReason ? 'Force merge' : 'Merge';
    const forceLabel = forceReason ? ` Checks currently report: ${forceReason}.` : '';
    if (!window.confirm(`${verb} PR #${pullRequest.number} into ${pullRequest.baseRefName || 'base'} using "${method}"?${forceLabel}`)) return;
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
  }, [anyActionBusy, blockedReason, busyAction, canManage, context.droneId, context.repoPath, finishAction, forceReason, onActionBegin, pullRequest]);

  const closePullRequest = React.useCallback(async () => {
    if (!pullRequest || !canManage || busyAction || anyActionBusy) return;
    if (!window.confirm(`Close PR #${pullRequest.number} without merging?`)) return;
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
  }, [anyActionBusy, busyAction, canManage, context.droneId, context.repoPath, finishAction, onActionBegin, pullRequest]);

  const statusLabel = pullRequest
    ? state || 'Unknown'
    : loading
      ? 'Loading status'
      : loadError || context.disabled || !context.repoAttached
        ? 'Status unavailable'
        : sameRepo === false
          ? 'External repository'
          : 'Status unavailable';
  const footerMessage = actionError ?? (loadError ? `Status unavailable: ${loadError}` : null);

  return (
    <section className="w-fit max-w-full self-start overflow-hidden rounded-[var(--radius-medium)] border border-[var(--accent-border)] border-l-2 border-l-[var(--accent)] bg-transparent">
      <div className="min-w-0 py-2 pl-3 pr-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            Linked request
          </span>
          <span className="font-mono text-[var(--text-10)] text-[var(--accent)]">#{link.pullNumber}</span>
          <span
            aria-live="polite"
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[var(--text-9)] capitalize ${
              pullRequest
                ? pullRequestStateClassName(pullRequest.state)
                : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)]'
            }`}
            title={loadError ?? statusLabel}
          >
            {loading ? <IconSpinner className="h-2.5 w-2.5" /> : null}
            {statusLabel}
          </span>
          {pullRequest && !actionNotice ? <PullRequestStatusBadgeStrip pullRequest={pullRequest} compact /> : null}
        </div>

        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <a
            href={link.href}
            onClick={(event) => {
              event.preventDefault();
              openRequest(link, onOpenLink);
            }}
            className="min-w-0 max-w-full truncate text-left text-[var(--text-12)] font-medium text-[var(--fg-secondary)] outline-none transition-colors hover:text-[var(--fg)] hover:underline focus-visible:text-[var(--fg)] focus-visible:underline"
            title={pullRequest?.title ?? `Open ${link.owner}/${link.repo} PR #${link.pullNumber}`}
          >
            {pullRequest?.title ?? `${link.owner}/${link.repo} pull request #${link.pullNumber}`}
          </a>
          {actionNotice ? (
            <span role="status" className="text-[var(--text-9)] text-[var(--green)]">
              {actionNotice}
            </span>
          ) : isOpen && sameRepo ? (
            <div className="flex shrink-0 items-center gap-1.5" aria-label="Pull request actions">
              <button
                type="button"
                onClick={() => void mergePullRequest()}
                disabled={!canManage || Boolean(blockedReason) || Boolean(busyAction) || anyActionBusy}
                className="inline-flex h-6 min-w-[64px] items-center justify-center whitespace-nowrap rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-2 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--green)] transition-[background-color,border-color,filter] hover:border-[var(--green)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--green)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
                title={blockedReason ? `Cannot merge: ${blockedReason}` : forceReason ? `Force merge: ${forceReason}` : `Merge PR #${link.pullNumber}`}
              >
                {busyAction === 'merge' ? 'Merging…' : blockedReason ? 'Blocked' : forceReason ? 'Force merge' : 'Merge'}
              </button>
              <button
                type="button"
                onClick={() => void closePullRequest()}
                disabled={!canManage || Boolean(busyAction) || anyActionBusy}
                className="inline-flex h-6 items-center justify-center whitespace-nowrap rounded border border-[var(--red-border)] bg-transparent px-2 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--red)] transition-[background-color,border-color] hover:border-[var(--red)] hover:bg-[var(--red-subtle)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
                title="Close this pull request without merging"
              >
                {busyAction === 'close' ? 'Closing…' : 'Close'}
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--text-10)] text-[var(--muted-dim)]">
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
        </div>
        {footerMessage ? (
          <div role="alert" className="mt-2 border-t border-[var(--red-border)] pt-2 text-[var(--text-9)] text-[var(--red)]">
            {footerMessage}
          </div>
        ) : null}
      </div>
    </section>
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
}: {
  links: GithubPullRequestLink[];
  context: LinkedPullRequestContext;
  onOpenLink?: (href: string) => boolean;
  allData: Extract<RepoPullRequestsPayload, { ok: true }> | null;
  statusLoading: boolean;
  statusError: string | null;
  className?: string;
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
}: {
  links: GithubPullRequestLink[];
  context: LinkedPullRequestContext;
  onOpenLink?: (href: string) => boolean;
  className?: string;
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
    />
  );
}

export function LinkedPullRequestCards({
  text,
  context,
  onOpenLink,
  className,
}: {
  text: string;
  context?: LinkedPullRequestContext;
  onOpenLink?: (href: string) => boolean;
  className?: string;
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
    return <LinkedPullRequestCardsWithAllStatus links={links} context={context} onOpenLink={onOpenLink} className={className} />;
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
    />
  );
}
