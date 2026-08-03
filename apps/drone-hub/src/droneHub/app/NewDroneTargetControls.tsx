import React from 'react';

import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/components';
import type { RepoRemoteBranchOption } from '../types';
import type { CreateRuntime, RepoBranchSourceMode } from './drone-create-runtime';
import {
  buildNewDroneBranchPickerEntries,
  newDroneBranchPickerValue,
  newDroneHostBranchLabel,
  parseNewDroneBranchPickerValue,
} from './new-drone-branch-picker';

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

const INLINE_TRIGGER_CLASS =
  '!h-8 justify-start !gap-1 !border-transparent !bg-transparent px-2 text-[.6875rem] !font-medium normal-case tracking-normal !text-[var(--chat-composer-model-fg)] hover:!opacity-70';

function RuntimeIcon({
  runtime,
  className = 'h-3.5 w-3.5',
}: {
  runtime: CreateRuntime;
  className?: string;
}) {
  if (runtime === 'host') {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.4 7.7 7.6 4.2 7.6-4.2M12 12v9" />
    </svg>
  );
}

const RUNTIME_ENTRIES: UiMenuSelectEntry[] = [
  {
    value: 'container',
    label: (
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[.3125rem] bg-[var(--accent-subtle)] text-[var(--accent)]">
          <RuntimeIcon runtime="container" />
        </span>
        <span className="min-w-0">
          <span className="block text-[var(--fg)]">Container</span>
          <span className="block whitespace-nowrap text-[9px] font-normal leading-tight text-[var(--muted-dim)]">
            Isolated workspace
          </span>
        </span>
      </span>
    ),
    title: 'Create the new drone in a managed container.',
    className: '!px-2.5 !py-1.5',
  },
  {
    value: 'host',
    label: (
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[.3125rem] bg-[var(--green-subtle)] text-[var(--green)]">
          <RuntimeIcon runtime="host" />
        </span>
        <span className="min-w-0">
          <span className="block text-[var(--fg)]">Host</span>
          <span className="block whitespace-nowrap text-[9px] font-normal leading-tight text-[var(--muted-dim)]">
            This machine
          </span>
        </span>
      </span>
    ),
    title: 'Create the new drone directly on the host machine.',
    className: '!px-2.5 !py-1.5',
  },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={`text-[var(--accent)] opacity-80 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M4.427 6.573a.25.25 0 0 1 .177-.073h6.792a.25.25 0 0 1 .177.427l-3.396 3.396a.25.25 0 0 1-.354 0L4.427 6.927a.25.25 0 0 1 0-.354Z" />
    </svg>
  );
}

function RuntimeLabel({ runtime }: { runtime: CreateRuntime }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={runtime === 'container' ? 'text-[var(--accent)]' : 'text-[var(--green)]'}>
        <RuntimeIcon runtime={runtime} />
      </span>
      <span className="truncate">{runtime === 'container' ? 'Container' : 'Host'}</span>
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
  const remoteBranchCheckoutEnabled = createRuntime === 'container';
  const effectiveBranchSource = remoteBranchCheckoutEnabled ? branchSource : 'host';
  const remoteBranchValid = remoteBranches.some((entry) => entry.name === remoteBranch);
  const branchEntries = React.useMemo(
    () =>
      buildNewDroneBranchPickerEntries({
        hostBranch,
        remoteBranches,
        remoteBranchCheckoutEnabled,
      }),
    [hostBranch, remoteBranchCheckoutEnabled, remoteBranches],
  );
  const branchLabel = branchesLoading
    ? 'Loading branches…'
    : effectiveBranchSource === 'host'
      ? newDroneHostBranchLabel(hostBranch)
      : remoteBranch || 'Select branch';

  return (
    <div className="flex w-full flex-wrap items-center gap-x-[.4375rem] gap-y-1">
      <UiMenuSelect
        variant="toolbar"
        value={createRuntime}
        onValueChange={(value) => onCreateRuntimeChange(value === 'host' ? 'host' : 'container')}
        entries={RUNTIME_ENTRIES}
        disabled={disabled}
        title={`Execution target: ${createRuntime === 'container' ? 'Container' : 'Host'}`}
        triggerLabel={<RuntimeLabel runtime={createRuntime} />}
        triggerLabelClassName="flex min-w-0"
        triggerClassName={`${INLINE_TRIGGER_CLASS} min-w-[5.75rem]`}
        chevron={(open) => <Chevron open={open} />}
        panelClassName="bottom-full !mt-0 mb-1.5 w-[14rem]"
        header="Execution target"
        headerClassName="!px-2.5 !py-1.5"
        menuClassName="!pt-0 !pb-1"
      />

      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        {actions}
        {repoPath ? (
          <UiMenuSelect
            variant="toolbar"
            value={newDroneBranchPickerValue(effectiveBranchSource, remoteBranch)}
            onValueChange={(value) => {
              const selection = parseNewDroneBranchPickerValue(value);
              if (!selection) return;
              if (selection.branchSource === 'remote' && selection.remoteBranch) {
                onRemoteBranchChange(selection.remoteBranch);
              }
              onBranchSourceChange(selection.branchSource);
            }}
            entries={branchEntries}
            disabled={disabled || branchesLoading}
            searchable
            searchPlaceholder="Search branches"
            searchInputClassName="!h-7 !border-[var(--border-subtle)] !bg-transparent focus:!border-[var(--border-subtle)]"
            title={`Branch: ${branchLabel}`}
            triggerLabel={branchLabel}
            triggerLabelClassName="font-mono"
            triggerClassName={`${INLINE_TRIGGER_CLASS} min-w-[5.5rem] max-w-[10.5rem]`}
            chevron={(open) => <Chevron open={open} />}
            panelClassName="bottom-full !mt-0 mb-1.5 w-[18rem] max-w-[calc(100vw-2rem)]"
            menuClassName="max-h-[min(15rem,calc(100vh-8rem))] overflow-y-auto"
            header="Branch"
          />
        ) : null}
      </div>

      {!branchesError &&
      effectiveBranchSource === 'remote' &&
      remoteBranch &&
      !remoteBranchValid ? (
        <div className="basis-full text-[var(--text-10)] text-[var(--yellow)]">
          This saved branch is unavailable. Choose another.
        </div>
      ) : null}
      {branchesError ? (
        <div className="basis-full whitespace-pre-wrap text-[var(--text-10)] text-[var(--red)]">
          {branchesError}
        </div>
      ) : null}
    </div>
  );
}
