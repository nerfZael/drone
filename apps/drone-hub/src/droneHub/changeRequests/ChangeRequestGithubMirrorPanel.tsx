import React from 'react';
import type {
  ChangeRequestGithubMirrorView,
  ChangeRequestView,
} from '@drone/hub-model/change-requests';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import {
  closeChangeRequestMirror,
  mergeChangeRequestMirror,
  publishChangeRequestMirror,
  refreshChangeRequestMirror,
  setChangeRequestMirrorAutoUpdate,
  syncChangeRequestMirror,
  type GithubMirrorMergeMethod,
} from './change-request-api';

const secondaryButtonClassName =
  'inline-flex h-8 items-center rounded-[var(--radius-medium)] border border-[var(--border)] px-3 text-[var(--text-10)] font-[var(--weight-bold)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40';
const ghostButtonClassName =
  'inline-flex h-8 items-center rounded-[var(--radius-medium)] px-2.5 text-[var(--text-10)] text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-40';
const primaryButtonClassName =
  'inline-flex h-8 items-center rounded-[var(--radius-medium)] border border-[var(--accent)] bg-[var(--accent)] px-3 text-[var(--text-10)] font-[var(--weight-bold)] text-[var(--accent-fg)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const dangerButtonClassName =
  'inline-flex h-8 items-center rounded-[var(--radius-medium)] px-2.5 text-[var(--text-10)] text-[var(--red)] transition-colors hover:bg-[var(--red-subtle)] disabled:cursor-not-allowed disabled:opacity-40';

export function ChangeRequestGithubMirrorPanel({
  requestNumber,
  nativeStatus,
  mirror,
  disabled,
  busy,
  mergeMethod,
  onMergeMethodChange,
  mutate,
}: {
  requestNumber: number;
  nativeStatus: 'open' | 'merged' | 'closed';
  mirror: ChangeRequestGithubMirrorView | null;
  disabled: boolean;
  busy: string | null;
  mergeMethod: GithubMirrorMergeMethod;
  onMergeMethodChange: (method: GithubMirrorMergeMethod) => void;
  mutate: (action: string, operation: () => Promise<ChangeRequestView>) => Promise<unknown>;
}) {
  const confirm = useAppConfirmDialog();
  const isOpen = nativeStatus === 'open';

  return (
    <div className="py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[var(--fg-secondary)]">
          <GithubMark />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[var(--text-11)] font-[var(--weight-bold)] text-[var(--fg)]">
            GitHub mirror
          </div>
          <div className="text-[var(--text-9)] text-[var(--muted-dim)]">
            {mirror
              ? 'This change request is published as a GitHub pull request.'
              : 'Publish this change request through the host GitHub account.'}
          </div>
        </div>
        {mirror ? <MirrorState state={mirror.state} /> : null}
      </div>

      {!mirror ? (
        isOpen ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5">
            <MergeMethodSelect
              value={mergeMethod}
              disabled={disabled}
              onChange={onMergeMethodChange}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void mutate('github-publish', () =>
                  publishChangeRequestMirror(requestNumber, { merge: false, mergeMethod }),
                )
              }
              className={secondaryButtonClassName}
            >
              {busy === 'github-publish' ? 'Opening…' : 'Open GitHub PR'}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Open and merge GitHub pull request?',
                    message: `Open a GitHub pull request and immediately try to ${mergeMethod}-merge it?`,
                    confirmLabel: 'Open and merge',
                  })
                ) {
                  void mutate('github-publish-merge', () =>
                    publishChangeRequestMirror(requestNumber, { merge: true, mergeMethod }),
                  );
                }
              }}
              className={primaryButtonClassName}
            >
              {busy === 'github-publish-merge' ? 'Opening and merging…' : 'Open & merge PR'}
            </button>
          </div>
        ) : (
          <div className="mt-2.5 border-t border-[var(--border-subtle)] pt-2.5 text-[var(--text-10)] text-[var(--muted)]">
            Only open native change requests can be published.
          </div>
        )
      ) : (
        <PublishedMirror
          requestNumber={requestNumber}
          nativeIsOpen={isOpen}
          mirror={mirror}
          disabled={disabled}
          busy={busy}
          mergeMethod={mergeMethod}
          onMergeMethodChange={onMergeMethodChange}
          mutate={mutate}
        />
      )}
    </div>
  );
}

function PublishedMirror({
  requestNumber,
  nativeIsOpen,
  mirror,
  disabled,
  busy,
  mergeMethod,
  onMergeMethodChange,
  mutate,
}: {
  requestNumber: number;
  nativeIsOpen: boolean;
  mirror: ChangeRequestGithubMirrorView;
  disabled: boolean;
  busy: string | null;
  mergeMethod: GithubMirrorMergeMethod;
  onMergeMethodChange: (method: GithubMirrorMergeMethod) => void;
  mutate: (action: string, operation: () => Promise<ChangeRequestView>) => Promise<unknown>;
}) {
  const confirm = useAppConfirmDialog();
  const mirrorIsOpen = mirror.state === 'open';

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--border-subtle)] pt-2.5 text-[var(--text-10)]">
        {mirror.htmlUrl ? (
          <a
            href={mirror.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-[var(--weight-bold)] text-[var(--accent)] hover:underline"
          >
            {mirror.owner}/{mirror.repo}#{mirror.pullNumber}
            <ExternalLinkIcon />
          </a>
        ) : (
          <span className="font-[var(--weight-bold)] text-[var(--fg-secondary)]">
            {mirror.owner}/{mirror.repo}#{mirror.pullNumber}
          </span>
        )}
        <span aria-hidden="true" className="text-[var(--border)]">·</span>
        <span className="font-mono text-[var(--muted)]">{mirror.headBranch}</span>
        {mirrorIsOpen ? (
          <>
            <span aria-hidden="true" className="text-[var(--border)]">·</span>
            <span className={mirror.outOfDate ? 'text-[var(--yellow)]' : 'text-[var(--green)]'}>
              {mirror.outOfDate ? 'Update available' : 'Up to date'}
            </span>
          </>
        ) : null}
      </div>

      {mirror.lastError ? (
        <div className="mt-2.5 border-l-2 border-[var(--red)] px-2.5 py-1 text-[var(--text-10)] text-[var(--red)]">
          {mirror.lastError}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5">
        <label className="flex h-8 items-center gap-2 px-1 text-[var(--text-10)] text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={mirror.autoUpdate}
            disabled={disabled || !mirrorIsOpen || !nativeIsOpen}
            onChange={(event) =>
              void mutate('github-auto-update', () =>
                setChangeRequestMirrorAutoUpdate(requestNumber, event.target.checked),
              )
            }
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Auto-update
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void mutate('github-refresh', () => refreshChangeRequestMirror(requestNumber))
          }
          className={ghostButtonClassName}
        >
          {busy === 'github-refresh' ? 'Refreshing…' : 'Refresh status'}
        </button>
        {mirrorIsOpen && nativeIsOpen ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void mutate('github-sync', () => syncChangeRequestMirror(requestNumber))
            }
            className={secondaryButtonClassName}
          >
            {busy === 'github-sync' ? 'Updating…' : 'Update PR'}
          </button>
        ) : null}
        {mirrorIsOpen && nativeIsOpen ? (
          <>
            <MergeMethodSelect
              value={mergeMethod}
              disabled={disabled}
              onChange={onMergeMethodChange}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Merge GitHub pull request?',
                    message: `${mergeMethod === 'squash' ? 'Squash-merge' : mergeMethod === 'rebase' ? 'Rebase-merge' : 'Merge'} GitHub PR #${mirror.pullNumber}?`,
                    confirmLabel: 'Merge pull request',
                  })
                ) {
                  void mutate('github-merge', () =>
                    mergeChangeRequestMirror(requestNumber, mergeMethod),
                  );
                }
              }}
              className={primaryButtonClassName}
            >
              {busy === 'github-merge' ? 'Merging…' : 'Merge PR'}
            </button>
          </>
        ) : null}
        {mirrorIsOpen ? (
          <button
            type="button"
            disabled={disabled}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Close GitHub pull request?',
                  message: `Close GitHub PR #${mirror.pullNumber} without merging it?`,
                  confirmLabel: 'Close pull request',
                  destructive: true,
                })
              ) {
                void mutate('github-close', () => closeChangeRequestMirror(requestNumber));
              }
            }}
            className={dangerButtonClassName}
          >
            {busy === 'github-close' ? 'Closing…' : 'Close PR'}
          </button>
        ) : null}
      </div>
    </>
  );
}

function MergeMethodSelect({
  value,
  disabled,
  onChange,
}: {
  value: GithubMirrorMergeMethod;
  disabled: boolean;
  onChange: (method: GithubMirrorMergeMethod) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--surface-inset-faint)] pl-2.5 text-[var(--text-9)] text-[var(--muted-dim)]">
      <span className="whitespace-nowrap">Merge with</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as GithubMirrorMergeMethod)}
        className="h-full min-w-24 rounded-r-[var(--radius-medium)] border-0 border-l border-[var(--border-subtle)] bg-transparent px-2 text-[var(--text-10)] text-[var(--fg)] outline-none disabled:opacity-40"
      >
        <option value="squash">Squash</option>
        <option value="merge">Merge commit</option>
        <option value="rebase">Rebase</option>
      </select>
    </label>
  );
}

function MirrorState({ state }: { state: ChangeRequestGithubMirrorView['state'] }) {
  const className =
    state === 'merged'
      ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
      : state === 'closed'
        ? 'bg-[var(--red-subtle)] text-[var(--red)]'
        : 'bg-[var(--green-subtle)] text-[var(--green)]';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[var(--text-9)] font-[var(--weight-bold)] ${className}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {state ? `${state.charAt(0).toUpperCase()}${state.slice(1)}` : state}
    </span>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 1.25a6.75 6.75 0 0 0-2.13 13.16c.34.06.46-.15.46-.33v-1.3c-1.9.41-2.3-.8-2.3-.8-.31-.8-.76-1.01-.76-1.01-.62-.43.05-.42.05-.42.69.05 1.05.7 1.05.7.61 1.05 1.6.75 1.99.57.06-.44.24-.75.43-.92-1.51-.17-3.1-.76-3.1-3.34 0-.74.26-1.34.7-1.82-.07-.17-.3-.86.07-1.79 0 0 .57-.18 1.86.7A6.48 6.48 0 0 1 8 4.48c.57 0 1.14.08 1.68.23 1.29-.88 1.86-.7 1.86-.7.37.93.14 1.62.07 1.79.44.48.7 1.08.7 1.82 0 2.59-1.59 3.17-3.1 3.34.25.21.46.63.46 1.27v1.85c0 .18.12.39.47.33A6.75 6.75 0 0 0 8 1.25Z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
      <path d="M6 4H4.5A1.5 1.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13h6a1.5 1.5 0 0 0 1.5-1.5V10M9 3h4v4M13 3 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
