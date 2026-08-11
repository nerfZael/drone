import React from 'react';

export type GithubMirrorMergeMethod = 'merge' | 'squash' | 'rebase';

export type ChangeRequestGithubMirrorView = {
  owner: string;
  repo: string;
  pullNumber: number;
  htmlUrl: string;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  state: 'open' | 'closed' | 'merged';
  autoUpdate: boolean;
  branchOwnedByDroneHub: boolean;
  syncedRevision: number;
  mergeCommitSha: string | null;
  lastError: string | null;
  outOfDate: boolean;
};

export function ChangeRequestGithubMirrorPanel({
  requestId,
  nativeStatus,
  mirror,
  disabled,
  busy,
  mergeMethod,
  onMergeMethodChange,
  mutate,
}: {
  requestId: string;
  nativeStatus: 'open' | 'merged' | 'closed';
  mirror: ChangeRequestGithubMirrorView | null;
  disabled: boolean;
  busy: string | null;
  mergeMethod: GithubMirrorMergeMethod;
  onMergeMethodChange: (method: GithubMirrorMergeMethod) => void;
  mutate: (
    action: string,
    pathname: string,
    method: 'PATCH' | 'POST',
    body?: Record<string, unknown>,
  ) => Promise<unknown>;
}) {
  const basePath = `/api/change-requests/${encodeURIComponent(requestId)}/github`;
  const isOpen = nativeStatus === 'open';

  return (
    <div className="mt-3 rounded-[var(--radius-large)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[var(--text-12)] font-[var(--weight-semibold)] text-[var(--fg)]">
            GitHub pull-request mirror
          </div>
          <div className="mt-0.5 text-[var(--text-10)] text-[var(--muted)]">
            User-controlled publishing through the host GitHub account.
          </div>
        </div>
        {mirror ? (
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase text-[var(--fg-secondary)]">
            {mirror.state}
          </span>
        ) : null}
      </div>

      {!mirror ? (
        isOpen ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <MergeMethodSelect
              value={mergeMethod}
              disabled={disabled}
              onChange={onMergeMethodChange}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void mutate('github-publish', `${basePath}/publish`, 'POST', {
                  merge: false,
                  mergeMethod,
                })
              }
              className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40"
            >
              {busy === 'github-publish' ? 'Opening…' : 'Open GitHub PR'}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (
                  window.confirm(
                    `Open a GitHub pull request and immediately try to ${mergeMethod}-merge it?`,
                  )
                ) {
                  void mutate('github-publish-merge', `${basePath}/publish`, 'POST', {
                    merge: true,
                    mergeMethod,
                  });
                }
              }}
              className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent-fg)] disabled:opacity-40"
            >
              {busy === 'github-publish-merge' ? 'Opening and merging…' : 'Open & merge PR'}
            </button>
          </div>
        ) : (
          <div className="mt-3 text-[var(--text-11)] text-[var(--muted)]">
            Only open native change requests can be published.
          </div>
        )
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-11)]">
            {mirror.htmlUrl ? (
              <a
                href={mirror.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-[var(--weight-semibold)] text-[var(--accent)] hover:underline"
              >
                {mirror.owner}/{mirror.repo}#{mirror.pullNumber}
              </a>
            ) : (
              <span className="font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
                {mirror.owner}/{mirror.repo}#{mirror.pullNumber}
              </span>
            )}
            <span className="font-mono text-[var(--muted-dim)]">{mirror.headBranch}</span>
            {mirror.state === 'open' ? (
              mirror.outOfDate ? (
                <span className="rounded border border-[var(--yellow-border)] bg-[var(--yellow-subtle)] px-1.5 py-0.5 text-[var(--text-9)] text-[var(--yellow)]">
                  out of date
                </span>
              ) : (
                <span className="text-[var(--green)]">up to date</span>
              )
            ) : null}
          </div>

          {mirror.lastError ? (
            <div className="mt-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">
              {mirror.lastError}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex h-8 items-center gap-2 rounded border border-[var(--border)] px-2 text-[var(--text-10)] text-[var(--fg-secondary)]">
              <input
                type="checkbox"
                checked={mirror.autoUpdate}
                disabled={disabled || mirror.state !== 'open' || !isOpen}
                onChange={(event) =>
                  void mutate('github-auto-update', basePath, 'PATCH', {
                    autoUpdate: event.target.checked,
                  })
                }
              />
              Auto-update
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void mutate('github-refresh', `${basePath}/refresh`, 'POST')}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40"
            >
              {busy === 'github-refresh' ? 'Refreshing…' : 'Refresh status'}
            </button>
            {mirror.state === 'open' && isOpen ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void mutate('github-sync', `${basePath}/sync`, 'POST')}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-40"
              >
                {busy === 'github-sync' ? 'Updating…' : 'Update PR now'}
              </button>
            ) : null}
            {mirror.state === 'open' && isOpen ? (
              <>
                <MergeMethodSelect
                  value={mergeMethod}
                  disabled={disabled}
                  onChange={onMergeMethodChange}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        `${mergeMethod === 'squash' ? 'Squash-merge' : mergeMethod === 'rebase' ? 'Rebase-merge' : 'Merge'} GitHub PR #${mirror.pullNumber}?`,
                      )
                    ) {
                      void mutate('github-merge', `${basePath}/merge`, 'POST', {
                        method: mergeMethod,
                      });
                    }
                  }}
                  className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--accent-fg)] disabled:opacity-40"
                >
                  {busy === 'github-merge' ? 'Merging…' : 'Merge PR'}
                </button>
              </>
            ) : null}
            {mirror.state === 'open' ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(`Close GitHub PR #${mirror.pullNumber} without merging it?`)) {
                    void mutate('github-close', `${basePath}/close`, 'POST');
                  }
                }}
                className="rounded border border-[var(--red-border)] px-3 py-1.5 text-[var(--text-11)] text-[var(--red)] disabled:opacity-40"
              >
                {busy === 'github-close' ? 'Closing…' : 'Close PR'}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
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
    <label className="text-[var(--text-9)] text-[var(--muted-dim)]">
      GitHub merge method
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as GithubMirrorMergeMethod)}
        className="mt-1 block h-8 rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] px-2 text-[var(--text-10)] text-[var(--fg)]"
      >
        <option value="squash">Squash</option>
        <option value="merge">Merge commit</option>
        <option value="rebase">Rebase</option>
      </select>
    </label>
  );
}
