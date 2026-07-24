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
  actions?: React.ReactNode;
};

function hostBranchLabel(hostBranch: string | null): string {
  return String(hostBranch ?? '').trim() || 'Detached HEAD';
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
  actions,
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-subtle)] pb-2">
      <section className="flex min-w-0 items-center gap-2">
        <SegmentedToolbarToggle
          label="Execution target"
          hideLabel
          value={createRuntime}
          options={[
            {
              value: 'container',
              label: 'Container',
              title: 'Create the new drone in a managed container.',
              tone: 'accent',
            },
            {
              value: 'host',
              label: 'Host',
              title: 'Create the new drone directly on the host machine.',
              tone: 'yellow',
            },
          ]}
          onChange={onCreateRuntimeChange}
          disabled={disabled}
          tone="accent"
          density="compact"
        />
      </section>

      <span className="hidden h-5 w-px bg-[var(--border)] sm:block" aria-hidden="true" />

      <section className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {repoPath ? (
          <>
            <SegmentedToolbarToggle
              label="Branch target"
              hideLabel
              value={effectiveBranchSource}
              options={[
                {
                  value: 'host',
                  label: 'Host branch',
                  title: `Use ${hostBranchLabel(hostBranch)} from the host repository.`,
                  tone: 'green',
                },
                {
                  value: 'remote',
                  label: 'Remote branch',
                  title: remoteBranchCheckoutEnabled
                    ? 'Checkout a remote-tracking branch.'
                    : 'Remote branches require the container execution target.',
                  disabled: !remoteBranchCheckoutEnabled,
                  tone: 'accent',
                },
              ]}
              onChange={onBranchSourceChange}
              disabled={disabled}
              tone="green"
              density="compact"
            />

            {effectiveBranchSource === 'host' ? (
              <>
                <span className="max-w-48 truncate rounded-full border border-[var(--green-border)] bg-[var(--green-subtle)] px-2 py-1 font-mono text-[var(--text-10)] text-[var(--green)]">
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
                  <span className="relative h-5 w-9 rounded-full border border-[var(--border)] bg-[var(--surface-inset)] transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-3 after:w-3 after:rounded-full after:bg-[var(--muted-dim)] after:shadow-sm after:transition-[transform,background-color] after:content-[''] peer-checked:border-[var(--green-border)] peer-checked:bg-[var(--green-subtle)] peer-checked:after:translate-x-4 peer-checked:after:bg-[var(--green)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--green)]" />
                </label>
              </>
            ) : (
              <div className="min-w-[15rem] flex-1">
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
                  <div className="mt-1 text-[var(--text-10)] text-[var(--yellow)]">
                    This saved branch is unavailable. Choose another.
                  </div>
                ) : null}
                {!branchesLoading && !branchesError && remoteBranches.length === 0 ? (
                  <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
                    No remote-tracking branches found.
                  </div>
                ) : null}
              </div>
            )}
            {branchesError ? (
              <div className="basis-full whitespace-pre-wrap pl-[3.75rem] text-[var(--text-10)] text-[var(--red)]">
                {branchesError}
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-[var(--text-10)] text-[var(--muted-dim)]">Choose a repository in Advanced</span>
        )}
      </section>

      {actions ? (
        <>
          <span className="hidden h-5 w-px bg-[var(--border)] sm:block" aria-hidden="true" />
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </>
      ) : null}
    </div>
  );
}
