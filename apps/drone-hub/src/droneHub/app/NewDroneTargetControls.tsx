import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import type { RepoRemoteBranchOption } from '../types';
import type { CreateRuntime, RepoBranchSourceMode } from './drone-create-runtime';
import { SegmentedToolbarToggle } from './SegmentedToolbarToggle';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type NewDroneTargetControlsProps = {
  createRuntime: CreateRuntime;
  onCreateRuntimeChange: (value: CreateRuntime) => void;
  repoPath: string;
  branchSource: RepoBranchSourceMode;
  onBranchSourceChange: (value: RepoBranchSourceMode) => void;
  remoteBranch: string;
  onRemoteBranchChange: (value: string) => void;
  hostBranch: string | null;
  remoteBranches: RepoRemoteBranchOption[];
  branchesLoading: boolean;
  branchesError: string | null;
  disabled: boolean;
};

function hostBranchLabel(hostBranch: string | null): string {
  return String(hostBranch ?? '').trim() || 'Detached HEAD';
}

function TargetHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[var(--text-10)] font-[var(--weight-bold)] uppercase tracking-[0.1em] text-[var(--muted)]">
      {children}
    </div>
  );
}

export function NewDroneTargetControls({
  createRuntime,
  onCreateRuntimeChange,
  repoPath,
  branchSource,
  onBranchSourceChange,
  remoteBranch,
  onRemoteBranchChange,
  hostBranch,
  remoteBranches,
  branchesLoading,
  branchesError,
  disabled,
}: NewDroneTargetControlsProps) {
  const { pullHostBranchBeforeCreate, setPullHostBranchBeforeCreate } = useDroneHubUiStore(
    useShallow((state) => ({
      pullHostBranchBeforeCreate: state.pullHostBranchBeforeCreate,
      setPullHostBranchBeforeCreate: state.setPullHostBranchBeforeCreate,
    })),
  );
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
  const remoteBranchCheckoutEnabled = createRuntime === 'container';
  const effectiveBranchSource = remoteBranchCheckoutEnabled ? branchSource : 'host';
  const remoteBranchValid = remoteBranches.some((entry) => entry.name === remoteBranch);

  return (
    <div className={`grid gap-3 px-1 pb-1 sm:gap-4 ${repoPath ? 'sm:grid-cols-2' : ''}`}>
      <section className={repoPath ? '' : 'sm:max-w-[34rem]'}>
        <TargetHeading>Execution target</TargetHeading>
        <SegmentedToolbarToggle
          label="Execution target"
          hideLabel
          value={createRuntime}
          options={[
            {
              value: 'container',
              label: 'Container',
              title: 'Create the new drone in a managed container.',
            },
            {
              value: 'host',
              label: 'Host',
              title: 'Create the new drone directly on the host machine.',
            },
          ]}
          onChange={onCreateRuntimeChange}
          disabled={disabled}
        />
      </section>

      {repoPath ? (
        <section>
          <TargetHeading>Branch target</TargetHeading>
          <SegmentedToolbarToggle
            label="Branch target"
            hideLabel
            value={effectiveBranchSource}
            options={[
              {
                value: 'host',
                label: 'Host branch',
                title: `Use ${hostBranchLabel(hostBranch)} from the host repository.`,
              },
              {
                value: 'remote',
                label: 'Remote branch',
                title: remoteBranchCheckoutEnabled
                  ? 'Checkout a remote-tracking branch.'
                  : 'Remote branches require the container execution target.',
                disabled: !remoteBranchCheckoutEnabled,
              },
            ]}
            onChange={onBranchSourceChange}
            disabled={disabled}
          />

          {effectiveBranchSource === 'host' ? (
            <div className="mt-2.5 flex min-h-9 flex-wrap items-center justify-between gap-2 px-1">
              <span className="min-w-0 truncate font-mono text-[var(--text-11)] text-[var(--fg-secondary)]">
                {hostBranchLabel(hostBranch)}
              </span>
              <label
                className={`inline-flex items-center gap-2 text-[var(--text-10)] text-[var(--muted)] ${
                  disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                }`}
                title="Run git pull --ff-only on the current host branch before creating the drone."
              >
                <span>Pull first</span>
                <input
                  type="checkbox"
                  checked={pullHostBranchBeforeCreate}
                  onChange={(event) => setPullHostBranchBeforeCreate(event.target.checked)}
                  disabled={disabled}
                  className="peer sr-only"
                />
                <span className="relative h-5 w-9 rounded-full border border-[var(--border)] bg-[var(--surface-inset)] transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-3 after:w-3 after:rounded-full after:bg-[var(--muted-dim)] after:shadow-sm after:transition-[transform,background-color] after:content-[''] peer-checked:border-[var(--accent-border)] peer-checked:bg-[var(--accent-subtle)] peer-checked:after:translate-x-4 peer-checked:after:bg-[var(--accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]" />
              </label>
            </div>
          ) : (
            <div className="mt-2.5">
              <UiMenuSelect
                variant="form"
                value={remoteBranch}
                onValueChange={onRemoteBranchChange}
                entries={remoteBranchEntries}
                disabled={disabled || branchesLoading || remoteBranchEntries.length === 0}
                searchable
                searchPlaceholder="Search remote branches"
                emptySearchLabel="No branches found"
                triggerLabel={branchesLoading ? 'Loading branches…' : remoteBranch || 'Select remote branch'}
                triggerLabelClassName={remoteBranch ? 'font-mono text-[var(--text-11)]' : undefined}
                title={remoteBranch || 'Select remote branch'}
                menuClassName="max-h-[260px] overflow-y-auto"
              />
              {!branchesLoading && !branchesError && remoteBranch && !remoteBranchValid ? (
                <div className="mt-2 text-[var(--text-10)] text-[var(--yellow)]">
                  This saved branch is unavailable. Choose another.
                </div>
              ) : null}
              {!branchesLoading && !branchesError && remoteBranches.length === 0 ? (
                <div className="mt-2 text-[var(--text-10)] text-[var(--muted-dim)]">
                  No remote-tracking branches found.
                </div>
              ) : null}
            </div>
          )}
          {branchesError ? (
            <div className="mt-2 whitespace-pre-wrap text-[var(--text-10)] text-[var(--red)]">
              {branchesError}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
