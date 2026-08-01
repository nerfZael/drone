import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/components';
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

const HOST_BRANCH_VALUE = 'host';
const REMOTE_BRANCH_VALUE_PREFIX = 'remote:';

function remoteBranchValue(branch: string): string {
  return `${REMOTE_BRANCH_VALUE_PREFIX}${branch}`;
}

function branchKindPill(label: string, tone: 'host' | 'remote') {
  return (
    <span
      className={`flex-shrink-0 rounded-full border px-1.5 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] ${
        tone === 'host'
          ? 'border-[var(--green-border)] bg-[var(--green-subtle)] text-[var(--green)]'
          : 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted-dim)]'
      }`}
    >
      {label}
    </span>
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
  actions,
}: NewDroneTargetControlsProps) {
  const { pullHostBranchBeforeCreate, setPullHostBranchBeforeCreate } = useDroneHubUiStore(
    useShallow((state) => ({
      pullHostBranchBeforeCreate: state.pullHostBranchBeforeCreate,
      setPullHostBranchBeforeCreate: state.setPullHostBranchBeforeCreate,
    })),
  );
  const remoteBranchCheckoutEnabled = createRuntime === 'container';
  const effectiveBranchSource = remoteBranchCheckoutEnabled ? branchSource : 'host';
  const remoteBranchValid = remoteBranches.some((entry) => entry.name === remoteBranch);
  const branchEntries = React.useMemo<UiMenuSelectEntry[]>(
    () => [
      {
        value: HOST_BRANCH_VALUE,
        label: (
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="truncate font-mono text-[var(--text-11)] text-[var(--fg)]">
              {hostBranchLabel(hostBranch)}
            </span>
            {branchKindPill('Host branch', 'host')}
          </span>
        ),
        title: `Use ${hostBranchLabel(hostBranch)} from the host repository.`,
        searchText: `${hostBranchLabel(hostBranch)} host branch current`,
      },
      ...(remoteBranches.length > 0
        ? ([{ kind: 'separator', key: 'host-remote-separator' }] as UiMenuSelectEntry[])
        : []),
      ...remoteBranches.map((entry) => ({
        value: remoteBranchValue(entry.name),
        label: (
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="truncate font-mono text-[var(--text-11)] text-[var(--fg)]">{entry.name}</span>
            {branchKindPill('Remote', 'remote')}
          </span>
        ),
        title: remoteBranchCheckoutEnabled
          ? entry.name
          : `${entry.name} requires the container execution target.`,
        searchText: `${entry.name} ${entry.remote} ${entry.branch} remote ${entry.headSha ?? ''}`,
        disabled: !remoteBranchCheckoutEnabled,
      })),
    ],
    [hostBranch, remoteBranchCheckoutEnabled, remoteBranches],
  );
  const branchPickerValue =
    effectiveBranchSource === 'host' ? HOST_BRANCH_VALUE : remoteBranchValue(remoteBranch);
  const selectedBranchLabel =
    effectiveBranchSource === 'host' ? hostBranchLabel(hostBranch) : remoteBranch;

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
            },
            {
              value: 'host',
              label: 'Host',
              title: 'Create the new drone directly on the host machine.',
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
            <div className="min-w-[15rem] max-w-full flex-1 sm:max-w-[24rem]">
              <UiMenuSelect
                variant="form"
                value={branchPickerValue}
                onValueChange={(next) => {
                  if (next === HOST_BRANCH_VALUE) {
                    onBranchSourceChange('host');
                    return;
                  }
                  if (!next.startsWith(REMOTE_BRANCH_VALUE_PREFIX)) return;
                  onRemoteBranchChange(next.slice(REMOTE_BRANCH_VALUE_PREFIX.length));
                  onBranchSourceChange('remote');
                }}
                entries={branchEntries}
                disabled={disabled || branchesLoading}
                searchable
                searchPlaceholder="Search branches"
                emptySearchLabel="No branches found"
                triggerLabel={
                  branchesLoading ? (
                    'Loading branches…'
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <span className="truncate font-mono text-[var(--text-11)]">
                        {selectedBranchLabel || 'Select branch'}
                      </span>
                      {effectiveBranchSource === 'host'
                        ? branchKindPill('Host branch', 'host')
                        : branchKindPill('Remote', 'remote')}
                    </span>
                  )
                }
                title={selectedBranchLabel || 'Select branch'}
                triggerLabelClassName="flex min-w-0 flex-1"
                panelClassName="bottom-full !right-auto !mt-0 mb-1.5 w-full min-w-[18rem] max-w-[calc(100vw-3rem)]"
                menuClassName="max-h-[min(260px,calc(100vh-8rem))] overflow-y-auto"
              />
              {!branchesLoading && !branchesError && effectiveBranchSource === 'remote' && remoteBranch && !remoteBranchValid ? (
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

            {effectiveBranchSource === 'host' ? (
              <>
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
            ) : null}
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
