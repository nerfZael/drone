import React from 'react';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/components';
import type { RepoBranchSourceMode } from './drone-create-runtime';

type RepoRemoteBranchOption = {
  name: string;
  remote: string;
  branch: string;
  headSha: string | null;
};

type RepoBranchSourceControlsProps = {
  repoPath: string;
  hostBranch: string | null;
  remoteBranches: RepoRemoteBranchOption[];
  loading?: boolean;
  error?: string | null;
  branchSource: RepoBranchSourceMode;
  onBranchSourceChange: (next: RepoBranchSourceMode) => void;
  remoteBranch: string;
  onRemoteBranchChange: (next: string) => void;
  remoteBranchCheckoutEnabled?: boolean;
  remoteBranchCheckoutDisabledReason?: string | null;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  appearance?: 'card' | 'flat';
};

function hostBranchLabel(hostBranch: string | null): string {
  return String(hostBranch ?? '').trim() || 'Detached HEAD';
}

export function RepoBranchSourceControls({
  repoPath,
  hostBranch,
  remoteBranches,
  loading = false,
  error = null,
  branchSource,
  onBranchSourceChange,
  remoteBranch,
  onRemoteBranchChange,
  remoteBranchCheckoutEnabled = true,
  remoteBranchCheckoutDisabledReason = null,
  disabled = false,
  className,
  compact = false,
  appearance = 'card',
}: RepoBranchSourceControlsProps) {
  const remoteBranchEntries = React.useMemo<UiMenuSelectEntry[]>(
    () =>
      remoteBranches.map((entry) => ({
        value: entry.name,
        label: (
          <div className="min-w-0">
            <div className="truncate font-mono text-[var(--text-11)] text-[var(--fg)]">{entry.name}</div>
            <div className="truncate text-[var(--text-10)] text-[var(--muted-dim)]">
              {entry.remote} • {entry.branch}
            </div>
          </div>
        ),
        title: entry.name,
        searchText: `${entry.name} ${entry.remote} ${entry.branch} ${entry.headSha ?? ''}`,
      })),
    [remoteBranches],
  );
  const remoteBranchValid = remoteBranches.some((entry) => entry.name === remoteBranch);
  const remoteBranchDisabled = disabled || !remoteBranchCheckoutEnabled;
  const flat = appearance === 'flat';

  return (
    <div
      className={
        className ??
        (flat
          ? 'border-t border-[var(--border-subtle)] pt-5'
          : `rounded-[var(--radius-xlarge)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] ${compact ? 'px-3 py-3' : 'px-4 py-4'}`)
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className={`${flat ? 'text-[var(--text-12)] text-[var(--fg)]' : 'text-[var(--text-10)] tracking-[0.12em] uppercase text-[var(--muted-dim)]'} font-[var(--weight-semibold)]`}>Repo branch source</div>
          <div className="mt-1 text-[var(--text-11)] text-[var(--muted)] font-mono truncate" title={repoPath}>
            {repoPath}
          </div>
        </div>
        {loading ? <div className="text-[var(--text-10)] text-[var(--muted-dim)]">Loading branches…</div> : null}
      </div>
      <div className={`mt-3 grid ${flat ? 'gap-5' : 'gap-3'} ${compact ? 'lg:grid-cols-2' : 'md:grid-cols-2'}`}>
        <button
          type="button"
          onClick={() => onBranchSourceChange('host')}
          disabled={disabled}
          aria-pressed={branchSource === 'host'}
          className={`${flat ? 'border-b-2 px-0' : 'rounded-[var(--radius-large)] px-3'} py-3 text-left transition-colors ${
            flat
              ? branchSource === 'host'
                ? 'border-[var(--accent)]'
                : 'border-transparent hover:text-[var(--fg-secondary)]'
              : branchSource === 'host'
                ? 'border border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                : 'border border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:border-[var(--border)]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {flat ? (
            <div className="flex items-start gap-2.5">
              <span aria-hidden="true" className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${branchSource === 'host' ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'}`} />
              <span className="min-w-0">
                <span className="block text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">Host branch</span>
                <span className="mt-1 block truncate font-mono text-[var(--text-11)] text-[var(--muted)]">{hostBranchLabel(hostBranch)}</span>
              </span>
            </div>
          ) : (
            <>
              <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">Use host branch</div>
              <div className="mt-1 text-[var(--text-10)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Host branch</div>
              <div className="mt-1 font-mono text-[var(--text-12)] text-[var(--fg-secondary)]">{hostBranchLabel(hostBranch)}</div>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => onBranchSourceChange('remote')}
          disabled={remoteBranchDisabled}
          aria-pressed={branchSource === 'remote'}
          title={remoteBranchCheckoutDisabledReason ?? undefined}
          className={`${flat ? 'border-b-2 px-0' : 'rounded-[var(--radius-large)] px-3'} py-3 text-left transition-colors ${
            flat
              ? branchSource === 'remote'
                ? 'border-[var(--accent)]'
                : 'border-transparent hover:text-[var(--fg-secondary)]'
              : branchSource === 'remote'
                ? 'border border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                : 'border border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:border-[var(--border)]'
          } ${remoteBranchDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {flat ? (
            <div className="flex items-start gap-2.5">
              <span aria-hidden="true" className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${branchSource === 'remote' ? 'bg-[var(--accent)]' : 'bg-[var(--control-off)]'}`} />
              <span className="min-w-0">
                <span className="block text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">Remote branch</span>
                <span className="mt-1 block text-[var(--text-10)] text-[var(--muted-dim)]">
                  {remoteBranches.length} branch{remoteBranches.length === 1 ? '' : 'es'} available
                </span>
              </span>
            </div>
          ) : (
            <>
              <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg)]">Checkout remote branch</div>
              <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
                Creates from a remote-tracking ref without changing local branches.
              </div>
              <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
                {remoteBranches.length} remote branch{remoteBranches.length === 1 ? '' : 'es'} available
              </div>
            </>
          )}
        </button>
      </div>
      {!remoteBranchCheckoutEnabled && remoteBranchCheckoutDisabledReason ? (
        <div className="mt-3 text-[var(--text-10)] text-[var(--muted-dim)]">{remoteBranchCheckoutDisabledReason}</div>
      ) : null}

      {branchSource === 'remote' ? (
        <div className="mt-3 flex flex-col gap-2">
          <UiMenuSelect
            variant="form"
            value={remoteBranch}
            onValueChange={onRemoteBranchChange}
            entries={remoteBranchEntries}
            disabled={disabled || loading || remoteBranchEntries.length === 0}
            searchable
            searchPlaceholder="Search remote branches"
            emptySearchLabel="No branches found"
            triggerLabel={remoteBranch || 'Select remote branch'}
            triggerLabelClassName={remoteBranch ? 'font-mono text-[var(--text-12)]' : undefined}
            title={remoteBranch || 'Select remote branch'}
            menuClassName="max-h-[260px] overflow-y-auto"
          />
          {!loading && !error && remoteBranch && !remoteBranchValid ? (
            <div className="text-[var(--text-10)] text-[var(--yellow)]">Saved remote branch is not available for this repo. Choose another branch.</div>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="mt-3 text-[var(--text-10)] text-[var(--red)] whitespace-pre-wrap">{error}</div> : null}
      {!error && !loading && branchSource === 'remote' && remoteBranches.length === 0 ? (
        <div className="mt-3 text-[var(--text-10)] text-[var(--muted-dim)]">No remote-tracking branches were found for this repo.</div>
      ) : null}
    </div>
  );
}
