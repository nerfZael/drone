import React from 'react';

import { UiActionMenu, UiButton } from '../../ui/components';
import { UnifiedRequestList, type UnifiedRequestListItem } from '../requests/UnifiedRequestList';
import type { RepoPullRequestMergeMethod, RepoPullRequestSummary } from '../types';
import { PullRequestStatusBadgeStrip, shortBranchName } from './pull-request-ui';

export function PullRequestListView({
  pullRequests,
  openCount,
  selectedNumbers,
  onSelectedNumbersChange,
  query,
  onQueryChange,
  mergeMethod,
  onMergeMethodChange,
  onOpenPullRequest,
  onMergeSelected,
  onCloseSelected,
  onRefresh,
  refreshLoading,
  mergeDisabled,
  closeDisabled,
  mergeLoading,
  closeLoading,
}: {
  pullRequests: RepoPullRequestSummary[];
  openCount: number;
  selectedNumbers: ReadonlySet<number>;
  onSelectedNumbersChange: (numbers: Set<number>) => void;
  query: string;
  onQueryChange: (query: string) => void;
  mergeMethod: RepoPullRequestMergeMethod;
  onMergeMethodChange: (method: RepoPullRequestMergeMethod) => void;
  onOpenPullRequest: (pullRequest: RepoPullRequestSummary) => void;
  onMergeSelected: () => void;
  onCloseSelected: () => void;
  onRefresh: () => void;
  refreshLoading: boolean;
  mergeDisabled: boolean;
  closeDisabled: boolean;
  mergeLoading: boolean;
  closeLoading: boolean;
}) {
  const byNumber = React.useMemo(
    () => new Map(pullRequests.map((pullRequest) => [pullRequest.number, pullRequest])),
    [pullRequests],
  );
  const items = React.useMemo<UnifiedRequestListItem[]>(
    () =>
      pullRequests.map((pullRequest) => ({
        number: pullRequest.number,
        title: pullRequest.title,
        state: pullRequest.draft ? 'draft' : 'open',
        stateLabel: pullRequest.draft ? 'Draft' : 'Open',
        updatedAt: pullRequest.updatedAt,
        externalHref: pullRequest.htmlUrl,
        lineStats: pullRequest.diffStats
          ? (() => {
              const modifications = Math.min(
                pullRequest.diffStats.additions,
                pullRequest.diffStats.deletions,
              );
              const additions = pullRequest.diffStats.additions - modifications;
              const deletions = pullRequest.diffStats.deletions - modifications;
              return {
                files: pullRequest.diffStats.changed,
                additions,
                modifications,
                deletions,
                total: additions + modifications + deletions,
              };
            })()
          : null,
        metadata: (
          <>
            <span>{pullRequest.authorLogin || 'Unknown author'}</span>
            <span aria-hidden="true">·</span>
            <span
              className="font-mono"
              title={`${pullRequest.headRefName} → ${pullRequest.baseRefName}`}
            >
              {shortBranchName(pullRequest.headRefName)} →{' '}
              {shortBranchName(pullRequest.baseRefName)}
            </span>
          </>
        ),
        signals: (
          <PullRequestStatusBadgeStrip
            pullRequest={pullRequest}
            limit={2}
            compact
            appearance="plain"
          />
        ),
      })),
    [pullRequests],
  );

  return (
    <UnifiedRequestList
      ariaLabel="Pull requests"
      items={items}
      selectedNumbers={selectedNumbers}
      onSelectedNumbersChange={onSelectedNumbersChange}
      onOpenRequest={(number) => {
        const pullRequest = byNumber.get(number);
        if (pullRequest) onOpenPullRequest(pullRequest);
      }}
      query={query}
      onQueryChange={onQueryChange}
      queryPlaceholder="Search pull requests"
      filters={[{ value: 'open', label: 'Open', count: openCount }]}
      activeFilter="open"
      onFilterChange={() => {}}
      toolbarTrailing={
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center gap-1 text-[var(--text-9)] text-[var(--muted-dim)]">
            <span className="hidden uppercase tracking-wide sm:inline">Merge</span>
            <UiActionMenu
              label="Default merge method"
              align="start"
              size="small"
              portal
              triggerContent={
                <span className="flex items-center gap-1.5 capitalize">
                  {mergeMethod}
                  <ChevronDownIcon />
                </span>
              }
              entries={[
                {
                  id: 'merge',
                  label: 'Merge commit',
                  selectionRole: 'radio',
                  checked: mergeMethod === 'merge',
                },
                {
                  id: 'squash',
                  label: 'Squash and merge',
                  selectionRole: 'radio',
                  checked: mergeMethod === 'squash',
                },
                {
                  id: 'rebase',
                  label: 'Rebase and merge',
                  selectionRole: 'radio',
                  checked: mergeMethod === 'rebase',
                },
              ]}
              onSelect={(value) =>
                onMergeMethodChange(value as RepoPullRequestMergeMethod)
              }
              panelClassName="min-w-40"
            />
          </div>
          <UiButton
            size="small"
            variant="secondary"
            leadingIcon={<RefreshIcon />}
            loading={refreshLoading}
            onClick={onRefresh}
            title="Refresh pull requests from GitHub"
          >
            Refresh
          </UiButton>
        </div>
      }
      emptyTitle="No open pull requests"
      emptyDescription="New pull requests for this repository will appear here."
      mergeAction={{
        label: 'Merge',
        title: `Merge selected pull requests with ${mergeMethod}`,
        tone: 'success',
        disabled: mergeDisabled,
        loading: mergeLoading,
        onClick: onMergeSelected,
      }}
      closeAction={{
        label: 'Close',
        title: 'Close selected pull requests without merging',
        tone: 'danger',
        disabled: closeDisabled,
        loading: closeLoading,
        onClick: onCloseSelected,
      }}
    />
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 text-[var(--muted-dim)]" aria-hidden="true">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12.7 5.4A5.3 5.3 0 1 0 13 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12.7 2.7v2.9H9.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
