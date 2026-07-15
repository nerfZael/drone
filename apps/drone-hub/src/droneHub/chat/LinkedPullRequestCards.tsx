import React from 'react';
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
import { IconOpen, IconSpinner } from './icons';
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

function repoMatches(link: GithubPullRequestLink, github: { owner: string; repo: string } | null | undefined): boolean | null {
  if (!github) return null;
  return (
    String(github.owner ?? '').trim().toLowerCase() === link.owner &&
    String(github.repo ?? '').trim().toLowerCase() === link.repo
  );
}

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
  onActionBusyChange,
  onOpenLink,
}: {
  link: GithubPullRequestLink;
  pullRequest: RepoPullRequestSummary | null;
  loading: boolean;
  loadError: string | null;
  sameRepo: boolean | null;
  context: LinkedPullRequestContext;
  anyActionBusy: boolean;
  onActionBusyChange: (busy: boolean) => void;
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
    onActionBusyChange(false);
  }, [onActionBusyChange]);

  const mergePullRequest = React.useCallback(async () => {
    if (!pullRequest || !canManage || blockedReason || busyAction || anyActionBusy) return;
    const method = readPullRequestMergeMethod();
    const verb = forceReason ? 'Force merge' : 'Merge';
    const forceLabel = forceReason ? ` Checks currently report: ${forceReason}.` : '';
    if (!window.confirm(`${verb} PR #${pullRequest.number} into ${pullRequest.baseRefName || 'base'} using "${method}"?${forceLabel}`)) return;
    setBusyAction('merge');
    onActionBusyChange(true);
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
  }, [anyActionBusy, blockedReason, busyAction, canManage, context.droneId, context.repoPath, finishAction, forceReason, onActionBusyChange, pullRequest]);

  const closePullRequest = React.useCallback(async () => {
    if (!pullRequest || !canManage || busyAction || anyActionBusy) return;
    if (!window.confirm(`Close PR #${pullRequest.number} without merging?`)) return;
    setBusyAction('close');
    onActionBusyChange(true);
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
  }, [anyActionBusy, busyAction, canManage, context.droneId, context.repoPath, finishAction, onActionBusyChange, pullRequest]);

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
    <section className="border-l-2 border-[rgba(167,139,250,.32)] pl-3">
      <div className="flex flex-col items-start gap-3 py-1 pr-1 sm:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Linked request
            </span>
            <span className="font-mono text-[10px] text-[var(--accent)]">#{link.pullNumber}</span>
            <span
              aria-live="polite"
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[9px] capitalize ${
                pullRequest
                  ? pullRequestStateClassName(pullRequest.state)
                  : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)]'
              }`}
              title={loadError ?? statusLabel}
            >
              {loading ? <IconSpinner className="h-2.5 w-2.5" /> : null}
              {statusLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => openRequest(link, onOpenLink)}
            className="mt-1.5 block max-w-full truncate text-left text-[12px] font-medium text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:underline"
            title={pullRequest?.title ?? `Open ${link.owner}/${link.repo} PR #${link.pullNumber}`}
          >
            {pullRequest?.title ?? `${link.owner}/${link.repo} pull request #${link.pullNumber}`}
          </button>
          <div className="mt-1 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-[var(--muted-dim)]">
              <span className="font-mono">{link.owner}/{link.repo}</span>
              {pullRequest?.headRefName || pullRequest?.baseRefName ? (
                <span className="min-w-0 font-mono break-all" title={`${pullRequest.headRefName} → ${pullRequest.baseRefName}`}>
                  {pullRequest.headRefName || '-'} → {pullRequest.baseRefName || '-'}
                </span>
              ) : null}
              {pullRequest?.authorLogin ? <span>by {pullRequest.authorLogin}</span> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
              {actionNotice ? (
                <span role="status" className="text-[9px] text-[var(--green)]">
                  {actionNotice}
                </span>
              ) : pullRequest ? (
                <PullRequestStatusBadgeStrip pullRequest={pullRequest} compact />
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-start gap-1 sm:justify-end">
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:border-[var(--border)] hover:text-[var(--fg-secondary)]"
            title="Open on GitHub"
            aria-label={`Open PR #${link.pullNumber} on GitHub`}
          >
            <IconOpen className="h-3 w-3" />
          </a>
          {isOpen && sameRepo ? (
            <>
              <button
                type="button"
                onClick={() => void mergePullRequest()}
                disabled={!canManage || Boolean(blockedReason) || Boolean(busyAction) || anyActionBusy}
                className="h-6 rounded border border-[rgba(74,222,128,.35)] bg-[var(--green-subtle)] px-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--green)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
                title={blockedReason ? `Cannot merge: ${blockedReason}` : forceReason ? `Force merge: ${forceReason}` : `Merge PR #${link.pullNumber}`}
              >
                {busyAction === 'merge' ? 'Merging…' : blockedReason ? 'Blocked' : forceReason ? 'Force merge' : 'Merge'}
              </button>
              <button
                type="button"
                onClick={() => void closePullRequest()}
                disabled={!canManage || Boolean(busyAction) || anyActionBusy}
                className="h-6 rounded border border-[rgba(255,90,90,.35)] bg-[var(--red-subtle)] px-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--red)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
                title="Close this pull request without merging"
              >
                {busyAction === 'close' ? 'Closing…' : 'Close'}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {footerMessage ? (
        <div
          role="alert"
          className="mt-1 py-1 text-[9px] text-[var(--red)]"
        >
          {footerMessage}
        </div>
      ) : null}
    </section>
  );
}

function findPullRequest(
  link: GithubPullRequestLink,
  data: Extract<RepoPullRequestsPayload, { ok: true }> | null,
): RepoPullRequestSummary | null {
  if (repoMatches(link, data?.github) !== true) return null;
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

  return (
    <div className={`mt-3 flex flex-col gap-2 ${className ?? ''}`} aria-label="Pull requests linked in this message">
      {links.map((link) => {
        const openRepoMatch = repoMatches(link, context.openPullRequestsData?.github);
        const sameRepo = openRepoMatch ?? repoMatches(link, allData?.github);
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
            onActionBusyChange={setAnyActionBusy}
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
          repoMatches(link, context.openPullRequestsData?.github) === true &&
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
