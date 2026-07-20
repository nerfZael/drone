import React from 'react';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
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
  pullHostBranchBeforeCreate: boolean;
  onPullHostBranchBeforeCreateChange: (next: boolean) => void;
  remoteBranch: string;
  onRemoteBranchChange: (next: string) => void;
  remoteBranchCheckoutEnabled?: boolean;
  remoteBranchCheckoutDisabledReason?: string | null;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
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
  pullHostBranchBeforeCreate,
  onPullHostBranchBeforeCreateChange,
  remoteBranch,
  onRemoteBranchChange,
  remoteBranchCheckoutEnabled = true,
  remoteBranchCheckoutDisabledReason = null,
  disabled = false,
  className,
  compact = false,
}: RepoBranchSourceControlsProps) {
  const remoteBranchEntries = React.useMemo<UiMenuSelectEntry[]>(
    () =>
      remoteBranches.map((entry) => ({
        value: entry.name,
        label: (
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] text-[var(--fg)]">{entry.name}</div>
            <div className="truncate text-[10px] text-[var(--muted-dim)]">
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

  return (
    <div
      className={
        className ??
        `rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-softest)] ${compact ? 'px-3 py-3' : 'px-4 py-4'}`
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-[var(--muted-dim)]">Repo branch source</div>
          <div className="mt-1 text-[11px] text-[var(--muted)] font-mono truncate" title={repoPath}>
            {repoPath}
          </div>
        </div>
        {loading ? <div className="text-[10px] text-[var(--muted-dim)]">Loading branches…</div> : null}
      </div>
      <div className={`mt-3 grid gap-3 ${compact ? 'lg:grid-cols-2' : 'md:grid-cols-2'}`}>
        <button
          type="button"
          onClick={() => onBranchSourceChange('host')}
          disabled={disabled}
          className={`rounded-xl border px-3 py-3 text-left transition-all ${
            branchSource === 'host'
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:border-[var(--border)]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="text-[11px] font-semibold text-[var(--fg)]">Use host branch</div>
          <div className="mt-1 text-[10px] text-[var(--muted-dim)] uppercase tracking-[0.08em]">Host branch</div>
          <div className="mt-1 font-mono text-[12px] text-[var(--fg-secondary)]">{hostBranchLabel(hostBranch)}</div>
        </button>
        <button
          type="button"
          onClick={() => onBranchSourceChange('remote')}
          disabled={remoteBranchDisabled}
          title={remoteBranchCheckoutDisabledReason ?? undefined}
          className={`rounded-xl border px-3 py-3 text-left transition-all ${
            branchSource === 'remote'
              ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:border-[var(--border)]'
          } ${remoteBranchDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="text-[11px] font-semibold text-[var(--fg)]">Checkout remote branch</div>
          <div className="mt-1 text-[10px] text-[var(--muted-dim)]">
            Creates from a remote-tracking ref without changing local branches.
          </div>
          <div className="mt-2 text-[10px] text-[var(--muted-dim)]">
            {remoteBranches.length} remote branch{remoteBranches.length === 1 ? '' : 'es'} available
          </div>
        </button>
      </div>
      {!remoteBranchCheckoutEnabled && remoteBranchCheckoutDisabledReason ? (
        <div className="mt-3 text-[10px] text-[var(--muted-dim)]">{remoteBranchCheckoutDisabledReason}</div>
      ) : null}

      {branchSource === 'host' ? (
        <label
          className={`mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px] ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          }`}
          title="Run git pull --ff-only on the current host branch before creating the drone."
        >
          <input
            type="checkbox"
            checked={pullHostBranchBeforeCreate}
            onChange={(event) => onPullHostBranchBeforeCreateChange(event.target.checked)}
            disabled={disabled}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span className="text-[var(--muted)]">Pull host branch before create</span>
        </label>
      ) : (
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
            triggerLabelClassName={remoteBranch ? 'font-mono text-[12px]' : undefined}
            title={remoteBranch || 'Select remote branch'}
            menuClassName="max-h-[260px] overflow-y-auto"
          />
          {!loading && !error && remoteBranch && !remoteBranchValid ? (
            <div className="text-[10px] text-[var(--yellow)]">Saved remote branch is not available for this repo. Choose another branch.</div>
          ) : null}
        </div>
      )}

      {error ? <div className="mt-3 text-[10px] text-[var(--red)] whitespace-pre-wrap">{error}</div> : null}
      {!error && !loading && branchSource === 'remote' && remoteBranches.length === 0 ? (
        <div className="mt-3 text-[10px] text-[var(--muted-dim)]">No remote-tracking branches were found for this repo.</div>
      ) : null}
    </div>
  );
}
